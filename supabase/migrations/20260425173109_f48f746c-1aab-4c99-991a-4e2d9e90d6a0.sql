-- Mapa: para cada email, qual é o ID principal (mais antigo)
CREATE TABLE IF NOT EXISTS public._dedup_email_map (
  email TEXT PRIMARY KEY,
  primary_id UUID NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_dedup_processed ON public._dedup_email_map(processed) WHERE NOT processed;

-- Popular o mapa com 1 principal por email (o mais antigo)
INSERT INTO public._dedup_email_map (email, primary_id)
SELECT DISTINCT ON (LOWER(email)) LOWER(email), id
FROM public.crm_customers
WHERE email IS NOT NULL AND email <> ''
ORDER BY LOWER(email), created_at ASC, id ASC
ON CONFLICT (email) DO NOTHING;

-- Função de deduplicação em lotes
CREATE OR REPLACE FUNCTION public.dedup_customers_batch(batch_size INTEGER DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails INTEGER := 0;
  v_purchases_moved INTEGER := 0;
  v_customers_deleted INTEGER := 0;
  v_remaining INTEGER;
BEGIN
  CREATE TEMP TABLE tmp_emails ON COMMIT DROP AS
  SELECT email, primary_id
  FROM public._dedup_email_map
  WHERE NOT processed
  ORDER BY email
  LIMIT batch_size;

  GET DIAGNOSTICS v_emails = ROW_COUNT;
  IF v_emails = 0 THEN
    SELECT COUNT(*) INTO v_remaining FROM public._dedup_email_map WHERE NOT processed;
    RETURN jsonb_build_object('done', true, 'remaining', v_remaining);
  END IF;

  -- Identifica clientes duplicados deste lote
  CREATE TEMP TABLE tmp_dups ON COMMIT DROP AS
  SELECT c.id AS dup_id, m.primary_id, m.email
  FROM public.crm_customers c
  JOIN tmp_emails m ON LOWER(c.email) = m.email
  WHERE c.id <> m.primary_id;

  -- Move compras das duplicatas para o principal
  UPDATE public.crm_purchases p
  SET customer_id = d.primary_id
  FROM tmp_dups d
  WHERE p.customer_id = d.dup_id;
  GET DIAGNOSTICS v_purchases_moved = ROW_COUNT;

  -- Atualiza o cliente principal com dados que ele não tem (consolidação)
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

  -- Deleta os duplicados
  DELETE FROM public.crm_customers c
  USING tmp_dups d
  WHERE c.id = d.dup_id;
  GET DIAGNOSTICS v_customers_deleted = ROW_COUNT;

  -- Marca emails como processados
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
$$;