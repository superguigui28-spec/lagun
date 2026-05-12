
-- Table to store TráfegoGPT conversations
CREATE TABLE public.trafego_gpt_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_name TEXT,
  campaign_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.trafego_gpt_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversations"
ON public.trafego_gpt_conversations FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations"
ON public.trafego_gpt_conversations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations"
ON public.trafego_gpt_conversations FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations"
ON public.trafego_gpt_conversations FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_trafego_gpt_conversations_user_id ON public.trafego_gpt_conversations(user_id);
CREATE INDEX idx_trafego_gpt_conversations_updated_at ON public.trafego_gpt_conversations(updated_at DESC);
