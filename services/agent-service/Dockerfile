FROM node:20-slim

# Установка FFmpeg и yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl ca-certificates \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build
RUN mkdir -p dist/actions && cp src/actions/manifest.json dist/actions/manifest.json
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
