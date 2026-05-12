CREATE TABLE IF NOT EXISTS public.internal_page_state (
  page_key TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_page_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Internal users can view page state" ON public.internal_page_state;
DROP POLICY IF EXISTS "Internal users can create page state" ON public.internal_page_state;
DROP POLICY IF EXISTS "Internal users can update page state" ON public.internal_page_state;
DROP POLICY IF EXISTS "Internal users can delete page state" ON public.internal_page_state;

CREATE POLICY "Internal users can view page state"
ON public.internal_page_state
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'partner'::app_role)
  OR public.has_role(auth.uid(), 'design'::app_role)
  OR public.has_role(auth.uid(), 'trafego'::app_role)
);

CREATE POLICY "Internal users can create page state"
ON public.internal_page_state
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'partner'::app_role)
  OR public.has_role(auth.uid(), 'design'::app_role)
  OR public.has_role(auth.uid(), 'trafego'::app_role)
);

CREATE POLICY "Internal users can update page state"
ON public.internal_page_state
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'partner'::app_role)
  OR public.has_role(auth.uid(), 'design'::app_role)
  OR public.has_role(auth.uid(), 'trafego'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'partner'::app_role)
  OR public.has_role(auth.uid(), 'design'::app_role)
  OR public.has_role(auth.uid(), 'trafego'::app_role)
);

CREATE POLICY "Internal users can delete page state"
ON public.internal_page_state
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'partner'::app_role)
);

CREATE OR REPLACE FUNCTION public.touch_internal_page_state_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_internal_page_state_updated_at ON public.internal_page_state;
CREATE TRIGGER touch_internal_page_state_updated_at
BEFORE UPDATE ON public.internal_page_state
FOR EACH ROW
EXECUTE FUNCTION public.touch_internal_page_state_updated_at();