
CREATE TABLE public.ad_creative_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_creative_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view ad comments"
ON public.ad_creative_comments FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can insert ad comments"
ON public.ad_creative_comments FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can update ad comments"
ON public.ad_creative_comments FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can delete ad comments"
ON public.ad_creative_comments FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_ad_creative_comments_updated_at
BEFORE UPDATE ON public.ad_creative_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ad_creative_comments_ad_id ON public.ad_creative_comments(ad_id);
