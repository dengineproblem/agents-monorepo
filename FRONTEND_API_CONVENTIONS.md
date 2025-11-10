# 🔧 Frontend API Conventions - Правила работы с API

**Дата создания**: 2025-11-06  
**Статус**: ✅ Обязательно к применению  

---

## ❌ ПРОБЛЕМА: Дублирование `/api/api/`

### Что происходит:
При добавлении новых API сервисов постоянно возникает ошибка **двойного `/api/api/`** в URL.

**Пример ошибки**:
```
GET http://localhost:8082/api/api/directions  ❌
```

### Почему это происходит:
Несогласованность между двумя местами:
1. **`API_BASE_URL`** содержит `/api` в конце
2. **API сервисы** добавляют `/api/` в начале пути

---

## ✅ РЕШЕНИЕ: Единый стандарт

### 📐 ПРАВИЛО #1: API_BASE_URL содержит `/api`

**`API_BASE_URL`** — это полный базовый URL до API endpoints (включая `/api`).

```typescript
// ✅ ПРАВИЛЬНО
API_BASE_URL = "http://localhost:8082/api"           // Локально
API_BASE_URL = "https://app.performanteaiagency.com/api"  // Production
```

```typescript
// ❌ НЕПРАВИЛЬНО  
API_BASE_URL = "http://localhost:8082"               // БЕЗ /api
API_BASE_URL = "http://localhost:8082/api/"          // С / в конце
```

---

### 📐 ПРАВИЛО #2: API сервисы НЕ добавляют `/api`

В API сервисах **НЕ добавляем** `/api/` к путям — он уже есть в `API_BASE_URL`.

```typescript
// ✅ ПРАВИЛЬНО
fetch(`${API_BASE_URL}/directions`)              // → /api/directions
fetch(`${API_BASE_URL}/whatsapp-numbers`)        // → /api/whatsapp-numbers  
fetch(`${API_BASE_URL}/creatives/upload`)        // → /api/creatives/upload
```

```typescript
// ❌ НЕПРАВИЛЬНО
fetch(`${API_BASE_URL}/api/directions`)          // → /api/api/directions ❌
fetch(`${API_BASE_URL}/api/whatsapp-numbers`)    // → /api/api/whatsapp-numbers ❌
```

---

### 📐 ПРАВИЛО #3: Настройка переменных окружения

#### Для локальной разработки (`.env.local`):
```bash
VITE_API_BASE_URL=http://localhost:8082/api
```

#### Для production (Docker Dockerfile):
```bash
# App Review
VITE_API_BASE_URL=https://performanteaiagency.com/api

# Production
VITE_API_BASE_URL=https://app.performanteaiagency.com/api
```

---

### 📐 ПРАВИЛО #4: Конфигурация в `config/api.ts`

```typescript
// ✅ ПРАВИЛЬНО
export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : (import.meta.env.DEV 
        ? 'http://localhost:8082/api'      // DEV с /api
        : 'https://app.performanteaiagency.com/api');  // PROD с /api
```

---

## 📋 ЧЕКЛИСТ при добавлении нового API

При создании нового API сервиса (`services/newApi.ts`):

- [ ] **Импортировать** `API_BASE_URL` из `@/config/api`
- [ ] **НЕ добавлять** `/api/` в начало путей
- [ ] **Использовать** `${API_BASE_URL}/endpoint` (без `/api/`)
- [ ] **Проверить** в консоли браузера что URL правильный
- [ ] **Протестировать** локально на `http://localhost:8084`

---

## 📝 ШАБЛОН для нового API сервиса

```typescript
// ✅ ПРАВИЛЬНЫЙ ШАБЛОН
import { API_BASE_URL } from '@/config/api';

export const myNewApi = {
  async getSomething(id: string) {
    // ✅ Без /api/ в пути
    const response = await fetch(`${API_BASE_URL}/my-endpoint?id=${id}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch');
    }
    
    return response.json();
  },
  
  async createSomething(data: any) {
    // ✅ Без /api/ в пути
    const response = await fetch(`${API_BASE_URL}/my-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error('Failed to create');
    }
    
    return response.json();
  }
};
```

---

## 🧪 КАК ТЕСТИРОВАТЬ

### 1. Локальная разработка

```bash
# 1. Создай .env.local
cd services/frontend
echo "VITE_API_BASE_URL=http://localhost:8082/api" > .env.local

# 2. Запусти Vite dev server
npm run dev

# 3. Открой http://localhost:5173 (или другой порт)

# 4. Проверь в консоли браузера:
# - Должно быть: GET http://localhost:8082/api/directions ✅
# - НЕ должно быть: GET http://localhost:8082/api/api/directions ❌
```

### 2. Production (Docker)

```bash
# Пересобрать контейнер
docker-compose build frontend
docker-compose up -d frontend

# Проверить логи
docker logs agents-monorepo-frontend-1

# Открыть http://localhost:3001
```

---

## 🔍 ОТЛАДКА проблем

### Проблема: Двойной `/api/api/`

**Симптом**: В консоли видишь `GET .../api/api/...`

**Причина**: В коде API сервиса добавлен лишний `/api/`

**Решение**:
```typescript
// ❌ БЫЛО
fetch(`${API_BASE_URL}/api/directions`)

// ✅ СТАЛО  
fetch(`${API_BASE_URL}/directions`)
```

---

### Проблема: `Cannot read properties of undefined`

**Симптом**: Ошибка при вызове API

**Причина**: `API_BASE_URL` пустая строка или undefined

**Решение**:
1. Проверь `.env.local` файл
2. Перезапусти Vite dev server (`npm run dev`)
3. Очисти кэш: `rm -rf node_modules/.vite`

---

### Проблема: API работает в Docker, но не работает в Vite dev

**Причина**: Разные значения `VITE_API_BASE_URL`

**Решение**:
- Docker: использует Dockerfile (строка 22, 27, 32)
- Vite dev: использует `.env.local` файл

Убедись что оба содержат правильный URL **С `/api`**:
```
http://localhost:8082/api  ✅
```

---

## 📊 ТАБЛИЦА: Где что находится

| Окружение | Файл конфигурации | API_BASE_URL |
|-----------|------------------|--------------|
| **Vite Dev** | `.env.local` | `http://localhost:8082/api` |
| **Docker Local** | `Dockerfile` BUILD_MODE=production | `https://app.performanteaiagency.com/api` |
| **Production** | `Dockerfile` BUILD_MODE=production | `https://app.performanteaiagency.com/api` |
| **App Review** | `Dockerfile` BUILD_MODE=appreview | `https://performanteaiagency.com/api` |

---

## 🗑️ DEPRECATED: Устаревшие переменные окружения

**Дата**: 2025-11-07

Следующие переменные **больше не используются** и были заменены на `API_BASE_URL`:

| Переменная | Статус | Замена |
|------------|--------|--------|
| `VITE_PROCESS_IMAGE_URL` | ❌ **УДАЛЕНА** | `${API_BASE_URL}/process-image` |
| `VITE_N8N_CREATIVE_WEBHOOK_URL` | ❌ **УДАЛЕНА** | `${API_BASE_URL}/process-video` |
| `VITE_TIKTOK_PROXY_URL` | ✅ **АКТИВНА** | Внешний прокси, не наш API |

**Причина удаления:**
- Нарушали правила единого стандарта API_BASE_URL
- Содержали жестко зашитые URL с `/api/` в пути
- Создавали путаницу и дублирование `/api/api/`

**Что изменилось в коде:**

```typescript
// ❌ БЫЛО (неправильно)
const videoEndpoint = (import.meta as any).env?.VITE_N8N_CREATIVE_WEBHOOK_URL 
  || 'http://localhost:8082/api/process-video';

// ✅ СТАЛО (правильно)
import { API_BASE_URL } from '@/config/api';
const videoEndpoint = `${API_BASE_URL}/process-video`;
```

**Файлы где были изменения:**
- ✅ `services/frontend/src/services/creativesApi.ts` (строки 193-197) - коммит `a22a460`
- ✅ `services/frontend/src/services/salesApi.ts` (строка 51) - коммит `5c55aaf`
- ✅ `services/frontend/src/components/profile/WhatsAppNumbersCard.tsx` (строки 68, 94, 114, 145) - коммит `5c55aaf`

---

## ✅ СТАТУС: ПОЛНОСТЬЮ ИСПРАВЛЕНО

**Дата завершения**: 2025-11-07  

🎉 **ВСЕ файлы в проекте теперь следуют единым правилам API!**

**Что было сделано:**
1. ✅ Исправлен `creativesApi.ts` - удалены устаревшие переменные `VITE_PROCESS_IMAGE_URL` и `VITE_N8N_CREATIVE_WEBHOOK_URL`
2. ✅ Исправлен `salesApi.ts` - заменен relative URL на `API_BASE_URL`
3. ✅ Исправлен `WhatsAppNumbersCard.tsx` - все 4 relative URL заменены на `API_BASE_URL`
4. ✅ Обновлена документация с правилами и примерами

**Результат:**
- ❌ Больше нет дублирования `/api/api/`
- ❌ Больше нет жестко зашитых URL
- ❌ Больше нет относительных URL вида `/api/...`
- ✅ Все файлы используют `API_BASE_URL` из единого источника
- ✅ Правила работают одинаково в dev, production и app review режимах
- ✅ Проблема 404 на `agents.performanteaiagency.com/api/process-video` решена

**Проверено:**
```bash
# Проверка что нигде не осталось проблемных паттернов
grep -r "VITE_PROCESS_IMAGE_URL\|VITE_N8N_CREATIVE_WEBHOOK_URL" services/frontend/src
# ✅ Ничего не найдено

grep -r "fetch.*'/api/" services/frontend/src/services
# ✅ Ничего не найдено (кроме комментариев)

grep -r "API_BASE_URL.*\/api\/" services/frontend/src
# ✅ Только в creativeAnalyticsApi.ts (специальный случай /api/analyzer/)
```

---

## ✅ ФАЙЛЫ для проверки

При изменении API конвенций проверь эти файлы:

### Конфигурация:
- ✅ `services/frontend/src/config/api.ts`
- ✅ `services/frontend/Dockerfile` (строки 22, 27, 32)
- ✅ `services/frontend/.env.local` (создать вручную для dev)

### API Сервисы (проверь все):
- ✅ `services/frontend/src/services/directionsApi.ts`
- ✅ `services/frontend/src/services/whatsappApi.ts`
- ✅ `services/frontend/src/services/defaultSettingsApi.ts`
- ✅ `services/frontend/src/services/manualLaunchApi.ts`
- ✅ `services/frontend/src/services/creativesApi.ts` ⭐️ **ИСПРАВЛЕНО 2025-11-07** - теперь использует `API_BASE_URL`
- ✅ `services/frontend/src/services/salesApi.ts` ⭐️ **ИСПРАВЛЕНО 2025-11-07** - заменен relative URL на `API_BASE_URL`
- ✅ `services/frontend/src/services/creativeAnalyticsApi.ts`
- ✅ `services/frontend/src/services/tiktokApi.ts`
- ✅ `services/frontend/src/services/facebookApi.ts`

### Компоненты (проверь если используют API напрямую):
- ✅ `services/frontend/src/components/DirectionAdSets.tsx`
- ✅ `services/frontend/src/components/VideoUpload.tsx`
- ✅ `services/frontend/src/components/Header.tsx`
- ✅ `services/frontend/src/components/FacebookConnect.tsx`
- ✅ `services/frontend/src/components/profile/WhatsAppNumbersCard.tsx` ⭐️ **ИСПРАВЛЕНО 2025-11-07** - все 4 relative URL заменены на `API_BASE_URL`
- ✅ `services/frontend/src/pages/Creatives.tsx`
- ✅ `services/frontend/src/pages/Profile.tsx` ⭐️ **ИСПРАВЛЕНО 2025-11-08** - AmoCRM endpoints используют `API_BASE_URL`

---

## 🚀 БЫСТРЫЙ ФИКС при возникновении проблемы

```bash
# 1. Найти все места где используется /api/api/
grep -r "API_BASE_URL.*\/api\/" services/frontend/src

# 2. Исправить каждый файл
# Заменить: ${API_BASE_URL}/api/endpoint
# На:      ${API_BASE_URL}/endpoint

# 3. Проверить .env.local
cat services/frontend/.env.local
# Должно быть: VITE_API_BASE_URL=http://localhost:8082/api

# 4. Перезапустить Vite
cd services/frontend
rm -rf node_modules/.vite
npm run dev

# 5. Проверить в браузере
# Консоль → Network → должно быть /api/endpoint (без дублирования)
```

---

## 📞 ИТОГО: Золотое правило

> **API_BASE_URL ВСЕГДА содержит `/api` в конце**  
> **API сервисы НИКОГДА не добавляют `/api/` в начале пути**

```typescript
// ✅ ВСЕГДА ТАК:
const url = `${API_BASE_URL}/directions`;  
// Результат: http://localhost:8082/api/directions ✅

// ❌ НИКОГДА ТАК:
const url = `${API_BASE_URL}/api/directions`;
// Результат: http://localhost:8082/api/api/directions ❌
```

---

## 🔧 BACKEND: Регистрация роутов в server.ts

### ⚠️ ВАЖНОЕ ПРАВИЛО: НЕ добавляйте `prefix: '/api'`

**Причина**: Nginx убирает `/api` перед проксированием в agent-service.

**nginx-production.conf**:
```nginx
location /api/ {
    # Убираем /api из пути при проксировании
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://agent-service:8082;
}
```

**Что происходит**:
1. Клиент запрашивает: `GET /api/directions`
2. Nginx перенаправляет: `GET /directions` (убрал `/api`)
3. Agent-service ищет роут: `/directions`

### ✅ ПРАВИЛЬНАЯ регистрация роутов

```typescript
// ✅ ПРАВИЛЬНО - БЕЗ prefix: '/api'
app.register(directionsRoutes);              // Роут: /directions
app.register(whatsappNumbersRoutes);         // Роут: /whatsapp-numbers
app.register(defaultSettingsRoutes);         // Роут: /default-settings

// ✅ ПРАВИЛЬНО - с кастомным префиксом (не /api)
app.register(campaignBuilderRoutes, { prefix: '/campaign-builder' });
```

### ❌ НЕПРАВИЛЬНАЯ регистрация роутов

```typescript
// ❌ НЕПРАВИЛЬНО - с prefix: '/api'
app.register(directionsRoutes, { prefix: '/api' });
// Результат: роут = /api/directions
// Nginx отправит: GET /directions  
// Agent-service ищет: /api/directions → 404 NOT FOUND ❌
```

### 📝 Пример в services/agent-service/src/server.ts

```typescript
// ВАЖНО: НЕ ДОБАВЛЯЙТЕ prefix: '/api' - nginx убирает /api перед проксированием!
// См. nginx-production.conf: rewrite ^/api/(.*)$ /$1 break;

app.register(actionsRoutes);                   // ✅ /actions
app.register(videoRoutes);                     // ✅ /video  
app.register(imageRoutes);                     // ✅ /image
app.register(directionsRoutes);                // ✅ /directions
app.register(whatsappNumbersRoutes);           // ✅ /whatsapp-numbers
app.register(campaignBuilderRoutes, {          // ✅ /campaign-builder
  prefix: '/campaign-builder' 
});

// Исключения: роуты без /api префикса в nginx
app.register(facebookWebhooks);                // /webhooks/facebook
app.register(amocrmOAuthRoutes);               // /amocrm/auth, /amocrm/callback
app.register(amocrmWebhooksRoutes);            // /webhooks/amocrm
app.register(amocrmPipelinesRoutes);           // /amocrm/pipelines
app.register(amocrmManagementRoutes);          // /amocrm/webhook-status, /amocrm/sync-leads
```

### 🔍 КАК ПРОВЕРИТЬ backend роуты

```bash
# 1. Проверить что роут зарегистрирован БЕЗ /api
docker exec agents-monorepo-agent-service-1 grep "app.get\|app.post" /app/dist/routes/directions.js | head -5

# Должно быть:
# app.get('/directions', ...)      ✅
# НЕ: app.get('/api/directions', ...)  ❌

# 2. Проверить регистрацию в server.ts
docker exec agents-monorepo-agent-service-1 grep "directionsRoutes" /app/dist/server.js

# Должно быть:
# app.register(directionsRoutes);              ✅
# НЕ: app.register(directionsRoutes, { prefix: '/api' });  ❌

# 3. Тест через прямой запрос к agent-service (минуя nginx)
curl http://localhost:8082/directions?userAccountId=xxx    # ✅ Должен работать
curl http://localhost:8082/api/directions?userAccountId=xxx  # ❌ Должен быть 404

# 4. Тест через nginx (production)
curl https://app.performanteaiagency.com/api/directions?userAccountId=xxx  # ✅
```

### 📋 ЧЕКЛИСТ при добавлении нового backend роута

- [ ] **НЕ добавлять** `prefix: '/api'` в `app.register()`
- [ ] **Определить** роут внутри файла БЕЗ `/api`: `app.get('/my-endpoint', ...)`
- [ ] **Зарегистрировать** в server.ts БЕЗ префикса: `app.register(myRoutes);`
- [ ] **Протестировать** напрямую: `curl http://localhost:8082/my-endpoint`
- [ ] **Протестировать** через nginx: `curl https://app.../api/my-endpoint`

---

## 📊 ПОЛНАЯ КАРТИНА: Frontend → Nginx → Backend

```
Frontend запрос:
  fetch(`${API_BASE_URL}/directions`)
  → GET https://app.performanteaiagency.com/api/directions

        ↓

Nginx (nginx-production.conf):
  location /api/ {
    rewrite ^/api/(.*)$ /$1 break;     ← Убирает /api
    proxy_pass http://agent-service:8082;
  }
  → GET http://agent-service:8082/directions

        ↓

Backend (server.ts):
  app.register(directionsRoutes);      ← БЕЗ prefix: '/api'

        ↓

Route handler (directions.ts):
  app.get('/directions', ...)          ← БЕЗ /api в пути
  → 200 OK ✅
```

### ✅ ЧТО РАБОТАЕТ

| Frontend | Nginx получает | Nginx отправляет в backend | Backend роут | Результат |
|----------|---------------|---------------------------|--------------|-----------|
| `/api/directions` | `/api/directions` | `/directions` | `/directions` | ✅ 200 OK |
| `/api/whatsapp-numbers` | `/api/whatsapp-numbers` | `/whatsapp-numbers` | `/whatsapp-numbers` | ✅ 200 OK |
| `/api/campaign-builder/...` | `/api/campaign-builder/...` | `/campaign-builder/...` | `/campaign-builder/...` | ✅ 200 OK |

### ❌ ЧТО НЕ РАБОТАЕТ

| Frontend | Nginx получает | Nginx отправляет в backend | Backend роут | Результат |
|----------|---------------|---------------------------|--------------|-----------|
| `/api/directions` | `/api/directions` | `/directions` | `/api/directions` | ❌ 404 NOT FOUND |
| `/api/api/directions` | `/api/api/directions` | `/api/directions` | `/directions` | ❌ 404 NOT FOUND |

---

**Следуй этим правилам и проблема `/api/api/` или 404 роутов никогда не возникнет!** 🎯

---

## 📱 CRM & CHATBOT API

WhatsApp CRM использует отдельные API endpoints с собственными префиксами.

### **Переменные окружения для CRM Frontend**

CRM Frontend НЕ использует `API_BASE_URL` из основного frontend. Вместо этого использует прямые пути через Vite proxy.

#### Локальная разработка (`.env` в `services/crm-frontend/`)

```bash
VITE_CRM_BACKEND_URL=http://localhost:8084
VITE_CHATBOT_API_URL=http://localhost:8083
```

**⚠️ ВАЖНО:** Эти переменные НЕ используются напрямую в коде - они для справки. В коде используются прямые пути `/api/crm` и `/api/chatbot`, которые проксируются через Vite.

#### Production

В production переменные окружения не нужны - запросы идут через общий nginx:
- `/api/crm/*` → crm-backend:8084
- `/api/chatbot/*` → chatbot-service:8083

### **Vite Proxy конфигурация**

Файл: `services/crm-frontend/vite.config.ts`

```typescript
export default defineConfig({
  server: {
    host: "::",
    port: 5174,
    proxy: {
      // CRM Backend API
      '/api/crm': {
        target: 'http://localhost:8084',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/crm/, ''),
      },
      // Chatbot Service API
      '/api/chatbot': {
        target: 'http://localhost:8083',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/chatbot/, ''),
      },
    },
  },
});
```

### **Правила для CRM API сервисов**

#### ✅ ПРАВИЛЬНО

```typescript
// services/crm-frontend/src/services/dialogAnalysisService.ts

const CRM_API_BASE = '/api/crm';  // ✅ Без домена, только путь

export async function getDialogStats(userAccountId: string) {
  const response = await fetch(
    `${CRM_API_BASE}/dialogs/stats?userAccountId=${userAccountId}`
  );
  return response.json();
}
```

```typescript
// services/crm-frontend/src/services/chatbotApi.ts

const CHATBOT_API_BASE = '/api/chatbot';  // ✅ Без домена, только путь

export async function getChatbotStats(userId: string) {
  const response = await fetch(`${CHATBOT_API_BASE}/stats?userId=${userId}`);
  return response.json();
}
```

#### ❌ НЕПРАВИЛЬНО

```typescript
// ❌ НЕ добавляй домен - proxy не сработает
const CRM_API_BASE = 'http://localhost:8084/api/crm';

// ❌ НЕ добавляй двойной /api/
fetch(`${CRM_API_BASE}/api/dialogs/stats`);  // → /api/crm/api/dialogs/stats

// ❌ НЕ используй относительные пути без префикса
fetch('/dialogs/stats');  // → не попадет в proxy
```

### **Nginx конфигурация для CRM (production)**

Файл: `nginx-production.conf`

```nginx
# CRM Backend API (должен быть ПЕРЕД общим /api/)
location /api/crm/ {
    # Убираем /api/crm из пути при проксировании
    rewrite ^/api/crm/(.*)$ /$1 break;
    proxy_pass http://crm-backend:8084;
    proxy_http_version 1.1;
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Таймауты для длительных операций (dialog analysis может занять время)
    proxy_read_timeout 600s;
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
}

# Chatbot Service API (должен быть ПЕРЕД общим /api/)
location /api/chatbot/ {
    # Убираем /api/chatbot из пути при проксировании
    rewrite ^/api/chatbot/(.*)$ /$1 break;
    proxy_pass http://chatbot-service:8083;
    proxy_http_version 1.1;
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Таймауты для длительных операций
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
}

# CRM Frontend (статика)
location /crm/ {
    proxy_pass http://crm-frontend:80/;
    proxy_http_version 1.1;
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**⚠️ ВАЖНО:** Блоки `/api/crm/` и `/api/chatbot/` должны быть ПЕРЕД общим блоком `/api/`, иначе они не сработают (nginx использует первое совпадение).

### **Backend: Регистрация роутов**

#### CRM Backend (`services/crm-backend/src/server.ts`)

```typescript
// ✅ ПРАВИЛЬНО - БЕЗ prefix
app.register(dialogsRoutes);  // Роуты: /dialogs/*

// Nginx убирает /api/crm, поэтому backend получает /dialogs/stats
```

#### Chatbot Service (`services/chatbot-service/src/server.ts`)

```typescript
// ✅ ПРАВИЛЬНО - БЕЗ prefix
app.register(statsRoutes);          // /stats
app.register(configurationRoutes);  // /configuration/*
app.register(triggersRoutes);       // /triggers/*
app.register(reactivationRoutes);   // /reactivation/*

// Nginx убирает /api/chatbot, поэтому backend получает /stats, /triggers/*, etc.
```

### **Полная картина: Frontend → Nginx → Backend**

#### CRM Backend

```
Frontend:
  fetch('/api/crm/dialogs/stats?userAccountId=xxx')

        ↓ (dev: Vite proxy)

Vite dev server:
  proxy: { '/api/crm': { target: 'http://localhost:8084', rewrite: ... } }
  → GET http://localhost:8084/dialogs/stats

        ↓ (production: Nginx)

Nginx:
  location /api/crm/ { rewrite ^/api/crm/(.*)$ /$1 break; ... }
  → GET http://crm-backend:8084/dialogs/stats

        ↓

Backend (server.ts):
  app.register(dialogsRoutes);  // БЕЗ prefix

        ↓

Route handler (dialogs.ts):
  app.get('/dialogs/stats', ...)  // БЕЗ /api/crm
  → 200 OK ✅
```

#### Chatbot Service

```
Frontend:
  fetch('/api/chatbot/configuration/user123')

        ↓ (dev: Vite proxy)

Vite dev server:
  proxy: { '/api/chatbot': { target: 'http://localhost:8083', rewrite: ... } }
  → GET http://localhost:8083/configuration/user123

        ↓ (production: Nginx)

Nginx:
  location /api/chatbot/ { rewrite ^/api/chatbot/(.*)$ /$1 break; ... }
  → GET http://chatbot-service:8083/configuration/user123

        ↓

Backend (server.ts):
  app.register(configurationRoutes);  // БЕЗ prefix

        ↓

Route handler:
  app.get('/configuration/:userId', ...)  // БЕЗ /api/chatbot
  → 200 OK ✅
```

### **Таблица портов CRM**

| Сервис | Локальная разработка | Production (Docker) |
|--------|---------------------|---------------------|
| crm-backend | 8084 | 8084 |
| crm-frontend | 5174 (Vite) | 3003 (nginx) |
| chatbot-service | 8083 | 8083 |

### **Чеклист при добавлении CRM API endpoint**

- [ ] **Frontend:** Использовать `/api/crm/*` или `/api/chatbot/*` (без домена)
- [ ] **Backend:** Определить роут БЕЗ `/api/crm` или `/api/chatbot`
- [ ] **Backend:** НЕ добавлять prefix при регистрации роута
- [ ] **Vite:** Проверить proxy в `vite.config.ts`
- [ ] **Nginx:** Проверить что блоки `/api/crm/` и `/api/chatbot/` ПЕРЕД `/api/`
- [ ] **Протестировать локально:** `curl http://localhost:8084/dialogs/stats` (напрямую)
- [ ] **Протестировать через Vite:** `curl http://localhost:5174/api/crm/dialogs/stats`

### **Пример: Добавление нового endpoint**

Допустим, нужно добавить endpoint для получения истории изменений лида.

#### 1. Backend (crm-backend)

```typescript
// services/crm-backend/src/routes/dialogs.ts

// ✅ ПРАВИЛЬНО - роут БЕЗ /api/crm
app.get('/dialogs/leads/:id/history', async (request, reply) => {
  const { id } = request.params;
  // ... логика
  return { history: [...] };
});
```

#### 2. Frontend (crm-frontend)

```typescript
// services/crm-frontend/src/services/dialogAnalysisService.ts

const CRM_API_BASE = '/api/crm';

export async function getLeadHistory(leadId: string) {
  // ✅ ПРАВИЛЬНО - путь с /api/crm
  const response = await fetch(`${CRM_API_BASE}/dialogs/leads/${leadId}/history`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch lead history');
  }
  
  return response.json();
}
```

#### 3. Проверка

```bash
# Локально (прямо в backend)
curl http://localhost:8084/dialogs/leads/123/history
# → 200 OK ✅

# Через Vite proxy
curl http://localhost:5174/api/crm/dialogs/leads/123/history
# → 200 OK ✅

# Production (через nginx)
curl https://app.performanteaiagency.com/api/crm/dialogs/leads/123/history
# → 200 OK ✅
```

---

**CRM & Chatbot API следуют тем же правилам, что и основной API, но с отдельными префиксами `/api/crm` и `/api/chatbot`.** 🎯

