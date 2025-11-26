# 🎯 ЗАДАЧА: Архитектура предварительного создания Ad Sets для пользователей с несколькими направлениями

> **Контекст:** Мы сталкиваемся с частыми ошибками при создании ad sets через Meta API с явно указанными номерами телефона WhatsApp. Это известная проблема Meta, которая не решается. Мы нашли обходной путь — создавать ad sets вручную через Facebook UI с нужными номерами заранее, а затем использовать эти существующие ad sets в нашем приложении.

---

## 📋 СОДЕРЖАНИЕ

1. [Суть проблемы](#суть-проблемы)
2. [Предлагаемое решение](#предлагаемое-решение)
3. [Архитектура проекта](#архитектура-проекта)
4. [Текущие сервисы создания ad sets](#текущие-сервисы-создания-ad-sets)
5. [База данных](#база-данных)
6. [Техническое задание](#техническое-задание)
7. [Ключевые вопросы для обсуждения](#ключевые-вопросы-для-обсуждения)
8. [Ссылки на важные файлы](#ссылки-на-важные-файлы)

---

## 🔴 СУТЬ ПРОБЛЕМЫ

### Текущая ситуация

**Проблема:** При создании ad sets через Meta Graph API с конкретным `whatsapp_phone_number` в `promoted_object` возникает ошибка:

```json
{
  "error": {
    "message": "Invalid parameter",
    "type": "OAuthException",
    "code": 100,
    "error_subcode": 2446885,
    "error_user_title": "Требуется Страница с аккаунтом WhatsApp Business",
    "error_user_msg": "Номер WhatsApp, связанный с вашей Страницей, относится к личному аккаунту..."
  }
}
```

**Кто страдает:**
- Пользователи с **несколькими направлениями** (directions), каждое со своим номером WhatsApp
- Например: клиника с направлениями "Имплантация", "Виниры", "Брекеты" — у каждого свой номер для приема заявок

**Кто НЕ страдает:**
- Пользователи с **одним направлением** — можно не указывать номер явно, Facebook сам подставляет дефолтный

### Почему это проблема

Эта ошибка:
- ✅ **Известна давно** (см. `WHATSAPP_ERROR_2446885_FIX.md`)
- ✅ **Воспроизводится стабильно** для пользователей с несколькими номерами
- ❌ **Не решается** на стороне Meta (проблема с их стороны)
- ✅ **Обходится** через ручное создание ad sets в Facebook UI

---

## 💡 ПРЕДЛАГАЕМОЕ РЕШЕНИЕ

### Концепция

1. **Для пользователей с одним направлением** — оставить как есть:
   - Создаем ad sets через API
   - Не указываем номер явно
   - Facebook сам подставляет дефолтный номер со страницы

2. **Для пользователей с несколькими направлениями** — новая логика:
   - Пользователь **заранее создает ad sets вручную** через Facebook Ads Manager UI
   - В каждом ad set указывает нужный номер WhatsApp
   - В нашем приложении связывает эти ad sets с направлениями
   - Наши сервисы **используют существующие ad sets**, не создавая новые
   - Управление (бюджеты, статусы) и создание объявлений (ads) внутри ad sets — через наше приложение

### Преимущества

✅ **Обходит проблему Meta API** полностью  
✅ **Обратная совместимость** — пользователи с одним направлением не затронуты  
✅ **Гибкость** — можно переключаться между режимами  
✅ **Управление сохраняется** — агент все еще может управлять бюджетами, создавать ads, останавливать/запускать ad sets

---

## 🏗️ АРХИТЕКТУРА ПРОЕКТА

### Общая структура

```
/root/agents-monorepo/
├── services/
│   ├── frontend/              # React (Vite) - UI приложения
│   ├── agent-service/         # Backend API (Fastify, TypeScript)
│   │   ├── src/
│   │   │   ├── routes/        # API endpoints
│   │   │   │   ├── actions.ts          # AgentBrain actions
│   │   │   │   ├── campaignBuilder.ts  # Auto-launch, Manual-launch
│   │   │   │   ├── creativeTest.ts     # Creative testing
│   │   │   │   └── directions.ts       # Управление направлениями
│   │   │   ├── workflows/     # Workflows создания кампаний/adsets
│   │   │   │   ├── createAdSetInDirection.ts       # Brain Agent workflow
│   │   │   │   ├── createCampaignWithCreative.ts   # Legacy workflow
│   │   │   │   └── creativeTest.ts                 # Creative test workflow
│   │   │   └── lib/
│   │   │       ├── campaignBuilder.ts    # createAdSetInCampaign() - общая функция
│   │   │       └── settingsHelpers.ts    # getWhatsAppPhoneNumber() - 4-tier fallback
│   └── agent-brain/           # AI Agent (Node.js)
│       └── src/
│           ├── server.js      # Основной агент + cron
│           └── scoring.js     # Scoring agent
├── docker-compose.yml
└── nginx-production.conf
```

### Текущие домены (production)

- `https://app.performanteaiagency.com` — Production frontend
- `https://performanteaiagency.com` — App Review frontend (упрощенная версия)
- Backend API доступен на обоих доменах через `/api/*`

### База данных: Supabase PostgreSQL

Прямой доступ к БД через Supabase Service Role (в коде сервисов)

---

## 📊 ТЕКУЩИЕ СЕРВИСЫ СОЗДАНИЯ AD SETS

### 1. **AgentBrain** (Automatic Management)

**Файл:** `services/agent-brain/src/server.js`  
**Workflow:** `services/agent-service/src/workflows/createAdSetInDirection.ts`

**Как работает:**
- Cron каждый день в 08:00 (Asia/Almaty)
- Анализирует кампании пользователей
- LLM генерирует actions (например, `Direction.CreateAdSetWithCreatives`)
- Agent-service выполняет действия через `routes/actions.ts`

**Создание ad set:**
```javascript
// Brain генерирует action:
{
  "type": "Direction.CreateAdSetWithCreatives",
  "params": {
    "direction_id": "uuid",
    "user_creative_ids": ["uuid1", "uuid2"],
    "daily_budget_cents": 5000,
    "adset_name": "My AdSet - 2025-11-06"
  }
}

// Agent-service вызывает:
workflowCreateAdSetInDirection(params, context, accessToken)
  → Создает ad set через Meta API
  → Создает ads для каждого креатива
```

**Ключевые моменты:**
- ✅ Использует 4-tier fallback для WhatsApp номера (`getWhatsAppPhoneNumber`)
- ✅ Привязан к существующей campaign (`direction.fb_campaign_id`)
- ❌ **СОЗДАЕТ НОВЫЙ ad set** через API

---

### 2. **Auto-Launch V2** (Batch Launch for All Directions)

**Файл:** `services/agent-service/src/routes/campaignBuilder.ts`  
**Endpoint:** `POST /api/campaign-builder/auto-launch-v2`

**Как работает:**
- Находит все активные направления пользователя
- Для каждого направления:
  - Берет креативы (до 5 шт.)
  - Создает ad set в существующей campaign
  - Создает ads

**Создание ad set:**
```typescript
const adset = await createAdSetInCampaign({
  campaignId: direction.fb_campaign_id,
  adAccountId: userAccount.ad_account_id,
  accessToken: userAccount.access_token,
  name: `${direction.name} - ${new Date().toISOString().split('T')[0]}`,
  dailyBudget: direction.daily_budget_cents,
  targeting,
  optimization_goal,
  billing_event,
  promoted_object,
  start_mode: 'midnight_almaty'
});
```

**Ключевые моменты:**
- ✅ Использует `getWhatsAppPhoneNumber` для номера
- ✅ Работает с несколькими направлениями
- ❌ **СОЗДАЕТ НОВЫЙ ad set** через API

---

### 3. **Manual Launch** (Single Direction Launch)

**Файл:** `services/agent-service/src/routes/campaignBuilder.ts`  
**Endpoint:** `POST /api/campaign-builder/manual-launch`

**Как работает:**
- Пользователь выбирает направление и креативы в UI
- Опционально задает бюджет и таргетинг
- Создается ad set немедленно

**Ключевые моменты:**
- ✅ Использует ту же логику что и Auto-Launch V2
- ✅ Позволяет переопределить бюджет и таргетинг
- ❌ **СОЗДАЕТ НОВЫЙ ad set** через API

---

### 4. **Creative Test** (A/B Testing)

**Файл:** `services/agent-service/src/routes/creativeTest.ts`  
**Endpoint:** `POST /api/creative-test/start`

**Как работает:**
- Создает отдельную тестовую campaign
- Создает ad set с бюджетом $20/день
- Тестирует один креатив

**Ключевые моменты:**
- ✅ Использует `getWhatsAppPhoneNumber`
- ✅ Создает ОТДЕЛЬНУЮ campaign (не использует `direction.fb_campaign_id`)
- ❌ **СОЗДАЕТ НОВЫЙ ad set** через API

---

## 🗄️ БАЗА ДАННЫХ

### Таблица `account_directions`

**Файл миграции:** `migrations/008_account_directions.sql`

```sql
CREATE TABLE account_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Основные параметры
  name TEXT NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
  objective TEXT NOT NULL CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Facebook Campaign
  fb_campaign_id TEXT,  -- ID существующей кампании в Facebook
  campaign_status TEXT DEFAULT 'PAUSED',
  
  -- Бюджет
  daily_budget_cents INTEGER NOT NULL DEFAULT 1000 CHECK (daily_budget_cents >= 1000),
  target_cpl_cents INTEGER NOT NULL DEFAULT 50,
  
  -- Статус
  is_active BOOLEAN DEFAULT true,
  
  -- WhatsApp (для objective='whatsapp')
  whatsapp_phone_number_id UUID REFERENCES whatsapp_phone_numbers(id) ON DELETE SET NULL,
  
  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_direction_name_per_user UNIQUE (user_account_id, name)
);
```

**Ключевые поля:**
- `fb_campaign_id` — ID Facebook Campaign (создается при создании направления)
- `whatsapp_phone_number_id` — FK на таблицу WhatsApp номеров (для multi-number setup)

---

### Таблица `whatsapp_phone_numbers`

**Файл миграции:** `migrations/012_whatsapp_phone_numbers_table.sql`

```sql
CREATE TABLE whatsapp_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  phone_number TEXT NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  label TEXT CHECK (label IS NULL OR char_length(label) <= 100),
  
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_phone_per_user UNIQUE (user_account_id, phone_number)
);
```

**Использование:**
- Пользователь может иметь несколько WhatsApp номеров
- Каждое направление может быть привязано к конкретному номеру
- Fallback логика: direction → Facebook Page API → default from table → legacy field

**Документация:** `WHATSAPP_NUMBERS_LOGIC.md`

---

### Таблица `user_creatives`

```sql
CREATE TABLE user_creatives (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES user_accounts(id),
  direction_id UUID REFERENCES account_directions(id),  -- Привязка к направлению
  
  title TEXT,
  media_type TEXT,  -- 'image' или 'video'
  media_url TEXT,
  
  -- Facebook Creative IDs для разных objectives
  fb_creative_id_whatsapp TEXT,
  fb_creative_id_instagram_traffic TEXT,
  fb_creative_id_site_leads TEXT,
  
  status TEXT DEFAULT 'ready',  -- 'ready', 'archived', 'testing'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Ключевое:** Креативы привязаны к направлениям через `direction_id`

---

### Функция получения WhatsApp номера (4-tier fallback)

**Файл:** `services/agent-service/src/lib/settingsHelpers.ts`  
**Функция:** `getWhatsAppPhoneNumber(direction, userAccountId, supabaseClient, accessToken?, pageId?)`

```typescript
// Priority 1: Номер из направления
if (direction.whatsapp_phone_number_id) {
  // Читаем из whatsapp_phone_numbers
  return phoneNumber;
}

// Priority 2: Номер из Facebook Page через Graph API
const response = await fetch(
  `https://graph.facebook.com/v20.0/${pageId}?fields=whatsapp_number&access_token=${accessToken}`
);

// Priority 3: Дефолтный номер из БД
const { data: defaultNumber } = await supabase
  .from('whatsapp_phone_numbers')
  .select('phone_number')
  .eq('user_account_id', userAccountId)
  .eq('is_default', true)
  .single();

// Priority 4: Legacy поле user_accounts.whatsapp_phone_number
return userAccount.whatsapp_phone_number || null;
```

**Важно:** Если номер не найден, возвращается `null` (НЕ ошибка!) — Facebook сам подставит дефолтный.

---

## 🎯 ТЕХНИЧЕСКОЕ ЗАДАНИЕ

### Задача 1: Добавить флаг режима работы в `account_directions`

**Цель:** Разделить логику для пользователей с одним/несколькими направлениями

#### 1.1. Миграция БД

Добавить новое поле в таблицу `account_directions`:

```sql
ALTER TABLE account_directions
ADD COLUMN adset_creation_mode TEXT DEFAULT 'api_create' 
CHECK (adset_creation_mode IN ('api_create', 'use_existing'));

COMMENT ON COLUMN account_directions.adset_creation_mode IS 
  'Режим создания ad sets:
   - api_create: создавать новые ad sets через API (по умолчанию)
   - use_existing: использовать заранее созданные ad sets (для multiple directions с разными WhatsApp номерами)';
```

**Или добавить на уровне пользователя:**

```sql
ALTER TABLE user_accounts
ADD COLUMN default_adset_mode TEXT DEFAULT 'api_create'
CHECK (default_adset_mode IN ('api_create', 'use_existing'));
```

**Вопрос для обсуждения:**
- Ставить флаг на уровне `user_accounts` (глобально) или на уровне `account_directions` (per-direction)?
- **Мое мнение:** На уровне `user_accounts` — проще для пользователя, один переключатель

---

#### 1.2. Новая таблица для связи ad sets с направлениями

```sql
CREATE TABLE direction_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,
  
  -- Facebook Ad Set ID (созданный вручную)
  fb_adset_id TEXT NOT NULL,
  
  -- Метаданные
  adset_name TEXT,  -- Название ad set (для отображения в UI)
  daily_budget_cents INTEGER,  -- Текущий бюджет (синхронизируется из Facebook)
  status TEXT,  -- ACTIVE/PAUSED (синхронизируется)
  
  -- Когда был добавлен в систему
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Статус в нашей системе
  is_active BOOLEAN DEFAULT true,  -- Можно отключить использование этого ad set
  
  CONSTRAINT unique_adset_per_direction UNIQUE (direction_id, fb_adset_id)
);

CREATE INDEX idx_direction_adsets_direction ON direction_adsets(direction_id) WHERE is_active = true;
CREATE INDEX idx_direction_adsets_fb ON direction_adsets(fb_adset_id);
```

**Логика:**
- Пользователь создает ad sets вручную в Facebook
- Копирует ID ad set из Facebook Ads Manager
- Вставляет в наше приложение → привязывается к направлению
- Система использует эти ad sets вместо создания новых

---

### Задача 2: API для управления связанными ad sets

#### 2.1. Endpoint: Привязать существующий ad set к направлению

```typescript
// POST /api/directions/:directionId/link-adset
{
  "fb_adset_id": "120232923985510449",
  "user_account_id": "uuid"
}

// Response:
{
  "success": true,
  "direction_adset": {
    "id": "uuid",
    "direction_id": "uuid",
    "fb_adset_id": "120232923985510449",
    "adset_name": "Имплантация - Базовый",
    "daily_budget_cents": 5000,
    "status": "ACTIVE"
  }
}
```

**Логика:**
1. Проверить что direction существует и принадлежит пользователю
2. Запросить данные ad set из Facebook API (validate ID + получить название/бюджет)
3. Проверить что ad set принадлежит к правильной campaign (`direction.fb_campaign_id`)
4. Сохранить в `direction_adsets`

**Файл:** `services/agent-service/src/routes/directions.ts` (новый endpoint)

---

#### 2.2. Endpoint: Получить список связанных ad sets

```typescript
// GET /api/directions/:directionId/adsets?user_account_id=uuid

// Response:
{
  "success": true,
  "adsets": [
    {
      "id": "uuid",
      "fb_adset_id": "120232923985510449",
      "adset_name": "Имплантация - Базовый",
      "daily_budget_cents": 5000,
      "status": "ACTIVE",
      "is_active": true,
      "linked_at": "2025-11-06T10:00:00Z"
    }
  ]
}
```

---

#### 2.3. Endpoint: Отвязать ad set от направления

```typescript
// DELETE /api/directions/:directionId/adsets/:adsetId?user_account_id=uuid

// Response:
{
  "success": true,
  "message": "Ad set unlinked successfully"
}
```

**Логика:**
- Удалить запись из `direction_adsets`
- **НЕ удалять сам ad set в Facebook** (он остается, просто отвязываем)

---

### Задача 3: Модификация существующих workflows

Все сервисы создания ad sets должны учитывать новый режим.

#### 3.1. Общая логика (псевдокод)

```typescript
async function createOrUseAdSet(direction, context) {
  // Проверяем режим работы
  const mode = await getAdSetMode(direction.user_account_id);
  
  if (mode === 'api_create') {
    // СТАРАЯ ЛОГИКА: создаем новый ad set
    return await createNewAdSet(direction, context);
  }
  
  if (mode === 'use_existing') {
    // НОВАЯ ЛОГИКА: используем существующий ad set
    const adset = await getAvailableAdSet(direction.id);
    
    if (!adset) {
      throw new Error(
        `No pre-created ad sets available for direction "${direction.name}". ` +
        `Please create ad sets manually in Facebook Ads Manager and link them.`
      );
    }
    
    return adset;
  }
}

async function getAvailableAdSet(directionId) {
  // Найти активный ad set с минимальной нагрузкой
  const adsets = await supabase
    .from('direction_adsets')
    .select('*')
    .eq('direction_id', directionId)
    .eq('is_active', true)
    .eq('status', 'ACTIVE');
  
  if (adsets.length === 0) return null;
  
  // Можно добавить логику выбора:
  // - Самый новый
  // - С наименьшим количеством ads
  // - Round-robin
  
  return adsets[0];
}
```

---

#### 3.2. Модификация `workflowCreateAdSetInDirection.ts`

**Файл:** `services/agent-service/src/workflows/createAdSetInDirection.ts`

**Текущий код (упрощенно):**
```typescript
export async function workflowCreateAdSetInDirection(params, context, accessToken) {
  // 1. Получить direction
  const direction = await getDirection(params.direction_id);
  
  // 2. Получить креативы
  const creatives = await getCreatives(params.user_creative_ids);
  
  // 3. Создать ad set через API
  const adsetResult = await graph('POST', `${ad_account_id}/adsets`, accessToken, adsetBody);
  
  // 4. Создать ads для каждого креатива
  for (const creative of creatives) {
    await graph('POST', `${ad_account_id}/ads`, accessToken, adBody);
  }
}
```

**Новый код:**
```typescript
export async function workflowCreateAdSetInDirection(params, context, accessToken) {
  // 1. Получить direction
  const direction = await getDirection(params.direction_id);
  
  // 2. Получить креативы
  const creatives = await getCreatives(params.user_creative_ids);
  
  // 3. НОВАЯ ЛОГИКА: проверить режим
  const userAccount = await getUserAccount(context.user_account_id);
  
  let adset_id: string;
  
  if (userAccount.default_adset_mode === 'use_existing') {
    // Использовать существующий ad set
    const linkedAdSet = await getAvailableLinkedAdSet(direction.id);
    
    if (!linkedAdSet) {
      throw new Error(
        `No pre-created ad sets available for direction "${direction.name}". ` +
        `Please link ad sets in settings.`
      );
    }
    
    adset_id = linkedAdSet.fb_adset_id;
    
    log.info({
      directionId: direction.id,
      adsetId: adset_id,
      mode: 'use_existing'
    }, 'Using pre-created ad set');
    
  } else {
    // СТАРАЯ ЛОГИКА: создать новый ad set
    const adsetResult = await graph('POST', `${ad_account_id}/adsets`, accessToken, adsetBody);
    adset_id = adsetResult.id;
    
    log.info({
      directionId: direction.id,
      adsetId: adset_id,
      mode: 'api_create'
    }, 'Created new ad set via API');
  }
  
  // 4. Создать ads (ОДИНАКОВО для обоих режимов)
  for (const creative of creatives) {
    await graph('POST', `${ad_account_id}/ads`, accessToken, {
      name: adName,
      adset_id: adset_id,  // Используем ID (новый или существующий)
      creative: { creative_id: creative.fb_creative_id },
      status: 'ACTIVE'
    });
  }
}
```

---

#### 3.3. Модификация Auto-Launch V2

**Файл:** `services/agent-service/src/routes/campaignBuilder.ts`  
**Endpoint:** `POST /api/campaign-builder/auto-launch-v2`

Аналогичная модификация в цикле по направлениям:

```typescript
for (const direction of directions) {
  const mode = userAccount.default_adset_mode;
  
  let adset_id;
  
  if (mode === 'use_existing') {
    const linkedAdSet = await getAvailableLinkedAdSet(direction.id);
    if (!linkedAdSet) {
      log.warn({ directionId: direction.id }, 'No linked ad sets, skipping');
      continue;  // Пропускаем это направление
    }
    adset_id = linkedAdSet.fb_adset_id;
  } else {
    const adset = await createAdSetInCampaign({...});
    adset_id = adset.id;
  }
  
  // Создаем ads
  await createAdsInAdSet({ adsetId: adset_id, ... });
}
```

---

#### 3.4. Модификация Manual Launch

**Аналогично Auto-Launch V2**

---

#### 3.5. Creative Test — оставить как есть?

**Вопрос:** Creative Test создает отдельную тестовую campaign. Нужно ли его трогать?

**Мое мнение:** Оставить как есть — тесты должны быть изолированы, создавать новые ad sets.

---

### Задача 4: Frontend UI

#### 4.1. Переключатель режима в Settings

**Местоположение:** `services/frontend/src/pages/Profile.tsx` или отдельная секция Settings

```tsx
<div className="setting-item">
  <h3>Ad Set Creation Mode</h3>
  <p>Choose how ad sets are created for your campaigns:</p>
  
  <RadioGroup value={adsetMode} onChange={setAdsetMode}>
    <Radio value="api_create">
      <strong>Single Direction Mode (Default)</strong>
      <p>Automatically create ad sets through Facebook API. 
         Recommended for users with one business direction.</p>
    </Radio>
    
    <Radio value="use_existing">
      <strong>Multiple Directions Mode</strong>
      <p>Use pre-created ad sets with specific WhatsApp numbers. 
         Required for users with multiple directions and separate phone numbers.</p>
    </Radio>
  </RadioGroup>
  
  {adsetMode === 'use_existing' && (
    <Alert type="info">
      You'll need to create ad sets manually in Facebook Ads Manager 
      and link them to your directions.
    </Alert>
  )}
</div>
```

---

#### 4.2. Секция "Linked Ad Sets" в Directions

**Местоположение:** При редактировании направления

```tsx
{userSettings.default_adset_mode === 'use_existing' && (
  <div className="linked-adsets-section">
    <h3>Linked Ad Sets</h3>
    <p>These ad sets were pre-created in Facebook and linked to this direction:</p>
    
    <table>
      <thead>
        <tr>
          <th>Ad Set Name</th>
          <th>Facebook ID</th>
          <th>Daily Budget</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {linkedAdSets.map(adset => (
          <tr key={adset.id}>
            <td>{adset.adset_name}</td>
            <td>{adset.fb_adset_id}</td>
            <td>${adset.daily_budget_cents / 100}</td>
            <td>{adset.status}</td>
            <td>
              <button onClick={() => unlinkAdSet(adset.id)}>Unlink</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    
    <button onClick={openLinkAdSetDialog}>+ Link New Ad Set</button>
  </div>
)}
```

---

#### 4.3. Dialog для привязки ad set

```tsx
<Dialog open={linkAdSetDialogOpen} onClose={closeLinkAdSetDialog}>
  <h2>Link Pre-Created Ad Set</h2>
  
  <p>Create an ad set in Facebook Ads Manager first, then paste its ID here:</p>
  
  <ol>
    <li>Go to <a href="https://business.facebook.com/adsmanager" target="_blank">Facebook Ads Manager</a></li>
    <li>Create a new ad set in campaign: <strong>{direction.fb_campaign_id}</strong></li>
    <li>Set your WhatsApp number in the ad set settings</li>
    <li>Copy the ad set ID (format: 120232923985510449)</li>
    <li>Paste it below:</li>
  </ol>
  
  <input 
    type="text" 
    placeholder="120232923985510449"
    value={fbAdSetId}
    onChange={e => setFbAdSetId(e.target.value)}
  />
  
  <button onClick={linkAdSet}>Link Ad Set</button>
</Dialog>
```

---

### Задача 5: Управление бюджетами в режиме `use_existing`

**Вопрос:** AgentBrain может менять бюджеты ad sets через действие `UpdateAdSetDailyBudget`. Это должно работать и для pre-created ad sets?

**Ответ:** ДА, это критично! AgentBrain должен управлять бюджетами.

**Реализация:**
- Действие `UpdateAdSetDailyBudget` работает напрямую с `fb_adset_id`
- Не нужно ничего менять — работает и для api_create, и для use_existing

**Проверить:** `services/agent-service/src/routes/actions.ts` — действие `UpdateAdSetDailyBudget`

---

### Задача 6: Синхронизация данных ad sets

**Проблема:** Если пользователь меняет бюджет/статус ad set в Facebook напрямую, наша БД будет out of sync.

**Решение:** Периодическая синхронизация

```typescript
// Новый endpoint: POST /api/directions/:directionId/sync-adsets

async function syncLinkedAdSets(directionId: string, accessToken: string) {
  const linkedAdSets = await supabase
    .from('direction_adsets')
    .select('*')
    .eq('direction_id', directionId);
  
  for (const linkedAdSet of linkedAdSets) {
    // Запросить актуальные данные из Facebook
    const fbData = await graph('GET', linkedAdSet.fb_adset_id, accessToken, {
      fields: 'name,daily_budget,status'
    });
    
    // Обновить в БД
    await supabase
      .from('direction_adsets')
      .update({
        adset_name: fbData.name,
        daily_budget_cents: parseInt(fbData.daily_budget),
        status: fbData.status
      })
      .eq('id', linkedAdSet.id);
  }
}
```

**Когда синхронизировать:**
- При открытии страницы направления в UI
- При запуске Auto-Launch (перед использованием ad set)
- По кнопке "Sync" в UI

---

## ❓ КЛЮЧЕВЫЕ ВОПРОСЫ ДЛЯ ОБСУЖДЕНИЯ

### 1. Где хранить флаг режима?

**Вариант A:** На уровне `user_accounts` (глобально)
```sql
ALTER TABLE user_accounts ADD COLUMN default_adset_mode TEXT DEFAULT 'api_create';
```

✅ **Плюсы:**
- Проще для пользователя — один переключатель
- Логично: если у пользователя несколько направлений с разными номерами, то проблема глобальная

❌ **Минусы:**
- Менее гибко — нельзя для одного направления api_create, для другого use_existing

---

**Вариант B:** На уровне `account_directions` (per-direction)
```sql
ALTER TABLE account_directions ADD COLUMN adset_creation_mode TEXT DEFAULT 'api_create';
```

✅ **Плюсы:**
- Гибче — можно микшировать режимы

❌ **Минусы:**
- Сложнее для пользователя
- Непонятно когда использовать какой режим

---

**Мое предложение:** Вариант A (`user_accounts`) — проще и логичнее.

---

### 2. Как выбирать ad set из пула связанных?

Если к одному направлению привязано несколько ad sets, какой использовать?

**Варианты:**
1. **Самый новый** (по `linked_at`)
2. **С наименьшим количеством ads** (чтобы распределять нагрузку)
3. **Round-robin** (по очереди)
4. **Пользователь выбирает** в UI (при запуске)

**Мое предложение:** Начать с варианта 1 (самый новый), потом можно добавить настройку.

---

### 3. Что делать если нет доступных ad sets?

Когда система запрашивает ad set для направления в режиме `use_existing`, но их нет привязанных или все `is_active = false`:

**Варианты:**
1. **Выбросить ошибку** — пользователь должен создать и привязать ad set
2. **Fallback на api_create** — автоматически создать через API
3. **Пропустить направление** — в Auto-Launch просто skip

**Мое предложение:**
- В AgentBrain / Auto-Launch → пропустить направление + записать в лог
- В Manual Launch → показать ошибку пользователю

---

### 4. Нужно ли трогать Creative Test?

Creative Test создает отдельную тестовую campaign с собственным ad set.

**Вопрос:** Применять ли режим `use_existing` к Creative Test?

**Мое мнение:** НЕТ, оставить как есть. Creative Test — это изолированная функция для A/B тестирования, там не нужны pre-created ad sets.

---

### 5. Что с управлением бюджетами?

AgentBrain может:
- Увеличивать/уменьшать бюджеты ad sets (`UpdateAdSetDailyBudget`)
- Останавливать/запускать ad sets (`PauseAdSet` / `ActivateAdSet`)

**Вопрос:** Должно ли это работать для pre-created ad sets?

**Ответ:** ДА! Это критично. Управление бюджетами и статусами — основная функция агента.

**Реализация:** Эти действия работают напрямую через Facebook API с `fb_adset_id`, не требуют изменений.

---

### 6. UI/UX для привязки ad sets

**Вопросы:**
- Где должна быть кнопка "Link Ad Set"? (В настройках направления? На отдельной странице?)
- Показывать ли инструкцию как создать ad set в Facebook?
- Валидировать ли `fb_adset_id` через API перед сохранением?

**Мои предложения:**
- Кнопка в форме редактирования направления (если режим `use_existing` включен)
- Показывать step-by-step инструкцию в dialog
- ДА, обязательно валидировать через API + проверить что ad set в правильной campaign

---

## 📚 ССЫЛКИ НА ВАЖНЫЕ ФАЙЛЫ

### Backend (agent-service)

**Workflows создания ad sets:**
- `services/agent-service/src/workflows/createAdSetInDirection.ts` — Brain Agent workflow
- `services/agent-service/src/workflows/createCampaignWithCreative.ts` — Legacy workflow
- `services/agent-service/src/workflows/creativeTest.ts` — Creative test workflow

**Routes:**
- `services/agent-service/src/routes/actions.ts` — Brain Agent actions handler
- `services/agent-service/src/routes/campaignBuilder.ts` — Auto-launch, Manual-launch
- `services/agent-service/src/routes/creativeTest.ts` — Creative test endpoints
- `services/agent-service/src/routes/directions.ts` — Directions CRUD

**Helpers:**
- `services/agent-service/src/lib/campaignBuilder.ts` — `createAdSetInCampaign()` функция
- `services/agent-service/src/lib/settingsHelpers.ts` — `getWhatsAppPhoneNumber()` функция

---

### Frontend

**Pages:**
- `services/frontend/src/pages/Profile.tsx` — User settings (можно добавить переключатель режима)
- `services/frontend/src/components/VideoUpload.tsx` — Directions management UI

**Services:**
- `services/frontend/src/services/manualLaunchApi.ts` — Manual launch API calls
- `services/frontend/src/services/directionsApi.ts` — Directions API calls (может не существовать, нужно создать)

---

### База данных

**Migrations:**
- `migrations/008_account_directions.sql` — Таблица directions
- `migrations/012_whatsapp_phone_numbers_table.sql` — Таблица WhatsApp номеров

---

### Документация

**Ключевые доки:**
- `PROJECT_OVERVIEW_RU.md` — Общий обзор проекта
- `INFRASTRUCTURE.md` — Инфраструктура, деплой, архитектура
- `WHATSAPP_ERROR_2446885_FIX.md` — Описание проблемы с WhatsApp номерами
- `WHATSAPP_NUMBERS_LOGIC.md` — Логика работы с множественными номерами
- `CAMPAIGN_BUILDER_DIRECTIONS_LOGIC.md` — Логика направлений в Campaign Builder
- `MANUAL_LAUNCH_FRONTEND_SPEC.md` — Спека Manual Launch для фронтенда

---

## 🎯 ПЛАН РЕАЛИЗАЦИИ (предложение)

### Phase 1: База данных и Backend API (2-3 дня)

1. **Миграция БД:**
   - Добавить `default_adset_mode` в `user_accounts`
   - Создать таблицу `direction_adsets`

2. **API endpoints:**
   - `POST /api/directions/:directionId/link-adset` — привязать ad set
   - `GET /api/directions/:directionId/adsets` — список связанных ad sets
   - `DELETE /api/directions/:directionId/adsets/:adsetId` — отвязать ad set
   - `POST /api/directions/:directionId/sync-adsets` — синхронизация данных

3. **Helper функции:**
   - `getAdSetMode(userAccountId)` — получить режим пользователя
   - `getAvailableLinkedAdSet(directionId)` — найти доступный ad set
   - `validateAndFetchAdSet(fbAdSetId, accessToken)` — валидация через Facebook API

---

### Phase 2: Модификация workflows (3-4 дня)

1. **Обновить `workflowCreateAdSetInDirection.ts`:**
   - Добавить проверку режима
   - Ветвление: api_create vs use_existing
   - Логирование

2. **Обновить Auto-Launch V2:**
   - Аналогичная логика в `campaignBuilder.ts`

3. **Обновить Manual Launch:**
   - Аналогично Auto-Launch

4. **Обновить AgentBrain actions:**
   - Проверить что `UpdateAdSetDailyBudget` работает для обоих режимов
   - Обновить `SYSTEM_PROMPT` (если нужно)

5. **Тестирование:**
   - Unit тесты для новых функций
   - Integration тесты через API

---

### Phase 3: Frontend UI (2-3 дня)

1. **Settings:**
   - Добавить переключатель режима в Profile/Settings

2. **Directions Management:**
   - Секция "Linked Ad Sets" в форме направления
   - Dialog для привязки ad set
   - Кнопка синхронизации

3. **API интеграция:**
   - Новые функции в `services/directionsApi.ts`
   - Обновить типы TypeScript

4. **UX:**
   - Инструкции для пользователя
   - Валидация форм
   - Error handling

---

### Phase 4: Тестирование и документация (2 дня)

1. **E2E тестирование:**
   - Создать тестового пользователя с 2 направлениями
   - Создать ad sets в Facebook вручную
   - Привязать через UI
   - Запустить Auto-Launch → проверить что использует pre-created ad sets
   - Проверить что ads создаются корректно

2. **Документация:**
   - User guide: как переключить режим и привязать ad sets
   - Developer docs: архитектура нового режима
   - Обновить `PROJECT_OVERVIEW_RU.md`

3. **Деплой:**
   - Stage environment → тестирование
   - Production deployment
   - Мониторинг логов

---

## 💼 ДОПОЛНИТЕЛЬНЫЕ СООБРАЖЕНИЯ

### Обратная совместимость

✅ **Гарантировано:** Существующие пользователи не затронуты — по умолчанию `default_adset_mode = 'api_create'`

---

### Безопасность

- Валидировать `fb_adset_id` через Facebook API перед сохранением
- Проверять что ad set принадлежит пользователю (через `ad_account_id`)
- Проверять что ad set в правильной campaign (`direction.fb_campaign_id`)

---

### Производительность

- Индексы на `direction_adsets` по `direction_id` и `fb_adset_id`
- Кешировать результаты `getAvailableLinkedAdSet()` (Redis?)

---

### Мониторинг

Добавить логирование:
- Когда используется pre-created ad set (вместо создания нового)
- Когда нет доступных ad sets (skip direction)
- Ошибки валидации `fb_adset_id`

---

## 🤝 ФИНАЛЬНЫЙ ВОПРОС

**Согласен ли ты с этим подходом?**

Если да — какие есть идеи по улучшению архитектуры?

Если нет — какое альтернативное решение ты предлагаешь?

---

## 📞 КОНТАКТЫ

После анализа этого документа, пожалуйста:

1. **Подтверди понимание задачи**
2. **Ответь на ключевые вопросы** (раздел "Ключевые вопросы для обсуждения")
3. **Предложи свой план реализации** (или согласись с предложенным)
4. **Укажи на потенциальные проблемы**, которые я мог упустить
5. **Оцени трудозатраты** на реализацию

---

**Дата создания:** 2025-11-06  
**Версия:** 1.0  
**Статус:** Awaiting Feedback

🚀 **Готов к детальному обсуждению архитектуры!**








