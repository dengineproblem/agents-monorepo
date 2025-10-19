# 🚀 ПЛАН DEPLOYMENT ДЛЯ APP REVIEW

**Цель:** 
- Основное приложение (с AI, TikTok, всем) → `app.performanteaiagency.com` (поддомен)
- App Review версия (упрощённая) → `performanteaiagency.com` (главный домен)

---

## 📋 ЭТАП 1: ПОДГОТОВКА ЛОКАЛЬНО (на вашем компьютере)

### Шаг 1.1: Создать App Review ветку

```bash
cd ~/agents-monorepo

# Убедиться что на main ветке и всё закоммичено
git status
git add .
git commit -m "Save current state before App Review branch"

# Создать новую ветку для App Review
git checkout -b app-review-mode
```

### Шаг 1.2: Создать конфиг для App Review

**Создать файл:** `services/frontend/src/config/appReview.ts`

```bash
cat > services/frontend/src/config/appReview.ts << 'EOF'
// Feature flags для App Review mode
export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  // Что показываем в App Review mode
  SHOW_VIDEO_UPLOAD: true,
  SHOW_CAMPAIGN_LIST: true,
  SHOW_CAMPAIGN_DETAIL: true,
  SHOW_PROFILE: true,
  SHOW_FACEBOOK_CONNECT: true,
  
  // Что скрываем в App Review mode
  SHOW_TIKTOK: !APP_REVIEW_MODE,
  SHOW_CREATIVES: !APP_REVIEW_MODE,
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,
  SHOW_CAMPAIGN_BUILDER: !APP_REVIEW_MODE,
  SHOW_ANALYTICS: !APP_REVIEW_MODE,
  SHOW_CONSULTATIONS: !APP_REVIEW_MODE,
};
EOF
```

### Шаг 1.3: Создать .env для App Review

**Создать файл:** `services/frontend/.env.production.appreview`

```bash
cat > services/frontend/.env.production.appreview << 'EOF'
VITE_APP_REVIEW_MODE=true
VITE_API_URL=https://performanteaiagency.com/api
VITE_FB_APP_ID=1441781603583445
VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile
EOF
```

### Шаг 1.4: Внести изменения из APP_REVIEW_CODE_CHANGES.md

Открыть `APP_REVIEW_CODE_CHANGES.md` и выполнить ВСЕ изменения:

**Основные файлы для редактирования:**
- [ ] `services/frontend/src/components/VideoUpload.tsx` - добавить confirmation
- [ ] `services/frontend/src/components/CampaignList.tsx` - добавить confirmation
- [ ] `services/frontend/src/pages/CampaignDetail.tsx` - добавить confirmation
- [ ] `services/frontend/src/components/AppSidebar.tsx` - скрыть TikTok, Creatives, etc
- [ ] `services/frontend/src/pages/Dashboard.tsx` - скрыть AI Autopilot, TikTok
- [ ] `services/frontend/src/pages/Profile.tsx` - скрыть TikTok, Directions
- [ ] `services/frontend/src/App.tsx` - скрыть routes

### Шаг 1.5: Тестировать локально

```bash
cd services/frontend

# Установить зависимости (если нужно)
npm install

# Создать .env.local для тестирования App Review mode
cat > .env.local << 'EOF'
VITE_APP_REVIEW_MODE=true
VITE_API_URL=http://localhost:8080/api
VITE_FB_APP_ID=1441781603583445
VITE_FB_REDIRECT_URI=http://localhost:5173/profile
EOF

# Запустить dev сервер
npm run dev

# Открыть http://localhost:5173
# Проверить:
# - TikTok скрыт
# - Creatives скрыты
# - AI Autopilot скрыт
# - Confirmation dialogs работают
```

### Шаг 1.6: Закоммитить изменения

```bash
cd ~/agents-monorepo

git add .
git commit -m "App Review mode: hide automation, add confirmations"
git push origin app-review-mode
```

---

## 📋 ЭТАП 2: НАСТРОЙКА СЕРВЕРА

### Шаг 2.1: Подключиться к серверу

```bash
ssh user@your-server
# Или через ваш метод подключения
```

### Шаг 2.2: Создать поддомен для Production версии

```bash
# На сервере создать новую директорию
cd ~
mkdir -p agents-monorepo-prod
cd agents-monorepo-prod

# Клонировать репозиторий (main ветка - с полным функционалом)
git clone <your-repo-url> .
git checkout main
```

### Шаг 2.3: Настроить Production версию (поддомен)

```bash
cd ~/agents-monorepo-prod

# Создать .env для production на поддомене
cat > services/frontend/.env.production << 'EOF'
VITE_APP_REVIEW_MODE=false
VITE_API_URL=https://app.performanteaiagency.com/api
VITE_FB_APP_ID=1441781603583445
VITE_FB_REDIRECT_URI=https://app.performanteaiagency.com/profile
EOF

# Создать .env для backend
cat > .env.agent << 'EOF'
PORT=8081
FRONTEND_PORT=3001
# ... остальные переменные скопировать из текущего .env.agent
EOF

# Изменить порты в docker-compose.yml
nano docker-compose.yml
# Изменить:
# - frontend: ports: "3001:3000"
# - agent-service: ports: "8081:8080"
# - agent-brain: ports: "7081:7080"

# Или создать отдельный docker-compose-prod.yml
```

### Шаг 2.4: Обновить основное приложение (главный домен)

```bash
cd ~/agents-monorepo

# Переключиться на App Review ветку
git fetch origin
git checkout app-review-mode
git pull origin app-review-mode

# Создать .env для App Review
cat > services/frontend/.env.production << 'EOF'
VITE_APP_REVIEW_MODE=true
VITE_API_URL=https://performanteaiagency.com/api
VITE_FB_APP_ID=1441781603583445
VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile
EOF

# Backend .env уже есть, не трогаем
# Порты остаются: 3000, 8080, 7080
```

---

## 📋 ЭТАП 3: НАСТРОЙКА DNS И NGINX

### Шаг 3.1: Создать DNS запись для поддомена

В панели управления доменом (например Cloudflare, Namecheap):

```
Тип: A
Имя: app
Значение: <IP вашего сервера>
TTL: Auto или 300
```

Подождать 5-10 минут для propagation DNS.

Проверить:
```bash
ping app.performanteaiagency.com
# Должен показать ваш IP
```

### Шаг 3.2: Настроить Nginx

**Создать конфиг для поддомена:**

```bash
sudo nano /etc/nginx/sites-available/app.performanteaiagency.com
```

**Вставить:**

```nginx
# Production версия - поддомен
server {
    listen 80;
    server_name app.performanteaiagency.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /api {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Обновить конфиг для главного домена:**

```bash
sudo nano /etc/nginx/sites-available/performanteaiagency.com
```

**Проверить что порты правильные:**

```nginx
# App Review версия - главный домен
server {
    listen 80;
    server_name performanteaiagency.com;
    
    location / {
        proxy_pass http://localhost:3000;  # ← главный домен на порт 3000
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /api {
        proxy_pass http://localhost:8080;  # ← главный домен на порт 8080
    }
}
```

**Активировать конфиги:**

```bash
# Создать symlink для нового конфига
sudo ln -s /etc/nginx/sites-available/app.performanteaiagency.com /etc/nginx/sites-enabled/

# Проверить конфигурацию
sudo nginx -t

# Перезагрузить nginx
sudo systemctl reload nginx
```

### Шаг 3.3: Получить SSL сертификаты

```bash
# Для поддомена
sudo certbot --nginx -d app.performanteaiagency.com

# Проверить что для главного домена уже есть
sudo certbot certificates | grep performanteaiagency.com
```

---

## 📋 ЭТАП 4: DEPLOY ПРИЛОЖЕНИЙ

### Шаг 4.1: Deploy Production версии (поддомен)

```bash
cd ~/agents-monorepo-prod

# Остановить если что-то уже работает на этих портах
docker-compose -p production down

# Собрать и запустить
docker-compose -p production up -d --build

# Проверить
docker-compose -p production ps
docker-compose -p production logs frontend --tail 50
```

### Шаг 4.2: Deploy App Review версии (главный домен)

```bash
cd ~/agents-monorepo

# Остановить текущую версию
docker-compose down

# Собрать и запустить App Review версию
docker-compose up -d --build

# Проверить
docker ps
docker logs agents-monorepo-frontend-1 --tail 50
```

### Шаг 4.3: Проверить что оба работают

```bash
# Проверить порты
sudo lsof -i :3000  # App Review (главный домен)
sudo lsof -i :3001  # Production (поддомен)
sudo lsof -i :8080  # App Review API
sudo lsof -i :8081  # Production API

# Должны быть заняты docker-proxy
```

---

## 📋 ЭТАП 5: ТЕСТИРОВАНИЕ

### Шаг 5.1: Проверить App Review версию (главный домен)

```bash
# Открыть в браузере:
https://performanteaiagency.com

# Проверить:
# ✅ TikTok НЕ виден в меню
# ✅ Creatives НЕ виден в меню  
# ✅ AI Autopilot НЕ виден на Dashboard
# ✅ Только Instagram в VideoUpload
# ✅ Confirmation dialogs работают при pause/resume
# ✅ Confirmation при загрузке видео
```

### Шаг 5.2: Проверить Production версию (поддомен)

```bash
# Открыть в браузере:
https://app.performanteaiagency.com

# Проверить:
# ✅ TikTok виден и работает
# ✅ Creatives доступны
# ✅ AI Autopilot виден
# ✅ Directions работают
# ✅ Всё как было
```

---

## 📋 ЭТАП 6: ОБНОВИТЬ FACEBOOK APP SETTINGS

### Шаг 6.1: Добавить OAuth Redirect URIs

Перейти: https://developers.facebook.com/apps/1441781603583445/fb-login/settings/

**Valid OAuth Redirect URIs (добавить ОБА):**
```
https://performanteaiagency.com/profile
https://app.performanteaiagency.com/profile
```

### Шаг 6.2: Проверить другие настройки

**Basic Settings:**
- Privacy Policy URL: `https://performanteaiagency.com/privacy`
- Terms of Service URL: `https://performanteaiagency.com/terms`
- Data Deletion: `https://performanteaiagency.com/api/facebook/data-deletion`

Все должны указывать на ГЛАВНЫЙ домен (для App Review).

---

## 📋 ЭТАП 7: ФИНАЛЬНАЯ ПРОВЕРКА

### Чеклист App Review версии (performanteaiagency.com):

- [ ] Страница загружается
- [ ] Login работает
- [ ] Facebook OAuth работает (redirect на /profile)
- [ ] Модальное окно выбора Ad Account/Page появляется
- [ ] Dashboard показывает кампании
- [ ] TikTok СКРЫТ
- [ ] Creatives СКРЫТЫ
- [ ] AI Autopilot СКРЫТ
- [ ] Directions СКРЫТЫ
- [ ] VideoUpload работает (только Instagram)
- [ ] Confirmation dialog перед загрузкой видео
- [ ] Pause кампании с confirmation
- [ ] Resume кампании с confirmation
- [ ] Privacy Policy работает (/privacy)
- [ ] Terms работают (/terms)

### Чеклист Production версии (app.performanteaiagency.com):

- [ ] Страница загружается
- [ ] Login работает
- [ ] Всё как было (TikTok, AI, Creatives, etc)

---

## 🔄 ОТКАТ (если что-то пошло не так)

### Откат App Review версии на главном домене:

```bash
cd ~/agents-monorepo

# Вернуться на main ветку
git checkout main

# Пересобрать
docker-compose down
docker-compose up -d --build
```

### Удалить Production поддомен:

```bash
cd ~/agents-monorepo-prod
docker-compose -p production down

# Удалить nginx конфиг
sudo rm /etc/nginx/sites-enabled/app.performanteaiagency.com
sudo systemctl reload nginx
```

---

## 📊 ИТОГОВАЯ СТРУКТУРА

После всех действий:

```
СЕРВЕР:
├── ~/agents-monorepo/              (App Review - главный домен)
│   ├── git branch: app-review-mode
│   ├── VITE_APP_REVIEW_MODE=true
│   ├── Порты: 3000, 8080, 7080
│   └── URL: https://performanteaiagency.com
│
└── ~/agents-monorepo-prod/         (Production - поддомен)
    ├── git branch: main
    ├── VITE_APP_REVIEW_MODE=false
    ├── Порты: 3001, 8081, 7081
    └── URL: https://app.performanteaiagency.com

NGINX:
├── performanteaiagency.com → localhost:3000 (App Review)
└── app.performanteaiagency.com → localhost:3001 (Production)

FACEBOOK:
└── OAuth Redirect URIs:
    ├── https://performanteaiagency.com/profile
    └── https://app.performanteaiagency.com/profile
```

---

## ⏱️ ПРИМЕРНОЕ ВРЕМЯ:

- **Этап 1 (локально):** 2-3 часа (изменения кода)
- **Этап 2 (сервер):** 30 минут (клонирование, настройка)
- **Этап 3 (DNS/Nginx):** 30 минут (+ 10 мин ожидание DNS)
- **Этап 4 (Deploy):** 20 минут (сборка образов)
- **Этап 5 (Тестирование):** 30 минут
- **Этап 6 (Facebook):** 10 минут
- **Этап 7 (Проверка):** 20 минут

**ИТОГО:** ~4-5 часов

---

## ✅ ГОТОВО!

После этого:
- ✅ App Review версия на главном домене
- ✅ Production версия на поддомене
- ✅ Можно записывать скринкасты
- ✅ Можно подавать на App Review
- ✅ Пользователи могут работать на поддомене

**Вопросы по плану?**

