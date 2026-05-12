CREATE INDEX IF NOT EXISTS idx_crm_customers_email_lower 
ON public.crm_customers (LOWER(email)) 
WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS idx_crm_purchases_customer_id 
ON public.crm_purchases (customer_id);