
ALTER TABLE public._import_staging ADD COLUMN IF NOT EXISTS id BIGSERIAL;
CREATE INDEX IF NOT EXISTS idx_staging_id_unprocessed ON public._import_staging(id) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_staging_email ON public._import_staging(email);
CREATE INDEX IF NOT EXISTS idx_crm_customers_email ON public.crm_customers(email);

CREATE OR REPLACE FUNCTION public.process_import_batch(batch_size integer DEFAULT 500)
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

  -- 1. Insere clientes novos
  WITH new_unique AS (
    SELECT DISTINCT ON (b.email)
      b.full_name, b.email, b.phone, b.city, b.state, b.neighborhood, b.birth_date
    FROM tmp_batch b
    LEFT JOIN public.crm_customers c ON c.email = b.email
    WHERE c.id IS NULL AND b.email IS NOT NULL
    ORDER BY b.email, b.birth_date NULLS LAST
  )
  INSERT INTO public.crm_customers (full_name, email, phone, city, state, neighborhood, birth_date)
  SELECT full_name, email, phone, city, state, neighborhood, birth_date FROM new_unique
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new_customers = ROW_COUNT;

  -- 2. Atualiza dados faltantes nos existentes
  UPDATE public.crm_customers c SET
    phone = COALESCE(c.phone, b.phone),
    city = COALESCE(c.city, b.city),
    state = COALESCE(c.state, b.state),
    neighborhood = COALESCE(c.neighborhood, b.neighborhood),
    birth_date = COALESCE(c.birth_date, b.birth_date),
    updated_at = now()
  FROM (
    SELECT DISTINCT ON (email) email, phone, city, state, neighborhood, birth_date
    FROM tmp_batch WHERE email IS NOT NULL
    ORDER BY email, birth_date NULLS LAST
  ) b
  WHERE c.email = b.email;

  -- 3. Insere compras
  INSERT INTO public.crm_purchases (customer_id, event_name, purchase_date, ticket_price, quantity, total_value, payment_method, coupon_used, attendance_status)
  SELECT c.id, b.event_name, CURRENT_DATE, b.price, 1, b.price, b.payment_method, b.coupon, 'Pendente'
  FROM tmp_batch b
  JOIN public.crm_customers c ON c.email = b.email;
  GET DIAGNOSTICS v_purchases = ROW_COUNT;

  -- 4. Marca como processado por id (rápido)
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
