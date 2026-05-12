
-- 1. Fix temp-uploads storage policies
DROP POLICY IF EXISTS "Auth insert temp-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete temp-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload temp files" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete own temp files" ON storage.objects;

CREATE POLICY "Authenticated can upload temp files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'temp-uploads');

CREATE POLICY "Owners can delete own temp files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'temp-uploads' AND owner = auth.uid());

-- 2. Fix webhook_logs
DROP POLICY IF EXISTS "Anyone can insert webhook logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "Service role can insert webhook logs" ON public.webhook_logs;

CREATE POLICY "Service role can insert webhook logs"
  ON public.webhook_logs FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- 3. Fix whatsapp_messages
DROP POLICY IF EXISTS "Anyone can insert messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Service role can insert messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Service role can update messages" ON public.whatsapp_messages;

CREATE POLICY "Service role can insert messages"
  ON public.whatsapp_messages FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update messages"
  ON public.whatsapp_messages FOR UPDATE
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Fix whatsapp_bot_settings
DROP POLICY IF EXISTS "Anyone can insert bot settings" ON public.whatsapp_bot_settings;
DROP POLICY IF EXISTS "Anyone can update bot settings" ON public.whatsapp_bot_settings;
DROP POLICY IF EXISTS "Partners can insert bot settings" ON public.whatsapp_bot_settings;
DROP POLICY IF EXISTS "Partners can update bot settings" ON public.whatsapp_bot_settings;

CREATE POLICY "Partners can insert bot settings"
  ON public.whatsapp_bot_settings FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can update bot settings"
  ON public.whatsapp_bot_settings FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- 5. Fix maestria_birthday
DROP POLICY IF EXISTS "Anyone can check coupon exists" ON public.maestria_birthday;
DROP POLICY IF EXISTS "Anyone can insert birthday" ON public.maestria_birthday;
DROP POLICY IF EXISTS "Service role and admins can read birthday" ON public.maestria_birthday;
DROP POLICY IF EXISTS "Service role can insert birthday" ON public.maestria_birthday;

CREATE POLICY "Service role and admins can read birthday"
  ON public.maestria_birthday FOR SELECT
  TO public
  USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert birthday"
  ON public.maestria_birthday FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- 6. Fix crm_creators
DROP POLICY IF EXISTS "Anyone can insert creators" ON public.crm_creators;
DROP POLICY IF EXISTS "Service role can insert creators" ON public.crm_creators;

CREATE POLICY "Service role can insert creators"
  ON public.crm_creators FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- 7. Create secure view for events without api_token
DROP VIEW IF EXISTS public.events_safe;
CREATE OR REPLACE VIEW public.events_safe AS
  SELECT id, name, avatar_url, event_date, webhook_url, platform, status, 
         official_tickets, official_revenue, created_at, updated_at
  FROM public.events;
