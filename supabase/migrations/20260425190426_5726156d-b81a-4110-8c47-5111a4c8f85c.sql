-- Limpa staging antigo
DELETE FROM public._import_staging;
ALTER SEQUENCE public._import_staging_id_seq RESTART WITH 1;

-- Nova função: import por evento, respeitando merge com clientes existentes
CREATE OR REPLACE FUNCTION public.import_event_batch(batch_size integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_processed INTEGER := 0;
  v_new_customers INTEGER := 0;
  v_purchases INTEGER := 0;
  v_remaining INTEGER;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  CREATE TEMP TABLE tmp_batch ON COMMIT DROP AS
  SELECT * FROM public._import_staging
  WHERE NOT processed
  ORDER BY id
  LIMIT batch_size;

  GET DIAGNOSTICS v_processed = ROW_COUNT;
  IF v_processed = 0 THEN
    SELECT COUNT(*) INTO v_remaining FROM public._import_staging WHERE NOT processed;
    RETURN jsonb_build_object('done', true, 'processed', 0, 'remaining', v_remaining);
  END IF;

  -- 1. Insere clientes novos (email não existente)
  WITH new_unique AS (
    SELECT DISTINCT ON (LOWER(b.email))
      b.full_name, LOWER(b.email) AS email, b.phone, b.city, b.state, b.neighborhood, b.birth_date
    FROM tmp_batch b
    WHERE b.email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.crm_customers c WHERE LOWER(c.email) = LOWER(b.email))
    ORDER BY LOWER(b.email), b.birth_date NULLS LAST
  )
  INSERT INTO public.crm_customers (full_name, email, phone, city, state, neighborhood, birth_date)
  SELECT full_name, email, phone, city, state, neighborhood, birth_date FROM new_unique;
  GET DIAGNOSTICS v_new_customers = ROW_COUNT;

  -- 2. Atualiza dados faltantes nos existentes (sem sobrescrever)
  UPDATE public.crm_customers c SET
    phone = COALESCE(c.phone, b.phone),
    city = COALESCE(c.city, b.city),
    state = COALESCE(c.state, b.state),
    neighborhood = COALESCE(c.neighborhood, b.neighborhood),
    birth_date = COALESCE(c.birth_date, b.birth_date),
    updated_at = now()
  FROM (
    SELECT DISTINCT ON (LOWER(email)) LOWER(email) AS email, phone, city, state, neighborhood, birth_date
    FROM tmp_batch WHERE email IS NOT NULL
    ORDER BY LOWER(email), birth_date NULLS LAST
  ) b
  WHERE LOWER(c.email) = b.email;

  -- 3. Insere compras (uma por lead, com valor já agregado)
  INSERT INTO public.crm_purchases (
    customer_id, event_name, purchase_date, ticket_price, quantity, total_value,
    payment_method, coupon_used, attendance_status
  )
  SELECT c.id, b.event_name, CURRENT_DATE,
         CASE WHEN b.price > 0 AND v.qty > 0 THEN b.price / v.qty ELSE b.price END,
         GREATEST(1, COALESCE(NULLIF(b.coupon, '')::text IS NOT NULL::int, 1)),
         b.price, b.payment_method, b.coupon, 'Pendente'
  FROM tmp_batch b
  CROSS JOIN LATERAL (SELECT 1 AS qty) v
  JOIN public.crm_customers c ON LOWER(c.email) = LOWER(b.email)
  WHERE b.email IS NOT NULL;
  GET DIAGNOSTICS v_purchases = ROW_COUNT;

  -- 4. Marca processado
  UPDATE public._import_staging s SET processed = true
  WHERE s.id IN (SELECT id FROM tmp_batch);

  SELECT COUNT(*) INTO v_remaining FROM public._import_staging WHERE NOT processed;

  RETURN jsonb_build_object(
    'done', false,
    'processed', v_processed,
    'new_customers', v_new_customers,
    'purchases_inserted', v_purchases,
    'remaining', v_remaining
  );
END;
$$;