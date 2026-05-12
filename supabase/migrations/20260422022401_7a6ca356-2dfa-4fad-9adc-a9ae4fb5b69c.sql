-- Restrict crm_creators reads to partners/admins
DROP POLICY IF EXISTS "Authenticated users can read creators" ON public.crm_creators;
CREATE POLICY "Partners can view creators"
ON public.crm_creators
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Restrict whatsapp_messages Realtime to partners/admins
ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;