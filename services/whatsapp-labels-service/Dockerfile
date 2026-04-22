FROM node:18-bullseye AS builder

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
COPY tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build


FROM node:18-bullseye

RUN apt-get update && apt-get install -y \
    chromium \
    tini \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8089

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
