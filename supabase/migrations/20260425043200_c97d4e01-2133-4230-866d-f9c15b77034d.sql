-- Tabela de cadastros do formulário de divulgação Maestria
CREATE TABLE public.maestria_divulgadores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at TIMESTAMPTZ,
  full_name TEXT NOT NULL,
  instagram TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  is_creator BOOLEAN,
  origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de cadastros da pré-venda Maestria
CREATE TABLE public.maestria_prevenda (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at TIMESTAMPTZ,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maestria_divulgadores_submitted_at ON public.maestria_divulgadores(submitted_at DESC);
CREATE INDEX idx_maestria_prevenda_submitted_at ON public.maestria_prevenda(submitted_at DESC);

ALTER TABLE public.maestria_divulgadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maestria_prevenda ENABLE ROW LEVEL SECURITY;

-- Apenas partner/admin podem visualizar
CREATE POLICY "Partners can view divulgadores"
ON public.maestria_divulgadores FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Partners can view prevenda"
ON public.maestria_prevenda FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'partner'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Service role pode inserir (para o webhook do Apps Script futuramente)
CREATE POLICY "Service role can insert divulgadores"
ON public.maestria_divulgadores FOR INSERT TO public
WITH CHECK (auth.role() = 'service_role'::text);

CREATE POLICY "Service role can insert prevenda"
ON public.maestria_prevenda FOR INSERT TO public
WITH CHECK (auth.role() = 'service_role'::text);