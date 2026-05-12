
CREATE TABLE IF NOT EXISTS public.crm_orphan_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid,
  full_name text,
  email text,
  phone text,
  birth_date date,
  city text,
  state text,
  neighborhood text,
  ltv numeric DEFAULT 0,
  previous_purchases_count integer DEFAULT 0,
  classification text,
  last_event text,
  preferred_event_type text,
  first_purchase boolean,
  tags text[],
  original_created_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orphan_email ON public.crm_orphan_customers (email);
CREATE INDEX IF NOT EXISTS idx_orphan_phone ON public.crm_orphan_customers (phone);
CREATE INDEX IF NOT EXISTS idx_orphan_name ON public.crm_orphan_customers (full_name);

ALTER TABLE public.crm_orphan_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Partners can view orphans"
  ON public.crm_orphan_customers FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage orphans"
  ON public.crm_orphan_customers FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
