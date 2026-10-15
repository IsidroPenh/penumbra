#!/usr/bin/env bash
# Construye el WebUI alternativo "Penumbra" para qBittorrent.
#
#  1. Descarga el WebUI oficial de la versión de qBittorrent indicada (todas las funciones originales).
#  2. Compila las traducciones (.ts -> .qm) para que la interfaz siga en tu idioma.
#  3. Copia encima los archivos del tema (overlay/) e inyecta las hojas de estilo y scripts.
#
# Uso:  ./build.sh [versión]      (por defecto detecta la versión de qbittorrent-nox)
# Resultado: ./dist  -> apunta "Usar WebUI alternativo" de qBittorrent a esa carpeta.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    for bin in qbittorrent-nox "$HOME/bin/qbittorrent-nox" qbittorrent; do
        if command -v "$bin" >/dev/null 2>&1; then
            VERSION="$("$bin" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
            [[ -n "$VERSION" ]] && break
        fi
    done
fi
[[ -z "$VERSION" ]] && { echo "No pude detectar la versión de qBittorrent. Pásala como argumento: ./build.sh 5.1.4" >&2; exit 1; }
echo ">> qBittorrent $VERSION"

CACHE="$HERE/.cache"
SRC="$CACHE/qBittorrent-release-$VERSION/src/webui/www"
DIST="$HERE/dist"
mkdir -p "$CACHE"

if [[ ! -d "$SRC" ]]; then
    echo ">> Descargando WebUI oficial $VERSION..."
    curl -fsSL "https://github.com/qbittorrent/qBittorrent/archive/refs/tags/release-$VERSION.tar.gz" \
        | tar xz -C "$CACHE" "qBittorrent-release-$VERSION/src/webui/www"
fi

echo ">> Preparando dist/"
rm -rf "$DIST"
mkdir -p "$DIST/translations"
cp -r "$SRC/public" "$SRC/private" "$DIST/"

# --- Traducciones -----------------------------------------------------------
LRELEASE=""
for c in lrelease lrelease-qt6 /usr/lib/qt6/bin/lrelease /usr/lib/x86_64-linux-gnu/qt6/bin/lrelease pyside6-lrelease "$HERE/.venv/bin/pyside6-lrelease"; do
    if command -v "$c" >/dev/null 2>&1; then LRELEASE="$c"; break; fi
done
if [[ -z "$LRELEASE" ]] && command -v python3 >/dev/null 2>&1; then
    echo ">> Instalando lrelease (PySide6) en .venv para compilar traducciones..."
    python3 -m venv "$HERE/.venv" && "$HERE/.venv/bin/pip" install -q pyside6-essentials && LRELEASE="$HERE/.venv/bin/pyside6-lrelease"
fi
if [[ -n "$LRELEASE" ]]; then
    echo ">> Compilando traducciones con $LRELEASE"
    for ts in "$SRC"/translations/webui_*.ts; do
        "$LRELEASE" -silent "$ts" -qm "$DIST/translations/$(basename "${ts%.ts}").qm" >/dev/null 2>&1 || true
    done
else
    echo "!! No encontré lrelease: la interfaz de escritorio quedará en inglés." >&2
fi

# --- Tema -------------------------------------------------------------------
echo ">> Aplicando tema"
cp -r "$HERE/overlay/." "$DIST/"

# Hoja de estilo del tema en todas las páginas privadas (ventana principal + diálogos en iframe)
for f in "$DIST"/private/*.html; do
    grep -q 'css/theme.css' "$f" && continue
    sed -i 's#</head>#    <link rel="stylesheet" type="text/css" href="css/theme.css?v=${CACHEID}">\n</head>#' "$f"
done

# Ventana principal: script de redirección móvil + color de barra + acceso a interfaz móvil
INDEX="$DIST/private/index.html"
sed -i 's#<meta name="viewport"[^>]*>#&\n    <meta name="theme-color" content="\#0b0d12">\n    <script src="scripts/theme.js?v=${CACHEID}"></script>#' "$INDEX"
sed -i 's#\(<li class="divider"><a id="StatisticsLink">.*</li>\)#\1\n                            <li class="divider"><a id="mobileUiLink" href="mobile.html"><img class="MyMenuIcon" src="images/penumbra-phone.svg" alt="" width="16" height="16">Interfaz móvil</a></li>#' "$INDEX"

# Login
LOGIN="$DIST/public/index.html"
sed -i 's#</head>#    <link rel="stylesheet" type="text/css" href="css/theme-login.css?v=${CACHEID}">\n    <meta name="theme-color" content="\#0b0d12">\n</head>#' "$LOGIN"

# El tema es solo oscuro: forzar la clase "dark" sin importar la preferencia del navegador
CS="$DIST/private/scripts/color-scheme.js"
sed -i 's#root.classList.toggle("dark", .*#root.classList.add("dark");#' "$CS"
grep -q 'root.classList.add("dark");' "$CS" || echo "!! No pude parchear color-scheme.js (cambió en esta versión)" >&2

# Versión por contenido: cada cambio en el tema obliga al navegador a descargar los archivos nuevos
# (qBittorrent permite guardar CSS/JS en caché 12 horas, y ${CACHEID} solo cambia al reiniciarlo)
VER="$(cat "$HERE"/overlay/public/m/app.* "$HERE"/overlay/public/css/*.css "$HERE"/overlay/private/css/*.css "$HERE"/overlay/private/scripts/*.js | sha1sum | cut -c1-10)"
for f in "$DIST"/private/*.html "$DIST"/public/*.html; do
    sed -i -E 's#((theme|theme-login|app)\.(css|js))\?v=\$\{CACHEID\}#\1?v='"$VER"'#g' "$f"
done

# qBittorrent rechaza enlaces simbólicos dentro del WebUI alternativo
find "$DIST" -type l -delete

echo ">> Listo: $DIST"
echo "   En qBittorrent: Herramientas > Opciones > Interfaz web > Usar interfaz web alternativa -> $DIST"
