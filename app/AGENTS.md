# Restaurant OS — Reglas de ingeniería (adaptación AGENTS.md del blueprint §46)

## Contrato de idioma
- Comunicación con el product owner, planes, informes, UI visible, validaciones, notificaciones, contenido demo y documentación: **español (es-PE)**.
- Identificadores de código, nombres de tablas/columnas, rutas de API, nombres de archivo y variables de entorno: **inglés**.

## Stack (esta entrega)
- Backend: Node.js ≥22.5 zero-dependencias (node:http, node:sqlite, node:crypto).
- Frontend: SPA vanilla (HTML+CSS+JS) con diccionario es-PE centralizado y design tokens CSS.
- Base de datos: SQLite (node:sqlite) con scoping multi-tenant forzado en la capa API; matriz RLS documentada para migración futura a Supabase/Postgres (ver docs/arquitectura.md).
- Pagos: adaptador mock (PaymentProviderInterface) — sin almacenar datos de tarjeta.
- Notificaciones: outbox_events + notifier pluggable; jamás controlan el éxito de la transacción.

## Reglas no negociables (del blueprint)
1. El venue_id SIEMPRE se resuelve del usuario autenticado; nunca del browser.
2. Precios y totales se calculan server-side; nunca se confía en el navegador.
3. Entitlements (planes) se aplican server-side.
4. Los cambios de esquema requieren migraciones versionadas (migrations/).
5. Los items de pedido guardan snapshot de nombre/precio/opciones.
6. Las operaciones críticas son idempotentes (idempotency_key).
7. Stock nunca negativo (CHECK + transacción).
8. Tokens públicos no exponen IDs internos.
9. Auditoría obligatoria en mutaciones sensibles (actor, rol, acción, antes/después, timestamp).
10. Prohibido: review gating e incentivos por reseñas.

## Método de trabajo
Antes de editar: explicar la tarea en español, listar archivos afectados, impacto en DB/seguridad/entitlements, casos de prueba.
Después de editar: correr tests, correr build/smoke, revisar navegador (estados loading/error/empty, móvil 375px y desktop), reportar en español, documentar limitaciones.

## Definición de done (blueprint §40)
Criterios de aceptación cumplidos · migración si aplica · RLS/documentado · estados de carga/error/vacío · móvil y desktop verificados · sin errores de consola · tests pasan · docs actualizadas · sin secretos · auditoría en acciones sensibles · limitaciones documentadas.