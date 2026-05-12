CREATE OR REPLACE FUNCTION public.grafos_event_aggregates()
 RETURNS TABLE(event_name text, channel text, volume bigint, conversion numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.name = p.event_name)
  GROUP BY 1, 2
  UNION ALL
  -- Eventos cadastrados sem compras: retorna linha placeholder com volume 0
  SELECT e.name, 'other'::text, 0::bigint, 0::numeric
  FROM public.events e
  WHERE NOT EXISTS (SELECT 1 FROM public.crm_purchases p WHERE p.event_name = e.name);
$function$;