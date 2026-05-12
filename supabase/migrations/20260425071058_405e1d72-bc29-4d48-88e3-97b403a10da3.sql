CREATE TABLE IF NOT EXISTS public._import_staging (
  event_name TEXT,
  price NUMERIC,
  payment_method TEXT,
  coupon TEXT,
  full_name TEXT,
  birth_date DATE,
  phone TEXT,
  email TEXT,
  city TEXT,
  state TEXT,
  neighborhood TEXT
);
ALTER TABLE public._import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage staging" ON public._import_staging FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));