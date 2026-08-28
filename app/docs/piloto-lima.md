# Piloto Lima y puerta de producción

El piloto se ejecuta con 2–3 restaurantes de Lima (un local por organización) antes de publicar el sistema como producción.

## Instrumentación mínima

- `onboarding_started`, `onboarding_completed` y tiempo hasta publicar menú.
- `menu_viewed`, `checkout_started`, `order_created`, `order_cancelled`.
- `payment_submitted`, `payment_confirmed`, `payment_rejected`, `reconciliation_exception`.
- `kitchen_started`, `kitchen_ready`, `order_completed` y tiempos entre estados.
- errores HTTP por ruta y errores de validación, sin PII ni secretos.

## Criterios de salida

- 20 pedidos reales por restaurante sin pérdida de pedido ni duplicación por reintento.
- 100% de pagos Yape/Plin conciliados con código de operación y usuario responsable.
- Mediana de confirmación de pago < 10 minutos en horario operativo.
- Cero accesos cross-tenant en pruebas RLS y cero secretos en el bundle.
- Restauración de una copia de Supabase y despliegue PHP probado en HostGator.

La métrica local no equivale a evidencia de producción. El estado `PRODUCTION_READY` solo se puede declarar después de configurar credenciales reales, HTTPS, cron de cPanel, backups y una transacción de prueba con cada medio habilitado.
