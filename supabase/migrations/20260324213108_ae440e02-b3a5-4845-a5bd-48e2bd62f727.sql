
-- Events table for managing events with avatars and webhook configs
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  avatar_url text,
  event_date date,
  webhook_url text,
  api_token text,
  platform text DEFAULT 'manual',
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view events" ON public.events FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can insert events" ON public.events FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can update events" ON public.events FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can delete events" ON public.events FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Design demands table
CREATE TABLE public.design_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text,
  publish_date date,
  status text DEFAULT 'pendente',
  attachments text[] DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.design_demands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view demands" ON public.design_demands FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can insert demands" ON public.design_demands FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can update demands" ON public.design_demands FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can delete demands" ON public.design_demands FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Storage bucket for event avatars
INSERT INTO storage.buckets (id, name, public) VALUES ('event-avatars', 'event-avatars', true);

CREATE POLICY "Partners can upload event avatars" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-avatars' AND (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Anyone can view event avatars" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'event-avatars');

-- Storage bucket for design attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('design-attachments', 'design-attachments', true);

CREATE POLICY "Partners can upload design attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'design-attachments' AND (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Anyone can view design attachments" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'design-attachments');
