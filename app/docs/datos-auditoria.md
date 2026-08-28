# Datos de auditoría y consultas de verificación

> **Legacy SQLite:** las consultas de este documento corresponden al backend histórico. Para el BFF
> PHP/Supabase usa `public.ros_audit_logs`, `public.ros_orders` y `public.ros_payments` con el acceso
> privilegiado controlado del servidor; nunca expongas `service_role` al navegador.

El panel "Auditoría" expone `GET /api/v1/audit` (filtros: entity_type, action, from, to). Debajo, el
set de consultas SQL directas para auditoría, trazabilidad y reconciliación.

## 1. Auditoría de acciones sensibles

```sql
-- Últimas 50 acciones de cualquier tenant
SELECT id, venue_id, user_email, role, action, entity_type, entity_id, created_at
FROM audit_logs ORDER BY id DESC LIMIT 50;

-- Acciones de un usuario específico (trazabilidad "quién hizo qué")
SELECT action, entity_type, entity_id, created_at
FROM audit_logs WHERE user_email = 'owner@casaaurora.pe' ORDER BY id DESC;

-- Cambios de facturación / equipo / inventario (los más sensibles)
SELECT * FROM audit_logs
WHERE action LIKE 'billing.%' OR action LIKE 'team.%' OR action LIKE 'inventory.%'
ORDER BY id DESC;

-- Con detalle antes/después (JSON)
SELECT action, entity_type, before_json, after_json, user_email, created_at
FROM audit_logs WHERE before_json IS NOT NULL ORDER BY id DESC LIMIT 20;
```

## 2. Trazabilidad de un pedido (historial de estados)

```sql
SELECT o.id, o.status, o.payment_status, o.customer_name, o.customer_email,
       h.status AS estado, h.note, h.actor_name, h.created_at
FROM orders o
JOIN order_status_history h ON h.order_id = o.id
WHERE o.venue_id = 1 AND o.id = 3
ORDER BY h.id;
```

Respuesta esperada (pedido demo #3): `pending` (Alex Demo) → `accepted` (Marta Ríos).

## 3. Pagos y reembolsos

```sql
-- Pagos (solo last4 + marca; nunca PAN)
SELECT id, order_id, card_last4, card_brand, amount_minor/100.0 AS monto_soles,
       status, external_ref, created_at FROM payments ORDER BY id DESC;

-- Doble cobro imposible: buscar external_ref duplicados
SELECT external_ref, COUNT(*) FROM payments GROUP BY external_ref HAVING COUNT(*) > 1;

-- Reembolsos
SELECT o.order_number, r.amount_minor/100.0, r.reason, r.status, r.created_at
FROM refunds r JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC;
```

## 4. Reconciliación de stock (productos vs inventario)

```sql
-- Consumo por pedido (productos con stock controlado)
SELECT p.name, SUM(oi.quantity) AS unidades_vendidas
FROM order_items oi JOIN products p ON p.id = oi.product_id
WHERE oi.order_id IN (SELECT id FROM orders WHERE status <> 'cancelled')
GROUP BY p.name ORDER BY 2 DESC;

-- Movimientos de inventario (traza de entrada/salida/ajuste)
SELECT type, reason, qty, created_at FROM inventory_movements ORDER BY id DESC LIMIT 50;
```

## 5. Métricas

```bash
curl http://localhost:3100/api/v1/metrics
# examples:
# http_requests_total 42
# orders_created_total 3
# payments_succeeded_total 2
# payments_failed_total 1
# http_5xx_total 0
```

## 6. Sesiones y seguridad

```sql
-- Sesiones activas (token hasheado; NUNCA el token crudo)
SELECT user_id, expires_at, created_at FROM sessions WHERE expires_at > datetime('now');

-- Invalidar todas las sesiones de un usuario (rotación ante sospecha)
DELETE FROM sessions WHERE user_id = ?;  -- bajo supervisión del operador
```
