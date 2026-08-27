# Pagos en producción

## Estado

El sistema tiene un adaptador desacoplado con dos modos:

- `mock`: permitido únicamente para desarrollo y pruebas automatizadas. Simula aprobación, rechazo (`0001`) y caída (`9999`); no representa una liquidación real.
- `stripe`: implementación opcional basada en Stripe PaymentIntents y Refunds. Requiere credenciales del entorno y un `payment_method_id` generado por Stripe.js/Elements o el SDK móvil. El backend nunca debe recibir números completos de tarjeta.

La selección se realiza con `PAYMENTS_MODE=stripe`. Sin `STRIPE_SECRET_KEY`, el modo Stripe falla de forma explícita con `provider_not_configured`; no hay fallback silencioso a mock.

## Variables requeridas

```dotenv
PAYMENTS_MODE=stripe
STRIPE_SECRET_KEY=sk_live_REDACTED
STRIPE_WEBHOOK_SECRET=whsec_REDACTED
```

Las claves reales deben existir únicamente en el gestor de secretos del entorno de ejecución. No deben guardarse en Git, `.env.example`, logs, capturas o tickets. En producción se debe usar HTTPS y claves `sk_live_`.

## Flujo de cobro

1. El cliente crea un PaymentMethod con Stripe.js/Elements.
2. Envía solo el identificador `payment_method_id` al endpoint de pago.
3. El servidor crea y confirma un PaymentIntent con el total calculado server-side y el `order_id` en metadata.
4. El estado local se confirma mediante webhook firmado. Si Stripe devuelve `requires_action`, el cliente debe completar 3-D Secure usando el `client_secret` y esperar el webhook.
5. Los reintentos se protegen con el estado local del pago y el evento Stripe único.

El endpoint es `POST /api/v1/webhooks/stripe`. Valida `Stripe-Signature` con HMAC, timestamp y tolerancia de cinco minutos. Los eventos se persisten en `payment_webhook_events` con restricción única `(provider, provider_event_id)`, de modo que una entrega repetida es reconocida como duplicada.

## Conciliación

`GET /api/v1/payments/reconciliation` requiere `payments.read` y devuelve las diferencias entre `payments.status` y `orders.payment_status` del negocio autenticado. La consulta es una señal operativa, no una conciliación bancaria contable: para cerrar caja aún se necesita comparar los reportes de Stripe (balance transactions/payouts) con el extracto bancario y registrar comisiones, moneda, fecha de liquidación y chargebacks.

## Requisitos pendientes antes de producción

- Configurar Stripe en una cuenta real y completar el flujo 3-D Secure en frontend.
- Configurar el webhook en Stripe con la URL HTTPS pública y el secreto específico del endpoint.
- Cambiar el body parser para preservar `req.rawBody` byte a byte antes de `JSON.parse`; el fallback canonicalizado actual sirve para pruebas, pero Stripe exige validar exactamente el payload recibido.
- Añadir manejo de `charge.refunded`, disputas/chargebacks, pagos expirados y eventos fuera de orden.
- Ejecutar una conciliación diaria contra payouts y banco, con alertas y procedimiento de reversión.
- Rotar secretos y probar recuperación ante timeout, duplicado y caída del proveedor.

Por lo tanto, el código ya no depende exclusivamente de un mock, pero el estado global solo puede declararse listo para producción después de configurar el proveedor real, preservar el payload crudo y ejecutar las pruebas de certificación del comercio.
