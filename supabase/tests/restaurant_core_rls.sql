-- Smoke tests para ejecutar con `supabase test db` después de aplicar la migración.
-- No inserta datos de negocio; valida que las tablas estén protegidas y que el
-- rol anon no pueda leer datos internos. Las pruebas de allow/deny con usuarios
-- de dos organizaciones deben agregarse al fixture del entorno piloto.
begin;
select plan(6);

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'organizations'),
  'organizations tiene RLS habilitado'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in
    ('organizations','organization_members','venues','menu_categories','menu_products',
     'option_groups','options','product_option_groups','customers','orders','order_items',
     'payments','payment_events','audit_logs')) >= 14,
  'las tablas core tienen políticas declaradas'
);

set local role anon;
select throws_ok($$select count(*) from public.organizations$$, '42501', 'anon no tiene grant para organizaciones');
select throws_ok($$select count(*) from public.payments$$, '42501', 'anon no tiene grant para pagos');
select throws_ok($$select count(*) from public.receipts$$, '42501', 'anon no tiene grant para comprobantes futuros');
select throws_ok($$select count(*) from public.complaints$$, '42501', 'anon no tiene grant para reclamos futuros');

select * from finish();
rollback;
