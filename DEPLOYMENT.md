# Деплой сервиса обработки видео

## 🌐 Ваши домены

- **Agent Brain (Scoring):** `https://brain2.performanteaiagency.com`
- **Agent Service (Video):** `https://agents.performanteaiagency.com` ⭐ Новый

## 📋 Шаги для деплоя

### 1. Настройка DNS

Добавьте A-запись в DNS для `performanteaiagency.com`:

```
Type: A
Name: agents
Value: [IP вашего сервера]
TTL: 300
```

### 2. Установка на сервере

```bash
# Подключитесь к серверу
ssh user@your-server

# Клонируйте репозиторий
git clone <your-repo> /opt/agents-monorepo
cd /opt/agents-monorepo

# Настройте переменные окружения
cp env.brain.example .env.brain
cp env.brain.example .env.agent

# Отредактируйте .env.agent
nano .env.agent
```

Добавьте в `.env.agent`:
```bash
# OpenAI для транскрибации
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Facebook API
FB_API_VERSION=v20.0
FB_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Supabase
SUPABASE_URL=https://xxxxxx.supabase.co
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server
PORT=8080
```

### 3. Запуск через Docker

```bash
# Запустите сервисы
docker-compose up -d --build

# Проверьте статус
docker-compose ps

# Проверьте логи
docker-compose logs -f agent-service
```

### 4. Установка Nginx

```bash
# Установите nginx
sudo apt update
sudo apt install nginx

# Скопируйте конфиг
sudo cp nginx.conf /etc/nginx/sites-available/agents

# Создайте симлинк
sudo ln -s /etc/nginx/sites-available/agents /etc/nginx/sites-enabled/

# Проверьте конфигурацию
sudo nginx -t

# Перезагрузите nginx
sudo systemctl reload nginx
```

### 5. Настройка SSL (Let's Encrypt)

```bash
# Установите certbot
sudo apt install certbot python3-certbot-nginx

# Получите сертификат для нового домена
sudo certbot --nginx -d agents.performanteaiagency.com

# Автообновление сертификатов уже настроено через cron
```

### 6. Проверка работы

```bash
# Health check
curl https://agents.performanteaiagency.com/health

# Должен вернуть: {"ok":true}
```

## 🎯 Webhook URL

После деплоя ваш webhook URL будет:

```
https://agents.performanteaiagency.com/process-video
```

## 🧪 Тестирование

```bash
# Локальный тест (с вашего компьютера)
export PAGE_ACCESS_TOKEN='ваш_токен'
export API_URL='https://agents.performanteaiagency.com'

./test-video-upload.sh ./test-video.mp4
```

Или через curl:

```bash
curl -X POST https://agents.performanteaiagency.com/process-video \
  -F "video=@video.mp4" \
  -F "user_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "ad_account_id=act_123456789" \
  -F "page_id=987654321" \
  -F "instagram_id=17841400000000000" \
  -F "page_access_token=EAAxxxxx" \
  -F "description=Тестовое видео" \
  -F "language=ru"
```

## 📊 Мониторинг

### Проверка статуса сервисов

```bash
# Docker containers
docker-compose ps

# Логи agent-service
docker-compose logs -f agent-service

# Логи agent-brain
docker-compose logs -f agent-brain

# Nginx логи
sudo tail -f /var/log/nginx/agents_access.log
sudo tail -f /var/log/nginx/agents_error.log
```

### Использование ресурсов

```bash
# Использование памяти и CPU
docker stats

# Disk space
df -h
du -sh /opt/agents-monorepo/*
```

## 🔧 Обслуживание

### Обновление кода

```bash
cd /opt/agents-monorepo
git pull
docker-compose up -d --build
```

### Перезапуск сервисов

```bash
# Перезапуск всех сервисов
docker-compose restart

# Перезапуск только agent-service
docker-compose restart agent-service
```

### Очистка временных файлов

```bash
# Очистка Docker
docker system prune -a

# Очистка /tmp (если накопились файлы)
sudo find /tmp -name "video_*.mp4" -mtime +1 -delete
sudo find /tmp -name "audio_*.wav" -mtime +1 -delete
```

## 🚨 Troubleshooting

### Проблема: 502 Bad Gateway

```bash
# Проверьте, запущен ли agent-service
docker-compose ps

# Проверьте логи
docker-compose logs agent-service

# Перезапустите
docker-compose restart agent-service
```

### Проблема: Timeout при загрузке видео

Увеличьте таймауты в nginx.conf:
```nginx
proxy_read_timeout 900s;
client_body_timeout 900s;
```

### Проблема: FFmpeg не найден

```bash
# Проверьте в контейнере
docker-compose exec agent-service which ffmpeg

# Если не найден, пересоберите образ
docker-compose up -d --build agent-service
```

## 📝 Резервное копирование

### База данных

Supabase автоматически делает бэкапы, но можно создать ручной:

```bash
# Через Supabase Dashboard
# Settings → Database → Create backup
```

### Конфигурация

```bash
# Создайте backup переменных окружения
cp .env.agent .env.agent.backup
cp .env.brain .env.brain.backup
```

## 🔐 Безопасность

- ✅ HTTPS через Let's Encrypt
- ✅ Закрытые переменные окружения
- ✅ Rate limiting через nginx (опционально)
- ✅ Firewall настройки

### Настройка Firewall (UFW)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable
```

## 📞 Контакты и поддержка

После успешного деплоя сохраните:
- URLs всех сервисов
- Учетные данные
- Backup переменных окружения
