# Arquitectura — Restaurant OS

## 1. Visión general

- **Backend:** Node.js puro (cero dependencias), HTTP sobre el módulo `node:http`, router propio, ESM.
- **Persistencia:** SQLite vía `node:sqlite` en modo **WAL**, esquema versionado por migraciones (`server/migrations/001_init.sql`, runner en `server/db.js`).
- **Frontend:** HTML/JS/CSS vanilla. El storefront es un módulo inline autocontenido; admin y cuenta usan `public/assets/admin.js` y `public/assets/account.js`. Diccionario es-PE centralizado en `public/assets/ui.js`.
- **Moneda:** enteros en céntimos (`*_minor`). **IGV 18%** configurable por negocio (`tax_rate_bps`).

```
Navegador (storefront / admin / account)
   │  HTTPS + cookies de sesión (ros_session)
   ▼
server.js  (router, middleware: parseo, rate limits, CORS same-origin, estáticos, /api/v1/healthz, /api/v1/metrics)
   ├── routes-public.js   → menú, pedidos, pago, seguimiento, reseña, eventos (sin sesión; venue por slug)
   ├── routes-app.js      → panel: /me, pedidos, menú, inventario, clientes, reservas, reseñas,
   │                        promos, cupones, facturación, equipo, auditoría, config, analítica
   ├── orders.js          → motor: precios server-side, promociones, cupones, zonas, IGV, stock,
   │                        transiciones, reembolsos, reseñas, métricas
   ├── auth.js            → scrypt, sesiones sha256, RBAC
   ├── entitlements.js    → plan Starter/Plus/Pro + overrides de plataforma
   ├── payments.js        → mock de pasarela (0001 declina, 9999 outage)
   ├── notifications.js   → outbox + reintentos con backoff (es-PE)
   └── db.js              → conexión, migraciones, withTxn*, audit(), analyticsEvent()
```

## 2. Modelo de datos (resumen)

~30 tablas en `server/migrations/001_init.sql`. Núcleo:

- `venues` (negocio: nombre, slug único, horarios JSON, zonas JSON, fees, `orders_enabled`, IGV)
- `users` (email único, scrypt hash, rol, estado, `venue_id` nullable para platform_admin)
- `subscriptions` + `plans` + `invoices` (Starter/Plus/Pro, trial 7d, cancelación programada)
- `categories`, `products` (precio y promo en céntimos, `track_stock`, imagen emoji/URL), `product_options`, `option_groups`, `product_option_groups`
- `promotions` (special_price, `percent_off`, `buy_x_get_y` con tope), `coupons` + `coupon_redemptions` (uso único por orden, únicos)
- `zones` (por venue; fee y pedido mínimo en céntimos)
- `orders`, `order_items`, `order_status_history`, `payments` (solo last4+brand, `external_ref` UNIQUE), `refunds`
- `inventory_items`, `inventory_movements` (tipo `in`/`out`/`adjust`, motivo)
- `customers` + `customer_notes`
- `reservations` + `reservation_settings`
- `review_points` (token público QR), `reviews` (públicas → Google, o privadas), `review_requests`
- `audit_logs` (venue, user_email, role, action, entity, before/after JSON, ip, created_at)
- `analytics_events` (menu_viewed, order_*, payment_*), `notification_outbox` (evento, canal, estado, intentos, `next_attempt_at`)

Invariantes clave: `external_ref` UNIQUE en pagos (idempotencia de webhooks), `order_items` inmutables con
precio unitario copiado al momento de la compra, stock descontado en la misma transacción que la orden,
cupones con restricciones (mínimo, vigencia, uso único).

## 3. Multi-tenant y aislamiento

- Cada request autenticado obtiene `venue_id` **solo desde la sesión** (nunca del body).
- Todas las queries del panel filtran por `WHERE venue_id = ?` (helper central en routes-app).
- El storefront público accede por `slug` (token público) y nunca expone datos de otro tenant.
- La matriz "RLS" documenta, tabla a tabla, el equivalente para migrar a Supabase/Postgres:

| Tabla | RLS objetivo (Supabase) | Política |
|---|---|---|
| venues, categories, products, promotions, coupons, zones, inventory_*, customers, reservations, review_*, analytics_events, audit_logs, notification_outbox | `USING (venue_id = auth.jwt()->>'venue_id')` | Tenant propietario |
| orders, order_items, payments, refunds, order_status_history | `USING (venue_id = auth.jwt()->>'venue_id')` + CHECK `payment_status` | Tenant + invariantes de pago |
| users | `USING (venue_id = auth.jwt()->>'venue_id')` + visibility `role <> 'platform_admin'` | Equipo del tenant |
| plans, invoices (platform) | solo service_role | Admin de plataforma |
| subscriptions | `USING (venue_id = ...)` | Tenant propietario |

## 4. Contrato de API

Fuente de verdad: `.cluster/restaurant-os/api-contract.md`. Superficies:

- **Pública** `/api/v1/public/venues/:slug` · `/menu` · `/orders` (POST con `idempotency_key`) · `/orders/:token/pay` · `/orders/:token` (GET seguimiento) · `/orders/:token/review` · `/events/batch`
- **App** `/api/v1/me` · `/auth/*` · `/venue` · `/orders*` · `/menu/*` · `/inventory*` · `/customers*` · `/reservations*` · `/reviews*` · `/promotions` · `/coupons` · `/billing*` · `/team*` · `/audit` · `/analytics/*`
- Envoltura uniforme `{ success, data }` / errores `{ error: { code, message } }` sin stack traces.

## 5. Seguridad

- **Passwords:** scrypt (N=16384, r=8, p=1, salt 16B), nunca en claro; sin secretos en el repo (`.env` gitignored, `.env.example` de plantilla).
- **Sesiones:** token aleatorio 32 B; se guarda sha256; cookie `ros_session` httpOnly + SameSite=Lax, 7 días.
- **RBAC:** `platform_admin | owner | manager | kitchen | cashier | marketing | viewer` con claves canónicas (`orders.transition`, `billing.manage`, `inventory.manage`, `analytics.read`, `audit.read`, `venue.manage`, …). El sidebar del admin filtra por permiso.
- **Rate limits:** login 10/15 min por IP+email, menú público 30/min por IP, pedidos 10/min por IP (desactivable por env para tests).
- **Entitlements:** siempre forzados en el servidor (crear producto con plan Starter → `403 PLAN_LIMIT`), nunca en el cliente.
- **Auditoría:** mutaciones sensibles → `audit_logs` con `user_email`, `role`, `created_at`, `before/after`.

## 6. Confiabilidad

- **Idempotencia:** `idempotency_key` único por orden; reintentos → misma orden. Pagos: `external_ref` UNIQUE → doble cobro imposible (`409 PAYMENT_ALREADY_PROCESSED`).
- **Precios:** el cliente muestra estimación; el servidor recalcula todo (subtotal → promoción → cupón → zona/mínimo → IGV).
- **Notificaciones:** outbox transaccional con el pedido (mismo `withTxn`); si falla el envío, `retry_count`/`next_attempt_at`; el pedido **nunca** se pierde por una notificación fallida.
- **Migraciones:** runner versionado (`migrations` table); nueva migración = nuevo archivo `NNN_*.sql`.
- **Backups/rollback:** ver `docs/runbook-rollback.md` y `docs/operaciones.md`.