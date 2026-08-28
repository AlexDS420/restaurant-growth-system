# Métricas del piloto Lima

El piloto registra eventos en `public.pilot_metric_events` de Supabase. El registro es append-only, tiene idempotencia por negocio y clave, y queda bloqueado para `anon`/`authenticated` mediante RLS. El BFF PHP y los cron usan `service_role`; no requiere Node ni un worker persistente.

## Eventos mínimos

| Métrica | Evento | Valor recomendado | Dimensiones |
|---|---|---:|---|
| Onboarding iniciado | `onboarding_started` | 1 | `source` |
| Onboarding completado | `onboarding_completed` | 1 | `duration_seconds` |
| Pedido creado | `order_created` | 1 | `fulfillment_type`, `channel` |
| Pedido entregado | `order_completed` | 1 | `payment_method` |
| Error | `api_error` | 1 | `route`, `code`, `status` |
| Inicio cocina | `kitchen_started` | 1 | `station` |
| Pedido listo | `kitchen_ready` | 1 | `station` |
| Pedido entregado desde cocina | `kitchen_completed` | 1 | `station` |
| Pago enviado | `payment_submitted` | importe en soles | `method` |
| Pago confirmado | `payment_confirmed` | importe en soles | `method` |
| Pago rechazado | `payment_rejected` | importe en soles | `method`, `reason` |
| Diferencia conciliación | `reconciliation_mismatch` | diferencia en soles | `method`, `date` |

`value` debe ser una magnitud no monetaria o soles según la métrica; para importes se recomienda guardar soles con tres decimales y conservar también el importe en minor units dentro de `dimensions`.

## Inserción desde PHP

El BFF debe insertar eventos con una clave determinista, por ejemplo `order:{uuid}:created` o `payment:{uuid}:confirmed`. Si se reintenta la petición, la restricción `unique (venue_id, idempotency_key)` evita duplicados. Nunca se aceptan `venue_id` ni métricas arbitrarias desde un cliente sin validación; el servidor deriva el negocio desde el pedido, pago o sesión.

## Consultas del piloto

La vista `public.pilot_metrics_daily` permite consultar el tablero diario en zona horaria de Lima (`America/Lima`). Indicadores recomendados:

- conversión de onboarding: completados / iniciados;
- pedidos por día, canal y modalidad;
- tasa de cancelación: cancelados / creados;
- tasa de error por ruta y código;
- tiempo de cocina: diferencia entre `kitchen_started` y `kitchen_ready` usando `entity_id` y dimensiones;
- confirmación Yape/Plin: confirmados / enviados;
- tasa de rechazo de pagos;
- monto y cantidad de diferencias de conciliación.

Para un piloto inicial se recomienda retener 30 días, revisar semanalmente y no almacenar nombres, teléfonos, comprobantes ni secretos en `dimensions`. La tabla de métricas no sustituye `audit_logs` ni el historial de estados de pedidos/pagos.
