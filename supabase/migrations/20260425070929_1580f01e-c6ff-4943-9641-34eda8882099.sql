ALTER TABLE public.crm_customers ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE public.crm_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT;
CREATE INDEX IF NOT EXISTS idx_crm_customers_birth_month ON public.crm_customers (EXTRACT(MONTH FROM birth_date));