
-- Adiciona contagem de duplicatas no map para ordenar do mais leve ao mais pesado
ALTER TABLE public._dedup_email_map ADD COLUMN IF NOT EXISTS dup_count INTEGER;

UPDATE public._dedup_email_map m
SET dup_count = sub.c
FROM (
  SELECT LOWER(email) AS e, COUNT(*) AS c
  FROM public.crm_customers
  WHERE email IS NOT NULL
  GROUP BY LOWER(email)
) sub
WHERE m.email = sub.e AND m.dup_count IS NULL;

CREATE INDEX IF NOT EXISTS idx_dedup_unprocessed_dupcount
  ON public._dedup_email_map (dup_count) WHERE NOT processed;

-- Recria a função: timeout estendido + processa do mais leve ao mais pesado
CREATE OR REPLACE FUNCTION public.dedup_customers_batch(batch_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emails INTEGER := 0;
  v_purchases_moved INTEGER := 0;
  v_customers_deleted INTEGER := 0;
  v_remaining INTEGER;
BEGIN
  -- Permite até 4 minutos por chamada (cron tem 1 min mas edge invoca async)
  PERFORM set_config('statement_timeout', '240000', true);

  CREATE TEMP TABLE tmp_emails ON COMMIT DROP AS
  SELECT email, primary_id
  FROM public._dedup_email_map
  WHERE NOT processed
  ORDER BY COALESCE(dup_count, 9999) ASC, email
  LIMIT batch_size;

  GET DIAGNOSTICS v_emails = ROW_COUNT;
  IF v_emails = 0 THEN
    SELECT COUNT(*) INTO v_remaining FROM public._dedup_email_map WHERE NOT processed;
    RETURN jsonb_build_object('done', true, 'remaining', v_remaining);
  END IF;

  CREATE TEMP TABLE tmp_dups ON COMMIT DROP AS
  SELECT c.id AS dup_id, m.primary_id, m.email
  FROM public.crm_customers c
  JOIN tmp_emails m ON LOWER(c.email) = m.email
  WHERE c.id <> m.primary_id;

  CREATE INDEX ON tmp_dups (dup_id);
  CREATE INDEX ON tmp_dups (primary_id);

  UPDATE public.crm_purchases p
  SET customer_id = d.primary_id
  FROM tmp_dups d
  WHERE p.customer_id = d.dup_id;
  GET DIAGNOSTICS v_purchases_moved = ROW_COUNT;

  UPDATE public.crm_customers c
  SET phone = COALESCE(c.phone, src.phone),
      city = COALESCE(c.city, src.city),
      state = COALESCE(c.state, src.state),
      neighborhood = COALESCE(c.neighborhood, src.neighborhood),
      birth_date = COALESCE(c.birth_date, src.birth_date),
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (d.primary_id) d.primary_id,
           x.phone, x.city, x.state, x.neighborhood, x.birth_date
    FROM tmp_dups d
    JOIN public.crm_customers x ON x.id = d.dup_id
    ORDER BY d.primary_id, x.birth_date NULLS LAST, x.updated_at DESC
  ) src
  WHERE c.id = src.primary_id;

  DELETE FROM public.crm_customers c
  USING tmp_dups d
  WHERE c.id = d.dup_id;
  GET DIAGNOSTICS v_customers_deleted = ROW_COUNT;

  UPDATE public._dedup_email_map m
  SET processed = true
  WHERE m.email IN (SELECT email FROM tmp_emails);

  SELECT COUNT(*) INTO v_remaining FROM public._dedup_email_map WHERE NOT processed;

  RETURN jsonb_build_object(
    'done', false,
    'emails_processed', v_emails,
    'purchases_moved', v_purchases_moved,
    'customers_deleted', v_customers_deleted,
    'remaining', v_remaining
  );
END;
$function$;
