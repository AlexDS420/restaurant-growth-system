-- Supabase/Postgres migration for manual Yape/Plin verification.
-- The core migration already defines method, status, operation_code and confirmed_*.
create index if not exists payments_venue_status_idx on public.payments (venue_id, status, created_at desc);
create unique index if not exists payments_yape_plin_operation_idx on public.payments (method, operation_code) where method in ('yape','plin') and operation_code is not null;
