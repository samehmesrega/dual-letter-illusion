FROM node:20-bookworm

# Install PrusaSlicer with ALL required runtime libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget ca-certificates libfuse2 \
      libgtk-3-0 libwebkit2gtk-4.0-37 libegl1 libxkbcommon0 \
      libgl1 libglu1-mesa libx11-6 libxrender1 libxext6 && \
    wget -q -O /tmp/prusa.AppImage \
      "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1%2Blinux-x64-older-distros-GTK3-202409181354.AppImage" && \
    chmod +x /tmp/prusa.AppImage && \
    cd /tmp && ./prusa.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/prusaslicer && \
    rm /tmp/prusa.AppImage && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Wrapper: use AppImage bundled libs first, fall back to system
RUN printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/prusaslicer/usr/lib:${LD_LIBRARY_PATH}\nexec /opt/prusaslicer/usr/bin/prusa-slicer "$@"\n' > /usr/local/bin/prusa-slicer && \
    chmod +x /usr/local/bin/prusa-slicer

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
