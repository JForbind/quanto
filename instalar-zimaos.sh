#!/bin/sh
# ============================================================
#  Instalador de Quanto 2.0 para ZimaOS / NAS Linux
#  No contiene ningún secreto: la contraseña se genera EN TU
#  SERVIDOR con /dev/urandom y solo se muestra en tu terminal.
# ============================================================
set -eu

APP_DIR="${APP_DIR:-/DATA/AppData/quanto}"
OLD_DIR="${OLD_DIR:-/DATA/AppData/crypto-portfolio}"
ZIP="${ZIP:-}"

say()  { printf '\n\033[1m>> %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------- 1. requisitos
say "Comprobando Docker"
command -v docker >/dev/null 2>&1 || die "No encuentro docker. Actívalo en ZimaOS y vuelve a intentarlo."
docker compose version >/dev/null 2>&1 || die "No encuentro 'docker compose'."
info "Docker OK ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'))"

# ---------------------------------------------------------- 2. ficheros
if [ ! -f "$APP_DIR/server.js" ]; then
  [ -n "$ZIP" ] && [ -f "$ZIP" ] || die "Falta el ZIP. Ejecuta:  ZIP=/ruta/quanto-2.0.zip sh $0"
  say "Descomprimiendo $ZIP"
  mkdir -p "$(dirname "$APP_DIR")"
  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$ZIP" -d "$(dirname "$APP_DIR")"
  elif command -v busybox >/dev/null 2>&1; then
    busybox unzip -oq "$ZIP" -d "$(dirname "$APP_DIR")"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$ZIP" "$(dirname "$APP_DIR")"
  else
    die "No hay unzip en el servidor. Instálalo o descomprime el ZIP a mano en $APP_DIR"
  fi
fi
[ -f "$APP_DIR/server.js" ] || die "No encuentro $APP_DIR/server.js"

cd "$APP_DIR"
mkdir -p data
info "Aplicación en $APP_DIR"

# ---------------------------------------------------------- 3. .env
if [ ! -f .env ]; then
  say "Creando .env con una contraseña aleatoria (generada aquí, no viaja a ningún sitio)"
  PW=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20)
  awk -v pw="$PW" '
    /^APP_PASSWORD=/ { print "APP_PASSWORD=" pw; next }
    { print }
  ' .env.example > .env
  chmod 600 .env
  NEW_PW="$PW"
else
  info "Ya existe .env: lo respeto tal cual"
  NEW_PW=""
fi

# ---------------------------------------------------------- 4. migrar datos antiguos
if [ -d "$OLD_DIR/data" ]; then
  if [ -z "$(ls -A data 2>/dev/null | grep -v '^\.gitkeep$' || true)" ]; then
    say "He encontrado datos de la app anterior en $OLD_DIR/data"
    printf '   ¿Copiarlos a esta instalación? [s/N] '
    read -r RESP < /dev/tty || RESP="n"
    case "$RESP" in
      s|S|y|Y)
        cp -a "$OLD_DIR/data/." data/
        info "Datos copiados"
        warn "Si ya tenías contraseña guardada en la app anterior, seguirá valiendo esa."
        warn "Puedes cambiarla luego en Ajustes → Seguridad."
        ;;
      *) info "Se dejan como estaban";;
    esac
  else
    info "Ya hay datos en $APP_DIR/data: no toco nada"
  fi
fi

# ---------------------------------------------------------- 5. arrancar
say "Construyendo y arrancando el contenedor (1-2 minutos la primera vez)"
HOME=/tmp docker compose up -d --build || die "No se pudo arrancar. Revisa: cd $APP_DIR && HOME=/tmp docker compose logs"

say "Esperando a que responda"
PORT_PUB=$(grep -E '^QUANTO_PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2 | tr -d ' \r"' || true)
[ -n "${PORT_PUB:-}" ] || PORT_PUB=8766
alive() {
  wget -q -O /dev/null "http://127.0.0.1:$PORT_PUB/api/health" 2>/dev/null && return 0
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT_PUB/api/health" 2>/dev/null && return 0
  return 1
}
i=0
until alive || [ $i -ge 60 ]; do
  i=$((i + 1))
  sleep 2
  printf '.'
done
printf '\n'

# ---------------------------------------------------------- 6. resumen
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "${IP:-}" ] || IP="IP-DEL-SERVIDOR"

say "Quanto está funcionando"
info "Abre:      http://$IP:$PORT_PUB"
if [ -n "$NEW_PW" ]; then
  info "Contraseña: $NEW_PW"
  warn "Apúntala ahora. Está en $APP_DIR/.env y puedes cambiarla en Ajustes → Seguridad"
else
  info "Contraseña: la que ya tenías en .env"
fi
info ""
info "Siguiente paso, ya en la app:"
info "  1. Ajustes → Bitvavo: pega la API Key y el Secret (solo lectura)"
info "  2. Ajustes → Historial completo: arrastra el CSV de Bitvavo"
info ""
info "Estado:   cd $APP_DIR && HOME=/tmp docker compose ps"
info "Log:      cd $APP_DIR && HOME=/tmp docker compose logs -f"
