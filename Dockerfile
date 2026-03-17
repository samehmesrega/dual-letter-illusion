FROM node:20-bookworm

# ── System dependencies (shared by all AppImage-based slicers) ──
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget ca-certificates libfuse2 \
      libgtk-3-0 libwebkit2gtk-4.0-37 libegl1 libxkbcommon0 \
      libgl1 libglu1-mesa libx11-6 libxrender1 libxext6 \
      cura-engine && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── PrusaSlicer 2.7.4 ──
RUN wget -q -O /tmp/prusa.AppImage \
      "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.7.4/PrusaSlicer-2.7.4%2Blinux-x64-GTK3-202404050928.AppImage" && \
    chmod +x /tmp/prusa.AppImage && \
    cd /tmp && ./prusa.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/prusaslicer && \
    rm /tmp/prusa.AppImage

RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/prusaslicer/usr/lib:${LD_LIBRARY_PATH}\nexec /opt/prusaslicer/usr/bin/prusa-slicer "$@"\n' \
    > /usr/local/bin/prusa-slicer && chmod +x /usr/local/bin/prusa-slicer

# ── OrcaSlicer 2.3.0 ──
RUN wget -q -O /tmp/orca.AppImage \
      "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.0/OrcaSlicer_Linux_AppImage_V2.3.0.AppImage" && \
    chmod +x /tmp/orca.AppImage && \
    cd /tmp && ./orca.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/orcaslicer && \
    rm /tmp/orca.AppImage

RUN ORCA_BIN=$(find /opt/orcaslicer -name "orca-slicer" -o -name "OrcaSlicer" -o -name "orca_slicer" | grep -E 'bin/' | head -1) && \
    ORCA_LIB=$(dirname "$ORCA_BIN")/../lib && \
    printf "#!/bin/sh\nexport LD_LIBRARY_PATH=%s:\${LD_LIBRARY_PATH}\nexec %s \"\$@\"\n" "$ORCA_LIB" "$ORCA_BIN" \
    > /usr/local/bin/orca-slicer && chmod +x /usr/local/bin/orca-slicer

# ── SuperSlicer 2.5.59.13 ──
RUN wget -q -O /tmp/super.AppImage \
      "https://github.com/supermerill/SuperSlicer/releases/download/2.5.59.13/SuperSlicer-ubuntu_20.04-2.5.59.13.AppImage" && \
    chmod +x /tmp/super.AppImage && \
    cd /tmp && ./super.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/superslicer && \
    rm /tmp/super.AppImage

RUN SUPER_BIN=$(find /opt/superslicer -name "superslicer" -o -name "SuperSlicer" -o -name "super-slicer" | grep -E 'bin/' | head -1) && \
    SUPER_LIB=$(dirname "$SUPER_BIN")/../lib && \
    printf "#!/bin/sh\nexport LD_LIBRARY_PATH=%s:\${LD_LIBRARY_PATH}\nexec %s \"\$@\"\n" "$SUPER_LIB" "$SUPER_BIN" \
    > /usr/local/bin/superslicer && chmod +x /usr/local/bin/superslicer

# ── BambuStudio — disabled (requires FFmpeg 7 / libavcodec.so.61 not in Bookworm) ──
# To re-enable: need Ubuntu 24.04 base image or manual FFmpeg 7 build

# ── CuraEngine (installed via apt above) ──
# Download fdmprinter.def.json matching CuraEngine 4.13 (Bookworm apt version)
RUN mkdir -p /opt/cura-definitions && \
    wget -q -O /opt/cura-definitions/fdmprinter.def.json \
      "https://raw.githubusercontent.com/Ultimaker/Cura/4.13/resources/definitions/fdmprinter.def.json" && \
    wget -q -O /opt/cura-definitions/fdmextruder.def.json \
      "https://raw.githubusercontent.com/Ultimaker/Cura/4.13/resources/definitions/fdmextruder.def.json"

WORKDIR /app

# Install ALL dependencies (including devDependencies for vite build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy app files
COPY . .

# Build frontend, then remove devDependencies
RUN npm run build && npm prune --production

EXPOSE 3001

CMD ["node", "server.js"]
