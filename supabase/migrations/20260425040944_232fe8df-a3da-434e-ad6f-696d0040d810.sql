
-- 1. Tabela de contas Instagram conectadas por creator
CREATE TABLE public.creator_instagram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.crm_creators(id) ON DELETE CASCADE,
  instagram_user_id text NOT NULL UNIQUE,
  username text NOT NULL,
  profile_picture_url text,
  account_type text,
  access_token text NOT NULL,
  token_expires_at timestamptz,
  followers_count integer DEFAULT 0,
  media_count integer DEFAULT 0,
  last_synced_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creator_instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and partners can view IG accounts"
  ON public.creator_instagram_accounts FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role));

CREATE POLICY "Admins and partners can update IG accounts"
  ON public.creator_instagram_accounts FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role));

CREATE POLICY "Admins can delete IG accounts"
  ON public.creator_instagram_accounts FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert IG accounts"
  ON public.creator_instagram_accounts FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update IG accounts"
  ON public.creator_instagram_accounts FOR UPDATE
  TO public
  USING (auth.role() = 'service_role');

CREATE TRIGGER update_creator_instagram_accounts_updated_at
  BEFORE UPDATE ON public.creator_instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_creator_ig_creator_id ON public.creator_instagram_accounts(creator_id);
CREATE INDEX idx_creator_ig_status ON public.creator_instagram_accounts(status);

-- 2. Lista de @s alvo de divulgação (admin gerencia)
CREATE TABLE public.promotion_target_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text,
  instagram_user_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.promotion_target_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and partners can manage target accounts"
  ON public.promotion_target_accounts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role));

CREATE POLICY "Service role can read target accounts"
  ON public.promotion_target_accounts FOR SELECT
  TO public
  USING (auth.role() = 'service_role');

CREATE TRIGGER update_promotion_target_accounts_updated_at
  BEFORE UPDATE ON public.promotion_target_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Vínculo entre eventos e @s alvo
CREATE TABLE public.event_promotion_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  target_account_id uuid NOT NULL REFERENCES public.promotion_target_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, target_account_id)
);

ALTER TABLE public.event_promotion_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and partners can manage event targets"
  ON public.event_promotion_targets FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role));

CREATE POLICY "Service role can read event targets"
  ON public.event_promotion_targets FOR SELECT
  TO public
  USING (auth.role() = 'service_role');

CREATE INDEX idx_event_targets_event ON public.event_promotion_targets(event_id);
CREATE INDEX idx_event_targets_target ON public.event_promotion_targets(target_account_id);

-- 4. Conteúdo detectado (posts e stories que mencionam um @ alvo)
CREATE TABLE public.creator_content_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES public.creator_instagram_accounts(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.crm_creators(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  target_account_id uuid REFERENCES public.promotion_target_accounts(id) ON DELETE SET NULL,
  media_id text NOT NULL,
  media_type text NOT NULL,
  permalink text,
  thumbnail_url text,
  caption text,
  detected_mention text,
  reach integer DEFAULT 0,
  impressions integer DEFAULT 0,
  likes integer DEFAULT 0,
  comments integer DEFAULT 0,
  saves integer DEFAULT 0,
  views integer DEFAULT 0,
  posted_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  UNIQUE (instagram_account_id, media_id, target_account_id)
);

ALTER TABLE public.creator_content_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and partners can view detections"
  ON public.creator_content_detections FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'partner'::app_role));

CREATE POLICY "Admins can delete detections"
  ON public.creator_content_detections FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert detections"
  ON public.creator_content_detections FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update detections"
  ON public.creator_content_detections FOR UPDATE
  TO public
  USING (auth.role() = 'service_role');

CREATE INDEX idx_detections_creator ON public.creator_content_detections(creator_id);
CREATE INDEX idx_detections_event ON public.creator_content_detections(event_id);
CREATE INDEX idx_detections_posted_at ON public.creator_content_detections(posted_at DESC);

-- Seed inicial: adicionar @s padrão da Tríade
INSERT INTO public.promotion_target_accounts (username, display_name, active) VALUES
  ('triade.ent', 'Tríade Entretenimento', true),
  ('maestria.rap', 'Maestria RAP', true)
ON CONFLICT (username) DO NOTHING;
