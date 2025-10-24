# ✅ Исправление proxy для Analyzer API

## Проблема

**Симптомы**: На production креативы, промежуточные и законченные тесты, LLM анализ отображаются корректно. На локальном фронтенде (localhost:8081) - не отображаются.

**Причина**: Frontend делает запросы к `/api/analyzer/*` (аналитика креативов), но proxy в `vite.config.ts` перенаправлял **все** `/api/*` запросы на agent-service (порт 8082), хотя analyzer работает на порту **7081**.

---

## Решение

Добавлен **специфичный proxy для analyzer** перед общим proxy в `vite.config.ts`. В Vite более специфичные правила имеют приоритет.

### Изменения

**Файл**: `services/frontend/vite.config.ts`

**Было**:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:8082',
    changeOrigin: true,
  },
}
```

**Стало**:
```typescript
proxy: {
  // Специфичный proxy для analyzer (порт 7081)
  // Убираем /api/analyzer префикс, т.к. analyzerService ожидает запросы без префикса
  '/api/analyzer': {
    target: 'http://localhost:7081',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/analyzer/, ''),
  },
  // Общий proxy для остальных API (порт 8082)
  '/api': {
    target: 'http://localhost:8082',
    changeOrigin: true,
  },
}
```

**Ключевое изменение**: Добавлен `rewrite` для удаления префикса `/api/analyzer`, т.к.:
- На production nginx делает rewrite: `/api/analyzer/*` → `/*` перед проксированием на analyzer
- analyzerService ожидает запросы БЕЗ префикса (например, `/creative-analytics/:id`, а не `/api/analyzer/creative-analytics/:id`)
- Локально нужно имитировать это поведение nginx через Vite proxy

---

## Маршрутизация запросов

После исправления запросы маршрутизируются корректно:

| Путь | Порт | Сервис | Назначение |
|------|------|--------|------------|
| `/api/analyzer/*` | 7081 | analyzer | Аналитика креативов, тесты, LLM анализ |
| `/api/directions/*` | 8082 | agent-service | Направления бизнеса |
| `/api/campaign-builder/*` | 8082 | agent-service | Автозапуск кампаний |
| `/api/creative-test/*` | 8082 | agent-service | Быстрые тесты |
| `/api/agent/actions` | 8082 | agent-service | Brain Agent actions |
| Все остальные `/api/*` | 8082 | agent-service | Остальные API |

---

## Тестирование

### Проверка сервисов

```bash
# Analyzer работает
$ lsof -ti:7081
80658  ✅

# Agent-service работает
$ lsof -ti:8082
10539  ✅

# Frontend работает
$ lsof -ti:8081
39728  ✅
```

### Проверка proxy

```bash
# Запрос к analyzer через proxy
$ curl "http://localhost:8081/api/analyzer/creative-analytics/4ede49fb-f92b-4c6c-91ae-cb8f06d603af?user_id=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

# Ответ:
{
  "creative": {
    "id": "4ede49fb-f92b-4c6c-91ae-cb8f06d603af",
    "title": "Крео цм 2.mp4",
    "status": "ready",
    "direction_name": "Цифровой менеджер"
  },
  "data_source": "none",
  "message": "Тест запущен, накапливается статистика",
  "test": {
    "exists": true,
    "status": "running",
    "started_at": "2025-10-24T11:49:38.03+00:00",
    "metrics": {
      "impressions": 0,
      "reach": 0,
      "leads": 0,
      "spend_cents": 0
    }
  },
  "production": null,
  "analysis": null
}

✅ Работает! Получаем данные о креативе и тесте!
```

### Результат

- ✅ Proxy для `/api/analyzer/*` → порт 7081 (analyzer)
- ✅ Proxy для остальных `/api/*` → порт 8082 (agent-service)
- ✅ Frontend перезапущен с новой конфигурацией
- ✅ Запросы маршрутизируются корректно

---

## Проверка в UI

Теперь на странице креативов (http://localhost:8081) должны отображаться:

1. **Промежуточные тесты** - данные из `creative_tests` таблицы
2. **Production метрики** - реальные данные из Facebook API
3. **LLM анализ** - рекомендации от AI агента
4. **Статус тестов** - running/completed/cancelled

### Где проверить

1. Откройте: http://localhost:8081
2. Перейдите на страницу "Креативы"
3. Откройте любой креатив (Accordion)
4. Должны загрузиться:
   - Транскрипт видео
   - Метрики тестов (если были)
   - Production метрики (если запускались)
   - LLM анализ и рекомендации

### DevTools проверка

В Chrome DevTools → Network:
- Запрос: `GET /api/analyzer/creative-analytics/{id}?user_id={uid}`
- Status: **200 OK**
- Response: JSON с полями `data_source`, `test`, `production`, `analysis`

---

## Production конфигурация

На production не нужны изменения - там nginx маршрутизирует запросы:
- `location /api/analyzer` → analyzer:7081
- `location /api` → agent-service:8082

Изменения в `vite.config.ts` применяются **только в dev mode** (`npm run dev`).

В production используется:
- `npm run build` → статические файлы
- nginx → маршрутизация API запросов

---

## Решённая проблема

### Корневая причина

analyzer Service (`services/agent-brain/src/analyzerService.js`) определяет routes **БЕЗ префикса** `/api/analyzer`:

```javascript
// Строка 446 в analyzerService.js
fastify.get('/creative-analytics/:user_creative_id', async (request, reply) => {
  // ...
})
```

**Почему так?** Комментарий в коде (строка 213-214):
```javascript
// Health check (без префикса, т.к. nginx проксирует /api/analyzer/ -> /)
```

На **production**:
- nginx принимает: `/api/analyzer/creative-analytics/:id`
- nginx делает rewrite: → `/creative-analytics/:id`
- analyzer получает: `/creative-analytics/:id` ✅

На **localhost ДО исправления**:
- Vite proxy принимает: `/api/analyzer/creative-analytics/:id`
- Vite НЕ делал rewrite: → `/api/analyzer/creative-analytics/:id`
- analyzer получает: `/api/analyzer/creative-analytics/:id` ❌ (404 Not Found)

На **localhost ПОСЛЕ исправления**:
- Vite proxy принимает: `/api/analyzer/creative-analytics/:id`
- Vite делает rewrite: → `/creative-analytics/:id`
- analyzer получает: `/creative-analytics/:id` ✅

---

## Дата исправления

**24 октября 2025, 17:15 (UTC+5)**

Frontend теперь корректно получает аналитику креативов в dev режиме! 🎉

