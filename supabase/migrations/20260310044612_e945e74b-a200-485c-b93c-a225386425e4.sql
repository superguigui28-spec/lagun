
CREATE TABLE public.maestria_birthday (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  whatsapp text NOT NULL,
  birth_date date NOT NULL,
  coupon text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maestria_birthday ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert birthday" ON public.maestria_birthday
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Anyone can check coupon exists" ON public.maestria_birthday
  FOR SELECT TO anon, authenticated USING (true);
