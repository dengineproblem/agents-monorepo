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

### **3. Другие домены (для справки)**

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

### **Docker Compose файлы:**

- **Основной:** `/root/agents-monorepo/docker-compose.yml` (все сервисы агентов и фронтенды)
- **N8N:** `/root/docker-compose.yml` (n8n и postgres)

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

location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}

location /api/analyzer/ {
    rewrite ^/api/analyzer/(.*)$ /$1 break;
    proxy_pass http://creative-analyzer:7081;
}
```

### **SSL сертификаты:**
- `performanteaiagency.com`: `/etc/letsencrypt/live/performanteaiagency.com/`
- `app.performanteaiagency.com`: `/etc/letsencrypt/live/app.performanteaiagency.com/`

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

/root/docker-compose.yml        # N8N + Postgres (отдельно)
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
- Production: https://app.performanteaiagency.com
- App Review: https://performanteaiagency.com
- Grafana: https://app.performanteaiagency.com:3000 (через SSH tunnel)
- N8N: https://n8n.performanteaiagency.com

**Важные порты для SSH туннелей:**
- Grafana: `ssh -L 3000:localhost:3000 root@server`
- Agent Brain: `ssh -L 7080:localhost:7080 root@server`

---

## 📝 ИСТОРИЯ ИЗМЕНЕНИЙ

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

