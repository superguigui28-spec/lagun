CREATE TABLE public.meta_ads_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  tool_name TEXT NOT NULL,
  tool_arguments JSONB NOT NULL DEFAULT '{}',
  system_prompt TEXT,
  ai_messages JSONB,
  ai_model TEXT,
  latest_media_url TEXT,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_ads_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own jobs" ON public.meta_ads_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own jobs" ON public.meta_ads_jobs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service can update jobs" ON public.meta_ads_jobs FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER update_meta_ads_jobs_updated_at BEFORE UPDATE ON public.meta_ads_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();