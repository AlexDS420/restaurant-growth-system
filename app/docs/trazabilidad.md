# Matriz de trazabilidad — Master Product Blueprint v1.1 → Restaurant OS

Fecha de revisión: 2026-08-24 (sección por sección, antes del build) · Criterio de aceptación: blueprint-coverage-complete.
Leyenda de estado: ✅ Implementado · 🟡 Implementado parcial/adaptado (decisión D-xx) · 📋 Documentado/planificado (backlog).

| # | Sección del blueprint | Requisito clave | Implementación / Decisión | Estado |
|---|---|---|---|---|
| 0 | Global Language Contract | UI y entregables en español; código en inglés | Diccionario `esPE` centralizado, UI es-PE, identificadores en inglés | ✅ |
| 1 | System Role | Arquitecto/QA asegurando coherencia, aislamiento, integridad | Proceso por tickets + informes en español al cierre | ✅ |
| 2 | Product Vision | Canal directo, menú digital, pedidos, clientes, reseñas, comandas | Copy del storefront y panel alineado a la propuesta | ✅ |
| 3 | Product Strategy | 5 motores: Commerce→Operations→Customers→Reputation→Growth | Módulos implementados en ese orden; flywheel en docs | ✅ |
| 4 | Product Positioning | "Vende directamente, organiza tu operación, haz que regresen" | Copy es-PE en storefront/login | ✅ |
| 5 | Initial Customer Profile | Restaurantes independientes 1 local, 50-500 pedidos/mes | Alcance MVP respetado; fuera de alcance documentado (§43) | ✅ |
| 6.1 | Activación <15 min | Onboarding: cuenta→negocio→horarios→categoría→producto→estilo→publicar→QR | Checklist "Completa tu configuración" + eventos medibles (`account_created_at…first_order_at`) | ✅ |
| 6.2 | Mobile-first storefront | Una mano, targets grandes, carrito persistente, poco checkout | Layout móvil 375px verificado; barra de carrito persistente | ✅ |
| 6.3 | Guest checkout | Pedido sin cuenta con nombre/teléfono/entrega/pago | Guest checkout implementado; perfil auto por teléfono normalizado | ✅ |
| 6.4 | Server authoritative | Precios/stock/cupones/totales decididos en server | Cálculo server-side en order engine; test de manipulación de precio | ✅ |
| 6.5 | Transacciones sobreviven fallo de notificación | Validate→save→commit→enqueue→notify async | Outbox: la orden se commitea antes; notifier falla sin revertir (test) | ✅ |
| 6.6 | Sin POS en V1 | Sin caja, facturación fiscal, nómina, inventario por ingredientes | Respetado; documentado en decisión D-06 | ✅ |
| 7.1-7.3 | Planes Starter/Plus/Pro | Presencia / Venta directa+reputación / Operación+automatización | Planes en DB (plans/features/plan_features) con precios configurables | ✅ |
| 7.4 | Matriz de capacidades por plan | 50 productos, pedidos, zonas, puntos de reseña, staff... | Entitlement keys aplicadas server-side (enforceEntitlement) | ✅ |
| 7.5 | Entitlement architecture | Centralizado, no `if plan===` disperso | Servicio entitlements.js con claves únicas; gate en UI + enforcement en API | ✅ |
| 7.6 | Trial behavior | 7 días Pro, downgrade a Starter sin borrar datos | Trial implementado; downgrade preserva datos (premium read-only) | ✅ |
| 8 | Product Modules (22 módulos) | Lista completa de módulos | Todos cubiertos: auth, orgs, locations, onboarding, planes, menú, storefront, carrito, checkout, órdenes, comandas, clientes, delivery, promos, cupones, reseñas, reservas, analítica, billing, equipo, integraciones(outbox), notificaciones, superadmin, auditoría | ✅/🟡 (realtime→polling D-07) |
| 9 | Auth & Multi-tenancy | Supabase Auth; orgs→locations; memberships | Adaptado D-02: sesión propia (scrypt+token hash); venues con organization_id/location_id para expansión | ✅ (adaptado) |
| 10 | Roles & Permissions | platform_admin, owner, manager, kitchen, cashier, marketing, viewer | RBAC implementado según security-spec (matriz rol→permisos) | ✅ |
| 11 | Onboarding | 9 pasos + activación checklist + datos del negocio | Checklist UI + endpoint de estado de activación | ✅ |
| 12 | Menu CMS | Categorías/productos/imágenes/stock/opciones/visibilidad | CRUD completo + option groups + imágenes (emoji/url; storage D-08) | ✅ |
| 13 | Public Storefront | Rutas públicas, SEO por negocio | Rutas implementadas; SEO: meta por venue vía JS + decisión D-09 (sin SSR) | 🟡 D-09 |
| 14 | Cart | Persistencia localStorage + invalidación | Implementado con expiración y recálculo server-side | ✅ |
| 15 | Checkout | Fulfillment pickup/delivery, campos, recálculo server | Implementado (dine_in en backlog) | ✅ |
| 16 | Order Engine | Transiciones válidas, snapshots, idempotencia, historial inmutable | Implementado; order_status_history inmutable; secuencia de creación §16 cumplida | ✅ |
| 17 | Orders Dashboard | Filtros (fecha/estado/entrega/pago/cliente), detalle con historial | Implementado | ✅ |
| 18 | Command Board (Pro) | Columnas Nuevos/En preparación/Listos, sonido, temporizadores, delays | Tablero implementado; realtime vía polling (D-07), sonido con WebAudio; gated Pro | 🟡 D-07 |
| 19 | Delivery | Cuota fija, zonas (fee/mínimo/minutos), pickup | Implementado (zones + pickup config) | ✅ |
| 20 | Customers | Perfil unificado por teléfono normalizado, 360, consentimiento | Proyección agregada + pantalla 360 + consent con fuente/hora | ✅ |
| 21.1-21.11 | Reputation | Puntos de reseña, QR/NFC, redirect con tracking, solicitudes (manual Plus/auto Pro), feedback privado, métricas, sin gating | Puntos con token y redirect 302+evento; link QR/SVG; solicitudes manuales y auto (Pro); feedback privado; métricas de aperturas; sin gating ni incentivos | 🟡 OAuth Google→URL directa (D-10) |
| 22 | Promotions | special_price, percentage, buy_x_get_y, bundle, free_item | Promociones implementadas (cálculo server-side en checkout) | ✅ |
| 23 | Coupons | Estados, redemptions transaccionales | Implementado con redemptions únicas por pedido | ✅ |
| 24 | Reservations (Pro) | Estados, settings (capacidad, antelación, ventana) | Implementado | ✅ |
| 25 | Analytics | Hoy + Requiere tu atención + Oportunidades (reglas deterministas) | Implementado con reglas deterministas (martes bajos, inactivos 30d, punto top) | ✅ |
| 26 | Billing | Planes DB, suscripciones, eventos, pagos, overrides; provider abstraído | Implementado mock (interfaz PaymentProviderInterface D-05) | ✅ |
| 27 | EmailJS | No es fuente de verdad; plantillas es-PE; outbox | Notifier pluggable (consola/archivo) + plantillas es-PE en constantes (D-03) | 🟡 D-03 |
| 28 | Notification Outbox | Worker, reintentos con backoff, máx intentos, superadmin ve fallos | Implementado (worker in-process, backoff, max attempts, endpoint admin) | ✅ |
| 29 | Event Analytics | Eventos de producto y operación | analytics_events + endpoint batch (eventos nucleares) | ✅ |
| 30 | Technical Architecture | React/Vite/PHP/Supabase | Adaptación al entorno local: D-01 (Node), D-02 (SQLite), D-04 (vanilla JS); mapas y pagos con adaptadores | 🟡 D-01/02/04 |
| 31 | Repository Structure | restaurant-os/{apps,supabase,docs} | Estructura simplificada equivalente: server/, public/, tests/, scripts/, docs/ (decision D-11) | 🟡 D-11 |
| 32 | Database Model | Tablas por dominio | `server/migrations/001_init.sql` (DDL) + docs/arquitectura.md §Modelo de datos | ✅ |
| 33 | Database Standards | UUID, minor units, UTC, soft delete, snapshots, constraints | Aplicado en DDL (CHECK stock≥0, UNIQUE idempotency, FK index) | ✅ |
| 34 | Row Level Security | Nadie accede datos de otra org; públicas solo publicadas | Scoping venue_id forzado en API + matriz RLS documentada para Supabase | ✅ |
| 35 | Initial API | Endpoints públicos/autenticados/webhooks; errores estructurados | api-contract implementado; webhooks mock para drill | ✅ |
| 36 | Design System | Tokens, componentes, estados, accesibilidad | `public/assets/app.css` (tokens del preset 11 Build) | ✅ |
| 37 | Spanish UI Dictionary | esPE centralizado | `public/assets/ui.js` (diccionario esPE) | ✅ |
| 38 | Environment Variables | .env.example, sin secretos | .env.example + config central | ✅ |
| 39 | Testing Strategy | 6 pruebas obligatorias + frontend/PHP/DB adaptadas | tests/e2e.test.js con las 6 obligatorias + suite completa | ✅ |
| 40 | Definition of Done | Checklist completo | Aplicado en QA (estados, móvil/desktop, consola, docs, auditoría, limitaciones) | ✅ |
| 41 | Development Environments | Local/Dev/Staging/Prod separados | Documentado; ensayo local production-like + drill rollback | ✅ |
| 42 | MVP Scope | Loop completo: menú→link/QR→pedido→operación→completado→reseña→reputación | Implementado y demostrado con escenario E2E representativo | ✅ |
| 43 | Out of MVP | Lista de exclusiones | Respetado (sin POS, nómina, ingredientes, flota, marketplace...) | ✅ |
| 44 | Roadmap E00-E18 | Fases con dependencias | plan-proyecto.md (spec del Planificador) + backlog de tickets | 📋 |
| 45 | AutoClaw Operating Protocol | Informes en español antes/después | Cumplido en esta entrega (plan, reportes, limitaciones) | ✅ |
| 46 | AGENTS.md | Reglas de ingeniería | AGENTS.md del proyecto creado (adaptado a stack real) | ✅ |
| 47 | Ticket Template | Formato E##-T## con criterios | plan-proyecto.md incluye backlog en ese formato | 📋 |
| 48 | First AutoClaw Prompt | Fundación E00 | Repo fundación creado (estructura, tokens, diccionario, env, tests) | ✅ |
| 49 | Final Product Decision | Loop mínimo: Presence+Commerce+Operations+Reputation | Escenario E2E desde flujo de venta hasta reputación | ✅ |

## Decisiones registradas (resumen — detalle en docs/registro-decisiones.md)
D-01 Node.js→PHP · D-02 SQLite→Supabase (scoping API + matriz RLS) · D-03 outbox+notifier→EmailJS · D-04 vanilla SPA→React · D-05 pagos mock (PaymentProviderInterface) · D-06 sin POS · D-07 realtime polling→Supabase Realtime · D-08 imágenes emoji/url→Supabase Storage · D-09 SEO client-side sin SSR · D-10 Google OAuth→URL directa · D-11 estructura repo simplificada · D-12 single-location MVP con campos multi-location.

## Brechas → backlog (ver plan-proyecto.md)
Comandas realtime push (SSE/WebSocket) · QR/NFC assets print-ready · sincronización Google Business · automatización Pro (scheduler de review requests) · E2E Playwright · hardening beta · multi-location UI.