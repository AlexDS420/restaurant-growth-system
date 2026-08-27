# Auditoría, optimización y UI/UX — Restaurant OS

Fecha de verificación: 2026-08-27. Alcance: aplicación local completa en `app/` (servidor Node/SQLite, storefront público, panel operativo, cuenta y skills del proyecto). No se ejecutó publicación en AutoClaw ni se validó un entorno de producción.

## Resultado ejecutivo

La aplicación queda **PASÓ en local** para sus flujos E2E y para la matriz visual móvil/escritorio ejecutada. Se corrigieron un fallo de arranque en rutas con espacios, un registro que invertía hash/rol, vínculos de opciones del menú, controles de sesión/formularios y cinco brechas de seguridad de alto impacto.

El sistema **NO debe declararse PRODUCTION_READY** todavía: Stripe y sus secretos deben configurarse en el entorno real, y la publicación estática mediante nginx no puede servir el backend Node/SQLite.

## Cómo funciona

- `server/server.js` expone HTTP, parsea JSON, aplica cabeceras, rate limits, sirve `public/` y monta rutas públicas y autenticadas.
- `server/auth.js` usa contraseñas scrypt, sesiones httpOnly y permisos RBAC.
- `server/orders.js` calcula precios desde SQLite, controla stock, idempotencia, pagos, reembolsos y auditoría.
- `server/entitlements.js` resuelve plan, trial y features por negocio.
- `public/storefront.html` consume menú/venue públicos y mantiene carrito en `localStorage`; `public/admin.html` y `public/account.html` consumen las rutas autenticadas.
- `server/notifications.js` usa outbox para desacoplar notificaciones de la transacción del pedido.

## Hallazgos y correcciones

### P0/P1 corregidos

1. **Escalada RBAC:** `PATCH /team/:id` aceptaba `platform_admin`, `owner` o cualquier valor. Ahora solo acepta roles operativos permitidos, verifica que el miembro pertenezca al tenant y bloquea el cambio del propio rol.
2. **Bypass de entitlements:** `skipEntitlement=true` y una excepción por slug permitían cobrar en planes sin pagos. El endpoint ahora exige `payments.online.enabled` siempre.
3. **IP falsificable:** se confiaba siempre en `X-Forwarded-For`, anulando el rate limit. Ahora se usa la IP del socket salvo que `TRUST_PROXY=true` se configure explícitamente detrás de un proxy controlado.
4. **Transacción abierta durante `await`:** los pagos concurrentes podían fallar con SQLite. La reserva `pending` ocurre en una transacción síncrona, la llamada al proveedor queda fuera y las actualizaciones finales vuelven a una transacción; un segundo intento recibe `PAYMENT_IN_PROGRESS`.
5. **Credenciales demo por defecto:** una base vacía podía sembrar usuarios conocidos al arrancar. `SEED_DEMO` ahora es `false` por defecto en todos los entornos; el seed es explícito.
6. **Menú sin opciones:** la consulta omitía `pg.product_id`, por lo que el storefront recibía arrays vacíos. El mapeo ahora devuelve `option_group_ids` por producto y `product_ids` por grupo.

También se añadieron cabeceras de seguridad, `Cache-Control: no-store` para API, validación de URI/JSON y normalización de correo en onboarding.

### Pagos, webhooks y conciliación

El adaptador ahora soporta `PAYMENTS_MODE=stripe` con PaymentIntents y refunds vía API HTTPS, manteniendo el mock únicamente para desarrollo/pruebas. El endpoint `/api/v1/webhooks/stripe` valida la firma HMAC compatible con `t=...,v1=...`, rechaza timestamps fuera de tolerancia, registra `provider_event_id` único y procesa eventos de forma idempotente. `/reconciliation` expone discrepancias entre pagos y estado de órdenes para roles autorizados. La integración real requiere `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y configuración de Stripe en producción; esas credenciales no se inventaron ni se almacenan en el repositorio.

## UI/UX y accesibilidad

Se aplicó una dirección visual operativa (“pase de cocina”): fondo porcelana, verde pino, señal saffron y tipografía condensada para jerarquía rápida. Se eliminaron transiciones globales, se añadieron estados de foco visibles, skip links, navegación semántica y soporte de movimiento reducido. La revisión siguió las reglas de [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

Cambios principales:

- búsqueda del menú estable, con foco y cursor preservados;
- tarjetas como `article`, botones reales y controles de carrito separados;
- modales con foco inicial, Escape, cierre por backdrop, focus trap y restauración;
- checkout, pago, reseña, login y tracking convertidos a formularios etiquetados con `name`, `autocomplete` y validación nativa;
- panel con URL `?section=`, `aria-current`, encabezado “Hoy en Casa Aurora”, estado de local y limpieza correcta del timer de Comanda;
- errores de sección con estado de reintento y toasts anunciables.

Evidencia visual: [storefront-mobile-after.png](audit-assets/after/storefront-mobile-before.png), [admin-desktop-after-login-after.png](audit-assets/after/admin-desktop-after-login-before.png) y [admin-mobile-after.png](audit-assets/after/admin-mobile-before.png). Los nombres conservan el harness de auditoría “before”; corresponden a la ejecución posterior a los cambios.

## Verificación

**PASÓ**

- `npm ci`: árbol reproducible y `npm audit` sin vulnerabilidades conocidas.
- `npm test`: 26 pruebas, 26 pass, 0 fail, 0 cancelled.
- `node --check` en módulos de servidor y frontend modificados.
- Playwright Chromium: búsqueda `cev`, quick-add, carrito, checkout, validación de pago, login, navegación del panel y ausencia de errores de página.
- Matriz móvil 375 px y escritorio 1440 px sin overflow horizontal.
- `quick_validate.py` del skill `fc-nginx-website`: `Skill is valid!`.

**NO EJECUTADO / LIMITACIONES**

- Publicación AutoClaw/nginx: no ejecutada y no verificada; el skill adaptado solo prepara sitios estáticos. Este sistema necesita Node persistente y SQLite, por lo que no es un artefacto estático válido.
- Stripe real: código y contrato verificados localmente, pero configuración de cuenta, secretos, HTTPS público y eventos del proveedor quedan por ejecutar en el entorno productivo.
- Persisten campos dinámicos secundarios del panel con cobertura WCAG incompleta; quedan como backlog P2 para una pasada dedicada.
- No existe endpoint de auto-registro de clientes; se retiró el CTA engañoso que llamaba al registro de negocios.

## Skills AutoClaw disponibles en Codex

El skill original de AutoClaw fue adaptado a `.agents/skills/fc-nginx-website/SKILL.md`, inventariado en `SKILLS.md` y validado. Puede invocarse como `$fc-nginx-website` en el siguiente ciclo de descubrimiento. La adaptación conserva límites estáticos y marca cualquier publicación AutoClaw como NO EJECUTADA cuando no existe integración real.
