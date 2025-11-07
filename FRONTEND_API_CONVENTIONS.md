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
- ✅ `services/frontend/src/services/creativesApi.ts` (строки 193-197)

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
- ✅ `services/frontend/src/services/creativesApi.ts` ⭐️ **ИСПРАВЛЕНО** - теперь использует `API_BASE_URL`
- ✅ `services/frontend/src/services/creativeAnalyticsApi.ts`
- ✅ `services/frontend/src/services/tiktokApi.ts`
- ✅ `services/frontend/src/services/facebookApi.ts`

### Компоненты (проверь если используют API напрямую):
- ✅ `services/frontend/src/components/DirectionAdSets.tsx`
- ✅ `services/frontend/src/components/VideoUpload.tsx`
- ✅ `services/frontend/src/components/Header.tsx`
- ✅ `services/frontend/src/components/FacebookConnect.tsx`
- ✅ `services/frontend/src/pages/Creatives.tsx`

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

