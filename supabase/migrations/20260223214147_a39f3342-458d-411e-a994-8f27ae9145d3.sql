
-- Enum para roles
CREATE TYPE public.app_role AS ENUM ('admin', 'partner');

-- Enum para classificação de cliente
CREATE TYPE public.client_classification AS ENUM ('cold', 'warm', 'hot', 'vip');

-- Tabela de roles de usuário
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Tabela de perfis
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Função para verificar role (security definer para evitar recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Tabela de clientes do CRM
CREATE TABLE public.crm_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  first_purchase BOOLEAN DEFAULT true,
  previous_purchases_count INTEGER DEFAULT 0,
  ltv NUMERIC(12,2) DEFAULT 0,
  last_event TEXT,
  preferred_event_type TEXT,
  classification client_classification DEFAULT 'cold',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_customers ENABLE ROW LEVEL SECURITY;

-- Tabela de compras
CREATE TABLE public.crm_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.crm_customers(id) ON DELETE CASCADE NOT NULL,
  event_name TEXT NOT NULL,
  event_date DATE,
  ticket_type TEXT,
  ticket_lot TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  acquisition_channel TEXT,
  attendance_status TEXT DEFAULT 'pending',
  coupon_used TEXT,
  influencer_code TEXT,
  campaign_origin TEXT,
  campaign_medium TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_purchases ENABLE ROW LEVEL SECURITY;

-- Trigger para criar perfil automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_crm_customers_updated_at
  BEFORE UPDATE ON public.crm_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para recalcular LTV e contagem de compras ao inserir compra
CREATE OR REPLACE FUNCTION public.update_customer_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_purchases INTEGER;
  total_ltv NUMERIC(12,2);
  last_evt TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total_value), 0)
  INTO total_purchases, total_ltv
  FROM public.crm_purchases
  WHERE customer_id = NEW.customer_id;

  SELECT event_name INTO last_evt
  FROM public.crm_purchases
  WHERE customer_id = NEW.customer_id
  ORDER BY COALESCE(event_date, purchase_date) DESC
  LIMIT 1;

  UPDATE public.crm_customers SET
    previous_purchases_count = total_purchases,
    ltv = total_ltv,
    last_event = last_evt,
    first_purchase = (total_purchases <= 1),
    classification = CASE
      WHEN total_ltv >= 1000 THEN 'vip'::client_classification
      WHEN total_ltv >= 500 THEN 'hot'::client_classification
      WHEN total_ltv >= 200 THEN 'warm'::client_classification
      ELSE 'cold'::client_classification
    END
  WHERE id = NEW.customer_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER after_purchase_insert
  AFTER INSERT ON public.crm_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_customer_stats();

CREATE TRIGGER after_purchase_update
  AFTER UPDATE ON public.crm_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_customer_stats();

-- RLS Policies: só partners e admins podem acessar

-- user_roles: apenas leitura própria
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- crm_customers: apenas partners/admins
CREATE POLICY "Partners can view customers"
  ON public.crm_customers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can insert customers"
  ON public.crm_customers FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can update customers"
  ON public.crm_customers FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can delete customers"
  ON public.crm_customers FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

-- crm_purchases: apenas partners/admins
CREATE POLICY "Partners can view purchases"
  ON public.crm_purchases FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can insert purchases"
  ON public.crm_purchases FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can update purchases"
  ON public.crm_purchases FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Partners can delete purchases"
  ON public.crm_purchases FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'partner') OR public.has_role(auth.uid(), 'admin'));
