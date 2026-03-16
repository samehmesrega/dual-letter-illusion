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
      "https://github.com/SoftFever/OrcaSlicer/releases/download/v2.3.0/OrcaSlicer_Linux_V2.3.0.AppImage" && \
    chmod +x /tmp/orca.AppImage && \
    cd /tmp && ./orca.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/orcaslicer && \
    rm /tmp/orca.AppImage

RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/orcaslicer/usr/lib:${LD_LIBRARY_PATH}\nexec /opt/orcaslicer/usr/bin/orca-slicer "$@"\n' \
    > /usr/local/bin/orca-slicer && chmod +x /usr/local/bin/orca-slicer

# ── SuperSlicer 2.5.59.13 ──
RUN wget -q -O /tmp/super.AppImage \
      "https://github.com/supermerill/SuperSlicer/releases/download/2.5.59.13/SuperSlicer-ubuntu_20.04-2.5.59.13.AppImage" && \
    chmod +x /tmp/super.AppImage && \
    cd /tmp && ./super.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/superslicer && \
    rm /tmp/super.AppImage

RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/superslicer/usr/lib:${LD_LIBRARY_PATH}\nexec /opt/superslicer/usr/bin/superslicer "$@"\n' \
    > /usr/local/bin/superslicer && chmod +x /usr/local/bin/superslicer

# ── BambuStudio 1.10.1.50 ──
RUN wget -q -O /tmp/bambu.AppImage \
      "https://github.com/bambulab/BambuStudio/releases/download/v01.10.01.50/Bambu_Studio_linux_ubuntu-v01.10.01.50.AppImage" && \
    chmod +x /tmp/bambu.AppImage && \
    cd /tmp && ./bambu.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/bambustudio && \
    rm /tmp/bambu.AppImage

RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/bambustudio/usr/lib:${LD_LIBRARY_PATH}\nexec /opt/bambustudio/usr/bin/bambu-studio "$@"\n' \
    > /usr/local/bin/bambu-studio && chmod +x /usr/local/bin/bambu-studio

# ── CuraEngine (installed via apt above) ──
# Binary at /usr/bin/CuraEngine, definitions at /usr/share/cura/resources/definitions/

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
