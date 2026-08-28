-- Public storefront fallback for hosts where PHP cannot make outbound HTTPS calls.
-- SECURITY DEFINER functions validate every field and expose no private columns.
create or replace function public.ros_create_public_order(p_slug text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venue ros_venues%rowtype;
  v_customer jsonb := coalesce(p_payload->'customer', '{}'::jsonb);
  v_fulfillment jsonb := coalesce(p_payload->'fulfillment', '{}'::jsonb);
  v_item jsonb;
  v_product ros_menu_products%rowtype;
  v_order ros_orders%rowtype;
  v_customer_id uuid;
  v_qty integer;
  v_unit bigint;
  v_subtotal bigint := 0;
  v_tax bigint;
  v_total bigint;
  v_idempotency text := nullif(left(coalesce(p_payload->>'idempotency_key', ''), 120), '');
  v_type text := coalesce(v_fulfillment->>'type', 'pickup');
  v_phone text := left(trim(coalesce(v_customer->>'phone', '')), 40);
  v_name text := left(trim(coalesce(v_customer->>'name', '')), 160);
begin
  if p_slug is null or length(trim(p_slug)) < 1 then raise exception 'VENUE_NOT_FOUND'; end if;
  select * into v_venue from ros_venues where slug = trim(p_slug) and status = 'active' and is_published limit 1;
  if not found then raise exception 'VENUE_NOT_FOUND'; end if;
  if v_name = '' or v_phone = '' then raise exception 'CUSTOMER_REQUIRED'; end if;
  if v_type not in ('pickup', 'delivery') then raise exception 'FULFILLMENT_INVALID'; end if;
  if v_type = 'delivery' and length(trim(coalesce(v_fulfillment->>'address', ''))) = 0 then raise exception 'ADDRESS_REQUIRED'; end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') < 1 or jsonb_array_length(p_payload->'items') > 50 then raise exception 'ITEMS_INVALID'; end if;

  if v_idempotency is not null then
    select * into v_order from ros_orders where venue_id = v_venue.id and idempotency_key = v_idempotency limit 1;
    if found then return jsonb_build_object('id', v_order.id, 'public_token', v_order.public_token, 'status', v_order.status, 'payment_status', v_order.payment_status, 'total_minor', v_order.total_minor, 'currency', v_order.currency); end if;
  end if;

  insert into ros_customers (venue_id, name, normalized_phone, email)
  values (v_venue.id, v_name, regexp_replace(v_phone, '[^0-9+]', '', 'g'), nullif(trim(v_customer->>'email'), ''))
  on conflict (venue_id, normalized_phone) do update set name = excluded.name, email = coalesce(excluded.email, ros_customers.email), updated_at = now()
  returning id into v_customer_id;

  insert into ros_orders (venue_id, customer_id, public_token, customer_name, customer_phone, customer_email, fulfillment_type, address, reference, status, payment_status, notes, currency, idempotency_key)
  values (v_venue.id, v_customer_id, encode(gen_random_bytes(18), 'hex'), v_name, v_phone, nullif(trim(v_customer->>'email'), ''), v_type, left(coalesce(v_fulfillment->>'address', ''), 300), left(coalesce(v_fulfillment->>'reference', ''), 200), 'pending', 'unpaid', left(coalesce(p_payload->>'notes', ''), 1000), 'PEN', v_idempotency)
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'QUANTITY_INVALID'; end if;
    select * into v_product from ros_menu_products where id = (v_item->>'product_id')::uuid and venue_id = v_venue.id and is_visible and is_available and deleted_at is null;
    if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    v_unit := coalesce(nullif(v_product.promo_price_minor, 0), v_product.price_minor);
    v_subtotal := v_subtotal + v_unit * v_qty;
    insert into ros_order_items (order_id, venue_id, product_id, name_snapshot, unit_price_minor, quantity, line_total_minor, ros_options_snapshot, notes)
    values (v_order.id, v_venue.id, v_product.id, v_product.name, v_unit, v_qty, v_unit * v_qty, coalesce(v_item->'option_ids', '[]'::jsonb), left(coalesce(v_item->>'notes', ''), 500));
  end loop;
  v_tax := floor(v_subtotal * 0.18)::bigint;
  v_total := v_subtotal + v_tax;
  update ros_orders set subtotal_minor = v_subtotal, tax_minor = v_tax, total_minor = v_total, updated_at = now() where id = v_order.id;
  return jsonb_build_object('id', v_order.id, 'public_token', v_order.public_token, 'status', 'pending', 'payment_status', 'unpaid', 'totals', jsonb_build_object('subtotal_minor', v_subtotal, 'tax_minor', v_tax, 'delivery_fee_minor', 0, 'total_minor', v_total, 'currency', 'PEN'));
exception when others then
  raise exception using message = case when sqlerrm in ('VENUE_NOT_FOUND','CUSTOMER_REQUIRED','FULFILLMENT_INVALID','ADDRESS_REQUIRED','ITEMS_INVALID','QUANTITY_INVALID','PRODUCT_UNAVAILABLE') then sqlerrm else 'ORDER_CREATE_FAILED' end;
end;
$$;

create or replace function public.ros_register_public_payment(p_public_token text, p_method text, p_operation_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order ros_orders%rowtype; v_payment ros_payments%rowtype; v_method text := lower(trim(p_method)); v_operation text := left(trim(p_operation_code), 80);
begin
  if v_method not in ('yape','plin') or v_operation = '' then raise exception 'PAYMENT_INVALID'; end if;
  select * into v_order from ros_orders where public_token = trim(p_public_token) limit 1;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_status = 'paid' then raise exception 'PAYMENT_ALREADY_PROCESSED'; end if;
  insert into ros_payments (order_id, venue_id, method, provider, amount_minor, status, operation_code, external_ref)
  values (v_order.id, v_order.venue_id, v_method, v_method, v_order.total_minor, 'verifying', v_operation, v_operation)
  returning * into v_payment;
  return jsonb_build_object('payment_status', 'pending_verification', 'payment_id', v_payment.id);
exception when unique_violation then
  raise exception 'PAYMENT_ALREADY_REGISTERED';
end;
$$;

revoke all on function public.ros_create_public_order(text, jsonb) from public, authenticated;
revoke all on function public.ros_register_public_payment(text, text, text) from public, authenticated;
grant execute on function public.ros_create_public_order(text, jsonb) to anon;
grant execute on function public.ros_register_public_payment(text, text, text) to anon;
