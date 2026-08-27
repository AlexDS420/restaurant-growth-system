# Registro de riesgos — Restaurant OS

| # | Riesgo | Prob. | Impacto | Mitigación / estado |
|---|---|---|---|---|
| R-01 | SQLite bajo concurrencia alta de escrituras | Media | Bloqueos `SQLITE_BUSY` | WAL + `busy_timeout`; escrituras cortas y transaccionales; si crece → migrar a Postgres (matriz RLS en arquitectura.md) |
| R-02 | Migración del esquema rompe datos existentes | Baja | Pérdida de datos | Runner versionado, backups antes de cada despliegue (`npm run backup`), runbook de rollback, ensayo aislado |
| R-03 | Doble cobro / reintento de pago | Baja | Cargo duplicado | `external_ref` UNIQUE + `409 PAYMENT_ALREADY_PROCESSED` (probado T3) |
| R-04 | Precios manipulados por el cliente | Media | Pérdida de margen | Precios 100 % server-side desde BD; UI solo estima (probado T2) |
| R-05 | Fuga entre tenants | Baja | Confidencialidad | `venue_id` desde sesión; queries parametrizadas; aislamiento probado (T1); RLS documentada para el futuro |
| R-06 | Notificaciones fallidas | Media | Comunicación perdida | Outbox transaccional + reintentos; nunca afecta el pedido (T4) |
| R-07 | Abuso de la API pública (spam de pedidos) | Media | Costo/ruido | Rate limits por IP (login 10/15 min, pedidos 10/min, menú 30/min) |
| R-08 | Sesión robada | Baja | Acceso indebido | Cookie httpOnly SameSite=Lax, token sha256 en BD, expiración 7 días; invalidación por logout |
| R-09 | Pérdida de datos por `rm`/borrado accidental | Baja | Pérdida | Política de `trash` antes que `rm`; respaldos pre-rollback automáticos; `.gitignore` protege `data/` |
| R-10 | Scripts operativos con comandos de borrado | Baja | Pérdida accidental | Resuelto: backup/rollback/rehearsal implementados sin `rm` (WAL se archiva con `mv` a `backups/quarantine/`); ensayo de rollback ejecutado y verificado |
| R-11 | Dependencia de `node:sqlite` (experimental en algunas versiones) | Baja | Arranque fallido | Requisito documentado (Node ≥ 22.5, probado 24.18); fallback documentado en runbook-despliegue.md |
| R-12 | Credenciales demo compartidas | Media | Abuso en demo | Solo datos ficticios; en producción se reemplaza el seed y se exige cambio de contraseña en el onboarding real |