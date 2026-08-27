# Registro de decisiones (D-01…D-12, numeración canónica de docs/trazabilidad.md)

Contexto: decisiones tomadas al implementar el blueprint en el entorno local (sin servicios en la nube).
El mapa canónico D-01…D-12 es el que usa `docs/trazabilidad.md`; este registro las describe en detalle.

| ID | Decisión tomada | Alternativa del blueprint | Motivo |
|---|---|---|---|
| D-01 | Backend **Node.js puro (cero dependencias)**, `node:sqlite` | PHP | Entorno local sin instalaciones; `node:sqlite` estable en Node ≥ 22.5; contrato API idéntico |
| D-02 | **SQLite (WAL) con migraciones versionadas**; aislamiento multi-tenant por scoping de `venue_id` en la API + matriz RLS documentada para migrar a Postgres/Supabase | Supabase (Auth, Postgres RLS) | Persistencia local de cero fricción; la semántica de aislamiento (venue_id siempre desde sesión/slug, nunca del body) se replica en la capa de API y está mapeada tabla a tabla en docs/arquitectura.md |
| D-03 | **Outbox transaccional** + notifier pluggable (consola/archivo) con plantillas es-PE | EmailJS | El pedido nunca se pierde por fallo de envío; reintentos con backoff; EmailJS no es fuente de verdad |
| D-04 | **Vanilla SPA** (storefront inline autocontenido; admin/account con módulos) | React/Vite | Cero build, estáticos directos; diccionario esPE centralizado en `public/assets/ui.js` |
| D-05 | **Pagos mock** con interfaz `PaymentProviderInterface` (0001 declina · 9999 outage · 4242 ok · doble cobro 409) | Pasarela real | Sin credenciales ni PCI en esta entrega; contrato de pagos listo para pasarela real (last4+brand, `external_ref` UNIQUE, idempotencia) |
| D-06 | **Sin POS/KDS en v1** (sin caja, facturación fiscal, nómina, inventario por ingredientes) | POS/KDS | Fuera de alcance §alcance del blueprint; stock simple de producto + movimientos auditados |
| D-07 | Realtime por **polling** (comanda 5 s, seguimiento 3 s) | Supabase Realtime / WebSocket | Simplicidad del stack cero-dependencias; WebSockets quedan como mejora futura |
| D-08 | Imágenes de productos por **emoji/URL** | Supabase Storage | Sin almacenamiento externo; campo `image_url` listo para CDN |
| D-09 | SEO **client-side** (meta por venue vía JS) | SSR | Stack estático; las URLs públicas devenue son estables; SSR como mejora futura |
| D-10 | **Google OAuth → campo de URL directa** en la conexión de reseñas | Google OAuth | Sin credenciales OAuth en la entrega; `google_connections.review_url` alimenta el flujo de reseñas |
| D-11 | **Estructura de repo simplificada** (server/, public/, tests/, docs/, scripts/) | Monorepo con paquetes | Escala del proyecto; el layout se puede expandir sin romper |
| D-12 | **Mono-ubicación** (venue) con campos `organization_id`/`location_id` listos para multi-sede | Multi-sede desde el inicio | MVP del blueprint; la tabla venues permite añadir `branches` sin romper |

## Decisiones complementarias (sin ID D-xx; detalle de implementación)

- **Moneda exacta:** precios en céntimos (`*_minor`), IGV `tax_rate_bps` por venue, recálculo 100 % server-side (el cliente solo estima).
- **RBAC con claves canónicas** (`orders.transition`, `billing.manage`, `audit.read`, …): un solo lugar de verdad (`ROLE_PERMISSIONS` en server/auth.js); el sidebar del admin filtra por permiso.
- **IDs enteros locales + tokens públicos aleatorios** para pedidos y reseñas (URLs cortas para QR/compartir; el token público no adivina el ID interno).
- **Auditoría con actor:** `audit_logs` guarda `user_email` + `role` + `created_at` + antes/después (JSON); los eventos públicos quedan asociados al nombre del actor en `order_status_history.actor_name`.
- **Scripts operativos sin comandos destructivos:** respaldo WAL-safe, rollback que archiva `-wal/-shm` (cuarentena) y ensayo en BD aislada — ver runbook-rollback.md.