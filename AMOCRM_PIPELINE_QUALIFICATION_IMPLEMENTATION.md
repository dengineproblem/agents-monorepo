# ✅ AmoCRM Pipeline & Qualification Tracking - Implementation Complete

**Дата:** 2025-11-05  
**Статус:** ✅ Готово к тестированию  

---

## 📋 Обзор

Полная реализация расширенной интеграции с amoCRM для:
- 🔄 Синхронизации воронок и этапов
- ✅ Отслеживания квалификации лидов
- 📊 Автоматического обновления статусов через webhooks
- 💰 Улучшенной обработки закрытых сделок
- 📈 Статистики квалификации для ROI аналитики

---

## 🗂️ Что реализовано

### 1. Миграция БД (`028_amocrm_pipeline_stages.sql`)

#### Новые поля в таблице `leads`:
```sql
current_pipeline_id INTEGER    -- Текущая воронка
current_status_id INTEGER       -- Текущий этап
is_qualified BOOLEAN            -- Квалифицирован ли лид
```

#### Новая таблица `amocrm_pipeline_stages`:
- Справочник воронок и этапов из amoCRM
- Хранит маппинг `status_id → is_qualified_stage`
- Автоматически обновляется при синхронизации

#### Новая таблица `amocrm_lead_status_history`:
- История переходов между этапами
- Сохраняет оригинальный webhook payload
- Используется для аудита и аналитики

**Индексы:**
- `idx_leads_pipeline_status` — быстрый поиск по статусу
- `idx_leads_is_qualified` — фильтрация квалифицированных
- `idx_amocrm_stages_user` — выборка воронок пользователя
- `idx_amocrm_history_lead` — история по лиду

---

### 2. Расширенный адаптер amoCRM (`adapters/amocrm.ts`)

#### Новые функции:

**Воронки и этапы:**
```typescript
getPipelines(subdomain, accessToken)
// Получает все воронки с этапами
```

**Массовое получение лидов:**
```typescript
getLeadsByIds(leadIds[], subdomain, accessToken, limit = 250)
// Батч-запросы с автоматической пагинацией
```

**Работа с контактами:**
```typescript
getContact(contactId, subdomain, accessToken)
extractPhoneFromContact(contact)
// Получение телефона из кастомных полей
```

**Управление webhooks:**
```typescript
subscribeWebhook(destination, settings[], subdomain, accessToken)
getWebhooks(subdomain, accessToken)
unsubscribeWebhook(webhookId, subdomain, accessToken)
```

---

### 3. Обработчики webhooks (`workflows/amocrmSync.ts`)

#### Новая функция `processLeadStatusChange()`:
Обрабатывает событие `status_lead`:

1. **Находит лид** в нашей БД по `amocrm_lead_id`
2. **Проверяет квалификацию** нового статуса в `amocrm_pipeline_stages`
3. **Обновляет** `current_pipeline_id`, `current_status_id`, `is_qualified`
4. **Записывает историю** в `amocrm_lead_status_history`
5. **Обрабатывает закрытие сделки** при переходе в статус 142 (won) или 143 (lost)

#### Улучшенная функция `handleDealClosureFromStatusChange()`:
- Запрашивает полные данные лида из amoCRM
- Получает телефон из контактов
- Создает/обновляет запись в `sales`

---

### 4. API Routes (`routes/amocrmPipelines.ts`)

#### `POST /api/amocrm/sync-pipelines`
Синхронизация воронок из amoCRM:
```bash
curl -X POST "https://app.performanteaiagency.com/api/amocrm/sync-pipelines?userAccountId={uuid}"
```

**Что делает:**
- Получает все воронки и этапы из amoCRM
- Создает/обновляет записи в `amocrm_pipeline_stages`
- Автоматически помечает статус 142 (won) как квалифицированный
- Сохраняет пользовательские настройки `is_qualified_stage`

**Ответ:**
```json
{
  "success": true,
  "synced": 15,
  "pipelines": 3
}
```

---

#### `GET /api/amocrm/pipelines`
Получение всех воронок пользователя:
```bash
curl "https://app.performanteaiagency.com/api/amocrm/pipelines?userAccountId={uuid}"
```

**Ответ:**
```json
{
  "pipelines": [
    {
      "pipeline_id": 752662,
      "pipeline_name": "Продажи",
      "stages": [
        {
          "id": "uuid",
          "status_id": 16203334,
          "status_name": "Первичный контакт",
          "status_color": "#fffeb2",
          "is_qualified_stage": false,
          "sort_order": 10
        },
        {
          "status_id": 142,
          "status_name": "Успешно реализовано",
          "is_qualified_stage": true,
          "sort_order": 999
        }
      ]
    }
  ]
}
```

---

#### `PATCH /api/amocrm/pipeline-stages/:stageId`
Настройка квалификации этапа:
```bash
curl -X PATCH "https://app.performanteaiagency.com/api/amocrm/pipeline-stages/{uuid}" \
  -H "Content-Type: application/json" \
  -d '{"is_qualified_stage": true}'
```

**Что делает:**
- Обновляет `is_qualified_stage` для этапа
- **Автоматически пересчитывает** `is_qualified` для всех лидов на этом этапе

**Ответ:**
```json
{
  "success": true,
  "stage": {
    "id": "uuid",
    "status_id": 16203337,
    "is_qualified_stage": true,
    ...
  }
}
```

---

#### `GET /api/amocrm/qualification-stats`
Статистика квалификации по креативам:
```bash
curl "https://app.performanteaiagency.com/api/amocrm/qualification-stats?userAccountId={uuid}&directionId={uuid}"
```

**Ответ:**
```json
{
  "stats": [
    {
      "creative_id": "uuid-1",
      "total_leads": 50,
      "qualified_leads": 30,
      "qualification_rate": 60
    },
    {
      "creative_id": "uuid-2",
      "total_leads": 40,
      "qualified_leads": 35,
      "qualification_rate": 88
    }
  ]
}
```

---

### 5. Обновленные webhook handlers (`routes/amocrmWebhooks.ts`)

#### Обработка `status_lead`:
```typescript
// Теперь вызывает processLeadStatusChange() вместо processDealWebhook()
for (const statusChange of payload.leads.status) {
  await processLeadStatusChange(statusChange, userAccountId, app);
}
```

**Что обрабатывается:**
- Переход между любыми этапами
- Обновление `is_qualified` на основе настроек
- Запись в историю
- Закрытие сделок (won/lost)

---

### 6. Регистрация роутов (`server.ts`)

Добавлен новый роут:
```typescript
import amocrmPipelinesRoutes from './routes/amocrmPipelines.js';
app.register(amocrmPipelinesRoutes);
```

---

## 🔄 Workflow обработки лида

### 1. Первичное создание лида
```
Лид приходит с сайта/WhatsApp
    ↓
Создается в нашей БД (leads)
    ↓
Отправляется в amoCRM (syncLeadToAmoCRM)
    ↓
Сохраняется amocrm_lead_id
    ↓
current_status_id = null (пока)
```

### 2. Смена этапа в amoCRM
```
Пользователь меняет этап в amoCRM
    ↓
Webhook status_lead → /api/webhooks/amocrm
    ↓
processLeadStatusChange()
    ↓
Обновляется current_pipeline_id, current_status_id
    ↓
Проверяется is_qualified_stage из справочника
    ↓
Обновляется is_qualified у лида
    ↓
Записывается история в amocrm_lead_status_history
    ↓
Если статус 142/143 → обрабатывается закрытие сделки
```

### 3. Закрытие сделки (won/lost)
```
Лид переходит в статус 142 (won) или 143 (lost)
    ↓
handleDealClosureFromStatusChange()
    ↓
Запрашивается полный лид из amoCRM API
    ↓
Извлекается телефон из контактов
    ↓
Создается/обновляется запись в sales
    ↓
Данные доступны для ROI аналитики
```

---

## 📊 Использование для ROI аналитики

### Пример расчета метрик:

```typescript
// Для каждого креатива:
const leads = await getLeadsByCreative(creativeId);

const stats = {
  total_leads: leads.length,
  qualified_leads: leads.filter(l => l.is_qualified).length,
  won_deals: leads.filter(l => l.current_status_id === 142).length,
  
  qualification_rate: (qualified_leads / total_leads) * 100,
  conversion_rate: (won_deals / qualified_leads) * 100
};
```

### Интеграция с существующей ROI логикой:

В `services/frontend/src/services/salesApi.ts` добавить:

```typescript
// При расчете ROI для креатива:
const qualificationStats = await fetch(
  `/api/amocrm/qualification-stats?userAccountId=${userAccountId}&directionId=${directionId}`
);

const creativeStats = {
  ...existingROI,
  qualification_rate: qualificationStats.find(s => s.creative_id === creativeId)?.qualification_rate || 0
};
```

---

## 🚀 Как начать использовать

### 1. Применить миграцию
```bash
# В production
psql -U postgres -d your_db -f migrations/028_amocrm_pipeline_stages.sql
```

### 2. Синхронизировать воронки
```bash
curl -X POST "https://app.performanteaiagency.com/api/amocrm/sync-pipelines?userAccountId={uuid}"
```

### 3. Настроить квалифицированные этапы
```bash
# Через API или будущий UI
PATCH /api/amocrm/pipeline-stages/{stageId}
{
  "is_qualified_stage": true
}
```

### 4. Подписаться на webhooks (если еще не подписаны)
```bash
# Через amoCRM UI или API
POST https://{subdomain}.amocrm.ru/api/v4/webhooks
{
  "destination": "https://app.performanteaiagency.com/api/webhooks/amocrm?user_id={uuid}",
  "settings": ["add_lead", "update_lead", "status_lead"]
}
```

---

## 📝 TODO (Next Steps)

### Frontend интеграция:
- [ ] UI для просмотра воронок и этапов
- [ ] Чекбоксы для настройки `is_qualified_stage`
- [ ] Отображение `qualification_rate` в ROI таблице
- [ ] История переходов лида в карточке лида

### Backend improvements:
- [ ] Cron задача для синхронизации воронок (раз в 12 часов)
- [ ] Reconciliation задача для исправления пропущенных webhooks
- [ ] Webhook signature validation (HMAC)
- [ ] Metrics и мониторинг обработки webhooks

### Аналитика:
- [ ] Dashboard с конверсионной воронкой по этапам
- [ ] Тренды квалификации по времени
- [ ] Сравнение креативов по qualification_rate

---

## 🔗 Связанные файлы

**Миграции:**
- `migrations/028_amocrm_pipeline_stages.sql`

**Backend:**
- `services/agent-service/src/adapters/amocrm.ts` *(расширен)*
- `services/agent-service/src/workflows/amocrmSync.ts` *(расширен)*
- `services/agent-service/src/routes/amocrmWebhooks.ts` *(обновлен)*
- `services/agent-service/src/routes/amocrmPipelines.ts` *(новый)*
- `services/agent-service/src/server.ts` *(обновлен)*

**Документация:**
- `AMOCRM_INTEGRATION_EXPANSION_QUESTIONS.md` *(ТЗ с ответами)*

---

## ✅ Готово к тестированию!

Все компоненты реализованы и готовы к использованию. Следующий шаг — применить миграцию и протестировать на staging окружении.

🚀 **Happy coding!**






