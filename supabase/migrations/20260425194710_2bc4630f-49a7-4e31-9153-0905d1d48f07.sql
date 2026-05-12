TRUNCATE TABLE public.crm_purchases, public.crm_customers, public._import_staging, public._dedup_email_map, public._dedup_id_map RESTART IDENTITY;

DROP FUNCTION IF EXISTS public.reset_crm_all_data();