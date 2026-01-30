FROM node:20-slim

WORKDIR /app

# Копируем package files
COPY package.json package-lock.json* ./

# Устанавливаем зависимости
RUN npm ci || npm install

# Копируем исходники
COPY tsconfig.json ./
COPY src ./src

# Собираем TypeScript
RUN npm run build

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=8086

EXPOSE 8086

# Запускаем сервер
CMD ["npm", "start"]
