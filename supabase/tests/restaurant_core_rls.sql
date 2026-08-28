-- Smoke tests para ejecutar con `supabase test db` después de aplicar la migración.
-- No inserta datos de negocio; valida que las tablas estén protegidas y que el
-- rol anon no pueda leer datos internos. Las pruebas de allow/deny con usuarios
-- de dos organizaciones deben agregarse al fixture del entorno piloto.
begin;
select plan(6);

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'ros_organizations'),
  'ros_organizations tiene RLS habilitado'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in
    ('ros_organizations','ros_organization_members','ros_venues','ros_menu_categories','ros_menu_products',
     'ros_option_groups','ros_options','ros_product_option_groups','ros_customers','ros_orders','ros_order_items',
     'ros_payments','ros_payment_events','ros_audit_logs')) >= 14,
  'las tablas core tienen políticas declaradas'
);

set local role anon;
select throws_ok($$select count(*) from public.ros_organizations$$, 42501, 'permission denied for table ros_organizations', 'anon no tiene grant para organizaciones');
select throws_ok($$select count(*) from public.ros_payments$$, 42501, 'permission denied for table ros_payments', 'anon no tiene grant para pagos');
select throws_ok($$select count(*) from public.ros_receipts$$, 42501, 'permission denied for table ros_receipts', 'anon no tiene grant para comprobantes futuros');
select throws_ok($$select count(*) from public.ros_complaints$$, 42501, 'permission denied for table ros_complaints', 'anon no tiene grant para reclamos futuros');

select * from finish();
rollback;
