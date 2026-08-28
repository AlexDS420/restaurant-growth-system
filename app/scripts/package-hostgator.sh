#!/usr/bin/env bash
set -euo pipefail

# Produce un paquete determinista para cPanel/HostGator básico.
# Uso: ./scripts/package-hostgator.sh [directorio-salida]
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$APP_DIR/release/hostgator}"
FRONTEND="$APP_DIR/frontend/dist"
if [[ ! -f "$FRONTEND/index.html" ]]; then FRONTEND="$APP_DIR/public"; fi
[[ -f "$FRONTEND/index.html" ]] || { echo "ERROR: no existe un frontend publicable" >&2; exit 1; }
[[ -f "$APP_DIR/hostgator/api/index.php" ]] || { echo "ERROR: falta BFF PHP" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/public_html" "$OUT/private/cron" "$OUT/private"
cp -R "$FRONTEND"/. "$OUT/public_html"/
mkdir -p "$OUT/public_html/api"
cp "$APP_DIR/hostgator/api/index.php" "$APP_DIR/hostgator/api/bootstrap.php" "$APP_DIR/hostgator/api/.htaccess" "$OUT/public_html/api/"
cp "$APP_DIR"/hostgator/cron/*.php "$OUT/private/cron/"
cp "$APP_DIR/hostgator/.env.example" "$OUT/private/.env.example"
cat > "$OUT/README-CPANEL.md" <<'EOF'
# Instalación HostGator

1. Sube el contenido de `public_html/` a `public_html/` del dominio.
2. Mantén `private/` fuera del document root cuando cPanel lo permita.
3. Copia `private/.env.example` a `private/.env` y completa Supabase y el webhook HTTPS. No subas ese `.env` al repositorio.
4. Ejecuta las migraciones Supabase antes de recibir pedidos.
5. Configura el cron con la ruta absoluta de `private/cron/process_outbox.php`.
6. Comprueba HTTPS, `/api/v1/healthz` (si está habilitado) y un pedido de prueba en PEN.
EOF

# La lista evita que archivos de desarrollo o secretos lleguen al hosting.
if find "$OUT" -type f \( -name '.env' -o -name '*.db' -o -name '*.db-*' -o -name '*.log' -o -name 'package-lock.json' \) -print -quit | grep -q .; then
  echo "ERROR: el paquete contiene un archivo prohibido" >&2; exit 1
fi
if find "$OUT" -type d \( -name node_modules -o -name tests -o -name data \) -print -quit | grep -q .; then
  echo "ERROR: el paquete contiene un directorio prohibido" >&2; exit 1
fi
(cd "$OUT" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 shasum -a 256 > manifest.sha256)
(cd "$OUT" && shasum -a 256 -c manifest.sha256 >/dev/null)
echo "Paquete creado: $OUT"
echo "Frontend: $FRONTEND"
echo "Archivos: $(find "$OUT" -type f | wc -l | tr -d ' ')"
echo "Manifest: $OUT/manifest.sha256"
