FROM node:20-slim

# Install minimal deps + extract PrusaSlicer AppImage
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget ca-certificates libfuse2 && \
    wget -q -O /tmp/prusa.AppImage \
      "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1%2Blinux-x64-older-distros-GTK3-202409181354.AppImage" && \
    chmod +x /tmp/prusa.AppImage && \
    cd /tmp && ./prusa.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/prusaslicer && \
    rm /tmp/prusa.AppImage && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create wrapper script that uses AppImage's bundled libraries
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
