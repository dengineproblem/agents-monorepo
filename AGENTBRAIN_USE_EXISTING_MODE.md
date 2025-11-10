# AgentBrain Integration with Pre-Created Ad Sets

**Дата**: 2025-11-06  
**Статус**: ✅ Завершено  
**Связанный документ**: [ADSET_PRECREATION_ARCHITECTURE_TASK.md](./ADSET_PRECREATION_ARCHITECTURE_TASK.md)

## 📋 Задача

Интегрировать режим `use_existing` с AgentBrain, чтобы он мог использовать заранее созданные (pre-created) ad sets вместо создания новых через API.

## 🎯 Проблема

Meta API возвращает ошибку (error_subcode: 2446885) при создании ad sets с явным указанием WhatsApp номера для пользователей с несколькими направлениями. Обходной путь — создавать ad sets вручную в Facebook Ads Manager и использовать их через приложение.

## ✅ Реализованные изменения

### 1. Agent-Service (`services/agent-service/src/routes/actions.ts`)

#### Новый Action Handler: `Direction.UseExistingAdSetWithCreatives`

**Назначение**: Использовать pre-created PAUSED ad set для добавления креативов

**Процесс**:
1. Проверка режима пользователя (`default_adset_mode === 'use_existing'`)
2. Получение доступного PAUSED ad set через `getAvailableAdSet(direction_id)`
3. **Обновление настроек ad set** (если указаны):
   - `daily_budget_cents` — установка бюджета
   - `audience_id` — смена аудитории (поддерживает `"use_lal_from_settings"` для LAL)
4. Активация ad set (PAUSED → ACTIVE) через `activateAdSet()`
5. Создание ads для каждого креатива
6. Инкрементирование счетчика `ads_count` через `incrementAdsCount()`

**Параметры**:
```typescript
{
  direction_id: string;          // UUID направления (required)
  user_creative_ids: string[];   // Массив UUID креативов (required)
  daily_budget_cents?: number;   // Бюджет в центах (optional, recommended)
  audience_id?: string;          // ID аудитории или "use_lal_from_settings" (optional)
  auto_activate?: boolean;       // Активировать ads (default: true)
}
```

**Возвращаемое значение**:
```typescript
{
  success: true,
  adset_id: string,              // Facebook ad set ID
  ads_created: number,           // Количество созданных ads
  ads: Array<{ad_id, user_creative_id}>,
  mode: 'use_existing',
  settings_updated: boolean,     // Были ли обновлены настройки
  updated_params: object         // Какие параметры были обновлены
}
```

**Валидация**:
- Проверка `direction_id` (required)
- Проверка `user_creative_ids` (required, массив, минимум 1)
- Проверка типа `daily_budget_cents` (number)
- Режим `use_existing` обязателен

---

### 2. Agent-Brain (`services/agent-brain/src/server.js`)

#### 2.1. Обновлен `ALLOWED_TYPES`

Добавлены:
- `Direction.UseExistingAdSetWithCreatives` — использование pre-created ad sets
- `PauseAdset` — пауза ad set (был пропущен ранее)

#### 2.2. Обновлен `getUserAccount()`

Теперь загружает поле `default_adset_mode` из `user_accounts`:
```javascript
.select('id, access_token, ..., default_adset_mode')
```

#### 2.3. Обновлен `llmInput`

**Добавлено в `account`**:
```javascript
account: {
  timezone: '...',
  default_adset_mode: 'api_create' | 'use_existing'  // NEW
}
```

**Добавлено в каждое `direction`**:
```javascript
directions: [{
  id: '...',
  name: '...',
  precreated_adsets: [                    // NEW
    {
      id: 'uuid',                          // UUID записи direction_adsets
      fb_adset_id: '123456789',            // Facebook ad set ID
      ads_count: 5,                        // Количество ads в ad set
      status: 'PAUSED'                     // Статус (PAUSED/ACTIVE)
    }
  ]
}]
```

**Логика загрузки**:
- Если `default_adset_mode === 'use_existing'`, для каждого направления загружаются доступные PAUSED ad sets
- Фильтры: `is_active=true`, `status='PAUSED'`, `ads_count < 50`
- Сортировка: по `ads_count` ASC, затем по `linked_at` ASC

#### 2.4. Обновлен `SYSTEM_PROMPT`

**Новый раздел: "🔄 РЕЖИМЫ СОЗДАНИЯ AD SETS"**

Документирует два режима работы:

**📌 РЕЖИМ "api_create" (по умолчанию)**:
- Создание новых ad sets через Facebook API
- Action: `Direction.CreateAdSetWithCreatives`
- Указывается `daily_budget_cents`

**📌 РЕЖИМ "use_existing"**:
- Использование pre-created ad sets из Facebook Ads Manager
- Action: `Direction.UseExistingAdSetWithCreatives`
- **Обязательно** указывать `daily_budget_cents` на основе расчетов
- Опционально указывать `audience_id` для LAL аудитории

**🚨 КРИТИЧНЫЕ ПРАВИЛА для режима "use_existing"**:
1. ⛔ НЕ использовать `Direction.CreateAdSetWithCreatives`
2. ✅ Проверять `precreated_adsets[]` перед генерацией action
3. ✅ **ВСЕГДА** указывать `daily_budget_cents` на основе расчетов
4. ✅ При `PauseAdset` автоматически останавливаются все ads
5. ✅ Лимит 50 ads на ad set (soft limit)
6. ✅ Можно указать `audience_id` для смены аудитории
7. ✅ Упоминать в отчете если нет доступных ad sets

**Псевдокод выбора action**:
```javascript
if (account.default_adset_mode === "use_existing") {
  const direction = directions.find(d => d.id === direction_id);
  if (!direction.precreated_adsets || direction.precreated_adsets.length === 0) {
    // ОШИБКА: сообщить пользователю
  } else {
    // Рассчитать бюджет на основе лимитов и освободившихся средств
    const calculatedBudget = /* расчеты */ 2500;
    
    action = {
      type: "Direction.UseExistingAdSetWithCreatives",
      params: {
        direction_id: "...",
        user_creative_ids: ["uuid1", "uuid2"],
        daily_budget_cents: calculatedBudget,  // ✅ ВАЖНО!
        audience_id: "use_lal_from_settings",  // Опционально
        auto_activate: true
      }
    };
  }
} else {
  // Стандартный режим
  action = {
    type: "Direction.CreateAdSetWithCreatives",
    params: { /* ... */ }
  };
}
```

#### 2.5. Обновлен раздел "ДОСТУПНЫЕ ДЕЙСТВИЯ"

**Описание `Direction.UseExistingAdSetWithCreatives`**:
```
{"direction_id","user_creative_ids":["uuid1","uuid2"],"daily_budget_cents?","audience_id?","auto_activate?"}

Процесс:
1. Выбирает PAUSED ad set с минимальным ads_count
2. ОБНОВЛЯЕТ ЕГО НАСТРОЙКИ (бюджет/аудиторию если указаны)
3. Активирует его (PAUSED → ACTIVE)
4. Создает ads внутри

Параметры:
- daily_budget_cents (РЕКОМЕНДУЕТСЯ указывать!)
- audience_id ("use_lal_from_settings" для LAL если has_lal_audience===true)
- auto_activate (default: true)
```

#### 2.6. Добавлены новые примеры

**ПРИМЕР 8**: Использование pre-created ad set с изменением бюджета
```json
{
  "planNote": "account.default_adset_mode=use_existing. Направление abc-123 имеет 3 доступных pre-created ad sets. HS bad для adset_456 → снижаем на -50% (освобождается $25). unused_creatives=2 с direction_id === abc-123. Активируем pre-created ad set с бюджетом $25 и добавляем 2 креатива.",
  "actions": [
    { "type": "GetCampaignStatus", "params": { "campaign_id": "<DIRECTION_CAMPAIGN_ID>" } },
    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_456", "daily_budget": 2500 } },
    { "type": "Direction.UseExistingAdSetWithCreatives", "params": { 
      "direction_id": "abc-123", 
      "user_creative_ids": ["uuid-1", "uuid-2"], 
      "daily_budget_cents": 2500, 
      "auto_activate": true 
    }}
  ]
}
```

**ПРИМЕР 8B**: С LAL аудиторией
```json
{
  "planNote": "account.default_adset_mode=use_existing, has_lal_audience=true. Направление abc-123: CPL x3, нужна смена аудитории. Активируем pre-created ad set с LAL аудиторией и бюджетом $15.",
  "actions": [
    { "type": "GetCampaignStatus", "params": { "campaign_id": "<DIRECTION_CAMPAIGN_ID>" } },
    { "type": "Direction.UseExistingAdSetWithCreatives", "params": { 
      "direction_id": "abc-123", 
      "user_creative_ids": ["uuid-1", "uuid-2"], 
      "daily_budget_cents": 1500, 
      "audience_id": "use_lal_from_settings", 
      "auto_activate": true 
    }}
  ]
}
```

**ПРИМЕР 9**: Нет доступных ad sets
```json
{
  "planNote": "account.default_adset_mode=use_existing. Направление abc-123: precreated_adsets=[]. Нет доступных ad sets! Пользователь должен создать их вручную в Facebook Ads Manager. Только снижаем бюджет плохих ad sets, новые НЕ создаем.",
  "actions": [
    { "type": "GetCampaignStatus", "params": { "campaign_id": "<CAMPAIGN_ID>" } },
    { "type": "UpdateAdSetDailyBudget", "params": { "adset_id": "adset_789", "daily_budget": 1500 } }
  ],
  "reportText": "⚠️ ВАЖНО: Закончились подготовленные группы объявлений для направления \"Имплантация\". Необходимо создать новые группы объявлений вручную в Facebook Ads Manager (со статусом ВЫКЛЮЧЕНО) и привязать их в настройках направления.\n\nТекущие действия: снижен бюджет неэффективной группы на 40% для экономии."
}
```

#### 2.7. Обновлена валидация в `validateAndNormalizeActions()`

```javascript
if (type === 'Direction.UseExistingAdSetWithCreatives') {
  if (!params.direction_id) throw new Error('direction_id required');
  const creativeIds = params.user_creative_ids;
  if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
    throw new Error('user_creative_ids array required');
  }
  // daily_budget_cents опциональный - если указан, ad set будет обновлен
  if (params.daily_budget_cents !== undefined) {
    const nb = toInt(params.daily_budget_cents);
    if (nb === null) throw new Error('daily_budget_cents must be int');
    params.daily_budget_cents = Math.max(300, Math.min(10000, nb));
  }
}
```

---

## 🔄 Архитектурный поток

### Режим `api_create` (по умолчанию)
```
AgentBrain → Direction.CreateAdSetWithCreatives → Facebook API (POST /adsets)
  → Создание ad set → Создание ads → Результат
```

### Режим `use_existing`
```
AgentBrain → Direction.UseExistingAdSetWithCreatives
  → getAvailableAdSet(direction_id)        // Выбор PAUSED ad set
  → graph('POST', adset_id, {budget, targeting})  // Обновление настроек
  → activateAdSet(id, fb_adset_id)         // Активация (PAUSED → ACTIVE)
  → Создание ads в ad set
  → incrementAdsCount(fb_adset_id, count)  // Обновление счетчика
  → Результат
```

---

## 💡 Ключевые особенности

### 1. **Полный контроль над настройками**

AgentBrain может изменять настройки pre-created ad set ПЕРЕД активацией:
- ✅ **Бюджет**: рассчитывается на основе анализа и лимитов
- ✅ **Аудитория**: можно переключить на LAL (если `has_lal_audience === true`)

Это дает AgentBrain **такой же уровень контроля**, как при создании нового ad set через API.

### 2. **Автоматический выбор ad set**

Система автоматически выбирает PAUSED ad set с минимальным `ads_count`:
- Приоритет 1: минимальное количество ads (распределение нагрузки)
- Приоритет 2: самый старый `linked_at` (FIFO)

### 3. **Мягкий лимит 50 ads**

Каждый pre-created ad set может содержать до 50 ads. После достижения лимита:
- Ad set исключается из списка доступных
- AgentBrain использует следующий PAUSED ad set
- Если нет доступных → сообщение пользователю в отчете

### 4. **Интеграция с LAL аудиториями**

AgentBrain может применить LAL аудиторию к pre-created ad set:
```javascript
{
  audience_id: "use_lal_from_settings"  // Использует ig_seed_audience_id из настроек
}
```

Это позволяет реанимировать неэффективные направления сменой аудитории.

### 5. **Автоматическая остановка ads при паузе**

При выполнении `PauseAdset` в режиме `use_existing`:
- Система автоматически останавливает все ACTIVE ads внутри ad set
- Это предотвращает путаницу при повторном использовании ad set

---

## 📊 Сценарии использования

### Сценарий 1: Стандартная ротация креативов

**Ситуация**: Один ad set показывает плохие результаты (CPL x2.5)

**Действия AgentBrain**:
1. Снижает бюджет плохого ad set на 50% (освобождается $25)
2. Выбирает PAUSED ad set из `precreated_adsets[]`
3. Устанавливает бюджет $25 (освободившиеся средства)
4. Активирует ad set
5. Создает 2-3 новых ads с fresh креативами

### Сценарий 2: Смена аудитории (LAL)

**Ситуация**: CPL превышает целевой в 3 раза, нужна смена аудитории

**Действия AgentBrain**:
1. Проверяет `account.has_lal_audience === true`
2. Выбирает PAUSED ad set
3. Устанавливает бюджет $15 (консервативный для теста)
4. Применяет LAL аудиторию (`audience_id: "use_lal_from_settings"`)
5. Активирует ad set
6. Создает 2 ads для теста новой аудитории

### Сценарий 3: Нет доступных ad sets

**Ситуация**: Все pre-created ad sets использованы (ads_count ≥ 50)

**Действия AgentBrain**:
1. Проверяет `precreated_adsets[]` → пусто
2. НЕ генерирует `Direction.UseExistingAdSetWithCreatives`
3. Применяет защитные действия (снижение бюджетов плохих ad sets)
4. В отчете добавляет предупреждение:
   > ⚠️ ВАЖНО: Закончились подготовленные группы объявлений для направления "Имплантация". Необходимо создать новые группы объявлений вручную в Facebook Ads Manager (со статусом ВЫКЛЮЧЕНО) и привязать их в настройках направления.

---

## 🧪 Тестирование

### Подготовка тестового окружения

1. Создать тестового пользователя:
```sql
UPDATE user_accounts 
SET default_adset_mode = 'use_existing' 
WHERE id = '<test_user_id>';
```

2. Создать направление (если нет)

3. Создать 3-5 ad sets вручную в Facebook Ads Manager:
   - Статус: **PAUSED** (выключен)
   - Привязать нужный WhatsApp номер
   - Установить любой бюджет (будет перезаписан AgentBrain)

4. Привязать ad sets через API:
```bash
POST /api/directions/{directionId}/link-adset
{
  "fb_adset_id": "123456789"
}
```

5. Добавить креативы для направления (с `direction_id`)

6. Запустить AgentBrain в тестовом режиме

### Проверки

✅ AgentBrain видит `default_adset_mode: 'use_existing'`  
✅ AgentBrain видит список `precreated_adsets[]` для направления  
✅ AgentBrain генерирует `Direction.UseExistingAdSetWithCreatives` с `daily_budget_cents`  
✅ Ad set активируется с правильным бюджетом  
✅ Ads создаются внутри активированного ad set  
✅ `ads_count` инкрементируется после создания ads  
✅ LAL аудитория применяется (если указан `audience_id`)  
✅ При паузе ad set все ads останавливаются  

---

## 📝 Изменённые файлы

### Agent-Service
- ✅ `services/agent-service/src/routes/actions.ts` — новый action handler + валидация

### Agent-Brain
- ✅ `services/agent-brain/src/server.js`:
  - ALLOWED_TYPES
  - getUserAccount()
  - llmInput (account + directions)
  - SYSTEM_PROMPT (новый раздел + правила + примеры)
  - validateAndNormalizeActions()

### Документация
- ✅ `AGENTBRAIN_USE_EXISTING_MODE.md` — эта документация

---

## 🎉 Результат

AgentBrain теперь **полностью интегрирован** с режимом `use_existing`:

✅ Автоматически определяет режим работы  
✅ Использует правильный action для каждого режима  
✅ Имеет полный контроль над настройками ad set (бюджет, аудитория)  
✅ Применяет все стратегии оптимизации (ребалансировка, LAL, ротация)  
✅ Корректно обрабатывает отсутствие доступных ad sets  
✅ Документирован с примерами и псевдокодом  

**Без ошибок линтера!** 🚀



