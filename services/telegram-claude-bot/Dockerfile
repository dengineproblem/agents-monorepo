FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm i

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Системный промпт и данные
COPY groups ./groups
RUN mkdir -p data

ENV NODE_ENV=production

CMD ["npm", "start"]
