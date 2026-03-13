FROM node:20-slim

# Install PrusaSlicer CLI (v2.8.1 older-distros AppImage for Debian 12)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget ca-certificates libgl1 libglu1-mesa libgtk-3-0 \
      libglib2.0-0 libx11-6 libxrender1 libxext6 libfuse2 && \
    wget -q -O /tmp/prusa.AppImage \
      "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1%2Blinux-x64-older-distros-GTK3-202409181354.AppImage" && \
    chmod +x /tmp/prusa.AppImage && \
    cd /tmp && ./prusa.AppImage --appimage-extract && \
    mv /tmp/squashfs-root /opt/prusaslicer && \
    ln -s /opt/prusaslicer/AppRun /usr/local/bin/prusa-slicer && \
    rm /tmp/prusa.AppImage && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy app files
COPY . .

# Build frontend
RUN npm run build

EXPOSE 3001

CMD ["node", "server.js"]
