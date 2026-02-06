# Dockerfile для Vite + React Frontend
# Multi-stage build для оптимизации

# Этап 1: Сборка приложения
FROM node:20-alpine AS builder

# Аргумент для определения режима сборки (production или appreview)
ARG BUILD_MODE=production
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package.json package-lock.json* ./
RUN npm ci

# Копируем исходный код
COPY . .

# Создаём .env на основе BUILD_MODE
RUN if [ "$BUILD_MODE" = "appreview" ]; then \
      echo "VITE_APP_REVIEW_MODE=true" > .env.local && \
      echo "VITE_API_BASE_URL=https://performanteaiagency.com/api" >> .env.local && \
      echo "VITE_CREATIVE_API_URL=https://performanteaiagency.com/api/creative" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile" >> .env.local && \
      echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" >> .env.local && \
      echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" >> .env.local; \
    elif [ "$BUILD_MODE" = "development" ]; then \
      echo "VITE_APP_REVIEW_MODE=false" > .env.local && \
      echo "VITE_API_BASE_URL=http://localhost:8082" >> .env.local && \
      echo "VITE_CREATIVE_API_URL=http://localhost:8085" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=http://localhost:8081/profile" >> .env.local && \
      echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" >> .env.local && \
      echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" >> .env.local; \
    else \
      echo "VITE_APP_REVIEW_MODE=false" > .env.local && \
      echo "VITE_API_BASE_URL=https://app.performanteaiagency.com/api" >> .env.local && \
      echo "VITE_CREATIVE_API_URL=https://app.performanteaiagency.com/api/creative" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://app.performanteaiagency.com/profile" >> .env.local && \
      echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" >> .env.local && \
      echo "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" >> .env.local; \
    fi

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
