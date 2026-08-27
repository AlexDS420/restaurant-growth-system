#!/usr/bin/env bash
# Restaurant OS — Rollback de la base de datos (sin comandos de borrado: todo se archiva).
# Uso: bash scripts/rollback.sh [archivo_respaldo]
# Si no se pasa archivo, restaura el respaldo más reciente de backups/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${DB_PATH:-$ROOT/data/restaurant-os.db}"
SRC="${1:-}"

if [ -z "$SRC" ]; then
  SRC="$(ls -t "$ROOT"/backups/restaurant-os.*.db 2>/dev/null | head -1 || true)"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "❌ No hay respaldo. Ejecuta primero: bash scripts/backup.sh"
  exit 1
fi

QDIR="$ROOT/backups/quarantine"
mkdir -p "$QDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# 1) Preservar SIEMPRE el estado actual antes de tocar nada (nunca se pierde el pre-rollback).
PRE="$ROOT/backups/pre-rollback.$STAMP.db"
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup '$PRE'" 2>/dev/null || cp "$DB_PATH" "$PRE"
  # 2) Checkpoint WAL y pasar a modo journal (DELETE): los archivos -wal/-shm quedan inertes.
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" >/dev/null 2>&1 || true
fi

# 3) Archivar (mover, no borrar) cualquier -wal/-shm remanente por si hace falta forense.
for f in "$DB_PATH-wal" "$DB_PATH-shm"; do
  if [ -e "$f" ]; then mv "$f" "$QDIR/$(basename "$f").$STAMP"; fi
done

# 4) Restaurar el respaldo sobre la base activa.
cp "$SRC" "$DB_PATH"

# 5) Verificación de integridad post-restauración.
CHECK="$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")"
if [ "$CHECK" != "ok" ]; then
  echo "⚠️  Integridad falló tras restaurar. Estado actual preservado en $PRE"
  exit 1
fi

echo "✅ Base restaurada desde: $SRC"
echo "   Estado anterior preservado en: $PRE"
echo "   WAL remanente archivado en: $QDIR"
echo "   Reinicia el servidor si estaba en ejecución: npm start"