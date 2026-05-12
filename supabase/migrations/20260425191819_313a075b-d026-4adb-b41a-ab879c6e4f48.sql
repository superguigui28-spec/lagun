CREATE INDEX IF NOT EXISTS idx_crm_customers_email_lower ON public.crm_customers (LOWER(email));
ANALYZE public.crm_customers;