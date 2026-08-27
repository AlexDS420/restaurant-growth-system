#!/usr/bin/env bash
# Restaurant OS — Ensayo de despliegue y rollback (release v1 → simula v2 → rollback).
# No toca la base real: usa data/rehearsal-<fecha>.db (aísla; no borra nada).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_PATH="$ROOT/data/rehearsal-$STAMP.db"
SNAP="$ROOT/backups/restaurant-os.rehearsal.$STAMP.db"
mkdir -p "$ROOT/data" "$ROOT/backups"

echo "==> 1/4 Construir v1 en BD aislada: $(basename "$DB_PATH")"
DB_PATH="$DB_PATH" NODE_ENV=test node "$ROOT/server/seed.js" >/dev/null
N="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM orders;')"
echo "    Pedidos sembrados: $N"

echo "==> 2/4 Respaldo de la v1"
sqlite3 "$DB_PATH" ".backup '$SNAP'"
echo "    Respaldo: $SNAP"

echo "==> 3/4 Simular el despliegue de la v2 (agrega columna en venues)"
sqlite3 "$DB_PATH" "ALTER TABLE venues ADD COLUMN loyalty_enabled INTEGER NOT NULL DEFAULT 0;"
COLS="$(sqlite3 "$DB_PATH" "PRAGMA table_info(venues);" | awk -F'|' '{print $2}' | tr '\n' ' ')"
case "$COLS" in
  *loyalty_enabled*) echo "    Diagnóstico: esquema v2 (INCOMPATIBLE con v1) — se decide rollback." ;;
  *) echo "    Diagnóstico: esquema compatible." ;;
esac

echo "==> 4/4 Rollback en la BD aislada (rollback.sh respeta \$DB_PATH)"
DB_PATH="$DB_PATH" bash "$ROOT/scripts/rollback.sh" "$SNAP"
CHECK="$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")"
N2="$(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM orders;')"

if [ "$CHECK" = "ok" ] && [ "$N2" = "$N" ]; then
  echo "✅ ENSAYO EXITOSO: integridad ok y $N2 pedidos intactos tras el rollback."
  echo "   BD del ensayo (conservada por si quieres inspeccionarla): $DB_PATH"
else
  echo "❌ ENSAYO FALLIDO (integridad=$CHECK, pedidos=$N2)."
  exit 1
fi