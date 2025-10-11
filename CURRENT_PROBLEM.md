# 🐛 ТЕКУЩАЯ ПРОБЛЕМА: Scoring Agent возвращает пустые массивы креативов

**Дата:** 2025-10-11  
**Статус:** В процессе решения  
**Критичность:** Высокая (блокирует работу agent-brain)

---

## 📋 КРАТКОЕ ОПИСАНИЕ

Agent Brain (daily cron) запускается успешно, но получает **пустые массивы** `ready_creatives` и `unused_creatives` от Scoring Agent, несмотря на то что в Supabase есть 4 активных креатива.

---

## 🎯 ЧТО ДОЛЖНО РАБОТАТЬ

1. **Scoring Agent** должен:
   - Получить из Supabase список всех активных креативов пользователя (`is_active=true`, `status='ready'`)
   - Для каждого креатива собрать historical performance за 30 дней через Facebook API (impressions, spend, leads, CPL, CTR)
   - Определить какие креативы сейчас используются в активных ads (через Facebook API)
   - Вернуть два массива:
     - `ready_creatives`: ВСЕ активные креативы с их статистикой
     - `unused_creatives`: креативы НЕ используемые в активных ads

2. **LLM** должен:
   - Получить эти массивы в `llmInput.scoring`
   - Если есть `unused_creatives` → создать новую кампанию с НЕСКОЛЬКИМИ креативами через `CreateCampaignWithCreative`
   - Если нет `unused_creatives` но есть `ready_creatives` → ротация лучших креативов

---

## ❌ ЧТО НЕ РАБОТАЕТ (СИМПТОМЫ)

### 1. Пустые массивы от Scoring Agent
```json
{
  "scoring_unused_creatives_count": 0,
  "scoring_unused_creatives": [],
  "scoring_ready_creatives_count": 0
}
```

### 2. LLM получает пустые данные
Несмотря на пустые массивы, LLM **успешно генерирует план** (видно `"status": "completed"` в логах), но:
- Не видим финальный JSON план в логах (обрезан)
- После LLM сразу идет `fetch failed: ETIMEDOUT` при отправке в Telegram

### 3. Telegram dispatch падает
```
TypeError: fetch failed
caused by: AggregateError [ETIMEDOUT]
at async sendTelegram
```

---

## ✅ ЧТО УЖЕ ПРОВЕРИЛИ И ИСПРАВИЛИ

### 1. Creatives существуют в Supabase ✅
```sql
SELECT id, title, is_active, status, fb_creative_id_whatsapp 
FROM user_creatives 
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
```
**Результат:** 4 креатива (`is_active=true`, `status='ready'`, все имеют `fb_creative_id_whatsapp`)

### 2. Исправлена ошибка `TypeError: activeCreativeIds.has is not a function` ✅
- **Причина:** `getActiveCreativeIds()` возвращала объект `{ creativeIdsSet, creativeToAdsMap }`, а код ожидал `Set`
- **Фикс:** Обновили код на `activeCreativeIds.creativeIdsSet.has(id)`

### 3. Исправлена ошибка `TypeError: Cannot read properties of undefined (reading 'size')` ✅
- **Причина:** Docker контейнер использовал старую версию кода
- **Фикс:** 
  ```bash
  docker-compose build --no-cache agent-brain
  docker-compose up -d agent-brain
  ```

### 4. Контейнер успешно перезапущен ✅
```
agents-monorepo-agent-brain-1  | {"level":30,"where":"scoring_agent","phase":"complete"}
agents-monorepo-agent-brain-1  | {"level":30,"where":"brain_run","phase":"scoring_complete"}
```

### 5. LLM успешно получает данные и отвечает ✅
```json
{
  "status": "completed",
  "model": "gpt-5-2025-08-07",
  "output": [{"type": "reasoning", "summary": "...
```

---

## 🔍 ЧТО НЕ ПРОВЕРИЛИ / ОСТАЛОСЬ СДЕЛАТЬ

### 1. **Почему Scoring Agent возвращает пустые массивы?** 🔴 КРИТИЧНО
Логи показывают:
```
{"where":"scoring_agent","phase":"creatives_fetched","total_creatives":4,"active_in_ads":5}
{"where":"scoring_agent","phase":"creatives_processed","total":0,"with_stats":0}
{"where":"scoring_agent","phase":"unused_creatives_identified","count":3}
```

**ПРОТИВОРЕЧИЕ:**
- `creatives_fetched: 4` ✅
- `creatives_processed: 0` ❌ (должно быть 4!)
- `unused_creatives: 3` ❓ (откуда, если processed=0?)

**ГИПОТЕЗА:** 
- Creatives успешно получены из Supabase
- НО при обработке (сбор Facebook stats) происходит ошибка/пропуск
- В итоге `ready_creatives` остается пустым
- `unused_creatives` определяется некорректно (показывает 3, но массив пустой)

**ЧТО ПРОВЕРИТЬ:**
- Логику обработки креативов в `scoring.js` после `phase:"creatives_fetched"`
- Почему `with_stats:0` при `total_creatives:4`?
- Возможно, Facebook API не возвращает статистику или падает с ошибкой (но ошибка не логируется)

### 2. **Увидеть финальный JSON план от LLM** 🟡 ВАЖНО
Ответ LLM обрезан в логах. Нужно:
```bash
# Включить DEBUG флаг для записи в файл
docker exec agents-monorepo-agent-brain-1 sh -c "echo 'DEBUG_LLM_INPUT=true' >> /app/.env"
docker-compose restart agent-brain

# Запустить повторный запрос
curl -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{"userAccountId":"0f559eb0-53fa-4b6a-a51b-5d3e15e5864b","inputs":{"dispatch":false}}'

# Посмотреть результат
docker exec agents-monorepo-agent-brain-1 cat /tmp/llm_input_debug.json
```

ИЛИ проверить в Supabase:
```sql
SELECT result_json 
FROM agent_executions 
WHERE ad_account_id = 'act_1090206589147369'
ORDER BY created_at DESC 
LIMIT 1;
```

### 3. **Telegram dispatch timeout** 🟢 НЕКРИТИЧНО
```
TypeError: fetch failed
caused by: AggregateError [ETIMEDOUT]
```

Это **сетевая ошибка** (Docker не может достучаться до Telegram API), НЕ блокирует основную логику. Можно игнорировать для текущей задачи.

---

## 🎯 ПРИОРИТЕТНЫЙ ПЛАН ДЕЙСТВИЙ

### Шаг 1: Добавить детальное логирование в `scoring.js` (КРИТИЧНО)
Найти место где обрабатываются creatives после `phase:"creatives_fetched"` и добавить логи:
```javascript
// В scoring.js после получения creatives из Supabase
for (const creative of userCreatives) {
  console.log('[DEBUG] Processing creative:', {
    id: creative.id,
    title: creative.title,
    fb_creative_id_whatsapp: creative.fb_creative_id_whatsapp
  });
  
  // Здесь должна быть логика сбора stats через Facebook API
  try {
    // ... код сбора статистики ...
    console.log('[DEBUG] Stats collected for creative:', creative.id);
  } catch (error) {
    console.error('[DEBUG] Failed to collect stats for creative:', creative.id, error);
  }
}
```

### Шаг 2: Проверить финальный output от LLM
Либо через Supabase (`agent_executions.result_json`), либо через DEBUG флаг.

### Шаг 3: Если нужно - пофиксить логику в `scoring.js`
В зависимости от того что покажут логи из Шага 1.

---

## 📂 РЕЛЕВАНТНЫЕ ФАЙЛЫ

1. **`/Users/anatolijstepanov/agents-monorepo/services/agent-brain/src/scoring.js`**
   - Функция `runScoringAgent()`
   - Функция `getActiveCreativeIds()`
   - Логика обработки креативов и сбора stats

2. **`/Users/anatolijstepanov/agents-monorepo/services/agent-brain/src/server.js`**
   - Строки 1800-2000: интеграция Scoring Agent в Brain
   - Строки 800-900: промпт LLM с инструкциями по работе с `unused_creatives`

3. **Supabase таблицы:**
   - `user_creatives`: хранит креативы пользователя
   - `agent_executions`: хранит результаты запусков agent-brain
   - `agent_actions`: хранит отдельные actions из executions

---

## 🔗 КОНТЕКСТ

- **Модель:** GPT-5 (gpt-5-2025-08-07)
- **User ID:** `0f559eb0-53fa-4b6a-a51b-5d3e15e5864b`
- **Ad Account:** `act_1090206589147369`
- **Timezone:** Asia/Almaty (+05:00)
- **Cron Schedule:** `0 8 * * *` (08:00 по таймзоне аккаунта)

---

## 💡 ВОЗМОЖНЫЕ КОРНЕВЫЕ ПРИЧИНЫ

1. **Facebook API не возвращает статистику** для креативов (нет impressions за 30 дней)
2. **Ошибка в логике фильтрации** - креативы пропускаются из-за некорректного условия
3. **Async/await проблема** - промисы не резолвятся и `ready_creatives` остается пустым
4. **Mapping error** - креативы обрабатываются, но не добавляются в финальный массив
5. **LLM возвращает невалидный JSON** (маловероятно, т.к. status=completed)

---

## 📝 ПОСЛЕДНИЕ ЛОГИ (для контекста)

```
agents-monorepo-agent-brain-1  | {"where":"scoring_agent","phase":"fetching_creatives"}
agents-monorepo-agent-brain-1  | {"where":"scoring_agent","phase":"creatives_fetched","total_creatives":4,"active_in_ads":5}
agents-monorepo-agent-brain-1  | {"where":"scoring_agent","phase":"creatives_processed","total":0,"with_stats":0}
agents-monorepo-agent-brain-1  | {"where":"scoring_agent","phase":"unused_creatives_identified","count":3}
agents-monorepo-agent-brain-1  | {"where":"scoring_agent","phase":"complete","duration":2754,"stats":{"adsets":3,"creatives":0}}
agents-monorepo-agent-brain-1  | {"where":"llm_input_debug","scoring_unused_creatives_count":3,"scoring_unused_creatives":[...3 items...],"scoring_ready_creatives_count":0}
agents-monorepo-agent-brain-1  | {"where":"responsesCreate","status":200,"body":"...\"status\": \"completed\"..."}
agents-monorepo-agent-brain-1  | {"err":{"type":"TypeError","message":"fetch failed: ETIMEDOUT"},"msg":"fetch failed"}
```

---

## ✅ КРИТЕРИЙ УСПЕХА

Когда проблема будет решена, мы должны увидеть в логах:
```json
{
  "where": "llm_input_debug",
  "scoring_ready_creatives_count": 4,  // ← НЕ 0!
  "scoring_unused_creatives_count": 3  // ← OK
}
```

И LLM должен создать action `CreateCampaignWithCreative` с `user_creative_ids: [uuid1, uuid2, uuid3]`.

---

**Удачи в решении! 🚀**

