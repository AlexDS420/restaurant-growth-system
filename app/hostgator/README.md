# BFF PHP para HostGator + Supabase

Este BFF está pensado para un plan básico de HostGator: PHP 8.1+, HTTPS, cPanel y Supabase como base de datos. El frontend Vite se publica como archivos estáticos y consume `/api/v1`.

## Instalación

1. Ejecuta `../../supabase/migrations/20260827000100_restaurant_core.sql` en un proyecto Supabase de prueba y luego `hostgator/supabase/004_outbox_events.sql` para habilitar la cola del cron.
2. Copia `hostgator/.env.example` a un archivo `.env` fuera de `public_html` cuando sea posible.
3. Configura `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` únicamente en el servidor PHP. Nunca incluyas la `service_role` en `public/`, Vite o JavaScript.
4. Publica `api/` detrás de HTTPS y activa `api/.htaccess`.
5. Configura el frontend para consumir `/api/v1`.

El endpoint público de pago acepta exclusivamente `yape` o `plin`, guarda el código de operación y lo deja en estado `pending` para revisión autorizada. Una captura no confirma un pago. Un usuario `owner`, `manager` o `cashier` puede confirmar o rechazar mediante `POST /api/v1/payments/{id}/confirm` con `X-CSRF-Token`.

## Contrato mínimo

- `GET /api/v1/public/venues/{slug}`
- `GET /api/v1/public/venues/{slug}/menu`
- `POST /api/v1/public/venues/{slug}/orders`
- `POST /api/v1/public/venues/{slug}/orders/{public_token}/pay`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `POST /api/v1/payments/{id}/confirm`
- `GET /api/v1/payments/reconciliation`

El BFF rechaza JSON inválido, usa cookies HttpOnly/SameSite, Supabase Auth, CSRF en mutaciones autenticadas, errores JSON uniformes, límites de campos y separación de secretos. Antes de declarar producción se debe probar el esquema en Supabase, HTTPS, RLS, backups, cPanel, restauración y un piloto real de Lima.

## Outbox y cron de cPanel

Ejecuta `supabase/004_outbox_events.sql` en Supabase. Configura `OUTBOX_WEBHOOK_URL` en el `.env` privado del servidor como un endpoint HTTPS controlado por el negocio. El worker `cron/process_outbox.php` es exclusivamente CLI y no se debe publicar como ruta web.

Cron recomendado cada minuto:

```cron
* * * * * /usr/local/bin/php /home/USUARIO/restaurant-growth/app/hostgator/cron/process_outbox.php >> /home/USUARIO/logs/restaurant-outbox.log 2>&1
```

El worker reclama hasta 25 eventos pendientes, usa `X-Idempotency-Key` con el UUID del evento, aplica reintentos exponenciales hasta 8 intentos y mueve los eventos agotados a `dead_letter`. Un estado `failed` queda programado para reintento; `sent` es terminal. El servicio receptor debe tratar el header de idempotencia como único para evitar envíos duplicados.

## Empaquetado reproducible

Desde `app/`, ejecuta `./scripts/package-hostgator.sh`. El script usa `frontend/dist/` cuando existe y, como fallback, `public/`; copia el BFF PHP a `public_html/api/`, deja el worker en `private/cron/`, excluye secretos, bases de datos, logs, `node_modules`, tests y datos, y genera `manifest.sha256`. Pasa la ruta de salida como primer argumento para no sobrescribir el paquete anterior.

La prueba local sin secretos se ejecuta desde `app/` con `php tests/bff-contract-test.php`; utiliza un Supabase REST falso en localhost y valida recalculo server-side, pago Yape pendiente y no exposición de la service key.

## cPanel cron

Mantén `cron/` fuera de `public_html` y programa, por ejemplo, cada 5 minutos:

```text
*/5 * * * * /usr/local/bin/php /home/USUARIO/restaurant/hostgator/cron/reconcile_payments.php >> /home/USUARIO/logs/payments.log 2>&1
```

`expire_pending.php` queda en dry-run hasta definir el SLA comercial. Los cron no sustituyen un webhook oficial ni una conciliación bancaria; solo procesan pendientes y dejan evidencia operativa.
