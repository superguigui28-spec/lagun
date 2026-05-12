
CREATE TABLE public.crm_creators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  instagram TEXT NOT NULL,
  tiktok TEXT,
  followers_instagram INTEGER NOT NULL DEFAULT 0,
  followers_tiktok INTEGER NOT NULL DEFAULT 0,
  video_skill TEXT NOT NULL,
  music_style TEXT NOT NULL,
  motivation TEXT NOT NULL,
  expected_value NUMERIC NOT NULL DEFAULT 0,
  qualification TEXT NOT NULL DEFAULT '🧪 Em Observação',
  qualification_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read creators"
  ON public.crm_creators FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anyone can insert creators"
  ON public.crm_creators FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
