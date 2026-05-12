-- Add new role values to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'design';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trafego';