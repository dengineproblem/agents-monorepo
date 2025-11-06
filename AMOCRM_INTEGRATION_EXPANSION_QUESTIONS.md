# 📋 Техническое задание для специалиста по API amoCRM

## ✅ СТАТУС: ОТВЕТЫ ПОЛУЧЕНЫ

**Дата вопросов:** 2025-11-05  
**Дата ответов:** 2025-11-05  
**Статус:** Готово к реализации

---

## Контекст проекта

У нас есть **AI-таргетолог** для автоматизации рекламы в Facebook/Instagram с WhatsApp-интеграцией. Система отслеживает эффективность рекламных креативов и считает ROI.

### Текущая интеграция amoCRM (что уже работает):

✅ OAuth 2.0 авторизация  
✅ Автоматическое обновление токенов  
✅ Отправка лидов с сайта → amoCRM (создание контактов и сделок)  
✅ Базовый webhook для получения данных о закрытых сделках  
✅ Связка данных через **номер телефона клиента**

### Наша архитектура БД:

```sql
-- Лиды (из WhatsApp, сайта, вручную)
leads (
  id, 
  chat_id,              -- WhatsApp: номер@s.whatsapp.net
  phone,                -- Телефон с сайта: +7 XXX XXX-XX-XX
  creative_id,          -- Связь с креативом
  direction_id,         -- Направление рекламы
  amocrm_lead_id,       -- ✅ Уже есть
  amocrm_contact_id,    -- ✅ Уже есть
  utm_source, utm_campaign, ...
)

-- Продажи (покупки клиентов)
purchases (
  client_phone,         -- 🔑 КЛЮЧ для связи с amoCRM
  amount,
  purchase_date,
  user_account_id
)

-- Продажи из amoCRM (текущая таблица)
sales (
  client_phone,         -- 🔑 КЛЮЧ для связи
  amocrm_deal_id,       -- ✅ Уже есть
  amocrm_pipeline_id,   -- ✅ Уже есть
  amocrm_status_id,     -- ✅ Уже есть
  amount,
  status                -- 'paid' | 'pending'
)
```

---

## 🎯 РАЗДЕЛ 1: Данные о продажах в реальном времени

### ❓ Вопросы:

**1. Какие типы webhooks нам нужны?**

**✅ ОТВЕТ:** Минимальный набор для сделок/этапов и сумм:
- `add_lead` (создана сделка)
- `update_lead` (изменена сделка — в т.ч. могла поменяться сумма)
- `status_lead` (смена этапа: содержит старый/новый статус и воронку)

**Источник:** [amoCRM Webhooks API](https://www.amocrm.ru/developers/content/crm_platform/webhooks-api)

---

**2. Какая структура данных приходит в webhook при закрытии сделки?**

**✅ ОТВЕТ:** 
- В webhook передается `price` (сумма сделки)
- Системные закрытые этапы:
  - **Успешно реализовано = 142** (won)
  - **Закрыто и не реализовано = 143** (lost)
- При смене этапа приходят: `pipeline_id`, `old_status_id`, `status_id`

**Пример payload (status_lead):**
```json
{
  "leads": {
    "status": [{
      "id": 4831596,
      "old_pipeline_id": 752662,
      "pipeline_id": 752662,
      "old_status_id": 16203334,
      "status_id": 16203337
    }]
  }
}
```

**Источник:** [amoCRM Webhooks Format](https://www.amocrm.ru/developers/content/crm_platform/webhooks-format)

---

**3. Как получить номер телефона контакта из webhook?**

**✅ ОТВЕТ:** Телефон находится в **контакте** (поле `custom_fields_values` с `field_code = "PHONE"`). 

**Алгоритм:**
1. Получить сделку с привязками:
   ```
   GET /api/v4/leads/{lead_id}?with=contacts
   ```
2. Для каждого контакт-ID:
   ```
   GET /api/v4/contacts/{id}
   ```
   Достать `custom_fields_values` → `PHONE`

**Источники:**
- [Сделки API](https://www.amocrm.ru/developers/content/crm_platform/leads-api)
- [Контакты API](https://www.amocrm.ru/developers/content/crm_platform/contacts-api)

---

**4. Настройка webhook в amoCRM**

**✅ ОТВЕТ:** Через API (нужны права админа):

```http
POST https://{subdomain}.amocrm.ru/api/v4/webhooks
Content-Type: application/json
Authorization: Bearer {access_token}

{
  "destination": "https://app.performanteaiagency.com/api/webhooks/amocrm?user_id={uuid}&sig={hmac}",
  "settings": ["add_lead","update_lead","status_lead"],
  "sort": 10
}
```

**⚠️ Важно:** amoCRM **не добавляет HMAC-подпись** к webhook-запросам. Рекомендации:
- Добавить в `destination` собственный токен/`sig` (HMAC от user_id+timestamp)
- Проверять `HTTPS`, rate-limit и idempotency
- Подтверждать критичные события (won/lost/price change) доп. запросом в API

**Источник:** [amoCRM Webhooks API](https://www.amocrm.ru/developers/content/crm_platform/webhooks-api)

---

## 🎯 РАЗДЕЛ 2: Отслеживание этапов воронки

### ❓ Вопросы:

**5. Как получить список всех воронок (pipelines) и их этапов (statuses)?**

**✅ ОТВЕТ:**
```http
GET https://{subdomain}.amocrm.ru/api/v4/leads/pipelines
Authorization: Bearer {access_token}
```

Возвращает все воронки и статусы, включая **системные 142/143**. 

**Структура ответа:**
- `status.id` — ID этапа
- `status.name` — Название этапа
- `status.color` — Цвет
- `sort` — Порядок сортировки

**Источник:** [Воронки и этапы](https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines)

---

**6. Как узнать текущий этап конкретного лида?**

**✅ ОТВЕТ:**
```http
GET https://{subdomain}.amocrm.ru/api/v4/leads/{lead_id}
Authorization: Bearer {access_token}
```

Поля `pipeline_id` и `status_id` присутствуют у сделки **всегда**.

**Источник:** [Сделки API](https://www.amocrm.ru/developers/content/crm_platform/leads-api)

---

**7. Webhooks для изменения этапа**

**✅ ОТВЕТ:** 
- Событие `status_lead` срабатывает при **любом** переходе между этапами
- В payload есть: `old_status_id`, `status_id`, `pipeline_id`
- Название статуса подтягивается из кеша справочника (см. вопрос 5)

**Источник:** [WebHooks](https://www.amocrm.ru/developers/content/digital_pipeline/webhooks)

---

**8. Настройка "квалифицированного лида"**

**✅ ОТВЕТ:** Рекомендуется хранить маппинг **`status_id → is_qualified`** в собственной таблице — это гибко и не привязано к полям amo. 

**Опционально:** можно дублировать признак тегом на самой сделке через `PATCH /api/v4/leads/{id}`.

**Источник:** [Теги API](https://www.amocrm.ru/developers/content/crm_platform/tags-api)

---

## 🎯 РАЗДЕЛ 3: Интеграция с ROI аналитикой

### ❓ Вопросы:

**9. Как связать лиды из amoCRM с нашими креативами?**

**✅ ОТВЕТ:** Связь уже есть: `leads.amocrm_lead_id` ⇄ amoCRM lead. 

Для массового обновления статусов:
```http
GET https://{subdomain}.amocrm.ru/api/v4/leads?filter[id][]=123&filter[id][]=456&limit=250
Authorization: Bearer {access_token}
```

- Лимит на страницу: до **250** сущностей
- Пагинация по `_links.next.href`

**Источник:** [Фильтрация API](https://www.amocrm.ru/developers/content/crm_platform/filters-api)

---

**10. Rate limits API amoCRM**

**✅ ОТВЕТ:** 
- **7 req/сек на интеграцию**
- **до 50 req/сек на аккаунт** (общая шина)
- Использовать экспоненциальный backoff + «джиттер» при 429

**Источник:** [Skool Community Discussion](https://www.skool.com/ai-automation-society/fetch-full-kommo-crm-chat-history-in-n8n-via-http)

---

**11. Кеширование и оптимизация**

**✅ ОТВЕТ:** Лучшая стратегия — **webhook-first**:
- Держать текущий `status_id`/`pipeline_id`/`price` в таблице `leads`
- Обновлять **по вебхукам**
- Массовые GET использовать для:
  - «Холодной» первичной синхронизации
  - Периодического reconciliation (раз в час/день)
  - Исправления пропусков

Это значительно экономит лимиты.

**Источник:** [Возможности платформы](https://www.amocrm.ru/developers/content/crm_platform/platform-abilities)

---

## 🎯 РАЗДЕЛ 4: Структура данных для новых таблиц

### ✅ Рекомендации специалиста:

**Поля в таблице `leads`:**
```sql
ALTER TABLE leads 
  ADD COLUMN current_pipeline_id INTEGER,
  ADD COLUMN current_status_id INTEGER,
  ADD COLUMN is_qualified BOOLEAN DEFAULT FALSE;
```
✅ **Подтверждено** — это ускорит запросы для дашбордов

---

**Новая таблица для хранения этапов воронки:**
```sql
CREATE TABLE amocrm_pipeline_stages (
  user_account_id UUID,
  pipeline_id INTEGER,
  pipeline_name TEXT,
  status_id INTEGER,
  status_name TEXT,
  status_color TEXT,
  is_qualified_stage BOOLEAN DEFAULT FALSE, -- ⭐ Настраиваемое
  sort_order INTEGER,
  PRIMARY KEY (user_account_id, pipeline_id, status_id)
);
```
✅ **Обязательно** — именно сюда кладем маппинг `status_id → is_qualified_stage`

---

**История переходов (опционально):**
```sql
CREATE TABLE amocrm_lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id INTEGER REFERENCES leads(id),
  amocrm_lead_id BIGINT,
  from_status_id INTEGER,
  to_status_id INTEGER,
  changed_at TIMESTAMPTZ,
  webhook_data JSONB
);
```
✅ **Отлично** для аудита и ретро-аналитики

---

### ❓ Вопросы:

**12. Нужна ли дополнительная синхронизация воронок?**

**✅ ОТВЕТ:** Да — пользователи периодически добавляют/переименовывают статусы. 

**Рекомендации:**
- Сделать ручную кнопку «Обновить воронки»
- Фоновая синхронизация раз в 12–24 часа
- Прямого вебхука «структура воронки изменилась» **нет**
- Брать актуальный список через `GET /api/v4/leads/pipelines`

**Источник:** [Воронки и этапы](https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines)

---

**13. Webhook при изменении структуры воронки**

**✅ ОТВЕТ:** Прямых уведомлений **нет**. Используйте периодическую синхронизацию.

---

## 📋 ИТОГОВЫЙ ПЛАН РЕАЛИЗАЦИИ

### 🔧 Шаг 1: Подписка на webhooks

```http
POST https://{subdomain}.amocrm.ru/api/v4/webhooks
Authorization: Bearer {access_token}

{
  "destination": "https://app.performanteaiagency.com/api/webhooks/amocrm?user_id={uuid}&sig={hmac}",
  "settings": ["add_lead","update_lead","status_lead"]
}
```

### 🔧 Шаг 2: Реализовать обработчики webhooks

**`status_lead`:**
- Апдейт `current_pipeline_id/status_id`
- Вычислить `is_qualified`
- Записать в `amocrm_lead_status_history`

**`update_lead`:**
- Если изменился `price` → синкнуть в `sales/purchases`
- При won (`status_id=142`) → подтвердить через `GET /leads/{id}`, записать покупку

**`add_lead`:**
- Создать запись в истории

### 🔧 Шаг 3: Миграции БД

```sql
-- 1. Добавить поля в leads
ALTER TABLE leads 
  ADD COLUMN current_pipeline_id INTEGER,
  ADD COLUMN current_status_id INTEGER,
  ADD COLUMN is_qualified BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_leads_pipeline_status 
  ON leads(current_pipeline_id, current_status_id) 
  WHERE current_pipeline_id IS NOT NULL;

-- 2. Создать таблицу воронок
CREATE TABLE amocrm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  pipeline_id INTEGER NOT NULL,
  pipeline_name TEXT NOT NULL,
  status_id INTEGER NOT NULL,
  status_name TEXT NOT NULL,
  status_color TEXT,
  is_qualified_stage BOOLEAN DEFAULT FALSE,
  sort_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_account_id, pipeline_id, status_id)
);

CREATE INDEX idx_amocrm_stages_user 
  ON amocrm_pipeline_stages(user_account_id);

-- 3. Создать таблицу истории
CREATE TABLE amocrm_lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  amocrm_lead_id BIGINT,
  from_status_id INTEGER,
  to_status_id INTEGER,
  from_pipeline_id INTEGER,
  to_pipeline_id INTEGER,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  webhook_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_amocrm_history_lead 
  ON amocrm_lead_status_history(lead_id, changed_at DESC);
CREATE INDEX idx_amocrm_history_amocrm_lead 
  ON amocrm_lead_status_history(amocrm_lead_id, changed_at DESC);
```

### 🔧 Шаг 4: API endpoints

**1. Синхронизация воронок:**
```
POST /api/amocrm/sync-pipelines?userAccountId={uuid}
```

**2. Настройка квалифицированных этапов:**
```
PATCH /api/amocrm/pipeline-stages/:stageId
{
  "is_qualified_stage": true
}
```

**3. Получение статистики по квалификации:**
```
GET /api/amocrm/qualification-stats?userAccountId={uuid}&directionId={uuid}
```

### 🔧 Шаг 5: ROI аналитика с квалификацией

Обновить расчет ROI:
```typescript
// Для каждого креатива:
const stats = {
  leads: totalLeads,
  qualified_leads: leadsWithIsQualified,
  qualification_rate: (qualified_leads / leads) * 100,
  conversions: paidPurchases,
  conversion_rate: (conversions / qualified_leads) * 100
};
```

### 🔧 Шаг 6: Фоновые задачи

**Cron задачи:**
- Синхронизация воронок: каждые 12 часов
- Reconciliation лидов: каждые 6 часов (проверка пропущенных webhooks)

---

## 🔗 Ссылки на документацию

1. [Webhooks API](https://www.amocrm.ru/developers/content/crm_platform/webhooks-api)
2. [Webhooks Format](https://www.amocrm.ru/developers/content/crm_platform/webhooks-format)
3. [Сделки API](https://www.amocrm.ru/developers/content/crm_platform/leads-api)
4. [Контакты API](https://www.amocrm.ru/developers/content/crm_platform/contacts-api)
5. [Воронки и этапы](https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines)
6. [Фильтрация API](https://www.amocrm.ru/developers/content/crm_platform/filters-api)
7. [События и Примечания](https://www.amocrm.ru/developers/content/crm_platform/events-and-notes)

---

## ✅ Готово к реализации!

Все ответы получены, план составлен. Можно начинать разработку! 🚀
