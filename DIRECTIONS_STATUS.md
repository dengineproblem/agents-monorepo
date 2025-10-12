# Статус интеграции "Направления" ✅ ❌

## ✅ ЧТО СДЕЛАНО

### **1. База данных (Supabase)**
- ✅ Миграция `008_account_directions.sql` — создание таблицы `account_directions`
- ✅ Миграция `009_add_objective_to_directions.sql` — добавление поля `objective`
- ✅ RLS политики настроены (service_role имеет полный доступ)
- ✅ Связь с `user_creatives` через `direction_id`

### **2. Backend API**
- ✅ `services/agent-service/src/routes/directions.ts` — 4 endpoint'а:
  - GET `/api/directions` — получить все направления
  - POST `/api/directions` — создать направление + Facebook Campaign
  - PATCH `/api/directions/:id` — обновить направление
  - DELETE `/api/directions/:id` — удалить направление
- ✅ Автоматическое создание Facebook Campaign при создании направления
- ✅ Название кампании: `[{name}] {objective_readable}` (например: `[Имплантация] WhatsApp`)
- ✅ Сервис зарегистрирован в `server.ts`

### **3. Инфраструктура**
- ✅ `nginx.conf` обновлён (порт 8082)
- ✅ Docker compose настроен

### **4. Документация для фронтенда**
- ✅ `DIRECTIONS_FRONTEND_SPEC.md` — полная спецификация UI
- ✅ `DIRECTIONS_FRONTEND_INTEGRATION.md` — готовый код для интеграции
- ✅ `DIRECTIONS_DEPLOY_CHECKLIST.md` — чеклист деплоя

### **5. Протестировано**
- ✅ API работает локально (http://localhost:8082)
- ✅ Создание направления → автоматически создаётся Facebook Campaign
- ✅ GET /api/directions возвращает корректные данные

---

## ❌ ЧТО НЕ СДЕЛАНО

### **1. Brain Agent (главный LLM агент) — НЕ ИНТЕГРИРОВАН!**

❌ Brain Agent **НЕ ЗНАЕТ** про направления!

**Что нужно:**
1. Добавить функцию `getUserDirections(userAccountId)` для получения активных направлений
2. Фильтровать креативы по `direction_id` (только креативы из активных направлений)
3. Обновить `llmInput`:
   ```javascript
   directions: [  // список направлений
     {
       id, name, objective, fb_campaign_id,
       daily_budget_cents, target_cpl_cents
     }
   ],
   campaigns: [
     {
       ...existing_fields,
       direction_id,  // привязка кампании к направлению
       direction_name,
       direction_daily_budget_cents,
       direction_target_cpl_cents
     }
   ]
   ```
4. Обновить SYSTEM_PROMPT:
   - Упомянуть что у клиента могут быть НАПРАВЛЕНИЯ
   - Каждое направление = Facebook Campaign с фиксированным ID
   - Бюджеты управляются ПО НАПРАВЛЕНИЯМ (не общий бюджет аккаунта)
   - При создании Ad Sets использовать `fb_campaign_id` из направления
5. Обновить функцию `getDirectionByCampaignId(campaignId)` для маппинга Campaign → Direction

**Где в коде:**
- `services/agent-brain/src/server.js`
- Функция `/api/brain/run`
- SYSTEM_PROMPT (строка ~777)

---

### **2. Campaign Builder — РЕШЕНИЕ ПРИНЯТО**

✅ **Campaign Builder остаётся БЕЗ изменений!**

**Архитектура:**
- Campaign Builder работает ТОЛЬКО для **legacy** (когда нет направлений)
- Он создаёт НОВУЮ кампанию и паузит все старые
- Когда есть направления → **Brain Agent** создаёт Ad Sets внутри существующих кампаний направлений
- Brain Agent НЕ паузит другие кампании направлений

---

### **3. Фронтенд — НЕ ИНТЕГРИРОВАН**

❌ Фронтенд сейчас пытается напрямую обращаться к Supabase для `account_directions`

**Что нужно:**
1. Убрать прямое обращение к Supabase
2. Использовать Backend API: `https://agents.performanteaiagency.com/api/directions`
3. Создать `services/directionsApi.ts` с методами API
4. Обновить компонент DirectionsCard для использования API

**Файлы документации для фронтендера:**
- `DIRECTIONS_FRONTEND_SPEC.md`
- `DIRECTIONS_FRONTEND_INTEGRATION.md`

---

### **4. Тестирование полного цикла**

❌ НЕ протестирован полный цикл:
1. Создание направления
2. Загрузка креатива с привязкой к направлению
3. Brain Agent анализирует креативы направления
4. Brain Agent создаёт Ad Sets внутри кампании направления

---

## 🎯 ЧТО ДЕЛАТЬ ДАЛЬШЕ

### **Приоритет 1: Интеграция Brain Agent** (критично!)

1. Добавить getUserDirections
2. Обновить llmInput с направлениями
3. Обновить SYSTEM_PROMPT
4. Протестировать

**Время:** ~2-3 часа работы

### **Приоритет 2: Интеграция фронтенда**

1. Передать документацию фронтендеру
2. Убрать Supabase direct access
3. Интегрировать API

**Время:** ~1-2 часа работы фронтендера

### **Приоритет 3: Деплой**

1. Применить миграции в Supabase
2. Запушить код в git
3. Пересобрать сервисы на сервере
4. Протестировать на продакшене

**Время:** ~30 минут

---

## 📊 ТЕКУЩАЯ АРХИТЕКТУРА

### **Создание направления:**
```
Frontend → POST /api/directions
    ↓
Backend (agent-service)
    ↓
1. Создаёт Facebook Campaign через Graph API
2. Сохраняет в account_directions (с fb_campaign_id)
    ↓
Response: { success, direction: {...} }
```

### **Автозапуск рекламы (когда будет готово):**
```
Frontend → Запрос к Brain Agent
    ↓
Brain Agent (agent-brain)
    ↓
1. Получает активные направления (getUserDirections)
2. Анализирует креативы каждого направления
3. Для каждого направления:
   - Использует fb_campaign_id из account_directions
   - Создаёт Ad Sets ВНУТРИ существующей кампании
   - Управляет бюджетом направления
    ↓
Response: { success, actions: [...], report: "..." }
```

---

## 🚀 ФАЙЛЫ ДЛЯ КОММИТА

```bash
# Новые файлы:
migrations/008_account_directions.sql
migrations/009_add_objective_to_directions.sql
services/agent-service/src/routes/directions.ts
DIRECTIONS_FRONTEND_SPEC.md
DIRECTIONS_FRONTEND_INTEGRATION.md
DIRECTIONS_DEPLOY_CHECKLIST.md
DIRECTIONS_STATUS.md

# Изменённые файлы:
nginx.conf
services/agent-service/src/server.ts
services/agent-service/src/lib/campaignBuilder.ts (minor: добавлен direction_id в тип)

# НЕ коммитить (пока не доделано):
services/agent-brain/src/server.js (там только reportOnlyMode, не directions)
```

---

## ✅ Готово для деплоя:
- Backend API для Directions
- Миграции базы данных
- Документация для фронтенда

## ❌ НЕ готово для продакшена:
- Brain Agent (основная логика автозапуска)
- Фронтенд интеграция

---

**Статус:** Backend API готов на 100%, Brain Agent на 0%, Frontend на 0%
**Дата:** 2025-10-12

