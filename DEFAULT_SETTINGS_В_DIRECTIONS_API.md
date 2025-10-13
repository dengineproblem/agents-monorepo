# ✅ Дефолтные настройки теперь создаются вместе с направлением

## Проблема

Фронтенд жаловался, что нужно делать **два отдельных запроса**:
1. `POST /api/directions` → создать направление
2. `POST /api/default-settings` → создать настройки для направления

Это неудобно и замедляет процесс.

---

## Решение

Теперь `POST /api/directions` принимает **опциональное** поле `default_settings` и создаёт настройки автоматически!

---

## API изменения

### ✅ Что было (старый способ):

```javascript
// Шаг 1: создать направление
const directionResponse = await fetch('/api/directions', {
  method: 'POST',
  body: JSON.stringify({
    userAccountId: "...",
    name: "Имплантация",
    objective: "whatsapp",
    daily_budget_cents: 5000,
    target_cpl_cents: 200
  })
});
const { direction } = await directionResponse.json();

// Шаг 2: создать дефолтные настройки
await fetch('/api/default-settings', {
  method: 'POST',
  body: JSON.stringify({
    direction_id: direction.id,
    campaign_goal: "whatsapp",
    cities: ["Москва"],
    age_min: 25,
    age_max: 55,
    // ...
  })
});
```

### 🎉 Что стало (новый способ):

```javascript
// Один запрос!
const response = await fetch('/api/directions', {
  method: 'POST',
  body: JSON.stringify({
    userAccountId: "...",
    name: "Имплантация",
    objective: "whatsapp",
    daily_budget_cents: 5000,
    target_cpl_cents: 200,
    
    // Опционально: дефолтные настройки
    default_settings: {
      cities: ["Москва"],
      age_min: 25,
      age_max: 55,
      gender: "all",
      description: "Имплантация под ключ",
      client_question: "Сколько это стоит?"
    }
  })
});

const { direction, default_settings } = await response.json();
// direction: { id, name, ... }
// default_settings: { id, direction_id, cities, age_min, ... } ← созданы!
```

---

## Response

### С default_settings:

```json
{
  "success": true,
  "direction": {
    "id": "uuid",
    "name": "Имплантация",
    "objective": "whatsapp",
    "fb_campaign_id": "123456",
    "campaign_status": "ACTIVE",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "is_active": true,
    "created_at": "...",
    "updated_at": "..."
  },
  "default_settings": {
    "id": "uuid-settings",
    "direction_id": "uuid",
    "campaign_goal": "whatsapp",
    "cities": ["Москва"],
    "age_min": 25,
    "age_max": 55,
    "gender": "all",
    "description": "Имплантация под ключ",
    "client_question": "Сколько это стоит?",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Без default_settings (backward compatibility):

```json
{
  "success": true,
  "direction": { ... },
  "default_settings": null  ← настройки НЕ созданы
}
```

---

## Преимущества

✅ **Один запрос вместо двух** → быстрее, удобнее для фронтенда
✅ **Атомарная операция** → либо создаётся всё, либо ничего (нет "полусозданных" состояний)
✅ **Полная обратная совместимость** → старый код (без `default_settings`) продолжает работать
✅ **Улучшенный UX** → пользователь заполняет всё в одной форме

---

## Что изменилось в коде

### 1. `services/agent-service/src/routes/directions.ts`

- `CreateDirectionSchema` теперь включает `default_settings?: { ... }`
- `POST /api/directions` после создания направления проверяет `input.default_settings`
- Если передано → создаёт запись в `default_ad_settings`
- Response включает `default_settings: { ... }` или `default_settings: null`

### 2. `services/agent-service/src/lib/campaignBuilder.ts`

- Исправлена ошибка: `direction_id` теперь корректно извлекается из `input`

### 3. Документация

- **DIRECTIONS_FRONTEND_SPEC.md** обновлена с примерами нового API
- **DIRECTIONS_CREATE_WITH_SETTINGS_EXAMPLE.md** создана (готовые примеры для фронтенда)

---

## Тестирование

✅ **Создание С default_settings:**
```bash
curl -X POST http://localhost:8082/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "...",
    "name": "Тест с настройками",
    "objective": "whatsapp",
    "daily_budget_cents": 7000,
    "target_cpl_cents": 250,
    "default_settings": {
      "cities": ["Москва", "Санкт-Петербург"],
      "age_min": 25,
      "age_max": 55,
      "gender": "all",
      "description": "Тестовое описание",
      "client_question": "Сколько это стоит?"
    }
  }'

# Response:
# {
#   "success": true,
#   "direction": { ... },
#   "default_settings": { ... }  ← настройки созданы!
# }
```

✅ **Создание БЕЗ default_settings (backward compatibility):**
```bash
curl -X POST http://localhost:8082/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "...",
    "name": "Тест без настроек",
    "objective": "instagram_traffic",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200
  }'

# Response:
# {
#   "success": true,
#   "direction": { ... },
#   "default_settings": null  ← настройки НЕ созданы (как и раньше)
# }
```

---

## Что делать фронтенду

### Рекомендация:

Используй **расширенную форму** создания направления, где пользователь заполняет:

1. **Основные параметры:**
   - Название направления
   - Тип кампании (objective)
   - Суточный бюджет
   - Целевой CPL

2. **Дефолтные настройки рекламы (в той же форме!):**
   - Города
   - Возраст (от/до)
   - Пол
   - Описание
   - Специфичные поля (в зависимости от objective)

**Пример UI:**
```
┌──────────────────────────────────────┐
│  Создать направление            [×]  │
├──────────────────────────────────────┤
│ Название: [Имплантация          ]    │
│ Тип: ◉ WhatsApp ○ Instagram ○ Site  │
│ Бюджет: [$50/день]  CPL: [$2.00]    │
│                                      │
│ ═══ Настройки рекламы ═══           │
│ Города: [Москва, СПб            ]   │
│ Возраст: от [25] до [55]            │
│ Пол: ◉ Все ○ М ○ Ж                 │
│ Описание: [Имплантация под ключ ]   │
│ Вопрос клиента: [Сколько стоит? ]   │
│                                      │
│         [Отмена]  [Создать]          │
└──────────────────────────────────────┘
```

При клике на "Создать" → один запрос `POST /api/directions` с `default_settings`.

---

## Деплой

### Локально:
✅ Уже протестировано и работает

### На сервере:
```bash
# 1. Зайди на сервер
ssh root@147.182.186.15

# 2. Перейди в проект
cd ~/agents-monorepo

# 3. Pull изменений
git pull origin main

# 4. Пересобери agent-service
docker-compose build agent-service

# 5. Перезапусти
docker-compose up -d agent-service

# 6. Проверь логи
docker logs -f agents-monorepo-agent-service-1
```

---

## Статус

✅ **API реализовано**
✅ **Протестировано локально**
✅ **Документация обновлена**
✅ **Закоммичено в Git**
⏳ **Ждёт деплоя на сервер**
⏳ **Ждёт интеграции фронтенда**

---

🎉 **Готово!** Теперь фронтенд может создавать направления и дефолтные настройки одним запросом!

