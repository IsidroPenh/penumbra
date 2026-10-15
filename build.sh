#!/usr/bin/env bash
# Builds the "Penumbra" alternative WebUI for qBittorrent.
#
#  1. Downloads the official WebUI for the given qBittorrent version (every original feature).
#  2. Compiles the translations (.ts -> .qm) so the UI stays in your language.
#  3. Copies the theme files (overlay/) on top and injects the stylesheets and scripts.
#
# Usage:  ./build.sh [version]      (defaults to the installed qbittorrent-nox version)
# Output: ./dist  -> point qBittorrent's "Use alternative WebUI" at that folder.

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
[[ -z "$VERSION" ]] && { echo "Could not detect the qBittorrent version. Pass it as an argument: ./build.sh 5.1.4" >&2; exit 1; }
echo ">> qBittorrent $VERSION"

CACHE="$HERE/.cache"
SRC="$CACHE/qBittorrent-release-$VERSION/src/webui/www"
DIST="$HERE/dist"
mkdir -p "$CACHE"

if [[ ! -d "$SRC" ]]; then
    echo ">> Downloading official WebUI $VERSION..."
    curl -fsSL "https://github.com/qbittorrent/qBittorrent/archive/refs/tags/release-$VERSION.tar.gz" \
        | tar xz -C "$CACHE" "qBittorrent-release-$VERSION/src/webui/www"
fi

echo ">> Preparing dist/"
rm -rf "$DIST"
mkdir -p "$DIST/translations"
cp -r "$SRC/public" "$SRC/private" "$DIST/"

# --- Translations -----------------------------------------------------------
LRELEASE=""
for c in lrelease lrelease-qt6 /usr/lib/qt6/bin/lrelease /usr/lib/x86_64-linux-gnu/qt6/bin/lrelease pyside6-lrelease "$HERE/.venv/bin/pyside6-lrelease"; do
    if command -v "$c" >/dev/null 2>&1; then LRELEASE="$c"; break; fi
done
if [[ -z "$LRELEASE" ]] && command -v python3 >/dev/null 2>&1; then
    echo ">> Installing lrelease (PySide6) into .venv to compile translations..."
    python3 -m venv "$HERE/.venv" && "$HERE/.venv/bin/pip" install -q pyside6-essentials && LRELEASE="$HERE/.venv/bin/pyside6-lrelease"
fi
if [[ -n "$LRELEASE" ]]; then
    echo ">> Compiling translations with $LRELEASE"
    for ts in "$SRC"/translations/webui_*.ts; do
        "$LRELEASE" -silent "$ts" -qm "$DIST/translations/$(basename "${ts%.ts}").qm" >/dev/null 2>&1 || true
    done
else
    echo "!! lrelease not found: the desktop UI will be in English." >&2
fi

# --- Theme -------------------------------------------------------------------
echo ">> Applying theme"
cp -r "$HERE/overlay/." "$DIST/"

# Theme stylesheet on every private page (main window + iframe dialogs)
for f in "$DIST"/private/*.html; do
    grep -q 'css/theme.css' "$f" && continue
    sed -i 's#</head>#    <link rel="stylesheet" type="text/css" href="css/theme.css?v=${CACHEID}">\n</head>#' "$f"
done

# Main window: mobile redirect script + browser bar color + link to the mobile UI
INDEX="$DIST/private/index.html"
sed -i 's#<meta name="viewport"[^>]*>#&\n    <meta name="theme-color" content="\#0b0d12">\n    <script src="scripts/theme.js?v=${CACHEID}"></script>#' "$INDEX"
sed -i 's#\(<li class="divider"><a id="StatisticsLink">.*</li>\)#\1\n                            <li class="divider"><a id="mobileUiLink" href="mobile.html"><img class="MyMenuIcon" src="images/penumbra-phone.svg" alt="" width="16" height="16"><span id="mobileUiLabel">Mobile interface</span></a></li>#' "$INDEX"

# Login
LOGIN="$DIST/public/index.html"
sed -i 's#</head>#    <link rel="stylesheet" type="text/css" href="css/theme-login.css?v=${CACHEID}">\n    <meta name="theme-color" content="\#0b0d12">\n</head>#' "$LOGIN"

# The theme is dark-only: force the "dark" class regardless of the browser preference
CS="$DIST/private/scripts/color-scheme.js"
sed -i 's#root.classList.toggle("dark", .*#root.classList.add("dark");#' "$CS"
grep -q 'root.classList.add("dark");' "$CS" || echo "!! Could not patch color-scheme.js (it changed in this version)" >&2

# Content-based version: any theme change forces the browser to fetch the new files
# (qBittorrent lets browsers cache CSS/JS for 12 hours, and ${CACHEID} only changes on restart)
VER="$(cat "$HERE"/overlay/public/m/*.js "$HERE"/overlay/public/m/*.css "$HERE"/overlay/public/css/*.css "$HERE"/overlay/private/css/*.css "$HERE"/overlay/private/scripts/*.js | sha1sum | cut -c1-10)"
for f in "$DIST"/private/*.html "$DIST"/public/*.html; do
    sed -i -E 's#((theme|theme-login|app|i18n)\.(css|js))\?v=\$\{CACHEID\}#\1?v='"$VER"'#g' "$f"
done

# qBittorrent rejects symlinks inside an alternative WebUI
find "$DIST" -type l -delete

echo ">> Done: $DIST"
echo "   In qBittorrent: Tools > Options > Web UI > Use alternative WebUI -> $DIST"
