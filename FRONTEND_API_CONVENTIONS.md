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
- ✅ `services/frontend/src/services/creativesApi.ts`
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

**Следуй этим правилам и проблема `/api/api/` никогда не возникнет!** 🎯

