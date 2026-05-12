
ALTER TABLE public.whatsapp_messages 
ADD COLUMN channel text NOT NULL DEFAULT 'whatsapp';

CREATE INDEX idx_whatsapp_messages_channel ON public.whatsapp_messages(channel);
