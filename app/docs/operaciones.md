# Operaciones — Restaurant OS

> **Legacy SQLite:** este documento describe el backend Node/SQLite histórico. El despliegue HostGator
> usa el BFF PHP y Supabase con tablas `ros_*`; no ejecutes estas consultas sobre el proyecto remoto.

## 1. Rutinas diarias/semanales

- **Respaldo:** `npm run backup` (o cron diario). Retención sugerida: 14 días.
- **Monitoreo:** `GET /api/v1/healthz` (liveness) y `GET /api/v1/metrics` (contadores: `http_requests_total`,
  `orders_created_total`, `payments_succeeded_total`, `payments_failed_total`, `refunds_total`,
  `notifications_failed_total`, `http_5xx_total`). Conectarlos a un scraper (Prometheus) o a un
  check HTTP simple.
- **Revisión de auditoría:** `SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50;` — revisar acciones
  sensibles (`billing.*`, `team.*`, `venue.updated`, `inventory.*`) cada semana.
- **Outbox:** revisar pendientes:
  ```sql
  SELECT event_name, channel, status, retry_count, next_attempt_at
  FROM notification_outbox WHERE status = 'pending' ORDER BY next_attempt_at;
  ```

## 2. Consultas útiles (datos de auditoría y operación)

Ver `docs/datos-auditoria.md` con el set completo. Resumen:

- Pedidos por estado hoy: `SELECT status, COUNT(*) FROM orders WHERE date(placed_at)=date('now') GROUP BY status;`
- Ingresos efectivos de la semana: `SELECT SUM(total_minor)/100.0 FROM orders WHERE payment_status='paid' AND placed_at >= datetime('now','-7 days');`
- Stock bajo umbral: `SELECT name, stock, min_stock FROM inventory_items WHERE stock <= min_stock ORDER BY stock;`
- Movimientos recientes: `SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 20;`
- Reembolsos: `SELECT o.order_number, r.amount_minor/100.0, r.reason, r.created_at FROM refunds r JOIN orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 20;`

## 3. Mantenimiento SQLite

- **WAL:** el archivo `-wal` se vacía solo con checkpoints; para backups usar `sqlite3 .backup` (seguro).
- **Integridad:** `sqlite3 data/restaurant-os.db "PRAGMA integrity_check;"` → debe decir `ok`.
- **Vacuum** (tras muchas bajas): `sqlite3 data/restaurant-os.db "VACUUM;"` (requiere pausa de escrituras).

## 4. Notificaciones (outbox)

- El pedido y sus notificaciones se escriben en la **misma transacción** → ante fallo del canal, el
  pedido existe igual y el outbox reintenta con `next_attempt_at = now + backoff * 2^retry`.
- Estados: `pending → sent` (o `failed` tras N intentos). Reintento manual:
  ```sql
  UPDATE notification_outbox SET status='pending', next_attempt_at=datetime('now') WHERE id=...;
  ```

## 5. Seguridad operativa

- `platform_admin` no edita datos de negocio de tenants (solo suspende/activa venues e inyecta overrides de entitelments desde `/api/v1/admin/*`).
- Rotación de sesiones: las sesiones expiran en 7 días; loguear de nuevo tras cambios de rol.
- `.env` jamás se versiona; el repo solo trae `.env.example`.
- Ante sospecha de fuga: invalidar sesiones borrando `sessions` de la BD y rotar `.env` (claves de ejemplo están en `config.js`; no hay claves reales en el repo).

## 6. Crecimiento

- SQLite soporta bien cargas de un solo nodo; el blueprint prevé migración a Supabase/Postgres:
  la matriz RLS está en `docs/arquitectura.md` y las queries ya están parametrizadas por `venue_id`
  (misma semántica que las políticas RLS).
