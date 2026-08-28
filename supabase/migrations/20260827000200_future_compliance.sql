-- Restaurant OS — módulos posteriores, feature-gated (Perú)
-- Esta migración prepara persistencia; NO activa UI, emisión SUNAT ni recepción
-- pública de reclamos. El BFF debe activar cada feature tras integración y QA.

create table if not exists public.ros_receipts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.ros_venues(id) on delete restrict,
  order_id uuid not null references public.ros_orders(id) on delete restrict,
  document_type text not null check (document_type in ('boleta','factura','nota_credito','nota_debito')),
  series text not null check (series ~ '^[A-Z0-9-]{1,8}$'),
  number bigint not null check (number > 0),
  status text not null default 'pending' check (status in ('pending','queued','sent','accepted','rejected','voided','contingency')),
  customer_document_type text check (customer_document_type is null or customer_document_type in ('DNI','RUC','CE','PAS')),
  customer_document_number text,
  customer_name text not null,
  customer_address text,
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  currency text not null default 'PEN' check (currency = 'PEN'),
  provider text,
  external_ref text,
  xml_url text,
  pdf_url text,
  cdr_code text,
  cdr_description text,
  error_code text,
  error_message text,
  issued_at timestamptz,
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, document_type, series, number),
  unique (venue_id, order_id, document_type)
);

create table if not exists public.ros_complaints (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.ros_venues(id) on delete restrict,
  order_id uuid references public.ros_orders(id) on delete set null,
  ticket text not null unique,
  consumer_name text not null,
  consumer_document_type text check (consumer_document_type is null or consumer_document_type in ('DNI','RUC','CE','PAS')),
  consumer_document_number text,
  consumer_email text,
  consumer_phone text not null,
  consumer_address text,
  type text not null check (type in ('reclamo','queja')),
  detail text not null check (length(trim(detail)) >= 10),
  request text not null check (length(trim(request)) >= 5),
  status text not null default 'received' check (status in ('received','in_review','responded','closed','rejected')),
  response text,
  response_due_at timestamptz,
  responded_at timestamptz,
  consent_privacy boolean not null default false check (consent_privacy),
  attachment_url text,
  created_by uuid references auth.users(id) on delete set null,
  responded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ros_receipts_venue_status on public.ros_receipts(venue_id, status, created_at desc);
create index if not exists idx_ros_receipts_order on public.ros_receipts(order_id);
create index if not exists idx_ros_complaints_venue_status on public.ros_complaints(venue_id, status, created_at desc);

alter table public.ros_receipts enable row level security;
alter table public.ros_complaints enable row level security;
revoke all on table public.ros_receipts, public.ros_complaints from anon, authenticated;
grant select, insert, update on table public.ros_receipts, public.ros_complaints to authenticated;

create policy "members manage future ros_receipts" on public.ros_receipts for all to authenticated
  using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));
create policy "members manage future ros_complaints" on public.ros_complaints for all to authenticated
  using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));

comment on table public.ros_receipts is 'FUTURO/FEATURE-GATED: requiere PSE/OSE, firma, CDR, correlativos y pruebas SUNAT antes de habilitarse.';
comment on table public.ros_complaints is 'FUTURO/FEATURE-GATED: Libro de Reclamaciones; el BFF debe controlar plazos, acceso y conservación.';
