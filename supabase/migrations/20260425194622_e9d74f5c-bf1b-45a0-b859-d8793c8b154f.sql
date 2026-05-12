CREATE OR REPLACE FUNCTION public.reset_crm_all_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  TRUNCATE TABLE public.crm_purchases, public.crm_customers, public._import_staging, public._dedup_email_map, public._dedup_id_map RESTART IDENTITY;

  SELECT jsonb_build_object(
    'crm_purchases', (SELECT COUNT(*) FROM public.crm_purchases),
    'crm_customers', (SELECT COUNT(*) FROM public.crm_customers),
    '_import_staging', (SELECT COUNT(*) FROM public._import_staging),
    '_dedup_email_map', (SELECT COUNT(*) FROM public._dedup_email_map),
    '_dedup_id_map', (SELECT COUNT(*) FROM public._dedup_id_map)
  ) INTO result;

  RETURN result;
END;
$$;