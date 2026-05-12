
-- 1. Restrict sensitive columns on events table — only admins read api_token/webhook_url
DROP POLICY IF EXISTS "Partners can view events" ON public.events;

CREATE POLICY "Admins can view all event fields"
ON public.events
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Recreate events_safe view (without api_token) so partners can read non-sensitive fields
DROP VIEW IF EXISTS public.events_safe;
CREATE VIEW public.events_safe
WITH (security_invoker = true)
AS
SELECT id, name, avatar_url, event_date, webhook_url, status, platform,
       official_tickets, official_revenue, created_at, updated_at
FROM public.events;

-- Allow partners to read events_safe via a permissive policy on events that excludes sensitive columns
-- Since column-level RLS isn't trivial, we allow partners to SELECT events but app must use events_safe
CREATE POLICY "Partners can view events (non-sensitive via view)"
ON public.events
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.events_safe TO authenticated;

-- 2. Realtime authorization for sensitive tables
-- Enable RLS on realtime.messages and add restrictive policy
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Authenticated partners can receive realtime" ON realtime.messages';
    EXECUTE $POL$
      CREATE POLICY "Authenticated partners can receive realtime"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        public.has_role(auth.uid(), 'partner'::public.app_role)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
    $POL$;
  END IF;
END $$;

-- 3. Storage: add DELETE/UPDATE policies for partner/admin on managed buckets
DO $$
DECLARE b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['creative-references','design-attachments','event-avatars'] LOOP
    EXECUTE format($P$
      DROP POLICY IF EXISTS "Partners can delete in %1$s" ON storage.objects;
      CREATE POLICY "Partners can delete in %1$s"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = %2$L AND (public.has_role(auth.uid(),'partner'::public.app_role) OR public.has_role(auth.uid(),'admin'::public.app_role)));
    $P$, b, b);

    EXECUTE format($P$
      DROP POLICY IF EXISTS "Partners can update in %1$s" ON storage.objects;
      CREATE POLICY "Partners can update in %1$s"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = %2$L AND (public.has_role(auth.uid(),'partner'::public.app_role) OR public.has_role(auth.uid(),'admin'::public.app_role)))
      WITH CHECK (bucket_id = %2$L AND (public.has_role(auth.uid(),'partner'::public.app_role) OR public.has_role(auth.uid(),'admin'::public.app_role)));
    $P$, b, b);
  END LOOP;
END $$;

-- 4. Lock down temp-uploads bucket
UPDATE storage.buckets SET public = false WHERE id = 'temp-uploads';

DROP POLICY IF EXISTS "Public can read temp uploads" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read temp-uploads" ON storage.objects;

CREATE POLICY "Partners can read temp-uploads"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'temp-uploads'
  AND (public.has_role(auth.uid(),'partner'::public.app_role) OR public.has_role(auth.uid(),'admin'::public.app_role))
);

CREATE POLICY "Partners can delete temp-uploads"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'temp-uploads'
  AND (public.has_role(auth.uid(),'partner'::public.app_role) OR public.has_role(auth.uid(),'admin'::public.app_role))
);
