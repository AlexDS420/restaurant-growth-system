-- Outbox durable para cron de cPanel. Ejecutar después de 001/003.
create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, event_type, entity_type, entity_id)
);
create index if not exists outbox_due_idx on public.outbox_events (status, next_attempt_at, created_at);
alter table public.outbox_events enable row level security;
-- El worker usa service_role desde CLI; el cliente no obtiene acceso a la cola.
create policy "outbox_no_client_access" on public.outbox_events for all to anon, authenticated using (false) with check (false);
