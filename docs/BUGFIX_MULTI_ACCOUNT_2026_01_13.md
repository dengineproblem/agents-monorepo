# Исправление критических багов мультиаккаунтности Agent-Brain

**Дата:** 2026-01-13
**Сервис:** agent-brain
**Затронутые файлы:** 4 файла, ~25 изменений

---

## Содержание

1. [Обзор проблем](#обзор-проблем)
2. [БАГ #1: Неправильный подсчёт лидов](#баг-1-неправильный-подсчёт-лидов)
3. [БАГ #2: Смешивание scoring_output между аккаунтами](#баг-2-смешивание-scoring_output-между-аккаунтами)
4. [БАГ #3: Операции с направлениями без проверки account_id](#баг-3-операции-с-направлениями-без-проверки-account_id)
5. [Добавленное логирование](#добавленное-логирование)
6. [Список всех изменений](#список-всех-изменений)
7. [Верификация исправлений](#верификация-исправлений)
8. [Паттерн мультиаккаунтности](#паттерн-мультиаккаунтности)

---

## Обзор проблем

### Симптомы, о которых сообщил пользователь:

1. **Смешивание креативов** — Agent-Brain в полуавтоматическом режиме предлагал запустить креативы одного бизнеса в рекламном кабинете другого бизнеса

2. **Неправильный подсчёт лидов** — агент отключил объявление с максимальным количеством лидов, показывая 0 лидов в отчёте (хотя в Facebook было много лидов)

3. **Несоблюдение бюджетов** — агент не добирал бюджет направлений, не видел корректные данные по бюджетам аккаунтов

### Корневые причины:

| Проблема | Корневая причина |
|----------|------------------|
| Неправильный подсчёт лидов | Отсутствие `action_breakdowns` в запросе к Facebook API |
| Смешивание креативов | Отсутствие фильтра `account_id` при загрузке `scoring_executions` |
| Несоблюдение бюджетов | 13+ мест без проверки `account_id` при операциях с направлениями |

---

## БАГ #1: Неправильный подсчёт лидов

### Описание проблемы

Функция `fetchAdsInsights()` в `scoring.js` не запрашивала параметр `action_breakdowns: 'action_type'` у Facebook API. Без этого параметра Facebook возвращает массив `actions` БЕЗ поля `action_type`, и функция `extractLeads()` не может распознать лиды (всегда возвращает 0).

### Сравнение

```javascript
// fetchAdsetsActions() строка 1135 - ПРАВИЛЬНО ✅
url.searchParams.set('action_breakdowns', 'action_type');

// fetchAdsInsights() строка 1179 - ОТСУТСТВОВАЛО ❌
```

### Исправление

**Файл:** `services/agent-brain/src/scoring.js`
**Строка:** после 1179 (теперь 1180-1182)

```javascript
// КРИТИЧНО: Без action_breakdowns Facebook возвращает actions БЕЗ action_type,
// и extractLeads() не может распознать лиды (возвращает 0)
url.searchParams.set('action_breakdowns', 'action_type');
```

### Как это работает

Facebook API при запросе `actions` возвращает разные форматы в зависимости от `action_breakdowns`:

**Без action_breakdowns:**
```json
{
  "actions": [
    {"value": "5"},
    {"value": "10"}
  ]
}
```

**С action_breakdowns: 'action_type':**
```json
{
  "actions": [
    {"action_type": "lead", "value": "5"},
    {"action_type": "link_click", "value": "10"}
  ]
}
```

Функция `extractLeads()` ищет записи с `action_type` равным `lead`, `onsite_conversion.lead_grouped`, и т.д. Без `action_type` она не может найти лиды.

---

## БАГ #2: Смешивание scoring_output между аккаунтами

### Описание проблемы

В функции `runInteractiveBrain()` (Brain Mini / полуавтоматический режим) загрузка последнего `scoring_execution` фильтровалась ТОЛЬКО по `user_account_id`, без учёта `account_id`. Это приводило к тому, что для Account B загружался отчёт от Account A (если он был более свежим).

### Проблемный код

```javascript
// БЫЛО (строки 2912-2919):
const { data: lastExecution } = await supabase
  .from('scoring_executions')
  .select('scoring_output, completed_at')
  .eq('user_account_id', userAccountId)  // ❌ Только user_account_id!
  .eq('status', 'success')
  .order('completed_at', { ascending: false })
  .limit(1)
  .single();
```

### Исправление

**Файл:** `services/agent-brain/src/scoring.js`
**Строки:** 2911-2951

```javascript
// СТАЛО:
let executionQuery = supabase
  .from('scoring_executions')
  .select('scoring_output, completed_at')
  .eq('user_account_id', userAccountId)
  .eq('status', 'success');

if (accountUUID) {
  executionQuery = executionQuery.eq('account_id', accountUUID);
  log.info({
    where: 'interactive_brain',
    phase: 'scoring_execution_filter',
    accountUUID,
    filterMode: 'multi_account',
    message: 'Фильтрация scoring_executions по account_id (мультиаккаунт)'
  });
} else {
  executionQuery = executionQuery.is('account_id', null);
  log.info({
    where: 'interactive_brain',
    phase: 'scoring_execution_filter',
    filterMode: 'legacy',
    message: 'Фильтрация scoring_executions: account_id IS NULL (legacy режим)'
  });
}

const { data: lastExecution, error: executionError } = await executionQuery
  .order('completed_at', { ascending: false })
  .limit(1)
  .single();

if (executionError && executionError.code !== 'PGRST116') {
  log.warn({
    where: 'interactive_brain',
    phase: 'scoring_execution_error',
    error: executionError.message,
    accountUUID,
    message: 'Ошибка загрузки scoring_execution'
  });
}
```

---

## БАГ #3: Операции с направлениями без проверки account_id

### Описание проблемы

Все операции с таблицей `account_directions` фильтровали ТОЛЬКО по `direction_id`, без проверки что направление принадлежит текущему `account_id`. Это создавало риск:

- Изменения бюджета чужого направления
- Паузы/возобновления чужого направления
- Создания AdSet в чужом направлении
- Загрузки метрик чужого направления

### Затронутые файлы и функции

#### `services/agent-brain/src/chatAssistant/agents/ads/handlers.js`

| Функция | Строки | Описание |
|---------|--------|----------|
| `createAdSet()` | 647-685 | Создание AdSet в кампании |
| `updateDirectionBudget()` | 1282-1328 | Изменение бюджета направления |
| `updateDirectionTargetCPL()` | 1343-1382 | Изменение целевого CPL |
| `pauseDirection()` | 1397-1478 | Пауза направления (2 запроса) |
| `resumeDirection()` | 1482-1563 | Возобновление направления (2 запроса) |
| `getDirectionInsights()` | 2580-2644 | Получение метрик направления |

#### `services/agent-brain/src/chatAssistant/shared/postCheck.js`

| Функция | Строки | Описание |
|---------|--------|----------|
| `verifyDirectionStatus()` | 200-236 | Проверка статуса направления |
| `verifyDirectionBudget()` | 243-279 | Проверка бюджета направления |

#### `services/agent-brain/src/chatAssistant/shared/dryRunHandlers.js`

| Функция | Строки | Описание |
|---------|--------|----------|
| `pauseDirection()` | 205-299 | Preview паузы направления |
| `updateDirectionBudget()` | 305-384 | Preview изменения бюджета |
| `launchCreative()` | 394-470 | Preview запуска креатива |

### Паттерн исправления

Для каждой функции применён единый паттерн:

```javascript
async someFunction({ direction_id, ... }, { adAccountId, adAccountDbId }) {
  const dbAccountId = adAccountDbId || null;

  // Логирование начала операции
  logger.info({
    handler: 'someFunction',
    direction_id,
    dbAccountId,
    filterMode: dbAccountId ? 'multi_account' : 'legacy'
  }, 'someFunction: начало операции');

  // Запрос с фильтрацией по account_id
  let query = supabase
    .from('account_directions')
    .select('...')
    .eq('id', direction_id);

  if (dbAccountId) {
    query = query.eq('account_id', dbAccountId);
  } else {
    query = query.is('account_id', null);
  }

  const { data, error } = await query.single();

  if (error) {
    // Логирование ошибки с hint
    logger.warn({
      handler: 'someFunction',
      direction_id,
      dbAccountId,
      error: error.message,
      hint: dbAccountId
        ? 'Направление не найдено или не принадлежит этому аккаунту'
        : 'Направление не найдено'
    }, 'someFunction: направление не найдено');

    return {
      success: false,
      error: `Направление не найдено или недоступно: ${error.message}`
    };
  }

  // ... остальная логика
}
```

---

## Добавленное логирование

### Формат логов

Все логи используют структурированный JSON формат:

```javascript
logger.info({
  handler: 'functionName',      // Название функции
  direction_id: '...',          // ID направления
  dbAccountId: '...' | null,    // UUID аккаунта или null для legacy
  filterMode: 'multi_account' | 'legacy',  // Режим работы
  // ... дополнительные поля
}, 'functionName: описание действия');
```

### Уровни логирования

| Уровень | Когда используется |
|---------|-------------------|
| `info` | Начало операции, успешные действия |
| `warn` | Направление не найдено, возможное несоответствие аккаунта |
| `error` | Критические ошибки (уже были в коде) |

### Примеры логов

**Успешная операция в мультиаккаунтном режиме:**
```json
{
  "level": "info",
  "handler": "updateDirectionBudget",
  "direction_id": "abc-123",
  "new_budget": 100,
  "dbAccountId": "def-456",
  "filterMode": "multi_account",
  "msg": "updateDirectionBudget: начало операции"
}
```

**Направление не найдено (возможно, чужой аккаунт):**
```json
{
  "level": "warn",
  "handler": "updateDirectionBudget",
  "direction_id": "abc-123",
  "dbAccountId": "def-456",
  "error": "PGRST116: JSON object requested, multiple (or no) rows returned",
  "hint": "Направление не найдено или не принадлежит этому аккаунту",
  "msg": "updateDirectionBudget: ошибка обновления"
}
```

**Legacy режим:**
```json
{
  "level": "info",
  "handler": "pauseDirection",
  "direction_id": "abc-123",
  "dbAccountId": null,
  "filterMode": "legacy",
  "msg": "pauseDirection: начало операции"
}
```

### Где искать логи

```bash
# Все логи agent-brain
docker-compose logs -f agent-brain

# Фильтрация по handler
docker-compose logs agent-brain | grep "updateDirectionBudget"

# Фильтрация по filterMode
docker-compose logs agent-brain | grep "multi_account"

# Только warnings
docker-compose logs agent-brain | grep '"level":"warn"'
```

---

## Список всех изменений

### `services/agent-brain/src/scoring.js`

| Строки | Изменение |
|--------|-----------|
| 1180-1182 | Добавлен `action_breakdowns: 'action_type'` в `fetchAdsInsights()` |
| 2911-2951 | Добавлена фильтрация `scoring_executions` по `account_id` с логированием |

### `services/agent-brain/src/chatAssistant/agents/ads/handlers.js`

| Строки | Функция | Изменение |
|--------|---------|-----------|
| 647-685 | `createAdSet()` | Добавлен `adAccountDbId`, фильтрация, логирование |
| 1282-1340 | `updateDirectionBudget()` | Добавлен `adAccountDbId`, фильтрация, логирование |
| 1343-1395 | `updateDirectionTargetCPL()` | Добавлен `adAccountDbId`, фильтрация, логирование |
| 1397-1478 | `pauseDirection()` | Добавлен `adAccountDbId`, фильтрация в 2 запросах, логирование |
| 1482-1563 | `resumeDirection()` | Добавлен `adAccountDbId`, фильтрация в 2 запросах, логирование |
| 2580-2644 | `getDirectionInsights()` | Добавлена фильтрация, логирование |

### `services/agent-brain/src/chatAssistant/shared/postCheck.js`

| Строки | Функция | Изменение |
|--------|---------|-----------|
| 200-236 | `verifyDirectionStatus()` | Добавлен опциональный параметр `adAccountDbId`, фильтрация |
| 243-279 | `verifyDirectionBudget()` | Добавлен опциональный параметр `adAccountDbId`, фильтрация |

### `services/agent-brain/src/chatAssistant/shared/dryRunHandlers.js`

| Строки | Функция | Изменение |
|--------|---------|-----------|
| 205-299 | `pauseDirection()` | Добавлен `adAccountDbId`, фильтрация, логирование |
| 305-384 | `updateDirectionBudget()` | Добавлен `adAccountDbId`, фильтрация, логирование |
| 394-470 | `launchCreative()` | Добавлен `adAccountDbId`, фильтрация, логирование |

---

## Верификация исправлений

### Проверка что код применился в контейнере

```bash
# БАГ #1: action_breakdowns
docker exec agents-monorepo-agent-brain-1 grep -n "action_breakdowns" /app/src/scoring.js

# БАГ #2: фильтрация scoring_executions
docker exec agents-monorepo-agent-brain-1 grep -n "scoring_execution_filter" /app/src/scoring.js

# БАГ #3: filterMode в handlers
docker exec agents-monorepo-agent-brain-1 grep -n "filterMode.*multi_account" /app/src/chatAssistant/agents/ads/handlers.js

# БАГ #3: dry-run handlers
docker exec agents-monorepo-agent-brain-1 grep -n "dryRun:" /app/src/chatAssistant/shared/dryRunHandlers.js
```

### Функциональное тестирование

#### Тест БАГ #1 (лиды):

1. Запустить Brain для аккаунта с активными объявлениями
2. В логах найти `fetchAdsInsights`
3. Проверить что `actions` содержат `action_type`
4. Убедиться что `extractLeads()` возвращает правильное число

#### Тест БАГ #2 (scoring_output):

1. Создать 2 `ad_accounts` для одного пользователя
2. Запустить `/api/brain/run` для каждого (создать `scoring_executions`)
3. Запустить Brain Mini для Account B
4. В логах найти `scoring_execution_filter`
5. Убедиться что `filterMode: 'multi_account'` и `accountUUID` соответствует Account B
6. Проверить что предлагаются креативы ТОЛЬКО от Account B

#### Тест БАГ #3 (направления):

1. Создать 2 `ad_accounts` с направлениями
2. Попытаться вызвать `updateDirectionBudget` с `direction_id` от Account A, но в контексте Account B
3. В логах найти `updateDirectionBudget: направление не найдено`
4. Убедиться что операция ОТКЛОНЕНА

---

## Паттерн мультиаккаунтности

### Как определяется режим работы

```javascript
// В server.js функция getAccountUUID():
async function getAccountUUID(userAccountId, ua) {
  if (!ua?.multi_account_enabled) {
    return null; // Legacy режим - account_id не используется
  }
  // ... загрузка UUID из ad_accounts
  return adAccount.id; // Мультиаккаунтный режим
}
```

### Правило проверки

```javascript
// ПРАВИЛЬНО ✅ - проверяем значение accountUUID
if (accountUUID) {
  query = query.eq('account_id', accountUUID);
} else {
  query = query.is('account_id', null);
}

// НЕПРАВИЛЬНО ❌ - не проверяем наличие accountUUID для определения режима
if (accountUUID) {
  // multi-account
}
// нет else → legacy записи не найдутся!
```

### Почему `is('account_id', null)` для legacy

В legacy режиме (до мультиаккаунтности) все записи создавались с `account_id = NULL`. Для обратной совместимости нужно явно искать записи где `account_id IS NULL`, а не просто опускать фильтр.

---

## Дополнительный аудит (13.01.2026)

После первоначальных исправлений был проведён полный аудит кода agent-brain на наличие других проблем изоляции данных.

### Найденные и исправленные уязвимости

#### КРИТИЧЕСКИЕ

| # | Файл | Функция | Проблема | Исправление |
|---|------|---------|----------|-------------|
| 1 | scoring.js | `saveCreativeMetricsToHistory()` | `ad_creative_mapping` без фильтра | Добавлен паттерн `if/else` с `filterMode` |
| 2 | scoring.js | `interactiveBrain()` SELECT | `brain_executions` без фильтра | Добавлен фильтр + логирование |
| 3 | scoring.js | `interactiveBrain()` INSERT | Не сохранялся `account_id` | Добавлен `account_id: accountUUID \|\| null` |
| 4 | roiCalculator.ts | `calculateCreativeROI()` | Не фильтровал leads/purchases | Добавлен параметр `accountId` |
| 5 | analyzerService.js | `/creative-analytics` | Нет фильтра по `account_id` | Добавлен query param и фильтрация |
| 6 | analyzerService.js | `/analyze-creative` | Нет проверки ownership | Добавлен `.eq('user_id', userId)` |

#### ВЫСОКИЕ

| # | Файл | Функция | Проблема | Исправление |
|---|------|---------|----------|-------------|
| 7 | ads/handlers.js | `getDirectionCreatives()` | Без `adAccountDbId` | Добавлен параметр и фильтрация |
| 8 | dryRunHandlers.js | `pauseCreative()` | Без фильтра | Добавлен `adAccountDbId` + фильтр |
| 9 | dryRunHandlers.js | `launchCreative()` | `user_creatives` без фильтра | Добавлена фильтрация |
| 10 | dryRunHandlers.js | `startCreativeTest()` | Без фильтра | Добавлена фильтрация |
| 11 | dryRunHandlers.js | `pauseDirection` | Подсчёты без фильтра | Добавлена фильтрация |
| 12 | creative/handlers.js | `getCreativeDetails()` | `ad_creative_mapping`, `creative_analysis` без фильтра | Добавлена фильтрация |
| 13 | creative/handlers.js | `getCreativeAnalysis()` | Без фильтра | Реализован TODO из комментария |
| 14 | creative/handlers.js | `getCreativeTranscript()` | Без фильтра | Добавлена фильтрация |
| 15 | creative/handlers.js | `startCreativeTest()` | Без фильтра | Добавлена фильтрация |

### Добавленное логирование

Во все исправленные функции добавлено структурированное логирование с `filterMode`:

```javascript
logger.info({
  handler: 'functionName',
  direction_id,
  dbAccountId,
  filterMode: dbAccountId ? 'multi_account' : 'legacy'
}, 'functionName: описание операции');
```

### Файлы с изменениями

| Файл | Изменения |
|------|-----------|
| `scoring.js` | 2004, 2017-2022, 3068, 3082-3088, 4335, 4418 |
| `roiCalculator.ts` | 108-118, 150-158 |
| `analyzerService.js` | 708-714, 1106-1115 |
| `ads/handlers.js` | 1081-1089 |
| `dryRunHandlers.js` | 212, 313, 402, 415-421, 537-542, 632-637 |
| `creative/handlers.js` | 174-182, 338-346 |

### FALSE POSITIVE (не требуют исправления)

| Endpoint | Причина |
|----------|---------|
| `/analyze-batch` | Cron endpoint для глобальной обработки всех тестов |
| `/analyze-test` | Получает `account_id` через JOIN с `user_creatives` |

### Верификация в контейнерах

```bash
# Проверить filterMode в scoring.js
docker exec agents-monorepo-agent-brain-1 grep -n "filterMode" /app/src/scoring.js

# Проверить filterMode в analyzerService.js
docker exec agents-monorepo-agent-brain-1 grep -n "filterMode" /app/src/analyzerService.js

# Проверить filterMode в handlers
docker exec agents-monorepo-agent-brain-1 grep -n "filterMode" /app/src/chatAssistant/agents/creative/handlers.js

# Проверить roiCalculator в agent-service
docker exec agents-monorepo-agent-service-1 grep -n "filterMode" /app/dist/lib/roiCalculator.js
```

---

## БАГ #4: Brain Mini не выполняет действия при одобрении

### Дата исправления: 2026-01-13

### Описание проблемы

При нажатии кнопки "Одобрить" в модальном окне Brain Mini, система повторно запускала анализ вместо выполнения одобренных proposals. Пользователь видел что анализ прошёл заново, но действия (updateBudget, pauseAdSet, createAdSet) не выполнялись.

### Корневая причина

В функции `triggerBrainOptimizationRun()` (файл `ads/handlers.js`) параметр `dry_run` игнорировался:

```javascript
// БЫЛО (строки 2279-2281):
// INTERACTIVE MODE: Generate proposals (dry_run=true или false)
// runInteractiveBrain ВСЕГДА только генерирует proposals БЕЗ исполнения
// dry_run влияет только на отображение в UI  // ❌ НЕПРАВИЛЬНО!
```

Frontend при одобрении вызывал `runBrainMiniStream({ dryRun: false })`, но backend игнорировал этот параметр и всегда только генерировал proposals.

### Исправление

**Файл:** `services/agent-brain/src/chatAssistant/agents/ads/handlers.js`
**Строки:** 2378-2592

Добавлена логика выполнения proposals когда `dry_run=false`:

```javascript
// СТАЛО:
if (!dry_run && result.proposals && result.proposals.length > 0) {
  // Выполняем каждый proposal
  for (const proposal of result.proposals) {
    switch (proposal.action) {
      case 'updateBudget':
        await this.updateBudget({ adset_id: proposal.entity_id, ... }, toolContext);
        break;
      case 'pauseAdSet':
        await this.pauseAdSet({ adset_id: proposal.entity_id, ... }, toolContext);
        break;
      case 'createAdSet':
        await this.createAdSet({ direction_id: proposal.direction_id, creative_ids: [...] }, toolContext);
        break;
      // ... и другие действия
    }
  }

  // Сохраняем результаты в brain_executions
  await supabase.from('brain_executions').insert({ ... });

  return { success: true, mode: 'executed', execution_results: [...] };
}
```

### Поддерживаемые действия

| Action | Handler | Описание |
|--------|---------|----------|
| `updateBudget` | `this.updateBudget()` | Изменение бюджета адсета |
| `pauseAdSet` | `this.pauseAdSet()` | Пауза адсета |
| `pauseAd` | `this.pauseAd()` | Пауза объявления |
| `enableAdSet` | `this.resumeAdSet()` | Включение адсета |
| `enableAd` | `this.resumeAd()` | Включение объявления |
| `createAdSet` | `this.createAdSet()` | Создание нового адсета с креативами |
| `launchNewCreatives` | `this.createAdSet()` | Алиас для createAdSet |
| `review` | - | Пропускается (только для информации) |

### Дополнительные изменения

1. **Добавлен `page_id`** в контекст выполнения (нужен для `createAdSet`):
   - Из `ad_accounts.page_id` в multi-account режиме
   - Из `user_accounts.page_id` в legacy режиме

2. **Логирование выполнения:**
   - `execution_mode_start` — начало выполнения
   - `executing_proposal` — для каждого действия
   - `proposal_executed` — результат каждого действия
   - `proposal_execution_error` — при ошибке

3. **Сохранение истории** в `brain_executions`:
   - `execution_mode: 'manual_trigger'`
   - `triggered_by: 'brain_mini_execute'`
   - `status: 'success' | 'partial'`

### Верификация

```bash
# Проверить что код выполнения есть
docker exec agents-monorepo-agent-brain-1 grep -n "execution_mode_start" /app/src/chatAssistant/agents/ads/handlers.js

# Проверить логи выполнения
docker-compose logs agent-brain | grep "execution_mode"

# Проверить что brain_executions создаются
docker-compose logs agent-brain | grep "brain_mini_execute"
```

### Тестирование

1. Нажать кнопку Brain Mini на аккаунте/направлении
2. Дождаться анализа и появления proposals
3. Нажать "Одобрить"
4. Проверить в логах:
   - `execution_mode_start` с количеством proposals
   - `executing_proposal` для каждого действия
   - `proposal_executed` с результатом
5. Проверить в Facebook Ads Manager что действия выполнены

---

## Контакты

При возникновении вопросов по этим исправлениям:
- Проверить логи: `docker-compose logs -f agent-brain | grep "filterMode"`
- Проверить логи выполнения: `docker-compose logs -f agent-brain | grep "execution_mode"`
- Документация мультиаккаунтности: `docs/MULTI_ACCOUNT_GUIDE.md`
