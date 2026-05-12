
DELETE FROM public.crm_purchases WHERE event_name = 'Maestria';
DELETE FROM public.crm_purchases WHERE event_name = 'Do it 4 Brazil Party - 2026';
DELETE FROM public.events WHERE name IN ('Maestria','Do it 4 Brazil Party - 2026');
