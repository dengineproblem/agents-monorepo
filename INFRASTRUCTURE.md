# 🏗️ ИНФРАСТРУКТУРА ПРОЕКТА - ПОЛНАЯ ДОКУМЕНТАЦИЯ

> **ВАЖНО:** Этот документ содержит актуальную информацию по всей инфраструктуре проекта. Читать перед любым деплоем!

---

## 📋 ОГЛАВЛЕНИЕ

1. [Архитектура системы](#архитектура-системы)
2. [Домены и их назначение](#домены-и-их-назначение)
3. [Docker контейнеры и порты](#docker-контейнеры-и-порты)
4. [Nginx конфигурация](#nginx-конфигурация)
5. [Две версии Frontend](#две-версии-frontend)
6. [Процесс деплоя](#процесс-деплоя)
7. [Troubleshooting](#troubleshooting)

---

## 🏛️ АРХИТЕКТУРА СИСТЕМЫ

### **Общая схема:**

```
Интернет (HTTPS :443 / HTTP :80)
    ↓
Docker nginx (контейнер)
    ├─ performanteaiagency.com → frontend-appreview:80 (App Review версия)
    ├─ app.performanteaiagency.com → frontend:80 (Production версия)
    └─ */api/* → agent-service:8082 (Backend API)
         └─ /api/analyzer/* → creative-analyzer:7081
```

### **Важные моменты:**

- ✅ **НЕТ системного nginx** (он остановлен и отключен)
- ✅ Docker nginx **напрямую** слушает порты 80/443
- ✅ SSL сертификаты монтируются из `/etc/letsencrypt` в Docker nginx
- ✅ Все сервисы изолированы в Docker сети

---

## 🌐 ДОМЕНЫ И ИХ НАЗНАЧЕНИЕ

### **1. `performanteaiagency.com` (App Review версия)**

**Назначение:** Упрощенная версия для прохождения Facebook App Review

**Особенности:**
- ✅ Полностью на **английском языке**
- ❌ **БЕЗ** переключателя языков
- ❌ **БЕЗ** разделов: Creatives, Directions, AI Autopilot, ROI Analytics
- ✅ В Actions только **2 кнопки**: "Upload Video" и "Upload Image"
- ✅ Диалоги подтверждения для всех критических действий

**Docker контейнер:** `agents-monorepo-frontend-appreview-1`  
**Порт внутри сети:** `frontend-appreview:80`  
**Порт на хосте:** `3002` (для отладки)

---

### **2. `app.performanteaiagency.com` (Production версия)**

**Назначение:** Полная рабочая версия для реальных пользователей

**Особенности:**
- ✅ Переключатель языков (RU/EN)
- ✅ Все разделы: Dashboard, Campaigns, Creatives, Directions, AI Autopilot, ROI Analytics
- ✅ Все кнопки в Actions: Autostart, Manual Launch, Add to Sale, Upload Video, Upload Image

**Docker контейнер:** `agents-monorepo-frontend-1`  
**Порт внутри сети:** `frontend:80`  
**Порт на хосте:** `3001` (для отладки)

---

### **3. `n8n.performanteaiagency.com` (Workflow Automation)**

**Назначение:** Автоматизация workflows, генерация креативов с текстом, интеграции

**Особенности:**
- ✅ Python 3.12.12 + Pillow 11.0.0 для генерации изображений
- ✅ ffmpeg для обработки видео
- ✅ WebSocket для real-time обновлений workflow
- ✅ Шрифты DejaVu для текста на изображениях
- ✅ PostgreSQL для хранения данных

**Docker контейнеры:** 
- `root-n8n-1` - основной контейнер n8n
- `root-postgres-1` - база данных PostgreSQL

**Важные детали:**
- **Docker-compose:** `/root/docker-compose.yml` (отдельный от основного)
- **Dockerfile:** `/root/Dockerfile`
- **Сеть:** `root_default` + подключен к `agents-monorepo_default` (для связи с nginx)
- **Volume:** `n8n_data` - хранит все workflows и настройки
- **Порт внутри:** `5678`
- **Домен:** `https://n8n.performanteaiagency.com`

---

### **4. Другие домены (для справки)**

- `agents.performanteaiagency.com` - прямой доступ к agent-service API (не используется в продакшене)
- `agent2.performanteaiagency.com` - legacy (не используется)
- `brain2.performanteaiagency.com` - legacy (не используется)

---

## 🐳 DOCKER КОНТЕЙНЕРЫ И ПОРТЫ

### **Таблица портов:**

| Контейнер | Внутренний порт | Внешний порт (хост) | Назначение |
|-----------|-----------------|---------------------|------------|
| `nginx` | 80, 443 | **80, 443** | Главный веб-сервер, SSL терминация |
| `frontend` (production) | 80 | 3001 | Production версия React приложения |
| `frontend-appreview` | 80 | 3002 | App Review версия React приложения |
| `agent-service` | 8082 | 8082 | Backend API (Facebook, workflows) |
| `creative-analyzer` | 7081 | 7081 | LLM анализатор креативов |
| `agent-brain` | 7080 | 7080 | Scoring agent (cron jobs) |
| `loki` | 3100 | 3100 | Логирование (Grafana Loki) |
| `grafana` | 3000 | 3000 | Мониторинг и визуализация логов |
| `n8n` | 5678 | 5678 | Workflow automation (отдельный docker-compose) |
| `postgres` | 5432 | - | БД для n8n (не публичный) |
| `evolution-api` | 8080 | 8080 | WhatsApp Business API (Evolution API) |
| `evolution-postgres` | 5432 | 5433 | БД для Evolution API |
| `evolution-redis` | 6379 | 6380 | Cache для Evolution API |

### **Docker Compose файлы:**

- **Основной:** `/root/agents-monorepo/docker-compose.yml` (все сервисы агентов, фронтенды, nginx)
  - Сеть: `agents-monorepo_default`
  - Контейнеры: nginx, frontend, frontend-appreview, agent-service, agent-brain, creative-analyzer, loki, grafana, evolution-api, evolution-postgres, evolution-redis
  
- **N8N (отдельный):** `/root/docker-compose.yml` (n8n + postgres)
  - Сеть: `root_default`
  - Контейнеры: n8n, postgres
  - **ВАЖНО:** n8n также подключен к `agents-monorepo_default` через `docker network connect` для связи с nginx

---

## ⚙️ NGINX КОНФИГУРАЦИЯ

### **Файл:** `nginx-production.conf` (в репозитории)

**Монтирование:**
```yaml
nginx:
  volumes:
    - ./nginx-production.conf:/etc/nginx/nginx.conf:ro
    - /etc/letsencrypt:/etc/letsencrypt:ro
```

### **Ключевые блоки:**

#### **1. App Review Frontend (`performanteaiagency.com`):**
```nginx
location / {
    proxy_pass http://frontend-appreview:80;
}

location /evolution/ {
    proxy_pass http://evolution-api:8080/;
}

location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}

location /api/analyzer/ {
    rewrite ^/api/analyzer/(.*)$ /$1 break;
    proxy_pass http://creative-analyzer:7081;
}
```

#### **2. Production Frontend (`app.performanteaiagency.com`):**
```nginx
location / {
    proxy_pass http://frontend:80;
}

location /evolution/ {
    proxy_pass http://evolution-api:8080/;
}

location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}

location /api/analyzer/ {
    rewrite ^/api/analyzer/(.*)$ /$1 break;
    proxy_pass http://creative-analyzer:7081;
}
```

#### **3. N8N Workflow Automation (`n8n.performanteaiagency.com`):**
```nginx
# WebSocket поддержка (в начале http блока)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name n8n.performanteaiagency.com;
    
    # Webhooks с CORS
    location ^~ /webhook/ {
        client_max_body_size 512M;
        proxy_pass http://root-n8n-1:5678;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        
        # Таймауты для долгих операций
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
    
    # Интерфейс n8n
    location / {
        proxy_pass http://root-n8n-1:5678;
        proxy_http_version 1.1;
        
        # WebSocket support (КРИТИЧНО для работы workflow!)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**ВАЖНО:** 
- `map $http_upgrade $connection_upgrade` должен быть ПЕРЕД server блоками
- Использовать `Connection $connection_upgrade`, НЕ `Connection "upgrade"`
- Без правильного WebSocket workflow не будут открываться!

### **SSL сертификаты:**
- `performanteaiagency.com`: `/etc/letsencrypt/live/performanteaiagency.com/`
- `app.performanteaiagency.com`: `/etc/letsencrypt/live/app.performanteaiagency.com/`
- `n8n.performanteaiagency.com`: `/etc/letsencrypt/live/n8n.performanteaiagency.com/`

---

## 🎨 ДВЕ ВЕРСИИ FRONTEND

### **Как это работает:**

**Dockerfile:** `services/frontend/Dockerfile`

```dockerfile
ARG BUILD_MODE=production

RUN if [ "$BUILD_MODE" = "appreview" ]; then \
      echo "VITE_APP_REVIEW_MODE=true" > .env.local && \
      echo "VITE_API_URL=https://performanteaiagency.com/api" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile" >> .env.local; \
    else \
      echo "VITE_APP_REVIEW_MODE=false" > .env.local && \
      echo "VITE_API_URL=https://app.performanteaiagency.com/api" >> .env.local && \
      echo "VITE_FB_APP_ID=1441781603583445" >> .env.local && \
      echo "VITE_FB_REDIRECT_URI=https://app.performanteaiagency.com/profile" >> .env.local; \
    fi
```

**Docker Compose:**
```yaml
frontend:
  build:
    context: ./services/frontend
    args:
      BUILD_MODE: production

frontend-appreview:
  build:
    context: ./services/frontend
    args:
      BUILD_MODE: appreview
```

### **Переменные окружения:**

| Переменная | Production | App Review |
|------------|-----------|------------|
| `VITE_APP_REVIEW_MODE` | `false` | `true` |
| `VITE_API_URL` | `https://app.performanteaiagency.com/api` | `https://performanteaiagency.com/api` |
| `VITE_FB_REDIRECT_URI` | `https://app.performanteaiagency.com/profile` | `https://performanteaiagency.com/profile` |

### **Логика в коде:**

`services/frontend/src/config/appReview.ts`:
```typescript
export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  SHOW_TIKTOK: !APP_REVIEW_MODE,
  SHOW_CREATIVES: !APP_REVIEW_MODE,
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,
  SHOW_ROI_ANALYTICS: !APP_REVIEW_MODE,
  SHOW_LANGUAGE_SWITCHER: !APP_REVIEW_MODE,
};
```

---

## 🚀 ПРОЦЕСС ДЕПЛОЯ

### **📝 ПОШАГОВАЯ ИНСТРУКЦИЯ**

#### **1. Коммит и пуш изменений (локально):**
```bash
cd ~/agents-monorepo
git add .
git commit -m "Your commit message"
git push origin main
```

#### **2. На сервере - подтянуть изменения:**
```bash
ssh root@your-server

cd ~/agents-monorepo
git pull origin main
```

#### **3. Пересобрать и перезапустить контейнеры:**

**ВАРИАНТ A: Пересобрать ВСЕ контейнеры (если меняли код):**
```bash
docker-compose build
docker-compose down
docker-compose up -d
```

**ВАРИАНТ B: Пересобрать ТОЛЬКО фронтенд:**
```bash
# Production версия
docker-compose build frontend
docker-compose up -d frontend

# App Review версия
docker-compose build frontend-appreview
docker-compose up -d frontend-appreview
```

**ВАРИАНТ C: Пересобрать ТОЛЬКО backend:**
```bash
docker-compose build agent-service
docker-compose up -d agent-service
```

**ВАРИАНТ D: Пересобрать ТОЛЬКО agent-brain:**
```bash
docker-compose build agent-brain creative-analyzer
docker-compose up -d agent-brain creative-analyzer
```

**ВАРИАНТ E: Пересобрать N8N (отдельный docker-compose):**
```bash
cd /root
docker-compose build n8n
docker-compose down
docker-compose up -d

# Проверить что n8n подключен к сети nginx
docker network connect agents-monorepo_default root-n8n-1 2>/dev/null || echo "Already connected"

# Перезагрузить nginx для применения конфигурации
cd /root/agents-monorepo
docker-compose restart nginx
```

#### **4. Проверить статус контейнеров:**
```bash
docker ps
```

Все контейнеры должны быть в статусе `Up`:
- `agents-monorepo-nginx-1`
- `agents-monorepo-frontend-1`
- `agents-monorepo-frontend-appreview-1`
- `agents-monorepo-agent-service-1`
- `agents-monorepo-agent-brain-1`
- `agents-monorepo-creative-analyzer-1`

#### **5. Проверить логи (если что-то не работает):**
```bash
# Все контейнеры
docker-compose logs -f

# Конкретный контейнер
docker-compose logs -f frontend
docker-compose logs -f nginx
docker-compose logs -f agent-service
```

#### **6. Проверить сайты в браузере:**
- `https://performanteaiagency.com` (App Review)
- `https://app.performanteaiagency.com` (Production)

---

## 🛠️ TROUBLESHOOTING

### **❌ ПРОБЛЕМА: "Port 80/443 already in use"**

**Причина:** Системный nginx занял порты 80/443

**Решение:**
```bash
# 1. Остановить системный nginx
sudo systemctl stop nginx
sudo systemctl disable nginx

# 2. Удалить "застрявший" Docker nginx
docker rm -f agents-monorepo-nginx-1

# 3. Перезапустить Docker nginx
docker-compose up -d nginx

# 4. Проверить
docker ps | grep nginx
```

---

### **❌ ПРОБЛЕМА: Изменения в коде не применяются**

**Причина:** Docker использует старый image

**Решение:**
```bash
# 1. Пересобрать БЕЗ КЭША
docker-compose build --no-cache frontend frontend-appreview

# 2. Перезапустить
docker-compose up -d frontend frontend-appreview

# 3. Проверить что image пересобрался
docker images | grep frontend
```

---

### **❌ ПРОБЛЕМА: Nginx показывает "502 Bad Gateway"**

**Причина:** Backend контейнер не запущен или упал

**Решение:**
```bash
# 1. Проверить статус
docker ps -a | grep agent-service

# 2. Посмотреть логи
docker-compose logs agent-service

# 3. Перезапустить
docker-compose restart agent-service
```

---

### **❌ ПРОБЛЕМА: "CORS error" в браузере**

**Причина:** Неправильный `VITE_API_URL` в frontend

**Решение:**
```bash
# 1. Проверить переменные внутри контейнера
docker exec agents-monorepo-frontend-1 cat /usr/share/nginx/html/index.html | grep VITE

# 2. Если неправильные - пересобрать
docker-compose build --no-cache frontend frontend-appreview
docker-compose up -d frontend frontend-appreview
```

---

### **❌ ПРОБЛЕМА: Обе версии фронтенда одинаковые**

**Причина:** Docker не пересобрал с разными `BUILD_MODE`

**Решение:**
```bash
# 1. Удалить старые images
docker rmi $(docker images -q agents-monorepo-frontend)
docker rmi $(docker images -q agents-monorepo-frontend-appreview)

# 2. Пересобрать с нуля
docker-compose build --no-cache frontend frontend-appreview

# 3. Перезапустить
docker-compose up -d frontend frontend-appreview
```

---

### **❌ ПРОБЛЕМА: SSL сертификат истёк**

**Причина:** Let's Encrypt сертификаты действительны 90 дней

**Решение:**
```bash
# 1. Обновить сертификаты
sudo certbot renew

# 2. Перезапустить nginx
docker-compose restart nginx

# 3. Проверить дату истечения
sudo certbot certificates
```

---

### **❌ ПРОБЛЕМА: n8n открывается, но workflow не открываются (зависают)**

**Причина:** WebSocket не работает - неправильная конфигурация nginx

**Решение:**
```bash
# 1. Проверить что в nginx-production.conf есть map директива
grep "map.*http_upgrade" /root/agents-monorepo/nginx-production.conf

# Если НЕТ - добавить в начало http блока (после error_log):
# map $http_upgrade $connection_upgrade {
#     default upgrade;
#     '' close;
# }

# 2. Проверить что используется $connection_upgrade, а не "upgrade"
grep "Connection.*connection_upgrade" /root/agents-monorepo/nginx-production.conf

# Если НЕТ - заменить Connection "upgrade" на Connection $connection_upgrade

# 3. Перезагрузить nginx
cd /root/agents-monorepo
docker-compose restart nginx

# 4. Проверить в браузере DevTools Console - не должно быть ошибок WebSocket
```

---

### **❌ ПРОБЛЕМА: n8n показывает 502 Bad Gateway**

**Причина:** n8n контейнер не подключен к сети nginx

**Решение:**
```bash
# 1. Проверить статус контейнера n8n
docker ps | grep n8n

# 2. Проверить сети n8n
docker inspect root-n8n-1 | grep -A 5 "Networks"

# 3. Подключить к сети nginx (если нужно)
docker network connect agents-monorepo_default root-n8n-1

# 4. Перезагрузить nginx
cd /root/agents-monorepo
docker-compose restart nginx

# 5. Проверить доступность
curl -I http://localhost:5678
```

---

### **❌ ПРОБЛЕМА: После пересоздания n8n контейнера пропал Python/Pillow**

**Причина:** Изменения не сохранены в Docker образе

**Решение:**
```bash
# 1. Проверить Dockerfile
cat /root/Dockerfile

# Должен содержать:
# RUN apk add --no-cache python3 py3-pillow jpeg-dev zlib-dev freetype-dev ...

# 2. Пересобрать образ
cd /root
docker-compose build --no-cache n8n

# 3. Пересоздать контейнер
docker-compose down
docker-compose up -d

# 4. Подключить к сети nginx
docker network connect agents-monorepo_default root-n8n-1 2>/dev/null

# 5. Проверить что Python и Pillow работают
docker exec root-n8n-1 python3 --version
docker exec root-n8n-1 python3 -c "from PIL import Image; print('OK')"
```

---

### **📊 ПОЛЕЗНЫЕ КОМАНДЫ ДЛЯ ДИАГНОСТИКИ**

```bash
# Проверить все порты
sudo lsof -i :80
sudo lsof -i :443
sudo lsof -i :3001
sudo lsof -i :3002
sudo lsof -i :8082

# Проверить Docker сеть
docker network ls
docker network inspect agents-monorepo_default

# Проверить размер логов (если диск заполнен)
du -sh /var/lib/docker/containers/*/*-json.log

# Очистить старые Docker images
docker image prune -a

# Полная очистка (ОСТОРОЖНО!)
docker system prune -a --volumes
```

---

## 📂 СТРУКТУРА ПРОЕКТА

```
/root/agents-monorepo/
├── docker-compose.yml          # Основной файл для всех сервисов
├── nginx-production.conf       # Конфигурация nginx (монтируется в контейнер)
│                               # ВАЖНО: содержит map $http_upgrade для WebSocket
├── services/
│   ├── frontend/               # React приложение (Vite)
│   │   ├── Dockerfile          # Multi-stage build с BUILD_MODE
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── appReview.ts  # Feature flags для App Review
│   │   │   └── i18n/           # Переводы (EN/RU)
│   │   └── nginx.conf          # Nginx для статики внутри контейнера
│   ├── agent-service/          # Backend API (Fastify + TypeScript)
│   │   └── src/
│   │       ├── routes/         # API endpoints
│   │       └── workflows/      # Facebook API workflows
│   └── agent-brain/            # Scoring agent + Analyzer
│       └── src/
│           ├── scoring.js      # Основной scoring agent
│           └── analyzerService.js  # LLM анализатор
└── .env.brain, .env.agent      # Переменные окружения (не в git!)

/root/                          # N8N (отдельная директория)
├── docker-compose.yml          # N8N + Postgres
│                               # Образ: custom-n8n:latest-ffmpeg
│                               # Сеть: root_default + agents-monorepo_default
│                               # Volume: n8n_data (хранит workflow)
├── Dockerfile                  # Кастомный образ n8n с:
│                               # - Python 3.12.12
│                               # - Pillow 11.0.0
│                               # - ffmpeg
│                               # - Шрифты DejaVu
└── Dockerfile.backup           # Резервная копия
```

---

## 🔐 ВАЖНЫЕ ФАЙЛЫ (НЕ В GIT!)

**На сервере:**
- `/root/agents-monorepo/.env.brain` - переменные для agent-brain (OpenAI ключи, Supabase)
- `/root/agents-monorepo/.env.agent` - переменные для agent-service (Supabase)
- `/etc/letsencrypt/` - SSL сертификаты

**НИКОГДА НЕ КОММИТИТЬ:**
- `.env.*` файлы
- Ключи API (OpenAI, Facebook, Supabase)

---

## ✅ ЧЕКЛИСТ ПЕРЕД ДЕПЛОЕМ

- [ ] Код протестирован локально
- [ ] Все изменения закоммичены (`git status` чист)
- [ ] Запушено в `main` ветку
- [ ] На сервере выполнен `git pull`
- [ ] Пересобраны нужные контейнеры (`docker-compose build`)
- [ ] Контейнеры перезапущены (`docker-compose up -d`)
- [ ] Проверен статус контейнеров (`docker ps`)
- [ ] Проверены логи (`docker-compose logs -f`)
- [ ] Проверены оба домена в браузере
- [ ] Проверена работа API (`/api/health`)

---

## 📞 КОНТАКТЫ И ССЫЛКИ

**Домены:**
- Production Frontend: https://app.performanteaiagency.com
- App Review Frontend: https://performanteaiagency.com
- N8N Workflows: https://n8n.performanteaiagency.com
- Grafana (через SSH tunnel): http://localhost:3000
- Agent Brain (через SSH tunnel): http://localhost:7080

**Важные порты для SSH туннелей:**
- Grafana: `ssh -L 3000:localhost:3000 root@server`
- Agent Brain: `ssh -L 7080:localhost:7080 root@server`

---

## 📝 ИСТОРИЯ ИЗМЕНЕНИЙ

**28 октября 2025:**
- ✅ Добавлена интеграция Evolution API для WhatsApp Business
- ✅ Создана инфраструктура для работы с несколькими WhatsApp номерами
- ✅ Выполнены миграции БД (013-016) для поддержки direction_id, creative_id, WhatsApp instances
- ✅ Добавлены новые сервисы: evolution-api (порт 8080), evolution-postgres (5433), evolution-redis (6380)
- ✅ Обновлен nginx-production.conf с маршрутом /evolution/
- ✅ Добавлены роуты в agent-service: /api/webhooks/evolution, /api/whatsapp/instances

**25 октября 2025:**
- ✅ Добавлен Python 3.12.12 + Pillow 11.0.0 в n8n контейнер
- ✅ Обновлен `/root/Dockerfile` с полным набором зависимостей для работы с изображениями
- ✅ Исправлена WebSocket конфигурация в nginx (добавлен `map $http_upgrade`)
- ✅ Решена проблема с Docker сетями (n8n подключен к `agents-monorepo_default`)
- ✅ Добавлена документация по n8n в INFRASTRUCTURE.md
- ✅ Создан отчет N8N_PYTHON_PILLOW_SETUP_REPORT.md

**23 октября 2025:**
- ✅ Исправлен конфликт портов (системный nginx vs Docker nginx)
- ✅ Подтверждена работа обеих версий фронтенда
- ✅ Создана эта документация

**22 октября 2025:**
- Попытка миграции на subdomain (незавершенная)
- Создан `app.conf` для системного nginx (больше не используется)

---

**ВАЖНО:** Всегда проверяй эту документацию перед деплоем! При изменении архитектуры - обновляй этот файл!

🚀 **Успешного деплоя!**

