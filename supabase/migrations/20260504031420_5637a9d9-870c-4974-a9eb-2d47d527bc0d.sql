CREATE OR REPLACE FUNCTION public.grafos_event_aggregates()
RETURNS TABLE(
  event_name text,
  channel text,
  volume bigint,
  conversion numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.event_name,
    CASE
      WHEN LOWER(COALESCE(p.acquisition_channel,'')) ~ 'meta|facebook|instagram|ads' THEN 'meta_ads'
      WHEN LOWER(COALESCE(p.acquisition_channel,'')) ~ 'whats|wa' THEN 'whatsapp'
      WHEN LOWER(COALESCE(p.acquisition_channel,'')) ~ 'mail' THEN 'email'
      ELSE 'other'
    END AS channel,
    SUM(COALESCE(p.quantity,1))::bigint,
    SUM(COALESCE(p.total_value,0))::numeric
  FROM public.crm_purchases p
  WHERE p.event_name IS NOT NULL
  GROUP BY 1, 2;
$$;