# Runbook de despliegue — Restaurant OS

Reproducible en un entorno limpio (macOS/Linux). Sin dependencias externas: solo Node ≥ 22.5 y `sqlite3` CLI (opcional, para backups).

## 1. Preparar el entorno

```bash
node -v   # debe ser >= 22.5 (probado en 24.18.0)
git clone <repo> restaurant-os && cd restaurant-os
cp .env.example .env
```

El repositorio incluye `package-lock.json`; en CI y producción se usa `npm ci` para
reproducir exactamente el árbol declarado. No se deben subir `.env`, `data/*.db` ni
credenciales al repositorio.

Variables disponibles (`.env`):

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3100` | Puerto HTTP |
| `DB_PATH` | `data/restaurant-os.db` | Ruta de la base SQLite |
| `SESSION_TTL_DAYS` | `7` | Vida de la sesión |
| `RATE_LIMIT_ENABLED` | `true` | Rate limits globales (poner `false` solo en tests) |
| `NOTIFY_BACKOFF_MS` | `30000` | Backoff base del outbox |

## 2. Instalar (sin dependencias) y sembrar

```bash
npm run seed     # aplica migraciones + datos demo (crea data/)
npm start        # servidor en http://localhost:3100
```

Verificación de arranque:

```bash
curl -s http://localhost:3100/api/v1/healthz  # → {"success":true,"data":{"status":"ok",…}}
curl -s http://localhost:3100/metrics        # → contadores (orders_created, payments_succeeded, http_requests…)
curl -s http://localhost:3100/ | head -c 120 # → HTML de la landing
```

## 3. Smoke de humo (5 min)

1. Abre `http://localhost:3100/storefront.html` → deben verse los 11 productos de **Casa Aurora** con precios en soles (promo: Lomo S/ 28 tachado S/ 32).
2. Agrega **Ceviche Clásico** → barra fija "1 artículo · S/ 28.00".
3. **Confirmar pedido** → nombre `Alex Demo`, teléfono `999888777`, correo `cliente@demo.pe`, Recojo → Confirmar.
4. Pago: `4242`/visa → se abre el seguimiento "Pedido recibido · Pagado".
5. `http://localhost:3100/admin.html` → `owner@casaaurora.pe` / `Demo1234!` → **Pedidos** debe listar el pedido nuevo (Nuevo/Pagado/S/ 33.04) → "Aceptar pedido" lo pasa a Aceptado.
6. `Auditoría` debe mostrar `order.created`, `payment.succeeded`, `order.accepted` con actor y hora.

## 4. Desplegar una versión nueva (código y/o esquema)

1. `git pull` / copia de la nueva versión (no sobrescribir `data/` ni `.env`).
2. **Antes:** `npm run backup` (respaldo WAL-safe en `backups/restaurant-os.<fecha>.db`).
3. `npm start` (el runner aplica las migraciones nuevas `server/migrations/NNN_*.sql` en orden; cada una se registra en la tabla `migrations`).
4. Re-correr smoke §3 y `npm test`.

## 5. Verificación de persistencia

- Reinicia el servidor (`Ctrl+C` → `npm start`): pedidos, clientes, stock e historial **sobreviven** (SQLite en `data/`). La suite incluye la prueba explícita "persistencia: datos sobreviven reinicio".

## 6. Rollback

Procedimiento completo en `docs/runbook-rollback.md`:
`npm run backup` siempre antes de tocar esquema · restaurar el respaldo más reciente · reiniciar.

## 7. Troubleshooting rápido

| Síntoma | Causa probable | Acción |
|---|---|---|
| `ERR_REQUIRE_ESM` / import falla | Node < 22.5 | Actualizar Node |
| `data/restaurant-os.db` no existe al arrancar | No se corrió seed | `npm run seed` |
| `SQLITE_BUSY` en backups | Server escribiendo | `sqlite3 data/restaurant-os.db "PRAGMA wal_checkpoint(TRUNCATE);"` o pausar escrituras |
| Pedidos no llegan a la comanda (5 s) | Polling del board | Revisar consola del admin (red/HTTP) |
| `429 RATE_LIMITED` en demo | Rate limit por IP | Esperar la ventana o `RATE_LIMIT_ENABLED=false` (solo desarrollo/tests) |

## 8. Despliegue persistente con Docker + nginx

El runtime completo no es un sitio estático: necesita Node persistente para la API,
sesiones y worker de outbox, además de un volumen persistente para SQLite. El
`docker-compose.yml` levanta ambos servicios y nginx actúa únicamente como reverse
proxy; no se publica `public/` directamente.

```bash
cp .env.example .env
# Editar .env con valores de producción fuera del repositorio.
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost/nginx-health
curl -fsS http://localhost/api/v1/healthz
curl -fsS http://localhost/api/v1/readyz
```

La aplicación escucha internamente en `app:3000`. SQLite vive en el volumen
`restaurant_data`; respáldalo con una tarea de backup del volumen. Antes de una nueva
versión: ejecutar backup, `docker compose build`, `docker compose up -d` y verificar
`readyz` antes de enrutar tráfico.

En producción nginx debe terminar TLS (o estar detrás de un balanceador TLS),
restringir el acceso administrativo y enviar `X-Forwarded-For` solo desde proxies
confiables. `TRUST_PROXY=true` solo es correcto en esa topología; nunca expongas el
puerto 3000 directamente a Internet.

`SIGTERM`/`SIGINT` detienen el worker de outbox, marcan el servicio como no listo,
cierran el listener HTTP y cierran SQLite de forma ordenada. `readyz` es el endpoint
para readiness de orquestadores; `healthz` comprueba liveness y la conexión de base.
