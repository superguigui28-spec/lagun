
-- Table to map event names to categories
CREATE TABLE public.event_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('rap_trap', 'pagode_funk')),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view event categories"
  ON public.event_categories FOR SELECT
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can manage event categories"
  ON public.event_categories FOR ALL
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
