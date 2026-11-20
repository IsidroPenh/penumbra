#!/usr/bin/env bash
# Builds the Penumbra Docker Mod tree for lscr.io/linuxserver/qbittorrent: one Penumbra build
# per qBittorrent minor version, in docker-mod/root/penumbra/<version>/. At container start the
# mod picks the build that matches the installed qBittorrent version (or the closest one).
#
# Usage:  ./build-mod.sh [version ...]   (defaults to the newest patch of every 5.x minor version,
#                                          e.g. 5.0.5 5.1.4 5.2.4 5.3.0, to keep the mod small)
# Then:   docker build -t penumbra-mod docker-mod

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/docker-mod/root/penumbra"

if (( $# )); then
    VERSIONS=("$@")
else
    mapfile -t VERSIONS < <(git ls-remote --tags --refs https://github.com/qbittorrent/qBittorrent 'refs/tags/release-*' \
        | grep -oE 'release-[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^release-//' | awk -F. '$1 >= 5' \
        | sort -rV | awk -F. '!seen[$1 "." $2]++' | sort -V)
fi
(( ${#VERSIONS[@]} )) || { echo "No qBittorrent versions to build." >&2; exit 1; }
echo ">> Building Penumbra for qBittorrent ${VERSIONS[*]}"

rm -rf "$OUT"
mkdir -p "$OUT"
for v in "${VERSIONS[@]}"; do
    "$HERE/build.sh" "$v"
    mv "$HERE/dist" "$OUT/$v"
    # Content fingerprint: the mod reinstalls /config/penumbra only when this changes
    (cd "$OUT/$v" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha1sum | sha1sum | cut -c1-16) > "$OUT/$v/.build"
done

# Most files are identical across versions: hard links make the image store them once
if command -v hardlink >/dev/null 2>&1; then
    hardlink --ignore-time "$OUT" >/dev/null
else
    echo "!! hardlink (util-linux) not found: the image will be larger than needed." >&2
fi

echo ">> Done: $OUT ($(du -sh "$OUT" | cut -f1))"
