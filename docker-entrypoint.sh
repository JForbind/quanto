#!/bin/sh
# Punto de entrada de Quanto.
# El volumen ./data puede llegar con propietario root (Docker lo crea así);
# nos aseguramos de que el usuario node pueda escribir y luego bajamos privilegios.
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
