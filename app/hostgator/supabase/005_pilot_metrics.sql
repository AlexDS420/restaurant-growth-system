-- Métricas operativas del piloto Lima. Ejecutar en Supabase después del core.
create table if not exists public.ros_pilot_metric_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.ros_venues(id) on delete restrict,
  metric_name text not null check (metric_name in ('onboarding_started','onboarding_completed','order_created','order_completed','order_cancelled','api_error','kitchen_started','kitchen_ready','kitchen_completed','payment_submitted','payment_confirmed','payment_rejected','reconciliation_mismatch')),
  value numeric(14,3) not null default 1,
  entity_type text,
  entity_id text,
  dimensions jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (venue_id, idempotency_key)
);
create index if not exists ros_pilot_metric_events_venue_time_idx on public.ros_pilot_metric_events (venue_id, occurred_at desc);
create index if not exists ros_pilot_metric_events_name_time_idx on public.ros_pilot_metric_events (venue_id, metric_name, occurred_at desc);
alter table public.ros_pilot_metric_events enable row level security;
drop policy if exists "pilot_metrics_no_client_access" on public.ros_pilot_metric_events;
create policy "pilot_metrics_no_client_access" on public.ros_pilot_metric_events for all to anon, authenticated using (false) with check (false);

create or replace view public.ros_pilot_metrics_daily
with (security_invoker = true) as
select venue_id, (occurred_at at time zone 'America/Lima')::date as metric_date, metric_name,
       count(*)::bigint as event_count, coalesce(sum(value), 0)::numeric as value_total
from public.ros_pilot_metric_events
group by venue_id, (occurred_at at time zone 'America/Lima')::date, metric_name;

revoke all on public.ros_pilot_metric_events from anon, authenticated;
revoke all on public.ros_pilot_metrics_daily from anon, authenticated;
