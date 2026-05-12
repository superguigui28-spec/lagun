
-- Function to remove duplicate purchases (keeps the oldest entry)
CREATE OR REPLACE FUNCTION public.deduplicate_purchases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY customer_id, event_name, coupon_used
        ORDER BY created_at ASC
      ) as rn
    FROM public.crm_purchases
    WHERE coupon_used IS NOT NULL
  )
  DELETE FROM public.crm_purchases
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
