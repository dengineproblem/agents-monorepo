# Dockerfile для CRM Frontend
# Multi-stage build

# Этап 1: Сборка приложения
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package.json package-lock.json* ./
RUN npm ci

# Копируем исходный код
COPY . .

# Собираем production build
RUN npm run build

# Этап 2: Production образ с Nginx
FROM nginx:alpine AS production

# Копируем собранные файлы в nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Копируем конфигурацию nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Открываем порт
EXPOSE 80

# Запускаем nginx
CMD ["nginx", "-g", "daemon off;"]

