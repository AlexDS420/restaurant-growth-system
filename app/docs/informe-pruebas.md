# Informe de verificación — Restaurant OS

Fecha: 2026-08-24 (Lima). Versión: 1.0.0. Entorno: macOS arm64, Node v24.18.0, `node:sqlite`, SQLite WAL.

## 1. Suite automatizada

`npm test` (node:test, puerto y BD efímeros — `data/test-*.db`):

```
ℹ tests 21 · ℹ pass 21 · ℹ fail 0 · duration ~1.6 s
```

### Las 6 pruebas obligatorias del blueprint (§39)

| # | Caso | Verifica | Resultado |
|---|---|---|---|
| T1 | Aislamiento multi-tenant | Pedido creado en Casa Aurora **invisible** para La Cantina (y viceversa); usuario de un tenant no lista datos del otro | ✅ |
| T2 | Precios server-side | Cliente intenta manipular precios/cantidades → el servidor recalcula con precios de BD (promo 2x1 del Lomo: total 33.04, descuento 28.00) | ✅ |
| T3 | Idempotencia de pedido y pago | Misma `idempotency_key` → misma orden (sin duplicado); doble cobro → `409 PAYMENT_ALREADY_PROCESSED` | ✅ |
| T4 | Notificaciones no pierden pedidos | Se fuerza fallo del "envío" → la orden queda creada y el outbox en `pending` con reintento programado | ✅ |
| T5 | Entitlements Plus vs Pro | Override de plataforma: tenant Plus no puede crear punto de reseña (`403 PLAN_LIMIT`), Pro sí; Starter sin pedidos | ✅ |
| T6 | RBAC | kitchen no puede leer analítica/exportar; manager no puede cancelar suscripción; roles sin `audit.read` no ven auditoría | ✅ |

### Extras cubiertos

Pago declarado (0001 → 402), caída de proveedor (9999), pago OK (4242) + `payment.succeeded`,
reembolso total/parcial (stock y estado consistentes), consumo/restauración de stock, `STOCK_OUT`,
cupón `BIENVENIDA10` (10 %), mínimo de delivery por zona, reserva pública + confirmación,
reseña con punto QR (`/r/:token`) y feedback privado, promoción + cupón en el mismo carrito,
auditoría con actor/acción/timestamp, `/api/v1/metrics` y `/api/v1/healthz`, **persistencia tras reinicio del
servidor** (mismo archivo de BD, datos intactos).

## 2. Verificación interactiva (navegador real)

Servidor demo `http://localhost:3100` (`data/demo.db`, `SEED_DEMO=true`). Flujo ejecutado
clic a clic con inspección de DOM:

1. **Storefront:** 11 productos de Casa Aurora, precios en soles, promo "Lomo Saltado S/ 28.00
   (antes S/ 32.00)", filtro por categorías, búsqueda.
2. **Carrito:** agregar Ceviche Clásico → barra fija "1 artículo · S/ 28.00"; botón pasa a
   "Agregado · 1"; **persiste tras recargar la página** (localStorage `ros_cart` + revalidación de producto).
3. **Checkout:** nombre/teléfono/correo (validación), Recojo, notas, cupón (aviso "server-side").
4. **Pedido #3:** creado con `idempotency_key` → `{status: pending, payment_status: unpaid,
   totals: {subtotal 2800, tax 504, total 3304}}` (= 28.00 + 18 % IGV).
5. **Pago 4242:** `payment.succeeded`; doble clic → guard del botón deshabilitado.
6. **Seguimiento:** "¡Pedido recibido! Pedido #3 · S/ 33.04 · Recojo — Estado actual: Nuevo · Pago: Pagado" + stepper.
7. **Panel admin:** login `owner@casaaurora.pe` → "MARTA RÍOS · DUEÑO", dashboard con
   **VENTAS HOY S/ 33.04 · PEDIDOS HOY 1**, checklist de configuración, oportunidades.
8. **Pedidos:** tabla con trazabilidad (#3 Nuevo/Pagado; #2 Cancelado/Reembolsado; #1 Entregado/Pagado).
9. **Transición:** "Aceptar pedido" → estado **Aceptado**; historial con actores
   (Alex Demo creó; Marta Ríos aceptó) y timestamps.
10. **Auditoría:** `order.created` · `payment.succeeded` · `order.accepted` (con `user_email=owner@casaaurora.pe`, `role=owner`).

### Defectos encontrados y corregidos durante la verificación

| Defecto | Causa raíz | Fix |
|---|---|---|
| El modal de producto no se abría al hacer clic en la tarjeta | `productById` comparaba `x.id === id` estricto con el `data-prod` string → siempre `null` → early return silencioso | `Number(id)` en la comparación |
| "Tu pedido está vacío" (400 EMPTY_ORDER) al confirmar desde el navegador | `openCheckout` construía `items` pero **no lo incluía en el body** del POST | agregar `items` al body |
| `npm test` (script `node --test tests/`) fallaba al arrancar en Node 24 | trailing slash en el argumento del runner | script ahora `node --test` (autodetección) |
| `GET /reviews` 500 (`no such column: o.order_number`) | la tabla `orders` no tiene `order_number` (se sintetiza) | `o.id AS order_number` |

## 3. Cobertura del blueprint

- Matriz de trazabilidad: `docs/trazabilidad.md` — 49/49 secciones con requisito y decisión asociada (D-01…D-13).
- Funciones marcadas futuras/opcionales por el blueprint: registradas como futuras (no implementadas, sin silencio).

## 4. Limitaciones declaradas

- Pasarela de pago mock (sin PCI; nunca se almacena el PAN).
- Sin POS/KDS físico ni marketplaces.
- `scripts/backup.sh`, `scripts/rollback.sh` y `scripts/rehearsal.sh` operativos, sin comandos destructivos; ensayo de rollback ejecutado con éxito (ver runbook-rollback.md).