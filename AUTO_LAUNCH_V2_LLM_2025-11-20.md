# Auto-Launch V2 с LLM + Fallback - 2025-11-20

## 🎯 Цель изменений

Добавить в `auto-launch-v2` LLM как **основной режим** с автоматическим fallback на детерминистический подход при ошибках.

---

## 📊 Логика работы

### До изменений:
```
auto-launch-v2 → Детерминистический подход (всегда)
  ↓
  - Берет первые 5 креативов
  - Создает Ad Set
  - Создает Ads
```

### После изменений:
```
auto-launch-v2 → ПОПЫТКА 1: LLM (primary)
  ↓ success
  ✅ LLM выбирает оптимальные креативы
  ✅ Создает кампанию через buildCampaignAction()
  
  ↓ error
  🔄 FALLBACK: Детерминистический подход
  ✅ Берет первые 5 креативов
  ✅ Создает Ad Set традиционно
```

---

## 🔧 Изменения в коде

### Файл: `services/agent-service/src/routes/campaignBuilder.ts`

#### 1. Добавлен блок LLM попытки (строки ~230-305)

```typescript
// ПОПЫТКА 1: LLM ПОДХОД (primary)
let llmSuccess = false;
try {
  log.info({ directionId: direction.id, mode: 'llm_primary' }, 'Attempting LLM-based launch');

  // Вызываем AI для анализа и выбора креативов
  const action = await buildCampaignAction({
    user_account_id,
    direction_id: direction.id,
    objective: direction.objective,
    campaign_name: direction.name,
    requested_budget_cents: direction.daily_budget_cents,
  });

  action.params.auto_activate = (request.body as any)?.auto_activate || false;

  log.info({ 
    directionId: direction.id,
    action: action.type,
    creativesSelected: action.params.user_creative_ids?.length,
    reasoning: action.reasoning
  }, 'LLM selected creatives for direction');

  // Выполняем action через систему actions
  const envelope = {
    idempotencyKey: `ai-autolaunch-v2-${direction.id}-${Date.now()}`,
    account: {
      userAccountId: user_account_id,
      whatsappPhoneNumber: userAccount.whatsapp_phone_number,
    },
    actions: [action],
    source: 'ai-campaign-builder-v2',
  };

  const actionsResponse = await request.server.inject({
    method: 'POST',
    url: '/api/agent/actions',
    payload: envelope,
  });

  if (actionsResponse.statusCode === 202) {
    const executionResult = JSON.parse(actionsResponse.body);
    
    results.push({
      direction_id: direction.id,
      direction_name: direction.name,
      campaign_id: direction.fb_campaign_id,
      success: true,
      mode: 'llm', // ← НОВОЕ: индикатор режима
      action: action.type,
      creatives_count: action.params.user_creative_ids?.length,
      reasoning: action.reasoning,
      execution_id: executionResult.executionId,
      status: 'success',
    });

    llmSuccess = true;
    log.info({ directionId: direction.id, executionId: executionResult.executionId }, 'LLM launch successful');
  } else {
    throw new Error(`Actions API returned ${actionsResponse.statusCode}`);
  }
} catch (llmError: any) {
  log.warn({ 
    err: llmError, 
    directionId: direction.id,
    message: llmError.message 
  }, 'LLM launch failed, falling back to deterministic approach');
}
```

#### 2. Fallback блок (строки ~306+)

```typescript
// ПОПЫТКА 2: ДЕТЕРМИНИСТИЧЕСКИЙ ПОДХОД (fallback)
if (!llmSuccess) {
  log.info({ directionId: direction.id, mode: 'deterministic_fallback' }, 'Using deterministic approach');

  try {
    // ... (вся прежняя детерминистическая логика)
    
    results.push({
      direction_id: direction.id,
      direction_name: direction.name,
      campaign_id: direction.fb_campaign_id,
      adset_id: adsetId,
      adset_name: `${direction.name} - Ad Set`,
      daily_budget_cents: direction.daily_budget_cents,
      ads_created: ads.length,
      creatives_used: creativesToUse.map(c => c.user_creative_id),
      mode: 'deterministic', // ← НОВОЕ: индикатор режима
      status: 'success',
    });
  } catch (error: any) {
    // ... обработка ошибок
    results.push({
      // ...
      mode: 'deterministic',
      status: 'failed',
    });
  }
}
```

---

## 📋 Структура ответа

### Успешный LLM запуск:
```json
{
  "success": true,
  "message": "Processed 2 direction(s)",
  "results": [
    {
      "direction_id": "uuid-1",
      "direction_name": "Имплантация",
      "campaign_id": "fb_campaign_id",
      "success": true,
      "mode": "llm",                     // ← LLM был использован
      "action": "Direction.CreateAdSetWithCreatives",
      "creatives_count": 3,              // ← LLM выбрал 3 креатива
      "reasoning": "Selected top performers based on CPL and CTR",
      "execution_id": "execution-uuid",
      "status": "success"
    }
  ]
}
```

### Fallback на детерминистический:
```json
{
  "success": true,
  "message": "Processed 2 direction(s)",
  "results": [
    {
      "direction_id": "uuid-2",
      "direction_name": "Виниры",
      "campaign_id": "fb_campaign_id",
      "adset_id": "fb_adset_id",
      "adset_name": "Виниры - Ad Set",
      "daily_budget_cents": 5000,
      "ads_created": 5,
      "creatives_used": ["creative-1", "creative-2", "creative-3", "creative-4", "creative-5"],
      "mode": "deterministic",           // ← Fallback режим
      "status": "success"
    }
  ]
}
```

---

## 🔍 Когда срабатывает fallback?

Детерминистический подход используется как fallback в следующих случаях:

### 1. **Ошибка OpenAI API**
```
LLM недоступен → fallback
```

### 2. **Ошибка buildCampaignAction()**
```
- Нет креативов с метриками
- Некорректный response от LLM
- Timeout OpenAI
→ fallback
```

### 3. **Ошибка выполнения action**
```
POST /api/agent/actions вернул не 202
→ fallback
```

### 4. **Любая другая ошибка в LLM блоке**
```
Exception в try-catch
→ fallback
```

---

## ✅ Преимущества

1. **Умный выбор креативов** (LLM режим):
   - Анализирует метрики (CPL, CTR, risk_score)
   - Выбирает оптимальное количество (не всегда 5)
   - Учитывает бюджетные ограничения
   - Возвращает reasoning для прозрачности

2. **Надежность** (fallback):
   - Всегда есть запасной план
   - Детерминистический подход гарантирует запуск
   - Не блокирует пользователя при проблемах с LLM

3. **Прозрачность**:
   - Поле `mode` показывает какой подход был использован
   - `reasoning` объясняет выбор LLM
   - Логи четко показывают попытки и fallback

---

## 🔄 Совместимость

### Обратная совместимость: ✅

Все существующие интеграции продолжат работать:
- Фронтенд ожидает `results` массив - он есть
- Структура ответа расширена (добавлено `mode`), но не сломана
- Детерминистический fallback идентичен старой логике

### Новые поля (опционально):

Клиенты могут использовать новые поля для UI:

```typescript
if (result.mode === 'llm') {
  // Показать badge "AI-оптимизация"
  // Показать reasoning в tooltip
}
```

---

## 📊 Метрики и логи

### Логи успешного LLM запуска:

```
[INFO] Attempting LLM-based launch { directionId: "uuid", mode: "llm_primary" }
[INFO] LLM selected creatives for direction { 
  directionId: "uuid",
  action: "Direction.CreateAdSetWithCreatives",
  creativesSelected: 3,
  reasoning: "Selected top performers..."
}
[INFO] LLM launch successful { directionId: "uuid", executionId: "exec-uuid" }
```

### Логи fallback:

```
[INFO] Attempting LLM-based launch { directionId: "uuid", mode: "llm_primary" }
[WARN] LLM launch failed, falling back to deterministic approach { 
  err: Error("OpenAI timeout"),
  directionId: "uuid",
  message: "OpenAI timeout"
}
[INFO] Using deterministic approach { directionId: "uuid", mode: "deterministic_fallback" }
```

---

## 🧪 Тестирование

### Тест 1: LLM успешный запуск

```bash
curl -X POST http://localhost:8082/api/campaign-builder/auto-launch-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "user_account_id": "uuid",
    "auto_activate": false
  }'
```

**Ожидаемый результат:**
- `mode: "llm"`
- `reasoning` присутствует
- `creatives_count` может быть ≠ 5

### Тест 2: Fallback (отключить OpenAI)

```bash
# Временно удалить OPENAI_API_KEY или установить невалидный

curl -X POST http://localhost:8082/api/campaign-builder/auto-launch-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "user_account_id": "uuid",
    "auto_activate": false
  }'
```

**Ожидаемый результат:**
- `mode: "deterministic"`
- `ads_created: 5`
- `creatives_used` - массив из 5 элементов

---

## ⚠️ Важные моменты

### 1. OpenAI API Key обязателен для LLM

Если `OPENAI_API_KEY` не настроен:
- LLM попытка сразу упадет
- Fallback на детерминистический подход
- Пользователь не увидит ошибку (transparent fallback)

### 2. Метрики креативов

LLM работает лучше если есть метрики креативов:
- Читает из `creative_metrics_history` (после рефакторинга Scoring Agent)
- Если метрик нет - все равно работает, но выбор менее оптимален

### 3. Бюджетные ограничения

LLM учитывает:
- `direction.daily_budget_cents`
- Минимальный бюджет на кампанию
- Максимальный бюджет на кампанию
- Target CPL пользователя

---

## 📝 TODO (будущие улучшения)

- [ ] Добавить метрики успешности LLM vs fallback
- [ ] A/B тестирование: сравнить performance LLM vs детерминистического
- [ ] Кеширование LLM responses для быстрых повторных запусков
- [ ] UI индикатор "AI-оптимизация" на фронтенде

---

**Дата:** 20 ноября 2025  
**Автор:** AI Agent  
**Файлы изменены:** `services/agent-service/src/routes/campaignBuilder.ts`

