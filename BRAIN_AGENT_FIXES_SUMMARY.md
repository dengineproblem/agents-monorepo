# 🔧 Brain Agent: Исправления и улучшения

**Дата:** 8 октября 2025

---

## 1. ✅ WhatsApp Phone Number - Полная интеграция

### Проблема
WhatsApp кампании создавались без `whatsapp_phone_number` в `promoted_object`, что могло приводить к ошибкам.

### Решение
Добавлена сквозная передача `whatsapp_phone_number` через все агенты:

#### **Brain Agent** (`services/agent-brain/src/server.js`)
- `getUserAccount()`: добавлен select `whatsapp_phone_number`
- `sendActionsBatch()`: передает `whatsappPhoneNumber` в account object
- Вызов: `sendActionsBatch(idem, userAccountId, actions, ua?.whatsapp_phone_number)`

#### **Actions System** (`services/agent-service/src/routes/actions.ts`)
- `AccountSchema`: добавлено `whatsappPhoneNumber: z.string().optional()`
- `resolveAccessToken()`: fetch `whatsapp_phone_number` из Supabase
- `handleAction()`: передача в context для workflow

#### **Create Campaign Workflow** (`services/agent-service/src/workflows/createCampaignWithCreative.ts`)
- `CreateCampaignContext`: добавлен `whatsapp_phone_number?: string`
- Adset creation: включает в `promoted_object` если WhatsApp кампания

**Результат:** Все WhatsApp кампании теперь автоматически используют номер из `user_accounts` таблицы.

---

## 2. ✅ Today-компенсация - УСИЛЕННАЯ

### Проблема
- Today-компенсация была слабая: максимум +10 баллов
- Вчерашние штрафы: до -60 баллов (CPL -30 + диагностика -30)
- **Результат:** Даже с отличными результатами СЕГОДНЯ, Health Score оставался `bad`

**Реальный кейс:**
- Вчера: CPL $4 → HS = bad → Brain снизил бюджет
- Сегодня: CPL $1.5 (отлично!) → но уже поздно, кампания урезана

### Решение

#### **Динамическая компенсация** (`services/agent-brain/src/server.js`, строки 504-523)

```javascript
// БЫЛО: максимум +10
todayAdj = Math.min(10, weights.cpl_gap/3);

// СТАЛО: динамическая компенсация
if (eToday <= 0.5*eCplY) {
  // В 2 раза лучше → ПОЛНАЯ компенсация
  todayAdj = Math.abs(Math.min(0, cplScore)) + 15;
} else if (eToday <= 0.7*eCplY) {
  // На 30% лучше → 60% компенсации
  todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.6) + 10;
} else if (eToday <= 0.9*eCplY) {
  // Легкое улучшение → +5
  todayAdj = 5;
}
```

#### **Обновленный промпт** (строки 811-816, 847)
```
Today-компенсация (УСИЛЕННАЯ):
• eCPL_today ≤ 0.5×eCPL_yesterday → ПОЛНАЯ компенсация + бонус
• eCPL_today ≤ 0.7×eCPL_yesterday → 60% компенсации
• eCPL_today ≤ 0.9×eCPL_yesterday → +5

⚠️ ВАЖНО: Хорошие результаты СЕГОДНЯ должны перевешивать плохие результаты ВЧЕРА!
```

### Примеры

**Пример 1: Отличные результаты**
- Вчера: CPL $4 → штраф -30
- Сегодня: CPL $1.5 (в 2.7 раза лучше) → компенсация +45
- **Результат:** HS = -30 + 45 = **+15 (good)** ✅

**Пример 2: Хорошие результаты**
- Вчера: CPL $3 → штраф -15
- Сегодня: CPL $1.8 (на 40% лучше) → компенсация +19
- **Результат:** HS = -15 + 19 = **+4 (neutral)** ✅

**Результат:** Brain Agent теперь правильно реагирует на текущие данные, не убивая хорошие кампании из-за вчерашних просадок.

---

## 3. ✅ Фильтрация неактивных adsets - ИСПРАВЛЕНА

### Проблема
В LLM попадали **ВСЕ adsets с затратами вчера**, включая неактивные/паузированные:

```javascript
// БЫЛО (строка 1461):
const adsetsWithYesterdayResults = adsetList.filter(as => {
  const hasResults = (spend > 0 || leads > 0);
  return hasResults; // ❌ Нет проверки статуса!
});
```

**Последствия:**
- LLM генерировал actions для неактивных adsets
- Actions отправлялись в executor, но не выполнялись
- Путаница в логике: "почему LLM трогает паузированные кампании?"

### Решение

#### **Фильтр 1: Детерминистическая логика** (строка 1461-1467)
```javascript
const adsetsWithYesterdayResults = adsetList.filter(as => {
  // Только АКТИВНЫЕ adsets с затратами вчера
  if (as.effective_status !== 'ACTIVE') return false;
  const yesterdayData = byY.get(as.id)||{};
  const hasResults = (spend > 0 || leads > 0);
  return hasResults;
});
```

#### **Фильтр 2: Данные для LLM** (строка 1626-1633)
```javascript
adsets: (adsetList||[])
  .filter(as => {
    // Только АКТИВНЫЕ adsets с затратами вчера (для LLM)
    if (as.effective_status !== 'ACTIVE') return false;
    const hasResults = (spend > 0 || leads > 0);
    return hasResults;
  })
```

#### **Logging для отладки** (строка 1469-1477)
```javascript
fastify.log.info({
  where: 'brain_run',
  phase: 'adsets_filtered',
  userId: userAccountId,
  total_adsets: adsetList.length,
  active_adsets: adsetList.filter(a => a.effective_status === 'ACTIVE').length,
  with_yesterday_results: adsetsWithYesterdayResults.length,
  filtered_out: adsetList.length - adsetsWithYesterdayResults.length
});
```

#### **Обновленный промпт** (строки 773-774, 922)
```
✅ В данных показаны ТОЛЬКО АКТИВНЫЕ ad set с результатами за вчера
   (effective_status="ACTIVE" И (spend > 0 ИЛИ leads > 0)).
   
✅ ВСЕ ad set в данных уже АКТИВНЫЕ - неактивные отфильтрованы автоматически.
   Можешь безопасно генерировать actions для любого ad set из списка.
```

### Результат
**До изменений:**
```json
{
  "trace": {
    "adsets": [
      {"name": "Вебинар", "hs": -53},
      {"name": "Старые", "hs": 15},
      {"name": "Мемы", "hs": 15},
      {"name": "Новые крео 5", "hs": 18, "spend": 0} // ❌ Неактивный!
    ]
  }
}
```

**После изменений:**
```json
{
  "trace": {
    "adsets": [
      {"name": "Старые", "hs": 15},
      {"name": "Мемы", "hs": 15}
      // ✅ "Новые крео 5" отфильтрован
    ]
  }
}
```

---

## 4. ❓ Actions не выполняются полностью - ТРЕБУЕТ ДОРАБОТКИ

### Наблюдение
LLM сгенерировал 3 UpdateAdSetDailyBudget actions:
1. "Старые": 1500 → 1950 ❌ **НЕ сработало**
2. "Мемы": 1500 → 1800 ❌ **НЕ сработало**
3. "Новые крео 5": 1500 → 750 ✅ **СРАБОТАЛО**

### Возможные причины
1. **Facebook API ошибка** для первых двух (например, превышение лимита)
2. **Validation** в agent-service отклонил
3. **Синхронное выполнение** остановилось после ошибки
4. **Конфликт** детерминистических и LLM actions

### Необходимые действия
- [ ] Проверить логи `action_executions` в Supabase
- [ ] Добавить детальное логирование в agent-service
- [ ] Проверить Facebook API response для каждого action
- [ ] Убедиться что actions выполняются независимо (параллельно)

---

## Измененные файлы

### services/agent-brain/src/server.js
- `computeHealthScoreForAdset()` - усиленная today-компенсация
- `getUserAccount()` - select whatsapp_phone_number
- `sendActionsBatch()` - передача whatsappPhoneNumber
- `adsetsWithYesterdayResults` filter - проверка effective_status
- `llmInput.analysis.adsets` filter - проверка effective_status
- `SYSTEM_PROMPT` - обновленные инструкции

### services/agent-service/src/routes/actions.ts
- `AccountSchema` - добавлено whatsappPhoneNumber
- `resolveAccessToken()` - fetch whatsapp_phone_number
- `handleAction()` - передача в context

### services/agent-service/src/actions/schema.ts
- `AccountSchema` - добавлено whatsappPhoneNumber field

### services/agent-service/src/workflows/createCampaignWithCreative.ts
- `CreateCampaignContext` - добавлено whatsapp_phone_number
- Adset creation - использование whatsapp_phone_number в promoted_object

---

## Тестирование

### Команды для локального теста
```bash
# 1. Запустить agent-brain
cd services/agent-brain
export OPENAI_API_KEY="your-key"
export BRAIN_MODEL="gpt-5"
node src/server.js

# 2. В другом терминале: agent-service
cd services/agent-service
npm run build && node dist/server.js

# 3. Тест без выполнения (preview)
curl -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_USER_ID",
    "inputs": {"dispatch": false}
  }'

# 4. Тест с выполнением
curl -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_USER_ID",
    "inputs": {"dispatch": true}
  }'
```

### Проверка результатов
1. **Health Scores**: проверить что today-компенсация работает
2. **Filtered adsets**: убедиться что неактивные не попадают в trace
3. **Actions execution**: все actions выполнены успешно
4. **WhatsApp campaigns**: promoted_object содержит whatsapp_phone_number

---

## Дата внедрения
**8 октября 2025**

## Следующие шаги
1. Диагностировать почему не все actions выполняются
2. Добавить retry logic для failed actions
3. Улучшить мониторинг execution status
4. Документировать все edge cases

