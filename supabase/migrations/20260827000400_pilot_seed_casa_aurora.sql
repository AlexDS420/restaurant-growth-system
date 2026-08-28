-- Datos mínimos publicables para el piloto Lima. Idempotente y sin credenciales.
-- Sustituye precios/datos comerciales antes de operar si Casa Aurora no es el local final.
insert into public.ros_organizations (id, name, slug, country_code, currency, timezone)
values ('10000000-0000-4000-8000-000000000001', 'Casa Aurora', 'casa-aurora', 'PE', 'PEN', 'America/Lima')
on conflict (id) do update set name = excluded.name, updated_at = now();

insert into public.ros_venues (id, organization_id, name, slug, legal_name, phone, whatsapp, email, address, district, city, status, currency, timezone, is_published)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Casa Aurora', 'casa-aurora', 'Casa Aurora', '+51999100100', '+51999100100', 'hola@casaaurora.pe', 'Av. Larco 180', 'Miraflores', 'Lima', 'active', 'PEN', 'America/Lima', true)
on conflict (id) do update set is_published = true, status = 'active', updated_at = now();

insert into public.ros_menu_categories (id, venue_id, name, description, sort_order, is_visible)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Entradas', 'Para empezar', 1, true),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Principales', 'Sabores peruanos', 2, true),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Bebidas', 'Refrescos y café', 3, true)
on conflict (id) do update set is_visible = true, updated_at = now();

insert into public.ros_menu_products (id, venue_id, category_id, name, description, price_minor, promo_price_minor, currency, is_available, is_visible, is_featured, preparation_time_minutes, sort_order)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Ceviche clásico', 'Pescado fresco, limón, cebolla roja, camote y choclo.', 2800, null, 'PEN', true, true, true, 20, 1),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Lomo saltado', 'Lomo, cebolla, tomate, papas fritas y arroz.', 3200, 2800, 'PEN', true, true, true, 25, 1),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Ají de gallina', 'Pollo deshilachado, crema de ají amarillo, arroz y papa.', 2400, null, 'PEN', true, true, false, 20, 2),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'Chicha morada', 'Chicha morada artesanal bien fría.', 800, null, 'PEN', true, true, false, 3, 1)
on conflict (id) do update set is_available = true, is_visible = true, updated_at = now();
