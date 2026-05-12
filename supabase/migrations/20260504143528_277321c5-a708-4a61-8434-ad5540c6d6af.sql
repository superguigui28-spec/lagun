-- 1. Atualizar função do Grafos para filtrar apenas eventos oficiais (tabela events)
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
  GROUP BY 1, 2;
$function$;

-- 2. Função para deletar órfãos em batches (evita timeout)
CREATE OR REPLACE FUNCTION public.delete_orphan_customers_batch(batch_size integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted INTEGER := 0;
  v_remaining INTEGER;
BEGIN
  PERFORM set_config('statement_timeout', '240000', true);

  WITH orphans AS (
    SELECT c.id
    FROM public.crm_customers c
    WHERE NOT EXISTS (SELECT 1 FROM public.crm_purchases p WHERE p.customer_id = c.id)
    LIMIT batch_size
  )
  DELETE FROM public.crm_customers
  WHERE id IN (SELECT id FROM orphans);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT COUNT(*) INTO v_remaining
  FROM public.crm_customers c
  WHERE NOT EXISTS (SELECT 1 FROM public.crm_purchases p WHERE p.customer_id = c.id);

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'remaining', v_remaining,
    'done', v_deleted = 0
  );
END;
$function$;