# 🧪 Тестирование CreateCampaignWithCreative

## 📋 **Что тестируем**

Новый action `CreateCampaignWithCreative`, который:
1. Берёт креатив из таблицы `user_creatives` по UUID
2. Определяет нужный `fb_creative_id` в зависимости от `objective` (WhatsApp/Instagram/SiteLeads)
3. Создаёт Campaign → AdSet → Ad в Facebook
4. Всё создаётся на **ПАУЗЕ** (status=PAUSED)

---

## 🛠️ **Подготовка**

### 1. Убедись, что AgentService запущен

```bash
cd services/agent-service
npm run dev
# или
docker-compose up agent-service
```

По умолчанию AgentService должен быть доступен на `http://localhost:4001`.

### 2. Получи список доступных креативов

Тебе нужен **UUID креатива** из таблицы `user_creatives`, который:
- `status = 'ready'`
- `is_active = true`
- Имеет хотя бы один `fb_creative_id_*` (whatsapp/instagram/site_leads)

**Через Supabase SQL Editor:**

```sql
SELECT 
  id, 
  title, 
  fb_creative_id_whatsapp,
  fb_creative_id_instagram_traffic,
  fb_creative_id_site_leads,
  status,
  is_active
FROM user_creatives
WHERE user_id = '<твой USER_ACCOUNT_ID>'
  AND status = 'ready'
  AND is_active = true;
```

**Через Supabase REST API:**

```bash
curl -X GET 'https://your-supabase-url/rest/v1/user_creatives?user_id=eq.<USER_ACCOUNT_ID>&status=eq.ready&is_active=eq.true&select=id,title,fb_creative_id_whatsapp,fb_creative_id_instagram_traffic,fb_creative_id_site_leads' \
  -H "apikey: <your-anon-key>" \
  -H "Authorization: Bearer <your-anon-key>"
```

Скопируй `id` (UUID) одного из креативов.

---

## 🚀 **Тест 1: Использование готового скрипта**

### Шаг 1: Установи переменные окружения

```bash
export USER_ACCOUNT_ID='0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'  # Замени на свой
export USER_CREATIVE_ID='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'  # UUID креатива из user_creatives
export AGENT_SERVICE_URL='http://localhost:4001'  # Или твой URL
```

### Шаг 2: Запусти тест

```bash
./test-create-campaign.sh
```

### Ожидаемый результат:

```
🧪 Тестирование CreateCampaignWithCreative action

📋 Параметры теста:
  USER_ACCOUNT_ID: 0f559eb0-...
  USER_CREATIVE_ID: xxxxxxxx-...
  AGENT_SERVICE_URL: http://localhost:4001

📤 Отправка запроса...

📥 Ответ сервера:
{
  "executionId": "uuid-here",
  "executed": true
}

✅ Action отправлен успешно!
   Execution ID: uuid-here

✅ Action выполнен!

🔍 Проверь в Facebook Ads Manager:
   - Новая кампания 'TEST — Новая кампания с креативом' (на паузе)
   - Внутри неё adset 'TEST — Основной adset' (на паузе)
   - Внутри adset объявление 'TEST — Объявление 1' (на паузе)
```

---

## 🔬 **Тест 2: Ручной запрос через curl**

Если хочешь больше контроля, можешь отправить запрос вручную:

```bash
curl -X POST "http://localhost:4001/api/agent/actions" \
  -H "Content-Type: application/json" \
  -d '{
  "idempotencyKey": "test-manual-'$(date +%s)'",
  "source": "test",
  "account": {
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
  },
  "actions": [
    {
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "objective": "WhatsApp",
        "campaign_name": "MANUAL TEST — Кампания WhatsApp",
        "adset_name": "MANUAL TEST — AdSet",
        "ad_name": "MANUAL TEST — Ad 1",
        "daily_budget_cents": 1500
      }
    }
  ]
}' | jq '.'
```

### Параметры:

- **`user_creative_id`** (обязательно): UUID из `user_creatives`
- **`objective`** (обязательно): `"WhatsApp"` | `"Instagram"` | `"SiteLeads"`
- **`campaign_name`** (обязательно): Название кампании
- **`daily_budget_cents`** (обязательно): Бюджет в центах (1500 = $15/день)
- **`adset_name`** (опционально): Название adset (по умолчанию `<campaign_name> - AdSet 1`)
- **`ad_name`** (опционально): Название объявления (по умолчанию `<campaign_name> - Ad 1`)
- **`targeting`** (опционально): JSON объект таргетинга (по умолчанию РФ, 18-65, все гендеры)

---

## 🔍 **Проверка результата**

### 1. В Facebook Ads Manager

Зайди в **Ads Manager** → **Campaigns** и найди кампанию:
- **Название**: `TEST — Новая кампания с креативом`
- **Status**: `Paused` (на паузе)
- **Objective**: Зависит от `objective` параметра:
  - `WhatsApp` → `Engagement` (Conversations)
  - `Instagram` → `Traffic`
  - `SiteLeads` → `Leads`

Внутри кампании:
- **AdSet**: `TEST — Основной adset` (на паузе)
- **Ad**: `TEST — Объявление 1` (на паузе)

### 2. В Supabase

Проверь логи выполнения:

```sql
-- Посмотреть execution
SELECT * FROM agent_executions 
WHERE idempotency_key LIKE 'test-create-campaign-%' 
ORDER BY created_at DESC 
LIMIT 1;

-- Посмотреть actions (замени <execution_id> на ID из предыдущего запроса)
SELECT * FROM agent_actions 
WHERE execution_id = '<execution_id>';

-- Посмотреть детальные логи
SELECT * FROM agent_logs 
WHERE execution_id = '<execution_id>'
ORDER BY step_idx;
```

Поле `result_json` в `agent_actions` должно содержать:

```json
{
  "success": true,
  "campaign_id": "123456789",
  "adset_id": "987654321",
  "ad_id": "111222333",
  "fb_creative_id": "444555666",
  "objective": "WhatsApp",
  "message": "Campaign \"TEST — Новая кампания с креативом\" created successfully with adset and ad (all PAUSED)"
}
```

---

## 🧹 **Очистка после теста**

После теста удали тестовые кампании из Facebook Ads Manager, чтобы не засорять аккаунт.

---

## ❌ **Возможные ошибки**

### 1. `Creative not found or not ready`

**Причина**: Креатив с таким UUID не найден или `status != 'ready'`.

**Решение**: 
- Проверь, что `user_creative_id` правильный
- Проверь SQL: `SELECT * FROM user_creatives WHERE id = '<UUID>' AND status = 'ready'`

### 2. `Creative does not have fb_creative_id for <objective>`

**Причина**: У креатива нет `fb_creative_id_whatsapp` (или `_instagram_traffic`, `_site_leads`) в зависимости от выбранного `objective`.

**Решение**:
- Проверь, что креатив был создан для этой цели через N8N workflow
- Проверь SQL: `SELECT fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads FROM user_creatives WHERE id = '<UUID>'`

### 3. `Failed to create campaign: no ID returned`

**Причина**: Facebook API вернул ошибку при создании кампании.

**Решение**:
- Проверь логи AgentService (`docker-compose logs agent-service`)
- Проверь, что `access_token` в `user_accounts` валидный
- Проверь, что у токена есть права `ads_management`

### 4. `userAccountId and adAccountId required in context`

**Причина**: Не удалось получить `userAccountId` или `adAccountId` из Supabase.

**Решение**:
- Проверь, что `userAccountId` в запросе правильный
- Проверь, что в таблице `user_accounts` есть запись с этим ID и заполнены поля `access_token`, `ad_account_id`, `page_id`, `instagram_id`

---

## 🎯 **Интеграция с Brain**

После успешного теста Brain сможет автоматически генерировать этот action, когда:
1. Scoring Agent предложит креатив с хорошим скорингом (Low risk, score < 20)
2. Brain решит, что нужна новая кампания (например, текущие кампании показывают High risk)
3. В промпте Brain уже есть инструкции и пример использования `CreateCampaignWithCreative`

---

## 📝 **Пример использования Brain**

В следующем запуске Brain увидит в `scoring.ready_creatives`:

```json
{
  "ready_creatives": [
    {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "Мемы про офис",
      "objectives": ["WhatsApp", "Instagram", "SiteLeads"],
      "score": 12,
      "risk": "Low"
    }
  ]
}
```

И если Brain решит создать новую кампанию, он сгенерирует:

```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "objective": "WhatsApp",
    "campaign_name": "Мемы про офис — WhatsApp",
    "daily_budget_cents": 2000
  }
}
```

---

## ✅ **Чеклист успешного теста**

- [ ] AgentService запущен и доступен
- [ ] Есть креатив в `user_creatives` со `status='ready'` и `is_active=true`
- [ ] Креатив имеет хотя бы один `fb_creative_id_*`
- [ ] Запрос через `test-create-campaign.sh` или curl вернул `executionId` и `executed: true`
- [ ] В Facebook Ads Manager появилась новая кампания (на паузе)
- [ ] В Supabase в `agent_actions` есть запись со `status='success'` и `result_json` с `campaign_id`, `adset_id`, `ad_id`
- [ ] Нет ошибок в логах AgentService

---

Если всё работает — можно коммитить! 🚀
