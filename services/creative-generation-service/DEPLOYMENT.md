# Deployment Guide - Creative Generation Service

## Обзор

Этот документ описывает процесс развертывания `creative-generation-service` - микросервиса для генерации рекламных креативов через Gemini 3 Pro Image Preview API.

## Предварительные требования

### 1. Google AI API Key

Получите API ключ для Gemini 3 Pro Image Preview:

1. Перейдите на [Google AI Studio](https://aistudio.google.com/)
2. Войдите через Google аккаунт
3. Создайте API ключ в разделе "Get API key"
4. Сохраните ключ - он потребуется для конфигурации

**Модели:**
- `gemini-pro` - для генерации текстов (offer, bullets, profits, cta)
- `gemini-3-pro-image-preview` - для генерации финального изображения с текстом

### 2. Supabase

Убедитесь, что у вас есть:
- URL проекта Supabase
- Service Role Key для backend операций
- Bucket `public` в Supabase Storage для хранения изображений

### 3. База данных

Примените миграцию для добавления поля `generated_image_url`:

```bash
# Из корня монорепозитория
psql $DATABASE_URL -f migrations/032_add_generated_image_url_to_user_creatives.sql
```

Или через Supabase Dashboard → SQL Editor.

## Локальное развертывание (Development)

### 1. Установка зависимостей

```bash
cd services/creative-generation-service
npm install
```

### 2. Конфигурация окружения

Создайте файл `.env`:

```bash
cp .env.example .env
```

Заполните переменные:

```bash
# Server Configuration
PORT=8085
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Google AI API
GEMINI_API_KEY=your_actual_api_key_here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key_here
```

### 3. Запуск сервиса

#### Development mode (с hot reload):

```bash
npm run dev
```

Сервис будет доступен на `http://localhost:8085`

#### Production mode:

```bash
npm run build
npm start
```

### 4. Проверка работоспособности

```bash
# Healthcheck
curl http://localhost:8085/health

# Должен вернуть:
# {"status":"ok","service":"creative-generation-service","timestamp":"..."}
```

## Production Deployment

### Вариант 1: PM2 (рекомендуется для VPS)

#### 1. Установка PM2

```bash
npm install -g pm2
```

#### 2. Создание ecosystem файла

Создайте `ecosystem.config.js` в корне сервиса:

```javascript
module.exports = {
  apps: [{
    name: 'creative-generation-service',
    script: 'dist/server.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 8085
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
```

#### 3. Запуск через PM2

```bash
# Билд production версии
npm run build

# Запуск через PM2
pm2 start ecosystem.config.js

# Сохранение списка процессов
pm2 save

# Автозапуск при перезагрузке сервера
pm2 startup
```

#### 4. Управление сервисом

```bash
# Просмотр логов
pm2 logs creative-generation-service

# Перезапуск
pm2 restart creative-generation-service

# Остановка
pm2 stop creative-generation-service

# Статус
pm2 status
```

### Вариант 2: Docker

#### 1. Создание Dockerfile (уже создан)

См. `Dockerfile` в корне сервиса

#### 2. Сборка образа

```bash
docker build -t creative-generation-service:latest .
```

#### 3. Запуск контейнера

```bash
docker run -d \
  --name creative-generation-service \
  -p 8085:8085 \
  -e GEMINI_API_KEY=your_key \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_KEY=your_key \
  -e NODE_ENV=production \
  --restart unless-stopped \
  creative-generation-service:latest
```

#### 4. Docker Compose (опционально)

Создайте `docker-compose.yml`:

```yaml
version: '3.8'

services:
  creative-generation:
    build: .
    container_name: creative-generation-service
    ports:
      - "8085:8085"
    environment:
      - NODE_ENV=production
      - PORT=8085
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Запуск:

```bash
docker-compose up -d
```

### Вариант 3: Systemd Service (Linux)

#### 1. Создание service файла

Создайте `/etc/systemd/system/creative-generation.service`:

```ini
[Unit]
Description=Creative Generation Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/services/creative-generation-service
Environment="NODE_ENV=production"
Environment="PORT=8085"
EnvironmentFile=/path/to/services/creative-generation-service/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 2. Активация сервиса

```bash
# Перезагрузка systemd
sudo systemctl daemon-reload

# Запуск сервиса
sudo systemctl start creative-generation

# Автозапуск
sudo systemctl enable creative-generation

# Статус
sudo systemctl status creative-generation
```

## Nginx Reverse Proxy

Настройте Nginx для проксирования запросов:

```nginx
# /etc/nginx/sites-available/creative-generation

upstream creative_generation {
    server localhost:8085;
}

server {
    listen 80;
    server_name api.yourdomain.com;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=creative_gen_limit:10m rate=10r/m;

    location /api/creative-gen/ {
        limit_req zone=creative_gen_limit burst=5;

        proxy_pass http://creative_generation/;
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_cache_bypass $http_upgrade;
        
        # Увеличенные таймауты для генерации изображений
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

Активация конфигурации:

```bash
sudo ln -s /etc/nginx/sites-available/creative-generation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Обновление Frontend

После развертывания сервиса обновите переменные окружения фронтенда:

### Development (.env.development)

```bash
VITE_CREATIVE_API_URL=http://localhost:8085
```

### Production (.env.production)

```bash
VITE_CREATIVE_API_URL=https://api.yourdomain.com/api/creative-gen
```

## Мониторинг и логирование

### Логи сервиса

```bash
# PM2
pm2 logs creative-generation-service

# Docker
docker logs -f creative-generation-service

# Systemd
sudo journalctl -u creative-generation -f
```

### Метрики для отслеживания

1. **Количество генераций в день**
2. **Среднее время генерации текстов** (обычно 2-5 сек)
3. **Среднее время генерации изображений** (обычно 10-30 сек)
4. **Процент успешных генераций**
5. **Использование квоты Gemini API**
6. **Размер Supabase Storage**

## Troubleshooting

### Ошибка: "GEMINI_API_KEY is required"

Убедитесь, что переменная окружения установлена:

```bash
echo $GEMINI_API_KEY
```

### Ошибка: "Failed to upload image"

Проверьте:
1. Права доступа к Supabase Storage
2. Bucket `public` существует и настроен как public
3. SUPABASE_SERVICE_KEY корректен

### Медленная генерация изображений

Это нормально для AI генерации. Убедитесь, что:
1. Nginx timeout установлен > 300s
2. Frontend не обрывает запрос раньше времени

### "No generations available"

Пользователь исчерпал лимит. Проверьте:

```sql
SELECT creative_generations_available 
FROM user_accounts 
WHERE id = 'user_id';
```

## Масштабирование

### Горизонтальное масштабирование

Сервис stateless, можно запустить несколько инстансов:

```bash
# PM2 cluster mode
pm2 start ecosystem.config.js -i 2  # 2 инстанса

# Docker + load balancer
# Используйте несколько контейнеров + Nginx upstream
```

### Вертикальное масштабирование

Gemini API operations memory-intensive:
- Минимум: 512MB RAM
- Рекомендуется: 1GB RAM
- CPU: 1 core достаточно

## Безопасность

1. **API ключи**: Никогда не коммитьте в git
2. **CORS**: Настройте только для trusted origins
3. **Rate limiting**: Используйте Nginx или middleware
4. **HTTPS**: Обязательно в production
5. **Supabase RLS**: Service key имеет полный доступ - защищайте

## Backup и восстановление

### Резервное копирование

1. **Код**: В Git
2. **Изображения**: Supabase Storage имеет built-in backups
3. **БД**: Регулярные backups через Supabase

### Восстановление

1. Разверните новый инстанс
2. Примените миграции
3. Настройте переменные окружения
4. Запустите сервис

## Поддержка

При возникновении проблем:

1. Проверьте логи сервиса
2. Проверьте статус Gemini API
3. Проверьте квоты и лимиты

## Контрольный список деплоя

- [ ] Google AI API ключ получен
- [ ] Supabase URL и Service Key настроены
- [ ] Миграция БД применена
- [ ] Зависимости установлены (`npm install`)
- [ ] Production билд создан (`npm run build`)
- [ ] .env файл настроен
- [ ] Сервис запущен (PM2/Docker/systemd)
- [ ] Nginx настроен и перезагружен
- [ ] Healthcheck endpoint возвращает OK
- [ ] Frontend переменные окружения обновлены
- [ ] Тестовая генерация прошла успешно
- [ ] Логирование работает
- [ ] Мониторинг настроен

---

**Готово!** Сервис развернут и готов к использованию 🎉

