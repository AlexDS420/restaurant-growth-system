# Restaurant OS 🍽️

SaaS multi-tenant de **comercio y operaciones para restaurantes** implementado a partir del
*Master Product Blueprint* (v1.1, 49 secciones). Stack: **Node.js (cero dependencias) + SQLite
(`node:sqlite`, WAL) + vanilla JS/HTML/CSS** con sistema visual **"pase de cocina"**
(porcelana fría, verde operativo y señales azafrán para lectura rápida durante el servicio).

- **Idioma de producto:** español (es-PE) · **Moneda:** PEN (enteros en céntimos) · **Zona:** America/Lima
- **Código/API/tablas:** inglés (contrato §0 del blueprint)

---

## 1. Qué incluye

| Módulo | Alcance |
|---|---|
| **Comercio** | Storefront público (menú, opciones, promociones, cupones, zonas de delivery, carrito persistente), pedidos con precios **server-side**, pagos Stripe configurables (mock solo en desarrollo; nunca se almacena el PAN), webhooks firmados y conciliación, seguimiento en tiempo real, reseñas post-entrega |
| **Operaciones** | Pedidos, comandas (board 3 columnas), menú, stock/inventario con movimientos, clientes (360° + notas), reservas, reseñas (puntos QR + enlaces Google), equipo, auditoría |
| **Plataforma** | Multi-tenant (aislamiento por `venue_id`), RBAC (6 roles), entitlements Starter/Plus/Pro (server-side), plantillas de negocio (planes, facturas, checkout/cancelar/reintentar), analítica + CSV, notificaciones por outbox con reintentos, eventos de analítica |
| **Seguridad** | scrypt (N=16384,r=8,p=1), sesiones con token sha256 en cookie httpOnly SameSite=Lax, rate limits, CSP/cabeceras defensivas, auditoría con actor+timestamp, sin secretos en el repo (ver `.env.example`) |

## 2. Requisitos

- Node.js **>= 22.5** (usa `node:sqlite`; probado en v24.18.0, macOS arm64)
- `sqlite3` CLI (solo para backups/ensayos; la app no lo requiere)

## 3. Instalación y arranque (entorno limpio)

```bash
cp .env.example .env         # ajusta puerto/DB si quieres (SEED_DEMO queda apagado)
npm run seed                 # acción explícita: crea data/restaurant-os.db con migraciones + demo
npm start                    # http://localhost:3100
```

Verifica: `curl http://localhost:3100/api/v1/healthz` → `{"success":true,"data":{"status":"ok",…}}`

**Páginas**

- Landing: `http://localhost:3100/`
- Storefront demo (Casa Aurora): `http://localhost:3100/storefront.html`
- Panel admin: `http://localhost:3100/admin.html`
- Cuenta de cliente: `http://localhost:3100/account.html`

**Credenciales demo** (seed)

| Rol | Correo | Clave |
|---|---|---|
| Owner Casa Aurora (Pro trial) | `owner@casaaurora.pe` | `Demo1234!` |
| Owner La Cantina (Starter) | `owner@lacantina.pe` | `Demo1234!` |
| Cocina / Caja / Marketing | `cocina@casaaurora.pe` · `caja@casaaurora.pe` · `marketing@casaaurora.pe` | `Demo1234!` |
| Cliente | `cliente@demo.pe` | `Demo1234!` |
| Platform admin | `admin@restaurantos.pe` | `Admin1234!` |

**Pagos demo** (mock): `4242` → aprobado · `0001` → declinado (402) · `9999` → caída del proveedor.
El doble cobro devuelve `409 PAYMENT_ALREADY_PROCESSED`. La tarjeta nunca se almacena.

## 4. Scripts

| Comando | Descripción |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Servidor con watch |
| `npm test` | Suite E2E (26 pruebas, incluye las 6 obligatorias del §39 y regresiones de onboarding/seguridad/pagos/HTTP) |
| `npm run seed` | Migraciones + datos demo |
| `npm run backup` | Respaldo SQLite (WAL-safe) en `backups/` |
| `npm run drill` | Ensayo despliegue/rollback en BD aislada |
| `bash scripts/rollback.sh [archivo]` | Restaura respaldo (preserva pre-rollback, verifica integridad) |

## 5. Estructura

```
server/        API + motor de órdenes + auth + entitlements + notificaciones + migraciones
public/        storefront.html, admin.html, account.html, index.html + assets (css, js)
tests/         e2e.test.js (node:test, BD y puerto efímeros)
scripts/       backup.sh, rollback.sh, rehearsal.sh (sin comandos destructivos; ver §7)
data/          *.db de trabajo (gitignored)
docs/          arquitectura, runbooks, operaciones, informe de pruebas, registros, query de auditoría
```

Consulta [docs/arquitectura.md](docs/arquitectura.md) para el modelo de datos, la matriz RLS (migración futura a Supabase) y el contrato de API, y [docs/runbook-despliegue.md](docs/runbook-despliegue.md) para el despliegue paso a paso.

## 6. Cómo modificar (guía rápida)

| Quieres cambiar… | Archivo |
|---|---|
| Colores/fuentes/estilo "pase de cocina" | `public/assets/app.css` (variables CSS al inicio) |
| Textos de la UI | diccionario `esPE` en `public/assets/ui.js` |
| Productos/horarios/zonas demo | `server/seed.js` |
| Precios, IGV, promociones, cupones | `server/orders.js` (motor de precios) + datos en BD |
| Funciones por plan | `server/entitlements.js` |
| Plantillas de notificación | `server/notifications.js` |
| Esquema | nueva migración `server/migrations/002_*.sql` (el runner las aplica en orden) |
| Puerto / DB / límites | `.env` (ver `server/config.js`) |

## 7. Estado de la entrega y limitaciones conocidas

- **Cobertura del blueprint:** 49/49 secciones trazadas en [docs/trazabilidad.md](docs/trazabilidad.md) (decisiones D-01…D-13 en [docs/registro-decisiones.md](docs/registro-decisiones.md)).
- **Suite:** 26/26 en verde (`npm test`), detalle en [docs/informe-pruebas.md](docs/informe-pruebas.md) y auditoría en [docs/auditoria-optimizacion-uiux.md](docs/auditoria-optimizacion-uiux.md).
- **Demo interactiva validada en navegador:** pedido real (Ceviche Clásico, S/ 33.04 con IGV) → pago → seguimiento → panel admin → transición Nuevo→Aceptado → auditoría con actor.
- **Scripts operativos:** `scripts/backup.sh`, `scripts/rollback.sh` y `scripts/rehearsal.sh` implementados **sin comandos de borrado** (los `-wal/-shm` se archivan en `backups/quarantine/` y el ensayo usa `data/rehearsal-*.db` aislada); ensayo de despliegue/rollback ejecutado con éxito (integridad ok, pedidos intactos) — detalle en [docs/runbook-rollback.md](docs/runbook-rollback.md) y [docs/informe-pruebas.md](docs/informe-pruebas.md).
- **Fuera de alcance (por blueprint/contrato):** POS/KDS físico, marketplaces, migración de datos reales, pasarelas reales y certificación PCI, verticales no-restaurante.
