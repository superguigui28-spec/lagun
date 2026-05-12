CREATE OR REPLACE FUNCTION public.crm_top_superclientes(lim integer DEFAULT 20)
 RETURNS TABLE(customer_id uuid, full_name text, phone text, total_spent numeric, event_count bigint, event_names text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT 
      p.customer_id AS cid,
      SUM(p.total_value)::numeric AS spent,
      COUNT(DISTINCT p.event_name) AS evt_count,
      ARRAY_AGG(DISTINCT p.event_name) AS evt_names
    FROM crm_purchases p
    WHERE p.event_name IS NOT NULL
      AND p.event_name NOT ILIKE '%maestria%'
    GROUP BY p.customer_id
    HAVING SUM(p.total_value) >= 1000
    ORDER BY SUM(p.total_value) DESC
    LIMIT lim
  )
  SELECT c.id, c.full_name, c.phone, a.spent, a.evt_count, a.evt_names
  FROM agg a
  JOIN crm_customers c ON c.id = a.cid
  ORDER BY a.spent DESC;
$function$;