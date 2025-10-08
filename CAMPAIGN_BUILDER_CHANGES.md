# Campaign Builder - Изменения на систему actions

**Дата**: 08.10.2025

## 🔄 Что изменилось

### Было (v1 - прямой вызов):
```
LLM → Plan (JSON с креативами и бюджетом)
  → convertPlanToWorkflowParams()
  → workflowCreateCampaignWithCreative() напрямую
  → Результат
```

### Стало (v2 - через систему actions):
```
LLM → Action (type + params + reasoning)
  → convertActionToEnvelope()
  → POST /api/agent/actions (внутренний вызов)
  → Валидация + Логирование + Workflow
  → Результат в agent_executions
```

## ✅ Преимущества новой архитектуры

1. **Единая валидация** - все actions проходят через Zod schemas
2. **Единое логирование** - все действия в `agent_executions` и `agent_actions`
3. **Консистентность** - Campaign Builder использует ту же систему что и Agent Brain
4. **Отслеживаемость** - каждое выполнение имеет `execution_id`
5. **Переиспользование** - используем уже существующий `CreateCampaignWithCreative` action

## 📝 Технические изменения

### 1. campaignBuilder.ts

**Было:**
```typescript
export async function buildCampaignPlan(): Promise<CampaignPlan> {
  // Генерировал простой план
  return {
    campaign_name: "...",
    objective: "whatsapp",
    daily_budget_cents: 150000,
    selected_creatives: [...]
  }
}
```

**Стало:**
```typescript
export async function buildCampaignAction(): Promise<CampaignAction> {
  // Генерирует полноценный action
  return {
    type: "CreateCampaignWithCreative",
    params: {
      user_creative_ids: [...],
      objective: "WhatsApp",
      campaign_name: "...",
      daily_budget_cents: 150000,
      use_default_settings: true,
      auto_activate: false
    },
    reasoning: "...",
    estimated_cpl: 2.10,
    confidence: "high"
  }
}
```

### 2. SYSTEM_PROMPT для LLM

Изменен формат ответа - теперь LLM генерирует action, а не план:

```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_ids": ["uuid-1", "uuid-2"],
    "objective": "WhatsApp",
    "campaign_name": "Название",
    "daily_budget_cents": 150000,
    "use_default_settings": true,
    "auto_activate": false
  },
  "selected_creatives": [...],
  "reasoning": "...",
  "estimated_cpl": 2.10,
  "confidence": "high"
}
```

### 3. campaignBuilder.ts routes

**Было:**
```typescript
const plan = await buildCampaignPlan(input);
const workflowParams = convertPlanToWorkflowParams(plan);
const result = await workflowCreateCampaignWithCreative(workflowParams, ...);
```

**Стало:**
```typescript
const action = await buildCampaignAction(input);
const envelope = convertActionToEnvelope(action, user_account_id);

// Вызов через систему actions
const actionsResponse = await request.server.inject({
  method: 'POST',
  url: '/api/agent/actions',
  payload: envelope,
});

// Получаем результат из БД
const { data: execution } = await supabase
  .from('agent_executions')
  .select('response_json')
  .eq('id', executionId)
  .single();
```

## 🎯 Что осталось без изменений

- ✅ API endpoints (`/auto-launch`, `/preview`, etc.) - интерфейс тот же
- ✅ Логика подбора креативов - LLM анализирует так же
- ✅ Бюджетные ограничения - получаем из user_accounts
- ✅ Scoring данные - используем creative_scores
- ✅ Default settings - применяются автоматически

## 📊 Новые возможности

### Отслеживание выполнения

Теперь каждое создание кампании логируется в БД:

```sql
-- Все запуски Campaign Builder
SELECT * FROM agent_executions 
WHERE source = 'campaign-builder'
ORDER BY created_at DESC;

-- Детали конкретного action
SELECT * FROM agent_actions
WHERE execution_id = 'your-execution-id';
```

### Idempotency

Автоматическая защита от дублирования:

```typescript
idempotencyKey: `campaign-builder-${Date.now()}-${Math.random()}`
```

### Response format

Теперь возвращается `execution_id` для трекинга:

```json
{
  "success": true,
  "execution_id": "uuid",
  "campaign_id": "...",
  "adset_id": "...",
  "ads": [...],
  "action": {
    "type": "CreateCampaignWithCreative",
    "campaign_name": "...",
    "reasoning": "...",
    "confidence": "high"
  }
}
```

## 🧪 Тестирование

Все тесты остаются прежними:

```bash
./test-campaign-builder.sh YOUR_USER_ACCOUNT_ID
```

## 🚀 Деплой

Нужно пересобрать Docker:

```bash
docker-compose build agent-service
docker-compose up -d agent-service
```

---

**Итог**: Архитектура стала более надежной, консистентной и легче в поддержке! 🎉

