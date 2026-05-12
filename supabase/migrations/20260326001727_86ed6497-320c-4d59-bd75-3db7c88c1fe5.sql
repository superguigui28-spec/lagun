CREATE TABLE public.whatsapp_bot_settings (
  phone TEXT PRIMARY KEY,
  bot_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert bot settings" ON public.whatsapp_bot_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update bot settings" ON public.whatsapp_bot_settings FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Partners can view bot settings" ON public.whatsapp_bot_settings FOR SELECT TO authenticated USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
