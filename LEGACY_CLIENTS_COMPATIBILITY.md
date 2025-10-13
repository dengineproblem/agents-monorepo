# ✅ Совместимость с Legacy-клиентами (без направлений)

## Вопрос

Что происходит с **существующими клиентами**, у которых реклама запущена **ДО** введения сущностей "направления" и "креативы"?

У них:
- ❌ Нет записей в `account_directions`
- ❌ Нет `direction_id` у кампаний
- ✅ Есть активные Facebook Campaigns
- ✅ Есть `plan_daily_budget_cents` и `default_cpl_target_cents` в `user_accounts`

---

## ✅ Ответ: Полная обратная совместимость!

Система **полностью поддерживает** legacy-клиентов. Вот как это работает:

---

## 1. Загрузка направлений

```javascript
// services/agent-brain/src/server.js:325
async function getUserDirections(userAccountId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('account_directions')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  
  if (error) {
    fastify.log.warn({ msg: 'load_directions_failed', error });
    return [];  // ← Если ошибка → пустой массив
  }
  return data || [];  // ← Если нет направлений → пустой массив
}
```

**Результат для legacy-клиента:**
```javascript
directions = []  // ← Пустой массив, НЕ ошибка!
```

---

## 2. Формирование targets (плановые показатели)

```javascript
// services/agent-brain/src/server.js:1743
const targets = { 
  cpl_cents: ua.default_cpl_target_cents || 200,          // ← Берём из user_accounts!
  daily_budget_cents: ua.plan_daily_budget_cents || 2000  // ← Берём из user_accounts!
};
```

**Результат для legacy-клиента:**
```javascript
targets = {
  cpl_cents: 200,          // ← Из user_accounts.default_cpl_target_cents
  daily_budget_cents: 5000 // ← Из user_accounts.plan_daily_budget_cents
}
```

✅ **Legacy-клиенты используют глобальные настройки из `user_accounts`!**

---

## 3. Маппинг кампаний

```javascript
// services/agent-brain/src/server.js:1983-2006
campaigns: (campList||[]).filter(c=>String(c.status||c.effective_status||'').includes('ACTIVE')).map(c=>{
  // Найти направление для этой кампании
  const direction = directions.find(d => d.fb_campaign_id === c.id);
  
  return {
    campaign_id: c.id,
    name: c.name,
    status: c.status,
    daily_budget: toInt(c.daily_budget)||0,
    lifetime_budget: toInt(c.lifetime_budget)||0,
    // Данные направления
    direction_id: direction?.id || null,                              // ← null для legacy
    direction_name: direction?.name || null,                          // ← null для legacy
    direction_daily_budget_cents: direction?.daily_budget_cents || null,  // ← null для legacy
    direction_target_cpl_cents: direction?.target_cpl_cents || null,      // ← null для legacy
    windows: { ... }
  };
})
```

**Результат для legacy-кампании:**
```javascript
{
  campaign_id: "123456",
  name: "Имплантация — старая кампания",
  status: "ACTIVE",
  daily_budget: 5000,
  direction_id: null,                      // ← null!
  direction_name: null,                    // ← null!
  direction_daily_budget_cents: null,      // ← null!
  direction_target_cpl_cents: null,        // ← null!
  windows: { ... }
}
```

✅ **Legacy-кампании имеют `direction_id: null`!**

---

## 4. Инструкции для LLM (SYSTEM_PROMPT)

```javascript
// services/agent-brain/src/server.js:868-870
'5. Если у кампании НЕТ direction_id (legacy кампании):',
'   - Используй глобальные targets.cpl_cents и targets.daily_budget_cents',
'   - В отчете выделяй их отдельно как "Legacy кампании"',
```

✅ **LLM явно проинструктирован как работать с legacy-кампаниями!**

---

## 5. Пример llmInput для legacy-клиента

```json
{
  "userAccountId": "uuid",
  "account": { ... },
  "limits": { "min_cents": 300, "max_cents": 10000 },
  
  "targets": {
    "cpl_cents": 200,          // ← Из user_accounts
    "daily_budget_cents": 5000 // ← Из user_accounts
  },
  
  "directions": [],  // ← ПУСТОЙ массив для legacy-клиента!
  
  "analysis": {
    "campaigns": [
      {
        "campaign_id": "123456",
        "name": "Имплантация — старая кампания",
        "status": "ACTIVE",
        "daily_budget": 5000,
        "direction_id": null,                      // ← null
        "direction_name": null,                    // ← null
        "direction_daily_budget_cents": null,      // ← null
        "direction_target_cpl_cents": null,        // ← null
        "windows": { ... }
      }
    ],
    "adsets": [ ... ]
  }
}
```

---

## 6. Как LLM обрабатывает legacy-кампании

### Логика LLM:

```javascript
// Псевдокод логики LLM
for (const campaign of llmInput.analysis.campaigns) {
  if (campaign.direction_id) {
    // ✅ Кампания с направлением
    const targetCPL = campaign.direction_target_cpl_cents;
    const targetBudget = campaign.direction_daily_budget_cents;
    const directionName = campaign.direction_name;
    
    console.log(`Направление: ${directionName}, Целевой CPL: $${targetCPL/100}`);
  } else {
    // ✅ Legacy-кампания
    const targetCPL = llmInput.targets.cpl_cents;
    const targetBudget = llmInput.targets.daily_budget_cents;
    
    console.log(`Legacy кампания, Целевой CPL: $${targetCPL/100} (глобальный)`);
  }
}
```

### Пример отчета LLM:

```
📊 ОТЧЁТ ЗА 12 ОКТЯБРЯ 2025

🎯 LEGACY КАМПАНИИ (без направлений):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Имплантация — старая кампания
  Бюджет: $50/день
  Заявки: 25 ($2.00/заявка) ✅ В целевом CPL ($2.00)
  Действие: Бюджет оставлен без изменений

📈 ИТОГО:
• Общий бюджет: $50/день (план: $50) ✅
• Средний CPL: $2.00 (план: $2.00) ✅
```

---

## 7. Миграция legacy-клиентов (опционально)

Если захочешь перевести legacy-клиента на направления:

### Вариант А: Автоматическая миграция

```sql
-- Создать направление для существующей кампании
INSERT INTO account_directions (
  user_account_id,
  name,
  objective,
  fb_campaign_id,
  campaign_status,
  daily_budget_cents,
  target_cpl_cents,
  is_active
)
SELECT
  ua.id,
  'Основное направление',  -- Название по умолчанию
  'whatsapp',              -- Определить из кампании
  c.id,                    -- Facebook Campaign ID
  c.status,
  ua.plan_daily_budget_cents,
  ua.default_cpl_target_cents,
  true
FROM user_accounts ua
JOIN facebook_campaigns c ON c.account_id = ua.ad_account_id
WHERE ua.id = 'legacy-user-uuid'
  AND NOT EXISTS (
    SELECT 1 FROM account_directions 
    WHERE fb_campaign_id = c.id
  );
```

### Вариант Б: Ручная миграция через UI

1. Клиент заходит в личный кабинет
2. Видит сообщение: "У вас есть кампании без направлений. Создайте направления для улучшенного управления."
3. Создаёт направления через UI
4. Привязывает существующие кампании к направлениям

---

## 8. Резюме

### ✅ Что работает для legacy-клиентов:

1. **Загрузка данных:**
   - `directions = []` (пустой массив)
   - `targets` берутся из `user_accounts`

2. **Маппинг кампаний:**
   - `direction_id = null`
   - `direction_daily_budget_cents = null`
   - `direction_target_cpl_cents = null`

3. **LLM понимает:**
   - Если `direction_id === null` → использовать `targets.cpl_cents` и `targets.daily_budget_cents`
   - Выделять legacy-кампании отдельно в отчете

4. **Бюджеты и CPL:**
   - Берутся из `user_accounts.plan_daily_budget_cents` и `user_accounts.default_cpl_target_cents`
   - Работают как раньше, до введения направлений

### ❌ Что НЕ работает для legacy-клиентов:

- ❌ Группировка по направлениям в отчете (т.к. нет направлений)
- ❌ Раздельные бюджеты по направлениям (используется общий бюджет)
- ❌ Креативы с `direction_id` (но это не критично — они могут загружать креативы без направлений)

### 🔄 Миграция:

- **Не обязательна!** Legacy-клиенты могут продолжать работать как раньше.
- **Опционально:** Можно предложить создать направления для улучшенного управления.

---

## 9. Тестирование

### Тест 1: Legacy-клиент без направлений

```bash
# 1. Создать user_account без направлений
# 2. Запустить Brain Agent
curl -X POST http://localhost:8083/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "legacy-user-uuid"
  }'

# 3. Проверить логи
docker logs -f agents-monorepo-agent-brain-1 | grep directions_loaded
# Ожидаем: "directions_loaded: count: 0"

# 4. Проверить что LLM получил targets из user_accounts
# Ожидаем: targets.cpl_cents = 200, targets.daily_budget_cents = 5000
```

### Тест 2: Смешанный клиент (legacy + новые кампании)

```bash
# 1. Создать направление для ОДНОЙ кампании
# 2. Оставить другие кампании без направления
# 3. Запустить Brain Agent
# 4. Проверить что:
#    - Кампания с direction_id использует direction_target_cpl_cents
#    - Кампания без direction_id использует targets.cpl_cents
```

---

## 10. Заключение

✅ **Полная обратная совместимость!**

Legacy-клиенты продолжают работать **без изменений**:
- Бюджеты и CPL берутся из `user_accounts`
- LLM понимает что делать с `direction_id: null`
- Отчеты выделяют legacy-кампании отдельно

Миграция на направления — **опциональна** и может быть выполнена постепенно.

🎯 **Система готова к работе с обоими типами клиентов!**

