-- Deduplicate crm_purchases keeping oldest row per coupon_used
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY coupon_used ORDER BY created_at ASC) AS rn
  FROM public.crm_purchases
  WHERE coupon_used IS NOT NULL
)
DELETE FROM public.crm_purchases
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Prevent future duplicates by SuperTicket ticket id
CREATE UNIQUE INDEX IF NOT EXISTS crm_purchases_coupon_used_unique
  ON public.crm_purchases (coupon_used)
  WHERE coupon_used IS NOT NULL;

-- Recompute customer LTV/counts from now-deduped purchases
UPDATE public.crm_customers c SET
  previous_purchases_count = sub.cnt,
  ltv = sub.total
FROM (
  SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(total_value),0) AS total
  FROM public.crm_purchases GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id;