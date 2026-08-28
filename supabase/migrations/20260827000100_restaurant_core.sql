-- Restaurant OS — núcleo Postgres/Supabase para Perú (PEN / America/Lima)
-- Esta migración es deliberadamente independiente del esquema SQLite local.
-- Identidad: Supabase Auth (auth.users). Autorización: memberships + RLS.
-- Nunca expongas service_role en el frontend.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  country_code text not null default 'PE' check (country_code = 'PE'),
  currency text not null default 'PEN' check (currency = 'PEN'),
  timezone text not null default 'America/Lima' check (timezone = 'America/Lima'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','kitchen','cashier','marketing','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null,
  legal_name text,
  phone text,
  whatsapp text,
  email text,
  address text,
  district text,
  city text not null default 'Lima',
  status text not null default 'active' check (status in ('active','suspended')),
  currency text not null default 'PEN' check (currency = 'PEN'),
  timezone text not null default 'America/Lima' check (timezone = 'America/Lima'),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_products (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  category_id uuid not null references public.menu_categories(id) on delete restrict,
  name text not null,
  description text,
  sku text,
  price_minor bigint not null check (price_minor >= 0),
  promo_price_minor bigint check (promo_price_minor is null or (promo_price_minor >= 0 and promo_price_minor <= price_minor)),
  currency text not null default 'PEN' check (currency = 'PEN'),
  is_available boolean not null default true,
  is_visible boolean not null default true,
  is_featured boolean not null default false,
  preparation_time_minutes integer not null default 15 check (preparation_time_minutes between 0 and 1440),
  image_url text,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  is_required boolean not null default false,
  selection_type text not null default 'single' check (selection_type in ('single','multiple')),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= min_selections),
  sort_order integer not null default 0
);

create table if not exists public.options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  price_minor bigint not null default 0 check (price_minor >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.product_option_groups (
  product_id uuid not null references public.menu_products(id) on delete cascade,
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  primary key (product_id, option_group_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  normalized_phone text not null,
  email text,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, normalized_phone)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  public_token text not null unique default encode(gen_random_bytes(18), 'base64'),
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  status text not null default 'pending' check (status in ('pending','accepted','preparing','ready','completed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','failed','refunded','partially_refunded')),
  fulfillment_type text not null check (fulfillment_type in ('pickup','delivery')),
  address text,
  reference text,
  notes text,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  currency text not null default 'PEN' check (currency = 'PEN'),
  idempotency_key text,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, idempotency_key)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  product_id uuid references public.menu_products(id) on delete set null,
  name_snapshot text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  options_snapshot jsonb not null default '[]'::jsonb,
  notes text
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete restrict,
  method text not null check (method in ('cash','yape','plin','bank_transfer','card')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'PEN' check (currency = 'PEN'),
  status text not null default 'pending' check (status in ('pending','verifying','confirmed','rejected','expired','refunded','partially_refunded')),
  operation_code text,
  proof_url text,
  provider text,
  external_ref text,
  failure_reason text,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_ref)
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  venue_id uuid not null references public.venues(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  venue_id uuid references public.venues(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_venues_org on public.venues(organization_id);
create index if not exists idx_categories_venue_order on public.menu_categories(venue_id, sort_order);
create index if not exists idx_products_venue_visible on public.menu_products(venue_id, is_visible, is_available, sort_order);
create index if not exists idx_orders_venue_status on public.orders(venue_id, status, placed_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_payments_venue_status on public.payments(venue_id, status, created_at desc);
create index if not exists idx_payment_events_status on public.payment_events(status, received_at);
create index if not exists idx_audit_venue_created on public.audit_logs(venue_id, created_at desc);

-- Helpers son SECURITY INVOKER y no consultan user_metadata editable por el cliente.
create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security invoker set search_path = public
as $$ select exists (
  select 1 from public.organization_members m
  where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.active
) $$;

create or replace function public.is_venue_member(target_venue uuid)
returns boolean language sql stable security invoker set search_path = public
as $$ select exists (
  select 1 from public.venues v
  join public.organization_members m on m.organization_id = v.organization_id
  where v.id = target_venue and m.user_id = (select auth.uid()) and m.active
) $$;

-- Defense in depth: ninguna tabla expuesta queda abierta por grants heredados.
do $$ declare t text; begin
  foreach t in array array['organizations','organization_members','venues','menu_categories','menu_products','option_groups','options','product_option_groups','customers','orders','order_items','payments','payment_events','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.venues, public.menu_categories, public.menu_products, public.option_groups, public.options, public.product_option_groups to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "public can read published venue" on public.venues for select to anon
  using (status = 'active' and is_published);
create policy "public can read visible categories" on public.menu_categories for select to anon
  using (is_visible and exists (select 1 from public.venues v where v.id = venue_id and v.status = 'active' and v.is_published));
create policy "public can read available products" on public.menu_products for select to anon
  using (is_visible and is_available and deleted_at is null and exists (select 1 from public.venues v where v.id = venue_id and v.status = 'active' and v.is_published));
create policy "public can read option groups" on public.option_groups for select to anon
  using (exists (select 1 from public.venues v where v.id = venue_id and v.status = 'active' and v.is_published));
create policy "public can read options" on public.options for select to anon
  using (is_available and exists (select 1 from public.venues v where v.id = venue_id and v.status = 'active' and v.is_published));
create policy "public can read product option links" on public.product_option_groups for select to anon
  using (exists (select 1 from public.menu_products p join public.venues v on v.id = p.venue_id where p.id = product_id and p.is_visible and p.is_available and v.status = 'active' and v.is_published));

create policy "members read organizations" on public.organizations for select to authenticated using (is_org_member(id));
create policy "members update organizations" on public.organizations for update to authenticated using (is_org_member(id)) with check (is_org_member(id));
create policy "users read own memberships" on public.organization_members for select to authenticated using (user_id = (select auth.uid()));
create policy "members read venues" on public.venues for select to authenticated using (is_org_member(organization_id));
create policy "members manage venues" on public.venues for all to authenticated using (is_org_member(organization_id)) with check (is_org_member(organization_id));

create policy "members manage categories" on public.menu_categories for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage products" on public.menu_products for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage option groups" on public.option_groups for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage options" on public.options for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage product option links" on public.product_option_groups for all to authenticated
  using (exists (select 1 from public.menu_products p where p.id = product_id and is_venue_member(p.venue_id)))
  with check (exists (select 1 from public.menu_products p where p.id = product_id and is_venue_member(p.venue_id)));
create policy "members manage customers" on public.customers for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage orders" on public.orders for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage order items" on public.order_items for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage payments" on public.payments for all to authenticated using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members read payment events" on public.payment_events for select to authenticated using (is_venue_member(venue_id));
create policy "members read audit logs" on public.audit_logs for select to authenticated using (venue_id is not null and is_venue_member(venue_id));

comment on table public.payments is 'Métodos PEN: yape/plin permiten verificación manual o integración oficial; una captura no confirma el pago.';
comment on table public.payment_events is 'Idempotencia y trazabilidad de webhooks; validar firma en el BFF antes de insertar.';
comment on table public.audit_logs is 'Registro append-only lógico; las escrituras deben ocurrir desde el BFF con service_role server-side o RPC controlada.';
