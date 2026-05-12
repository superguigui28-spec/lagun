ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS official_tickets integer,
  ADD COLUMN IF NOT EXISTS official_revenue numeric(12,2);