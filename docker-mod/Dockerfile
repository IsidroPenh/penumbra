# syntax=docker/dockerfile:1

# Penumbra Docker Mod for lscr.io/linuxserver/qbittorrent.
# Build the tree first with ../build-mod.sh; Docker Mods must be a single layer.
FROM scratch

LABEL org.opencontainers.image.source="https://github.com/IsidroPenh/penumbra"
LABEL org.opencontainers.image.description="Penumbra dark WebUI for qBittorrent, as a linuxserver.io Docker Mod"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"

COPY root/ /
