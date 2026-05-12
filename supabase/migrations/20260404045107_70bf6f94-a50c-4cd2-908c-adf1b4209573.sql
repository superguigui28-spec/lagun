CREATE POLICY "Partners can insert messages"
ON public.whatsapp_messages
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
);