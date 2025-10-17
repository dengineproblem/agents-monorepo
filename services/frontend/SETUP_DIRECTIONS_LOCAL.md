# Настройка Направлений для локальной разработки

## ✅ Уже сделано

1. ✅ Создан файл конфигурации `/src/config/api.ts`
2. ✅ API сервис обновлён для работы через бэкенд
3. ✅ По умолчанию используется **продакшн URL**: `https://agents.performanteaiagency.com`

---

## 🔧 Локальная разработка

### Если бэкенд запущен локально на порту 8082:

Создайте файл `.env.local` в корне проекта:

```bash
# .env.local
VITE_API_BASE_URL=http://localhost:8082
```

**⚠️ ВАЖНО:** Не коммитьте `.env.local` в Git! Он должен быть в `.gitignore`.

---

## 🚀 Продакшн

Ничего делать не нужно! По умолчанию используется:
```
https://agents.performanteaiagency.com
```

---

## 🧪 Проверка

### 1. Проверьте какой URL используется

Откройте консоль браузера (F12) и найдите:
```
[API Config] Base URL: https://agents.performanteaiagency.com
```

Или (если создали .env.local):
```
[API Config] Base URL: http://localhost:8082
```

### 2. Проверьте работу API

В консоли браузера должны быть логи:
```
[directionsApi.list] Запрос направлений для user_account_id: ...
[directionsApi.list] HTTP статус: 200
[directionsApi.list] Результат от API: { success: true, data: {...} }
[directionsApi.list] Найдено направлений: 1
```

---

## 🐛 Отладка

### Проблема: Направления не загружаются

1. **Проверьте консоль браузера:**
   - Есть ли ошибка сети (CORS, 404, 500)?
   - Какой HTTP статус возвращает API?

2. **Проверьте URL API:**
   ```javascript
   // В консоли браузера
   import { API_BASE_URL } from '@/config/api';
   console.log(API_BASE_URL);
   ```

3. **Проверьте доступность API напрямую:**
   ```bash
   # Локально
   curl "http://localhost:8082/api/directions?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
   
   # Продакшн
   curl "https://agents.performanteaiagency.com/api/directions?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
   ```

### Проблема: CORS ошибка

Если видите в консоли:
```
Access to fetch at 'http://localhost:8082/api/directions' from origin 'http://localhost:5173' 
has been blocked by CORS policy
```

**Решение:** Бэкенд должен разрешить CORS для фронтенд origin.

В Express это делается так:
```javascript
import cors from 'cors';

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174', 
    'https://your-frontend-domain.com'
  ]
}));
```

---

## 📋 Структура проекта

```
crmforall/
├── src/
│   ├── config/
│   │   └── api.ts              ← Конфигурация API URL
│   ├── services/
│   │   └── directionsApi.ts    ← API методы для направлений
│   ├── types/
│   │   └── direction.ts        ← TypeScript типы
│   └── components/
│       └── profile/
│           └── DirectionsCard.tsx
├── .env.local                   ← (создайте для локальной разработки)
└── .env.local.example          ← (пример конфигурации)
```

---

## ✅ Готово!

Теперь фронтенд работает через бэкенд API:

**Продакшн (по умолчанию):**
```
Frontend → https://agents.performanteaiagency.com/api/directions → Backend
```

**Локально (если создан .env.local):**
```
Frontend → http://localhost:8082/api/directions → Backend (локальный)
```

🚀 Всё работает!

