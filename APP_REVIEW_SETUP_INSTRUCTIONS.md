# 🚀 БЕЗОПАСНАЯ НАСТРОЙКА APP REVIEW ВЕРСИИ

## ⚠️ КРИТИЧЕСКИ ВАЖНО!

**ТЕКУЩИЙ PRODUCTION РАБОТАЕТ И НЕ ДОЛЖЕН СЛОМАТЬСЯ!**

Этот документ описывает пошаговый план добавления упрощённой App Review версии БЕЗ РИСКА для работающего production.

---

## 📊 ТЕКУЩЕЕ СОСТОЯНИЕ

```
performanteaiagency.com → frontend:3001 (РАБОТАЕТ, НЕ ТРОГАТЬ!)
```

## 🎯 ЦЕЛЕВОЕ СОСТОЯНИЕ

```
performanteaiagency.com     → frontend-appreview:3002 (App Review - упрощённая)
app.performanteaiagency.com → frontend:3001          (Production - полная)
```

---

## 📋 ПЛАН РАБОТЫ (5 ФАЗ)

### **ФАЗА 1: ПОДГОТОВКА КОДА (ЛОКАЛЬНО, БЕЗОПАСНО)** ⏱️ 2-3 часа

#### 1.1. Создать Feature Flags

**Файл:** `services/frontend/src/config/appReview.ts`

```typescript
// Feature flags для App Review режима
export const APP_REVIEW_MODE = import.meta.env.VITE_APP_REVIEW_MODE === 'true';

export const FEATURES = {
  // Скрываем в App Review mode
  SHOW_TIKTOK: !APP_REVIEW_MODE,
  SHOW_CREATIVES: !APP_REVIEW_MODE,
  SHOW_DIRECTIONS: !APP_REVIEW_MODE,
  SHOW_AI_AUTOPILOT: !APP_REVIEW_MODE,
  SHOW_ROI_ANALYTICS: !APP_REVIEW_MODE,
  SHOW_CONSULTATIONS: !APP_REVIEW_MODE,
  SHOW_CAMPAIGN_BUILDER: !APP_REVIEW_MODE,
};
```

#### 1.2. Добавить Internationalization (i18n)

**Файл:** `services/frontend/src/i18n/translations.ts`

```typescript
export const translations = {
  en: {
    menu: {
      dashboard: 'Dashboard',
      campaigns: 'Campaigns',
      profile: 'Profile',
      settings: 'Settings',
    },
    action: {
      uploadVideo: 'Upload Video',
      uploadImage: 'Upload Image',
      connect: 'Connect',
      disconnect: 'Disconnect',
      save: 'Save',
      cancel: 'Cancel',
    },
    msg: {
      confirmPause: 'Are you sure you want to pause this campaign?',
      confirmResume: 'Are you sure you want to resume this campaign?',
      confirmCreate: 'Are you sure you want to create this campaign?',
      success: 'Success',
      error: 'Error',
    },
  },
  ru: {
    menu: {
      dashboard: 'Дашборд',
      campaigns: 'Кампании',
      profile: 'Профиль',
      settings: 'Настройки',
    },
    action: {
      uploadVideo: 'Загрузить видео',
      uploadImage: 'Загрузить изображение',
      connect: 'Подключить',
      disconnect: 'Отключить',
      save: 'Сохранить',
      cancel: 'Отмена',
    },
    msg: {
      confirmPause: 'Вы уверены, что хотите приостановить эту кампанию?',
      confirmResume: 'Вы уверены, что хотите возобновить эту кампанию?',
      confirmCreate: 'Вы уверены, что хотите создать эту кампанию?',
      success: 'Успешно',
      error: 'Ошибка',
    },
  },
};
```

**Файл:** `services/frontend/src/i18n/LanguageContext.tsx`

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations } from './translations';
import { APP_REVIEW_MODE } from '../config/appReview';

type Language = 'en' | 'ru';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // В App Review mode по умолчанию английский
  const defaultLang: Language = APP_REVIEW_MODE ? 'en' : 'ru';
  
  const [language, setLanguageState] = useState<Language>(() => {
    if (APP_REVIEW_MODE) return 'en'; // Всегда английский в App Review
    const saved = localStorage.getItem('language');
    return (saved === 'en' || saved === 'ru') ? saved : defaultLang;
  });

  useEffect(() => {
    if (!APP_REVIEW_MODE) {
      localStorage.setItem('language', language);
    }
  }, [language]);

  const setLanguage = (lang: Language) => {
    if (APP_REVIEW_MODE && lang !== 'en') {
      console.warn('App Review mode: only English is allowed');
      return;
    }
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // Fallback
      }
    }
    
    return typeof value === 'string' ? value : key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  return context;
};
```

#### 1.3. Обновить App.tsx

```typescript
import { LanguageProvider } from './i18n/LanguageContext';
import { FEATURES } from './config/appReview';

function App() {
  return (
    <LanguageProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/campaigns" element={<CampaignList />} />
          {FEATURES.SHOW_CREATIVES && <Route path="/creatives" element={<Creatives />} />}
          {FEATURES.SHOW_ROI_ANALYTICS && <Route path="/roi" element={<ROI />} />}
          {/* ... остальные routes */}
        </Routes>
      </Router>
    </LanguageProvider>
  );
}
```

#### 1.4. Добавить Confirmation Dialogs

**В файлах:**
- `services/frontend/src/pages/CampaignDetail.tsx`
- `services/frontend/src/pages/CampaignList.tsx`
- `services/frontend/src/components/VideoUpload.tsx`

**Пример:**

```typescript
import { useTranslation } from '../i18n/LanguageContext';

const { t } = useTranslation();

const handleToggleStatus = (checked: boolean) => {
  const confirmMsg = checked 
    ? t('msg.confirmResume')
    : t('msg.confirmPause');
  
  const confirmed = window.confirm(confirmMsg);
  
  if (confirmed) {
    toggleCampaignStatus(id, checked);
  }
};
```

#### 1.5. Скрыть UI элементы

**В AppSidebar.tsx:**

```typescript
import { FEATURES } from '../config/appReview';

const menuItems = [
  { path: '/', label: 'menu.dashboard', icon: Home, show: true },
  { path: '/campaigns', label: 'menu.campaigns', icon: TrendingUp, show: true },
  { path: '/creatives', label: 'menu.creatives', icon: Image, show: FEATURES.SHOW_CREATIVES },
  { path: '/roi', label: 'menu.roi', icon: BarChart, show: FEATURES.SHOW_ROI_ANALYTICS },
  // ...
];

const visibleMenuItems = menuItems.filter(item => item.show);
```

**В Dashboard.tsx, Profile.tsx:**

```typescript
import { FEATURES } from '../config/appReview';

{FEATURES.SHOW_AI_AUTOPILOT && (
  <Card>
    {/* AI Autopilot content */}
  </Card>
)}

{FEATURES.SHOW_TIKTOK && (
  <Button>Connect TikTok</Button>
)}
```

---

### **ФАЗА 2: ЛОКАЛЬНОЕ ТЕСТИРОВАНИЕ** ⏱️ 30 мин

```bash
cd services/frontend

# Тест 1: Production версия
cp env.production.example .env.local
npm run dev
# Открыть http://localhost:5173
# Проверить: все функции видны, русский язык

# Тест 2: App Review версия
cp env.appreview.example .env.local
npm run dev
# Открыть http://localhost:5173
# Проверить:
# - Английский язык по умолчанию
# - Скрыты: TikTok, Креативы, ROI, Консультации, AI Autopilot
# - Есть confirmation dialogs для всех действий
# - Видны только: Dashboard, Campaigns, Profile
```

**✅ КРИТЕРИЙ ГОТОВНОСТИ ФАЗЫ 2:**
- App Review версия работает локально
- Все UI элементы правильно скрыты/показаны
- Confirmation dialogs работают
- Английский язык по умолчанию

---

### **ФАЗА 3: ПОДГОТОВКА СЕРВЕРА (БЕЗ РИСКА)** ⏱️ 15 мин

#### 3.1. Настроить DNS

В панели управления доменом:
```
A-запись: app.performanteaiagency.com → IP_СЕРВЕРА
```

#### 3.2. Получить SSL сертификат

```bash
# На сервере
sudo systemctl stop nginx  # Временно останавливаем nginx

# Получаем сертификат
sudo certbot certonly --standalone \
  -d app.performanteaiagency.com \
  --email bazzartomsk@gmail.com \
  --agree-tos \
  --non-interactive

# Запускаем nginx обратно
sudo systemctl start nginx

# Проверяем сертификат
sudo certbot certificates | grep app.performanteaiagency.com
```

---

### **ФАЗА 4: ДЕПЛОЙ APP REVIEW ВЕРСИИ (БЕЗОПАСНО)** ⏱️ 20 мин

#### 4.1. Обновить Dockerfile (НЕ СЛОМАЕТ PRODUCTION!)

**Файл:** `services/frontend/Dockerfile`

**ИЗМЕНИТЬ ТОЛЬКО ПЕРВУЮ ЧАСТЬ:**

```dockerfile
# Этап 1: Сборка приложения
FROM node:20-alpine AS builder

# Аргумент для определения режима сборки
ARG BUILD_MODE=production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Копируем правильный .env файл
RUN if [ "$BUILD_MODE" = "appreview" ]; then \
      echo "Building App Review version..." && \
      cp env.appreview.example .env; \
    else \
      echo "Building Production version..." && \
      cp env.production.example .env 2>/dev/null || echo "Using defaults"; \
    fi

RUN npm run build

# Этап 2: Production образ (НЕ ТРОГАЕМ!)
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### 4.2. Добавить App Review сервис в docker-compose.yml

**ДОБАВИТЬ после существующего `frontend:` (НЕ УДАЛЯТЬ СУЩЕСТВУЮЩИЙ!):**

```yaml
services:
  # ... все существующие сервисы ...

  # СУЩЕСТВУЮЩИЙ - НЕ ТРОГАЕМ!
  frontend:
    build: ./services/frontend
    environment:
      - NODE_ENV=production
    ports:
      - "3001:80"
    restart: unless-stopped
    depends_on:
      - agent-service

  # НОВЫЙ - для App Review
  frontend-appreview:
    build:
      context: ./services/frontend
      args:
        - BUILD_MODE=appreview
    environment:
      - NODE_ENV=production
    ports:
      - "3002:80"
    restart: unless-stopped
    depends_on:
      - agent-service
```

#### 4.3. Деплой на сервер

```bash
cd ~/agents-monorepo
git pull origin main

# Собираем ТОЛЬКО App Review версию (production не трогаем!)
docker-compose up -d --build frontend-appreview

# Проверяем
docker-compose ps
curl -I http://localhost:3002
```

---

### **ФАЗА 5: НАСТРОЙКА NGINX (ФИНАЛ)** ⏱️ 10 мин

#### 5.1. Добавить блок для app.performanteaiagency.com

**В файл `nginx-production.conf` ДОБАВИТЬ (не удалять существующее!):**

```nginx
# ==============================================
# PRODUCTION FRONTEND (Поддомен)
# app.performanteaiagency.com → Полная версия
# ==============================================

server {
    listen 80;
    listen [::]:80;
    server_name app.performanteaiagency.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name app.performanteaiagency.com;
    
    ssl_certificate /etc/letsencrypt/live/app.performanteaiagency.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.performanteaiagency.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Безопасность
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # API запросы
    location /api/ {
        rewrite ^/api/(.*)$ /$1 break;
        proxy_pass http://agent-service:8082;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
    }
    
    # Analyzer API
    location /api/analyzer/ {
        rewrite ^/api/analyzer/(.*)$ /$1 break;
        proxy_pass http://creative-analyzer:7081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
    }
    
    # Frontend приложение (используем тот же frontend:3001)
    location / {
        proxy_pass http://frontend:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 5.2. Обновить существующий блок для performanteaiagency.com

**НАЙТИ блок с `server_name performanteaiagency.com` и ИЗМЕНИТЬ ТОЛЬКО location /:**

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name performanteaiagency.com www.performanteaiagency.com;
    
    # ... все существующие настройки SSL не трогаем ...
    
    # ... все location /api/ не трогаем ...
    
    # Frontend приложение - МЕНЯЕМ НА App Review версию
    location / {
        proxy_pass http://frontend-appreview:80;  # ← ИЗМЕНИЛИ С frontend:80
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 5.3. Применить изменения

```bash
# Перезапустить nginx в Docker
docker-compose restart nginx

# Проверить
curl -I https://performanteaiagency.com
curl -I https://app.performanteaiagency.com
```

---

## ✅ ФИНАЛЬНАЯ ПРОВЕРКА

После всех изменений:

1. **App Review версия** (`performanteaiagency.com`):
   - [ ] Открывается
   - [ ] Английский язык по умолчанию
   - [ ] Скрыты: TikTok, Креативы, ROI, Консультации
   - [ ] Есть confirmation dialogs
   - [ ] Видны: Dashboard, Campaigns, Profile

2. **Production версия** (`app.performanteaiagency.com`):
   - [ ] Открывается
   - [ ] Русский язык по умолчанию
   - [ ] Все функции видны
   - [ ] OAuth работает с новым redirect URI

3. **Backend работает** для обеих версий:
   - [ ] API доступен с обоих доменов
   - [ ] Кампании создаются
   - [ ] Facebook OAuth работает

---

## 🆘 ОТКАТ (ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК)

```bash
# На сервере
cd ~/agents-monorepo

# Остановить App Review версию
docker-compose stop frontend-appreview

# Восстановить старый nginx конфиг (если нужно)
git checkout nginx-production.conf
docker-compose restart nginx

# Проверить, что production работает
curl -I https://performanteaiagency.com
```

---

## 📝 ЧЕКЛИСТ ДЛЯ ДРУГОГО АГЕНТА

- [ ] Фаза 1: Создать все файлы (`appReview.ts`, `translations.ts`, `LanguageContext.tsx`)
- [ ] Фаза 1: Обновить `App.tsx`, `AppSidebar.tsx`, `Dashboard.tsx`, `Profile.tsx`
- [ ] Фаза 1: Добавить confirmation dialogs в `CampaignDetail.tsx`, `CampaignList.tsx`, `VideoUpload.tsx`
- [ ] Фаза 2: Протестировать локально (оба режима)
- [ ] Фаза 3: Настроить DNS и получить SSL
- [ ] Фаза 4: Обновить `Dockerfile` и `docker-compose.yml`
- [ ] Фаза 4: Деплой `frontend-appreview` на сервер
- [ ] Фаза 5: Обновить `nginx-production.conf`
- [ ] Фаза 5: Проверить оба домена

---

## 🎯 ИТОГОВАЯ СТРУКТУРА

```
Домены:
  performanteaiagency.com     → frontend-appreview:3002 (App Review)
  app.performanteaiagency.com → frontend:3001          (Production)

Docker контейнеры:
  frontend           (порт 3001) - Production версия
  frontend-appreview (порт 3002) - App Review версия
  agent-service      (порт 8082) - Backend (общий)
  nginx              (порты 80, 443) - Роутинг

Код:
  services/frontend/ - ОДИН исходный код
    ├── src/config/appReview.ts     - Feature flags
    ├── src/i18n/translations.ts    - Переводы
    ├── src/i18n/LanguageContext.tsx - i18n Context
    ├── env.production.example      - Env для production
    └── env.appreview.example       - Env для app review
```

**ВАЖНО:** Оба билда собираются из ОДНОГО кода, разница только в env переменных!

---

## 📚 ДОПОЛНИТЕЛЬНЫЕ РЕСУРСЫ

- `SCREENCAST_SCENARIOS.md` - сценарии для записи видео
- `APP_REVIEW_TEXTS.md` - тексты для формы App Review
- `FACEBOOK_APP_REVIEW_STATUS.md` - общий статус проекта

**УДАЧИ!** 🚀

