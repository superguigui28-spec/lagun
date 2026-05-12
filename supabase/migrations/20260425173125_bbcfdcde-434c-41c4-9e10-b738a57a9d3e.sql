ALTER TABLE public._dedup_email_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage dedup map" ON public._dedup_email_map
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));