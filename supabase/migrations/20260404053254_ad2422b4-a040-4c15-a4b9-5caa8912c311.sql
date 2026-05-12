
CREATE OR REPLACE FUNCTION public.crm_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  total_customers bigint;
  new_customers_30d bigint;
  superclientes bigint;
  fans bigint;
BEGIN
  -- Total customers (with at least one purchase)
  SELECT COUNT(DISTINCT customer_id) INTO total_customers FROM crm_purchases;

  -- New customers in last 30 days
  SELECT COUNT(*) INTO new_customers_30d
  FROM crm_customers
  WHERE created_at >= NOW() - INTERVAL '30 days';

  -- Superclientes: customers with LTV > 1000
  SELECT COUNT(*) INTO superclientes
  FROM crm_customers
  WHERE ltv >= 1000;

  -- Fãs: customers with purchases in 4+ distinct events
  SELECT COUNT(*) INTO fans
  FROM (
    SELECT customer_id
    FROM crm_purchases
    GROUP BY customer_id
    HAVING COUNT(DISTINCT event_name) >= 4
  ) sub;

  result := jsonb_build_object(
    'total_customers', total_customers,
    'new_customers_30d', new_customers_30d,
    'superclientes', superclientes,
    'fans', fans
  );

  RETURN result;
END;
$$;
