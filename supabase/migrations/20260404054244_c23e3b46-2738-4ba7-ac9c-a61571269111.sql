
CREATE OR REPLACE FUNCTION public.crm_top_fans(lim integer DEFAULT 20)
RETURNS TABLE(customer_id uuid, full_name text, phone text, total_spent numeric, event_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.full_name, c.phone, COALESCE(c.ltv, 0)::numeric, sub.event_count
  FROM (
    SELECT p.customer_id AS cid, COUNT(DISTINCT p.event_name) AS event_count
    FROM crm_purchases p
    GROUP BY p.customer_id
    HAVING COUNT(DISTINCT p.event_name) >= 4
  ) sub
  JOIN crm_customers c ON c.id = sub.cid
  ORDER BY sub.event_count DESC, c.ltv DESC NULLS LAST
  LIMIT lim;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_top_superclientes(lim integer DEFAULT 20)
RETURNS TABLE(customer_id uuid, full_name text, phone text, total_spent numeric, event_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.full_name, c.phone, COALESCE(c.ltv, 0)::numeric,
    (SELECT COUNT(DISTINCT p.event_name) FROM crm_purchases p WHERE p.customer_id = c.id) AS event_count
  FROM crm_customers c
  WHERE c.ltv >= 1000
  ORDER BY c.ltv DESC
  LIMIT lim;
END;
$$;
