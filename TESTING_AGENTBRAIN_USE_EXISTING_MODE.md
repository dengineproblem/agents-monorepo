# 🧪 Testing Guide: AgentBrain + Pre-Created Ad Sets Integration

**Дата**: 2025-11-06  
**Версия**: 1.0  
**Статус**: Ready for Testing  

---

## 📋 Контекст и проблема

### Исходная проблема
Meta API возвращает **ошибку 2446885** при создании ad sets с явным указанием WhatsApp номера для пользователей с несколькими направлениями бизнеса (например: "Имплантация", "Виниры", "Брекеты").

### Решение
Создавать ad sets **вручную** в Facebook Ads Manager (со статусом PAUSED) и **использовать их** через наше приложение. AgentBrain научился работать с такими pre-created ad sets.

---

## 🎯 Что было реализовано

### Два режима работы

#### 1. **api_create** (по умолчанию)
- Создание новых ad sets через Facebook API
- Работает для пользователей с **одним направлением**
- Action: `Direction.CreateAdSetWithCreatives`

#### 2. **use_existing** (новый)
- Использование заранее созданных PAUSED ad sets
- Для пользователей с **несколькими направлениями**
- Action: `Direction.UseExistingAdSetWithCreatives`

### Архитектура решения

```
User (multiple directions)
  ↓
Manual creation of ad sets in Facebook Ads Manager (PAUSED)
  ↓
Link ad sets to directions via API
  ↓
AgentBrain receives precreated_adsets[] for each direction
  ↓
AgentBrain uses Direction.UseExistingAdSetWithCreatives
  ↓
System: selects PAUSED ad set → updates settings → activates → creates ads
  ↓
Success! No error 2446885
```

---

## 📁 Ключевые файлы для ознакомления

### 📚 Документация (читать в порядке приоритета)

1. **[AGENTBRAIN_USE_EXISTING_MODE.md](./AGENTBRAIN_USE_EXISTING_MODE.md)** ⭐ **НАЧНИ ЗДЕСЬ**
   - Полная документация интеграции AgentBrain
   - Процесс работы нового action
   - Параметры и примеры
   - Сценарии использования

2. **[ADSET_PRECREATION_ARCHITECTURE_TASK.md](./ADSET_PRECREATION_ARCHITECTURE_TASK.md)**
   - Полная архитектура решения
   - Детали всех компонентов
   - Обсуждение решений

### 🗄️ База данных

3. **[migrations/028_add_adset_mode_to_user_accounts.sql](./migrations/028_add_adset_mode_to_user_accounts.sql)**
   - Добавляет поле `default_adset_mode` в `user_accounts`
   - Значения: `'api_create'` (default) | `'use_existing'`

4. **[migrations/029_create_direction_adsets_table.sql](./migrations/029_create_direction_adsets_table.sql)**
   - Новая таблица `direction_adsets` для хранения связей
   - Поля: id, direction_id, fb_adset_id, ads_count, status, linked_at
   - RLS политики и индексы

### ⚙️ Backend (Agent-Service)

5. **[services/agent-service/src/routes/actions.ts](./services/agent-service/src/routes/actions.ts)**
   - **ЛИНИЯ 417-549**: Новый action handler `Direction.UseExistingAdSetWithCreatives`
   - Обновление настроек ad set перед активацией (бюджет, аудитория)
   - Валидация параметров

6. **[services/agent-service/src/lib/directionAdSets.ts](./services/agent-service/src/lib/directionAdSets.ts)**
   - Helper функции:
     - `getAvailableAdSet()` - выбор PAUSED ad set
     - `activateAdSet()` - активация (PAUSED → ACTIVE)
     - `deactivateAdSetWithAds()` - пауза + остановка всех ads
     - `incrementAdsCount()` - обновление счетчика

7. **[services/agent-service/src/routes/directionAdSets.ts](./services/agent-service/src/routes/directionAdSets.ts)**
   - API endpoints:
     - POST `/api/directions/:directionId/link-adset`
     - GET `/api/directions/:directionId/adsets`
     - DELETE `/api/directions/:directionId/adsets/:id`
     - POST `/api/directions/:directionId/sync-adsets`

8. **[services/agent-service/src/workflows/createAdSetInDirection.ts](./services/agent-service/src/workflows/createAdSetInDirection.ts)**
   - **ЛИНИЯ 200+**: Условная логика для обоих режимов
   - Workflow для AgentBrain

9. **[services/agent-service/src/routes/campaignBuilder.ts](./services/agent-service/src/routes/campaignBuilder.ts)**
   - **Auto-Launch V2**: ЛИНИЯ 210+
   - **Manual Launch**: ЛИНИЯ 440+
   - Поддержка обоих режимов

### 🧠 Backend (Agent-Brain)

10. **[services/agent-brain/src/server.js](./services/agent-brain/src/server.js)**
    - **ЛИНИЯ 372-388**: ALLOWED_TYPES (добавлен новый action)
    - **ЛИНИЯ 397-406**: getUserAccount() загружает `default_adset_mode`
    - **ЛИНИЯ 2348-2396**: llmInput включает режим и precreated_adsets[]
    - **ЛИНИЯ 997-1062**: SYSTEM_PROMPT - документация режимов
    - **ЛИНИЯ 1260-1272**: ДОСТУПНЫЕ ДЕЙСТВИЯ - описание action
    - **ЛИНИЯ 1399-1406**: ПРИМЕРЫ использования
    - **ЛИНИЯ 1485-1497**: Валидация нового action

### 🎨 Frontend

11. **[services/frontend/src/pages/Profile.tsx](./services/frontend/src/pages/Profile.tsx)**
    - **ЛИНИЯ 1490+**: Переключатель режима "Ad Set Creation Mode"
    - UI для выбора между `api_create` и `use_existing`

12. **[services/frontend/src/components/DirectionAdSets.tsx](./services/frontend/src/components/DirectionAdSets.tsx)**
    - Компонент для управления linked ad sets
    - Функции: link, unlink, sync

---

## 🔧 Что делает новый action

### `Direction.UseExistingAdSetWithCreatives`

**Процесс**:
```
1. Выбрать PAUSED ad set (минимальный ads_count, FIFO)
   ↓
2. Обновить настройки (если указаны):
   • daily_budget_cents → новый бюджет
   • audience_id → смена аудитории (LAL support)
   ↓
3. Активировать ad set (PAUSED → ACTIVE)
   ↓
4. Создать ads для каждого креатива
   ↓
5. Инкрементировать ads_count
   ↓
6. Вернуть результат
```

**Параметры**:
```typescript
{
  direction_id: string;          // UUID направления (required)
  user_creative_ids: string[];   // Массив UUID креативов (required)
  daily_budget_cents?: number;   // Бюджет в центах (РЕКОМЕНДУЕТСЯ!)
  audience_id?: string;          // "use_lal_from_settings" для LAL (optional)
  auto_activate?: boolean;       // Default: true
}
```

**Пример**:
```json
{
  "type": "Direction.UseExistingAdSetWithCreatives",
  "params": {
    "direction_id": "abc-123",
    "user_creative_ids": ["uuid-1", "uuid-2"],
    "daily_budget_cents": 2500,
    "auto_activate": true
  }
}
```

---

## 🧪 План тестирования

### Этап 1: Подготовка окружения (30 мин)

#### 1.1. Применить миграции БД
```bash
# В production БД
psql $DATABASE_URL -f migrations/028_add_adset_mode_to_user_accounts.sql
psql $DATABASE_URL -f migrations/029_create_direction_adsets_table.sql
```

**Проверка**:
```sql
-- Проверить поле default_adset_mode
SELECT id, username, default_adset_mode 
FROM user_accounts 
LIMIT 5;

-- Проверить таблицу direction_adsets
SELECT COUNT(*) FROM direction_adsets;
```

#### 1.2. Создать тестового пользователя
```sql
-- Выбрать существующего пользователя с несколькими направлениями
UPDATE user_accounts 
SET default_adset_mode = 'use_existing' 
WHERE id = '<TEST_USER_ID>';

-- Проверить направления пользователя
SELECT id, name, objective, fb_campaign_id 
FROM account_directions 
WHERE user_account_id = '<TEST_USER_ID>';
```

#### 1.3. Создать PAUSED ad sets в Facebook Ads Manager

**Для КАЖДОГО направления** создать 3-5 ad sets:
1. Открыть Facebook Ads Manager
2. Выбрать кампанию направления (по `fb_campaign_id`)
3. Создать новый Ad Set:
   - ✅ Название: "Pre-created AdSet #1 - <Direction Name>"
   - ✅ Бюджет: любой (будет перезаписан AgentBrain)
   - ✅ WhatsApp номер: нужный для направления
   - ✅ **Статус: PAUSED** (выключен!)
4. Скопировать Ad Set ID из URL

#### 1.4. Привязать ad sets через API
```bash
# Для каждого созданного ad set
curl -X POST http://localhost:3001/api/directions/<DIRECTION_ID>/link-adset \
  -H "Content-Type: application/json" \
  -d '{"fb_adset_id": "123456789"}'

# Проверить привязку
curl http://localhost:3001/api/directions/<DIRECTION_ID>/adsets
```

**Ожидаемый результат**:
```json
[
  {
    "id": "uuid",
    "fb_adset_id": "123456789",
    "adset_name": "Pre-created AdSet #1 - Имплантация",
    "ads_count": 0,
    "status": "PAUSED",
    "is_active": true,
    "linked_at": "2025-11-06T07:00:00Z"
  }
]
```

---

### Этап 2: Тестирование AgentBrain (1-2 часа)

#### 2.1. Проверить входные данные AgentBrain

**Запустить AgentBrain в debug режиме**:
```bash
DEBUG_LLM_INPUT=true node services/agent-brain/src/server.js
```

**Проверить `/tmp/llm_input_debug.json`**:
```json
{
  "account": {
    "default_adset_mode": "use_existing"  // ✅ Должен быть use_existing
  },
  "directions": [
    {
      "id": "abc-123",
      "name": "Имплантация",
      "precreated_adsets": [              // ✅ Должен быть список
        {
          "id": "uuid",
          "fb_adset_id": "123456789",
          "ads_count": 0,
          "status": "PAUSED"
        }
      ]
    }
  ]
}
```

#### 2.2. Проверить генерацию action

**Симулировать плохие результаты** для одного направления (изменить метрики в БД или вручную).

**Запустить AgentBrain** и проверить generated actions:

**✅ Ожидаемое поведение**:
```json
{
  "actions": [
    {
      "type": "GetCampaignStatus",
      "params": {"campaign_id": "..."}
    },
    {
      "type": "Direction.UseExistingAdSetWithCreatives",
      "params": {
        "direction_id": "abc-123",
        "user_creative_ids": ["uuid-1", "uuid-2"],
        "daily_budget_cents": 2500,
        "auto_activate": true
      }
    }
  ]
}
```

**❌ НЕ должно быть**:
- `Direction.CreateAdSetWithCreatives` (старый action)
- Пустой `daily_budget_cents`

#### 2.3. Проверить выполнение action

**Отправить action в executor**:
```bash
curl -X POST http://localhost:3001/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-123",
    "source": "brain",
    "account": {"userAccountId": "<TEST_USER_ID>"},
    "actions": [
      {
        "type": "Direction.UseExistingAdSetWithCreatives",
        "params": {
          "direction_id": "<DIRECTION_ID>",
          "user_creative_ids": ["<CREATIVE_1>", "<CREATIVE_2>"],
          "daily_budget_cents": 2500,
          "auto_activate": true
        }
      }
    ]
  }'
```

**Проверить результат**:
```json
{
  "executionId": "uuid",
  "executed": true
}
```

#### 2.4. Проверить Facebook Ads Manager

**В Facebook Ads Manager проверить**:
1. ✅ Ad Set изменил статус: PAUSED → ACTIVE
2. ✅ Бюджет обновился: → $25/день
3. ✅ Созданы 2 ads внутри ad set
4. ✅ Ads имеют статус ACTIVE

#### 2.5. Проверить БД

```sql
-- Проверить обновление ads_count
SELECT fb_adset_id, ads_count, status, last_used_at 
FROM direction_adsets 
WHERE direction_id = '<DIRECTION_ID>';

-- Ожидаемый результат:
-- fb_adset_id    | ads_count | status | last_used_at
-- 123456789      | 2         | ACTIVE | 2025-11-06 12:00:00
```

---

### Этап 3: Дополнительные сценарии (30 мин)

#### 3.1. Тест с LAL аудиторией

**Условие**: `user_accounts.ig_seed_audience_id IS NOT NULL`

**Action**:
```json
{
  "type": "Direction.UseExistingAdSetWithCreatives",
  "params": {
    "direction_id": "abc-123",
    "user_creative_ids": ["uuid-1", "uuid-2"],
    "daily_budget_cents": 1500,
    "audience_id": "use_lal_from_settings",
    "auto_activate": true
  }
}
```

**Проверка в Facebook**:
- ✅ Ad Set имеет LAL аудиторию в targeting

#### 3.2. Тест отсутствия доступных ad sets

**Подготовка**:
```sql
-- Пометить все ad sets как использованные
UPDATE direction_adsets 
SET ads_count = 50 
WHERE direction_id = '<DIRECTION_ID>';
```

**Запустить AgentBrain**

**Ожидаемое поведение**:
- ❌ Не генерирует `Direction.UseExistingAdSetWithCreatives`
- ✅ В `reportText` есть предупреждение:
  > ⚠️ ВАЖНО: Закончились подготовленные группы объявлений для направления "Имплантация". Необходимо создать новые...

#### 3.3. Тест паузы ad set

**Action**:
```json
{
  "type": "PauseAdset",
  "params": {"adsetId": "<FB_ADSET_ID>"}
}
```

**Проверка в Facebook**:
- ✅ Ad Set: ACTIVE → PAUSED
- ✅ **Все ads внутри**: ACTIVE → PAUSED (автоматически!)

---

### Этап 4: Интеграционное тестирование (1 час)

#### 4.1. Auto-Launch V2
```bash
curl -X POST http://localhost:3001/api/campaign-builder/auto-launch-v2
```
- ✅ Использует `use_existing` режим для тестового пользователя
- ✅ Создает ads в pre-created ad sets

#### 4.2. Manual Launch
```bash
curl -X POST http://localhost:3001/api/campaign-builder/manual-launch \
  -d '{"direction_id": "<DIRECTION_ID>", "creative_ids": [...]}'
```
- ✅ Использует pre-created ad set
- ✅ Активирует и наполняет ads

#### 4.3. AgentBrain (full flow)
- Дождаться ежедневного запуска (08:00 по таймзоне пользователя)
- Или запустить вручную через n8n webhook

**Проверить**:
- ✅ Отчет в Telegram
- ✅ Actions в `agent_executions` таблице
- ✅ Использование `Direction.UseExistingAdSetWithCreatives`
- ✅ Правильные расчеты бюджета

---

## ✅ Чек-лист тестирования

### База данных
- [ ] Миграция 028 применена
- [ ] Миграция 029 применена
- [ ] Поле `default_adset_mode` существует
- [ ] Таблица `direction_adsets` создана
- [ ] RLS политики работают

### Тестовое окружение
- [ ] Создан тестовый пользователь
- [ ] Установлен `default_adset_mode = 'use_existing'`
- [ ] Созданы 3+ PAUSED ad sets в Facebook
- [ ] Ad sets привязаны через API
- [ ] Проверен список через GET `/api/directions/:id/adsets`

### AgentBrain Input
- [ ] `account.default_adset_mode` передается
- [ ] `directions[].precreated_adsets[]` заполнен
- [ ] Креативы имеют `direction_id`

### AgentBrain Logic
- [ ] Генерирует `Direction.UseExistingAdSetWithCreatives`
- [ ] **НЕ** генерирует `Direction.CreateAdSetWithCreatives`
- [ ] Указывает `daily_budget_cents` на основе расчетов
- [ ] Проверяет наличие `precreated_adsets[]`
- [ ] Сообщает об отсутствии доступных ad sets

### Action Execution
- [ ] Action выполняется без ошибок
- [ ] Ad Set активируется (PAUSED → ACTIVE)
- [ ] Бюджет обновляется
- [ ] Ads создаются внутри ad set
- [ ] `ads_count` инкрементируется
- [ ] LAL аудитория применяется (если указана)

### Facebook Ads Manager
- [ ] Ad Set изменил статус на ACTIVE
- [ ] Бюджет соответствует `daily_budget_cents`
- [ ] Ads созданы и активны
- [ ] При паузе ad set все ads останавливаются

### Workflows
- [ ] Auto-Launch V2 работает
- [ ] Manual Launch работает
- [ ] AgentBrain daily run работает
- [ ] Creative Test НЕ затронут (работает как раньше)

---

## 🚨 Частые проблемы и решения

### Проблема 1: AgentBrain генерирует старый action
**Симптом**: `Direction.CreateAdSetWithCreatives` вместо `Direction.UseExistingAdSetWithCreatives`

**Причина**: `default_adset_mode` не установлен или не загружается

**Решение**:
```sql
-- Проверить режим
SELECT default_adset_mode FROM user_accounts WHERE id = '<USER_ID>';

-- Если NULL, установить
UPDATE user_accounts SET default_adset_mode = 'use_existing' WHERE id = '<USER_ID>';
```

### Проблема 2: `precreated_adsets[]` пустой
**Симптом**: AgentBrain не видит доступные ad sets

**Причина**: Ad sets не привязаны или все использованы

**Решение**:
```sql
-- Проверить привязанные ad sets
SELECT * FROM direction_adsets WHERE direction_id = '<DIRECTION_ID>';

-- Проверить ads_count
SELECT fb_adset_id, ads_count, status FROM direction_adsets;

-- Если ads_count >= 50, создать новые в Facebook и привязать
```

### Проблема 3: Action execution fails
**Симптом**: Ошибка при выполнении action

**Причина**: Неверный `fb_adset_id` или ad set удален в Facebook

**Решение**:
```bash
# Синхронизировать с Facebook
curl -X POST http://localhost:3001/api/directions/<DIRECTION_ID>/sync-adsets

# Проверить статус
curl http://localhost:3001/api/directions/<DIRECTION_ID>/adsets
```

### Проблема 4: Ads не останавливаются при паузе
**Симптом**: При `PauseAdset` ads остаются активными

**Причина**: Старая логика или режим `api_create`

**Решение**: Проверить что пользователь в режиме `use_existing`:
```sql
SELECT default_adset_mode FROM user_accounts WHERE id = '<USER_ID>';
```

---

## 📊 Метрики успеха

### Критерии прохождения теста:

1. ✅ **0 ошибок** при создании ads в режиме `use_existing`
2. ✅ **100% ad sets** активируются корректно
3. ✅ **Бюджеты** устанавливаются согласно расчетам AgentBrain
4. ✅ **Ads создаются** в pre-created ad sets
5. ✅ **Счетчики** `ads_count` обновляются
6. ✅ **Отчеты** AgentBrain корректны
7. ✅ **LAL аудитории** применяются (если указаны)
8. ✅ **Все ads останавливаются** при паузе ad set

---

## 📞 Контакты и поддержка

### При возникновении проблем:

1. **Проверить логи**:
   ```bash
   # Agent-Service
   tail -f services/agent-service/logs/app.log
   
   # Agent-Brain
   tail -f services/agent-brain/logs/app.log
   ```

2. **Проверить БД**:
   ```sql
   -- Последние executions AgentBrain
   SELECT * FROM agent_executions ORDER BY created_at DESC LIMIT 5;
   
   -- Последние actions
   SELECT * FROM agent_actions ORDER BY created_at DESC LIMIT 10;
   ```

3. **Документация**:
   - [AGENTBRAIN_USE_EXISTING_MODE.md](./AGENTBRAIN_USE_EXISTING_MODE.md)
   - [ADSET_PRECREATION_ARCHITECTURE_TASK.md](./ADSET_PRECREATION_ARCHITECTURE_TASK.md)

---

## ✅ После успешного тестирования

1. Обновить статус в TODO:
   ```markdown
   - [x] Протестировано на тестовом пользователе
   - [x] Все чек-листы пройдены
   - [x] Метрики успеха достигнуты
   ```

2. Задокументировать результаты в новом файле:
   ```
   TESTING_RESULTS_<DATE>.md
   ```

3. Подготовить к деплою на production:
   - Применить миграции
   - Проинформировать пользователей о новой возможности
   - Создать инструкцию по созданию pre-created ad sets

---

**Удачи в тестировании!** 🚀







