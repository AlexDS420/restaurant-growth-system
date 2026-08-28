# Supabase para Restaurant OS

La migración `migrations/20260827000100_restaurant_core.sql` define el núcleo Postgres para restaurantes de Lima:

- tablas aisladas `ros_organizations`, `ros_organization_members` y `ros_venues` para multitenancy;
- catálogo (`ros_menu_categories`, `ros_menu_products`, `ros_option_groups`, `ros_options` y vínculos);
- clientes, pedidos y snapshots de líneas;
- pagos en PEN con `cash`, `yape`, `plin`, transferencia y tarjeta;
- estados `pending`, `verifying`, `confirmed`, `rejected`, `expired`, `refunded` y `partially_refunded`;
- eventos de proveedor idempotentes y bitácora de auditoría.

La migración posterior `migrations/20260827000200_future_compliance.sql` deja preparados, pero **no habilitados**, `receipts` y `complaints` para comprobantes electrónicos y Libro de Reclamaciones. Son módulos feature-gated: requieren configurar un PSE/OSE, validación de CDR/correlativos, políticas de conservación y pruebas legales/operativas antes de encenderlos.

## Configuración segura

1. Aplicar la migración con Supabase CLI o SQL Editor en un proyecto de prueba antes de producción.
2. Configurar Supabase Auth y usar el UUID de `auth.users` como `user_id`.
3. En el frontend usar únicamente la publishable/anon key y un BFF PHP server-side.
4. Nunca incluir `service_role` en React, Vite, HTML, JavaScript, repositorio ni variables `VITE_*`.
5. El BFF debe validar sesión, tenant, importes calculados server-side y autorización antes de mutar.
6. Webhooks de Yape/Plin o de la pasarela deben verificarse en el BFF con firma y cuerpo raw antes de insertar `ros_payment_events`.

## Yape y Plin

La base registra comprobante/código (`operation_code`), importe esperado, método, estado y usuario que confirmó. Una imagen o captura no cambia por sí sola el estado a `confirmed`. La confirmación automática requiere un proveedor oficial con webhook verificable; mientras tanto, caja debe revisar y confirmar manualmente, dejando auditoría.

## Limitaciones de esta migración

- La migración aislada fue aplicada manualmente en el proyecto Supabase del piloto el 2026-08-27; el prefijo `ros_` evita colisiones con tablas ERP preexistentes.
- No contiene secretos, QR, números de cuenta ni credenciales.
- No reemplaza el BFF Node actual: es la base de la migración progresiva hacia PHP + Supabase.
- La escritura de auditoría desde el backend debe implementarse como operación controlada y append-only.
- La suite `supabase/tests/restaurant_core_rls.sql` valida RLS y debe ampliarse con fixtures allow/deny antes de declarar producción.
- Antes de activar comprobantes o Libro de Reclamaciones deben añadirse fixtures y pruebas de plazos, correlativos, CDR, estados, permisos de caja/administración y acceso público exclusivamente a través del BFF.
- El frontend público debe consultar solo filas publicadas mediante el BFF o la API con las políticas anon descritas.
