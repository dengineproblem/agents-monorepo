FROM node:20-alpine

# Установка FFmpeg для обработки видео и yt-dlp для скачивания
RUN apk add --no-cache ffmpeg python3 py3-pip curl \
    && pip3 install --break-system-packages yt-dlp

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
