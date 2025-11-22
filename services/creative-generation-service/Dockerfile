FROM node:20-alpine

# Установка рабочей директории
WORKDIR /app

# Копирование файлов зависимостей
COPY package*.json ./
COPY tsconfig.json ./

# Установка зависимостей
RUN npm ci --production=false

# Копирование исходного кода
COPY src ./src

# Сборка TypeScript
RUN npm run build

# Удаление dev зависимостей
RUN npm prune --production

# Создание директории для логов
RUN mkdir -p logs

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=8085
ENV HOST=0.0.0.0

# Открываем порт
EXPOSE 8085

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8085/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Запуск приложения
CMD ["node", "dist/server.js"]

