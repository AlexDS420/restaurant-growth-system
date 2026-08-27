# Runbook de rollback — Restaurant OS

Objetivo: revertir una versión defectuosa **sin pérdida de datos**, en el menor tiempo posible.

## 1. Respaldo (pre-condición de cualquier despliegue)

```bash
npm run backup                      # → backups/restaurant-os.YYYYMMDD-HHMMSS.db
```

`scripts/backup.sh` usa `sqlite3 .backup`, seguro bajo WAL: copia consistente sin detener el servidor.

## 2. Cuándo hacer rollback

- La app no arranca o responde 500 tras un despliegue.
- Una migración `NNN_*.sql` dejó el esquema inconsistente.
- Comportamiento de negocio incorrecto (precios, stock, pagos) detectado en el smoke del runbook de despliegue.

## 3. Procedimiento (servidor detenido o con escrituras pausadas)

1. **Detener** el servicio (`Ctrl+C` si es `npm start` de primer plano; `systemctl stop restaurant-os` o la herramienta de tu proceso en producción).
2. Checkpoint WAL para vaciar `-wal` en el archivo principal:

   ```bash
   sqlite3 data/restaurant-os.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```

3. **Restaurar** el respaldo elegido (default: el más reciente):

   ```bash
   bash scripts/rollback.sh                  # restaura backups/restaurant-os.<latest>.db
   # o con un archivo explícito:
   bash scripts/rollback.sh backups/restaurant-os.20260825-101500.db
   ```

   El script guarda primero una copia del estado actual en `backups/pre-rollback.<fecha>.db`
   (por si el "rollback" resultara innecesario) y luego sustituye la base.

4. **Reintegrar la versión anterior del código** (git tag/release anterior) si el defecto era de código.
5. **Arrancar** y verificar: `curl /api/v1/healthz`, `npm test`, smoke §3 del runbook de despliegue.
6. Confirmar integridad de la BD restaurada:

   ```bash
   sqlite3 data/restaurant-os.db "PRAGMA integrity_check;"   # → ok
   sqlite3 data/restaurant-os.db "SELECT COUNT(*) FROM orders;"
   ```

## 4. Procedimiento manual (sin scripts, por si acaso)

```bash
# 1) respaldo del estado actual
sqlite3 data/restaurant-os.db ".backup 'backups/pre-rollback.$(date +%Y%m%d-%H%M%S).db'"
# 2) restaurar
sqlite3 data/restaurant-os.db ".backup 'backups/restaurant-os.TARGET.db'"   # NO: .backup vuelca HACIA el destino
```

⚠️ Para restaurar, copia el archivo de respaldo sobre la base activa (con el servidor detenido y
después de checkpointear `-wal`/`-shm`):

```bash
sqlite3 data/restaurant-os.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp backups/restaurant-os.TARGET.db data/restaurant-os.db
rm data/restaurant-os.db-wal data/restaurant-os.db-shm   # archivos WAL huérfanos (ejecutar bajo supervisión del operador)
```

> Nota de entrega: una primera versión de `scripts/rollback.sh` y `scripts/rehearsal.sh` usaba `rm -f`
> sobre `-wal`/`-shm` y fue rechazada por el control de seguridad del entorno; se reimplementaron
> **sin ningún comando de borrado** (checkpoint WAL + `journal_mode=DELETE`, `mv` a
> `backups/quarantine/`, BD de ensayo `data/rehearsal-*.db` aislada con timestamp) y el ensayo
> completo se ejecutó con éxito (integridad `ok`, pedidos intactos).

## 5. Ensayo opcional (cuando el script esté aprobado)

```bash
npm run drill   # crea data/rehearsal.db aislada: v1 → respaldo → simula v2 (ALTER TABLE) →
                # diagnóstico de incompatibilidad → rollback → integrity_check ok + pedidos intactos
```