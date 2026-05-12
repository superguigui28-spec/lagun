CREATE INDEX IF NOT EXISTS idx_crm_purchases_customer ON public.crm_purchases (customer_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_email ON public._import_staging (email);