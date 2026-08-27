#!/usr/bin/env bash
# Restaurant OS — Respaldo de la base de datos (SQLite, WAL).
# Uso: bash scripts/backup.sh [directorio_destino]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${DB_PATH:-$ROOT/data/restaurant-os.db}"
DEST="${1:-$ROOT/backups}"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ No existe la base en $DB_PATH (¿ya ejecutaste npm run seed?)."
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/restaurant-os.$STAMP.db"

# sqlite3 .backup es seguro con WAL: produce una copia consistente sin detener el server.
sqlite3 "$DB_PATH" ".backup '$OUT'"

SIZE=$(du -h "$OUT" | cut -f1)
echo "✅ Respaldo creado: $OUT ($SIZE)"
echo "   Restaurar con: bash scripts/rollback.sh $OUT"