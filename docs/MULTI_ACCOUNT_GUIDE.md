# Руководство по мультиаккаунтности

> Полная документация по архитектуре мультиаккаунтности в системе управления рекламными кампаниями Facebook/Instagram.

## Содержание

1. [Обзор архитектуры](#обзор-архитектуры)
   - [Два режима работы](#два-режима-работы)
   - [Принцип работы флага](#принцип-работы-флага)
   - [Визуальная схема](#визуальная-схема)
2. [Соглашение об именовании](#соглашение-об-именовании)
   - [Критическое различие](#критическое-различие-два-разных-понятия)
   - [Где используется каждое поле](#где-используется-каждое-поле)
   - [История переименования](#история-переименования)
3. [Таблицы базы данных](#таблицы-базы-данных)
   - [user_accounts](#user_accounts-основная-таблица-пользователей)
   - [ad_accounts](#ad_accounts-рекламные-аккаунты)
   - [Связанные таблицы](#связанные-таблицы-с-account_id)
4. [Миграции](#миграции)
   - [Полный список миграций](#полный-список-миграций)
   - [Детали ключевых миграций](#детали-ключевых-миграций)
   - [Идемпотентность миграций](#идемпотентность-миграций)
5. [Логика работы в коде](#логика-работы-в-коде)
   - [Хелпер adAccountHelper.ts](#главный-хелпер-adaccounthelperts)
   - [Паттерн в роутах](#паттерн-использования-в-роутах)
   - [Блок-схема принятия решений](#блок-схема-принятия-решений)
6. [API эндпоинты](#api-эндпоинты)
   - [Креативы](#создание-креативов)
   - [Autopilot](#autopilot)
   - [Creative Tests](#creative-tests)
7. [Frontend интеграция](#frontend-интеграция)
   - [Хранение выбранного аккаунта](#хранение-выбранного-аккаунта)
   - [Передача account_id в запросах](#передача-account_id-в-запросах)
8. [Примеры использования](#примеры-использования)
9. [Troubleshooting](#troubleshooting)
10. [Чеклист для разработчика](#чеклист-для-разработчика)
11. [FAQ](#faq)

---

## Обзор архитектуры

### Два режима работы

Система поддерживает два режима работы, определяемых **единственным флагом** `multi_account_enabled` в таблице `user_accounts`:

```
┌────────────────────────────────────────────────────────────────────┐
│                    РЕЖИМЫ РАБОТЫ СИСТЕМЫ                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────┐      ┌─────────────────────────────────┐ │
│  │   LEGACY РЕЖИМ      │      │   MULTI-ACCOUNT РЕЖИМ           │ │
│  │   (по умолчанию)    │      │   (расширенный)                 │ │
│  ├─────────────────────┤      ├─────────────────────────────────┤ │
│  │ multi_account_      │      │ multi_account_                  │ │
│  │ enabled = FALSE     │      │ enabled = TRUE                  │ │
│  ├─────────────────────┤      ├─────────────────────────────────┤ │
│  │ • 1 пользователь =  │      │ • 1 пользователь =              │ │
│  │   1 FB аккаунт      │      │   N FB аккаунтов                │ │
│  │                     │      │                                 │ │
│  │ • Credentials в     │      │ • Credentials в                 │ │
│  │   user_accounts     │      │   ad_accounts                   │ │
│  │                     │      │                                 │ │
│  │ • account_id        │      │ • account_id                    │ │
│  │   НЕ ТРЕБУЕТСЯ      │      │   ОБЯЗАТЕЛЕН                    │ │
│  └─────────────────────┘      └─────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Принцип работы флага

**СТРОГОЕ ПРАВИЛО:** Логика ветвления определяется ТОЛЬКО значением `multi_account_enabled`:

```typescript
// ПРАВИЛЬНО ✅
if (user.multi_account_enabled) {
  // Используем ad_accounts, требуем account_id
} else {
  // Используем user_accounts, account_id игнорируется
}

// НЕПРАВИЛЬНО ❌
if (account_id) {
  // НЕ проверяем наличие account_id для определения режима!
}
```

### Визуальная схема

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           user_accounts                                  │
│─────────────────────────────────────────────────────────────────────────│
│ id (UUID, PK)              ─────────────────────────────────────────────│
│ multi_account_enabled      ← ГЛАВНЫЙ ФЛАГ (определяет режим работы)     │
│─────────────────────────────────────────────────────────────────────────│
│ [Legacy credentials - используются если multi_account_enabled = false]  │
│ access_token               ← Facebook User Access Token                  │
│ ad_account_id              ← Facebook Ad Account ID (act_123456)        │
│ page_id                    ← Facebook Page ID                           │
│ instagram_id               ← Instagram Business Account ID              │
│ instagram_username         ← @username в Instagram                      │
│ business_id                ← Facebook Business Manager ID               │
│ whatsapp_phone_number      ← WhatsApp Business Phone                    │
│─────────────────────────────────────────────────────────────────────────│
│ [Общие настройки пользователя]                                          │
│ prompt1, prompt2...        ← Промпты для генерации                      │
│ telegram_id                ← Telegram для уведомлений                   │
│ tarif, tarif_expires       ← Информация о тарифе                        │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
                      │ 1:N (если multi_account_enabled = true)
                      │
┌─────────────────────▼───────────────────────────────────────────────────┐
│                           ad_accounts                                    │
│─────────────────────────────────────────────────────────────────────────│
│ id (UUID, PK)              ← ЭТО account_id в API запросах              │
│ user_account_id (FK)       ← Связь с user_accounts.id                   │
│─────────────────────────────────────────────────────────────────────────│
│ [Идентификация аккаунта]                                                │
│ name                       ← Название аккаунта (для UI)                 │
│ username                   ← Логин/username                             │
│ is_default                 ← Аккаунт по умолчанию (один на user)        │
│ is_active                  ← Активен ли аккаунт                         │
│ connection_status          ← Статус подключения (pending/connected/error)│
│─────────────────────────────────────────────────────────────────────────│
│ [Facebook credentials - ИДЕНТИЧНЫЕ поля как в user_accounts]            │
│ access_token               ← Facebook User Access Token                  │
│ ad_account_id              ← Facebook Ad Account ID (act_123456)        │
│ page_id                    ← Facebook Page ID                           │
│ instagram_id               ← Instagram Business Account ID              │
│ instagram_username         ← @username в Instagram                      │
│ business_id                ← Facebook Business Manager ID               │
│─────────────────────────────────────────────────────────────────────────│
│ [Дополнительные интеграции - копируются или уникальные для аккаунта]    │
│ whatsapp_phone_number      ← WhatsApp номер                             │
│ tiktok_account_id          ← TikTok Ads Account                         │
│ amocrm_*                   ← AmoCRM интеграция                          │
│ prompt1, prompt2...        ← Промпты (могут отличаться от user_accounts)│
│─────────────────────────────────────────────────────────────────────────│
│ [Autopilot]                                                             │
│ autopilot                  ← Включён ли автопилот для этого аккаунта    │
└─────────────────────────────────────────────────────────────────────────┘
                      │
                      │ Связанные таблицы (account_id = FK к ad_accounts.id)
                      │
        ┌─────────────┼─────────────┬─────────────────┬──────────────┐
        ▼             ▼             ▼                 ▼              ▼
┌───────────────┐ ┌────────────┐ ┌────────────────┐ ┌────────────┐ ┌─────────┐
│user_creatives │ │generated_  │ │account_        │ │brain_      │ │creative_│
│               │ │creatives   │ │directions      │ │executions  │ │tests    │
│ account_id    │ │ account_id │ │ account_id     │ │ account_id │ │account_id│
│ (UUID FK)     │ │ (UUID FK)  │ │ (UUID FK)      │ │ (UUID FK)  │ │(UUID FK)│
└───────────────┘ └────────────┘ └────────────────┘ └────────────┘ └─────────┘
        │
        │ + Миграция 067 (ROI аналитика, конкуренты, WhatsApp, метрики)
        │
        ┌─────────────┼─────────────┬─────────────────┬──────────────┐
        ▼             ▼             ▼                 ▼              ▼
┌───────────────┐ ┌────────────┐ ┌────────────────┐ ┌────────────┐ ┌─────────┐
│    leads      │ │ purchases  │ │    sales       │ │user_       │ │whatsapp_│
│               │ │            │ │                │ │competitors │ │instances│
│ account_id    │ │ account_id │ │ account_id     │ │ account_id │ │account_id│
│ (UUID FK)     │ │ (UUID FK)  │ │ (UUID FK)      │ │ (UUID FK)  │ │(UUID FK)│
└───────────────┘ └────────────┘ └────────────────┘ └────────────┘ └─────────┘
        │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌───────────────┐ ┌────────────────────┐
│creative_      │ │creative_analysis   │
│metrics_history│ │                    │
│ account_id    │ │ account_id         │
│ (UUID FK)     │ │ (UUID FK)          │
└───────────────┘ └────────────────────┘
```

---

## Соглашение об именовании

### Критическое различие: два разных понятия

> ⚠️ **ВНИМАНИЕ:** Путаница между этими двумя полями — главная причина багов!

| Поле | Тип данных | Что это | Пример значения | Где хранится |
|------|------------|---------|-----------------|--------------|
| `ad_account_id` | `TEXT` | **Facebook Ad Account ID** — идентификатор рекламного аккаунта в Facebook | `act_123456789012345` | `user_accounts.ad_account_id`, `ad_accounts.ad_account_id` |
| `account_id` | `UUID` | **FK ссылка на ad_accounts.id** — внутренний идентификатор для связи таблиц | `550e8400-e29b-41d4-a716-446655440000` | `user_creatives.account_id`, `brain_executions.account_id` и др. |

### Визуальное сравнение

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ad_account_id (TEXT)                              │
│──────────────────────────────────────────────────────────────────────────│
│ • Facebook Ad Account ID                                                  │
│ • Формат: act_XXXXXXXXX (всегда начинается с "act_")                     │
│ • Используется для вызовов Facebook Marketing API                        │
│ • Получается из Facebook при подключении аккаунта                        │
│                                                                          │
│ Пример: "act_123456789012345"                                            │
│                                                                          │
│ Используется в:                                                          │
│   - Facebook API calls (createAd, getInsights, uploadImage...)          │
│   - Хранится в user_accounts.ad_account_id (legacy)                     │
│   - Хранится в ad_accounts.ad_account_id (multi-account)                │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                          account_id (UUID)                                │
│──────────────────────────────────────────────────────────────────────────│
│ • Внутренний UUID нашей системы                                          │
│ • FK ссылка на ad_accounts.id                                            │
│ • Используется в API для указания какой аккаунт использовать            │
│ • Генерируется автоматически при создании ad_accounts записи             │
│                                                                          │
│ Пример: "550e8400-e29b-41d4-a716-446655440000"                           │
│                                                                          │
│ Используется в:                                                          │
│   - API параметрах (body.account_id, query.accountId)                   │
│   - FK колонках связанных таблиц (user_creatives.account_id и др.)      │
│   - Никогда не передаётся в Facebook API                                │
└──────────────────────────────────────────────────────────────────────────┘
```

### Где используется каждое поле

#### `ad_account_id` (Facebook ID)

```typescript
// 1. Хранение в базе данных
user_accounts.ad_account_id    // Legacy режим
ad_accounts.ad_account_id      // Multi-account режим

// 2. Facebook API вызовы
const response = await fetch(
  `https://graph.facebook.com/v21.0/${ad_account_id}/ads`,
  { method: 'POST', ... }
);

// 3. Нормализация (добавление префикса act_)
function normalizeAdAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}
```

#### `account_id` (UUID FK)

```typescript
// 1. API параметры
const body = {
  user_id: 'uuid',
  account_id: 'uuid',  // ← Этот параметр
  creative_id: 'uuid'
};

// 2. Query параметры
GET /api/autopilot/executions?userAccountId=uuid&accountId=uuid

// 3. FK в связанных таблицах
await supabase
  .from('user_creatives')
  .insert({
    user_id,
    account_id,  // ← UUID FK к ad_accounts.id
    ...
  });

// 4. Фильтрация данных по аккаунту
await supabase
  .from('brain_executions')
  .select('*')
  .eq('account_id', accountId);  // ← Фильтр по UUID
```

### История переименования

**Проблема:** Изначально FK колонки в связанных таблицах назывались `ad_account_id` (UUID), что вызывало путаницу с Facebook Ad Account ID (TEXT).

**Решение:** Миграция 066 переименовала все FK колонки:

| До (путаница) | После (ясно) |
|---------------|--------------|
| `user_creatives.ad_account_id` (UUID) | `user_creatives.account_id` (UUID) |
| `brain_executions.ad_account_id` (UUID) | `brain_executions.account_id` (UUID) |
| ... | ... |

**Теперь правило простое:**
- `ad_account_id` = Facebook ID (TEXT, act_xxx)
- `account_id` = UUID FK к ad_accounts.id

---

## Таблицы базы данных

### user_accounts (основная таблица пользователей)

```sql
CREATE TABLE user_accounts (
  -- Идентификация
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT,

  -- ⭐ ГЛАВНЫЙ ФЛАГ МУЛЬТИАККАУНТНОСТИ
  multi_account_enabled BOOLEAN DEFAULT false,

  -- Legacy credentials (используются ТОЛЬКО при multi_account_enabled = false)
  access_token TEXT,                    -- Facebook User Access Token
  ad_account_id TEXT,                   -- Facebook Ad Account ID (act_xxx)
  page_id TEXT,                         -- Facebook Page ID
  instagram_id TEXT,                    -- Instagram Business Account ID
  instagram_username TEXT,              -- @username
  business_id TEXT,                     -- Facebook Business Manager ID
  ig_seed_audience_id TEXT,             -- Seed Audience для Lookalike
  whatsapp_phone_number TEXT,           -- WhatsApp Business номер

  -- TikTok (legacy)
  tiktok_account_id TEXT,
  tiktok_business_id TEXT,
  tiktok_access_token TEXT,

  -- Промпты для генерации креативов
  prompt1 TEXT,
  prompt2 TEXT,
  prompt3 TEXT,
  prompt4 TEXT,

  -- Telegram уведомления
  telegram_id TEXT,
  telegram_id_2 TEXT,
  telegram_id_3 TEXT,
  telegram_id_4 TEXT,

  -- API ключи
  openai_api_key TEXT,
  gemini_api_key TEXT,

  -- AmoCRM интеграция
  amocrm_subdomain TEXT,
  amocrm_access_token TEXT,
  amocrm_refresh_token TEXT,
  amocrm_token_expires_at TIMESTAMP,
  amocrm_client_id TEXT,
  amocrm_client_secret TEXT,

  -- Custom Audiences для таргетинга
  custom_audiences JSONB DEFAULT '[]',

  -- Тариф
  tarif TEXT,
  tarif_expires TIMESTAMP,

  -- Настройки
  default_adset_mode TEXT DEFAULT 'api_create',  -- 'api_create' | 'use_existing'
  autopilot BOOLEAN DEFAULT false,               -- Legacy autopilot flag

  -- Метаданные
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_user_accounts_email ON user_accounts(email);
CREATE INDEX idx_user_accounts_telegram_id ON user_accounts(telegram_id);
```

### ad_accounts (рекламные аккаунты)

```sql
CREATE TABLE ad_accounts (
  -- Идентификация
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- ЭТО account_id в API!
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Название и статус
  name TEXT,                              -- Название для UI ("Основной аккаунт")
  username TEXT,                          -- Логин/username
  is_default BOOLEAN DEFAULT false,       -- Только один аккаунт может быть default
  is_active BOOLEAN DEFAULT true,         -- Активен ли
  connection_status TEXT DEFAULT 'pending', -- 'pending' | 'connected' | 'error' | 'token_expired'

  -- Facebook credentials (ИДЕНТИЧНЫЕ поля как в user_accounts)
  access_token TEXT,                      -- Facebook User Access Token
  ad_account_id TEXT,                     -- Facebook Ad Account ID (act_xxx) ← ТЕКСТ!
  page_id TEXT,
  instagram_id TEXT,
  instagram_username TEXT,
  business_id TEXT,
  ig_seed_audience_id TEXT,

  -- WhatsApp
  whatsapp_phone_number TEXT,

  -- TikTok
  tiktok_account_id TEXT,
  tiktok_business_id TEXT,
  tiktok_access_token TEXT,

  -- Промпты (могут отличаться от user_accounts)
  prompt1 TEXT,
  prompt2 TEXT,
  prompt3 TEXT,
  prompt4 TEXT,

  -- Telegram (для уведомлений по этому аккаунту)
  telegram_id TEXT,
  telegram_id_2 TEXT,
  telegram_id_3 TEXT,
  telegram_id_4 TEXT,

  -- API ключи (могут быть уникальными для аккаунта)
  openai_api_key TEXT,
  gemini_api_key TEXT,

  -- AmoCRM
  amocrm_subdomain TEXT,
  amocrm_access_token TEXT,
  amocrm_refresh_token TEXT,
  amocrm_token_expires_at TIMESTAMP,
  amocrm_client_id TEXT,
  amocrm_client_secret TEXT,

  -- Custom Audiences
  custom_audiences JSONB DEFAULT '[]',

  -- Тариф (может быть отдельный для аккаунта)
  tarif TEXT,
  tarif_expires TIMESTAMP,

  -- Autopilot для этого конкретного аккаунта
  autopilot BOOLEAN DEFAULT false,

  -- Метаданные
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_ad_accounts_user_account_id ON ad_accounts(user_account_id);
CREATE UNIQUE INDEX idx_ad_accounts_default ON ad_accounts(user_account_id)
  WHERE is_default = true;  -- Только один default на пользователя
CREATE INDEX idx_ad_accounts_active ON ad_accounts(user_account_id, is_active)
  WHERE is_active = true;
```

### Связанные таблицы с account_id

Все таблицы, которые привязываются к конкретному рекламному аккаунту:

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- user_creatives - загруженные/созданные креативы
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE user_creatives
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_creatives.account_id IS
  'UUID FK к ad_accounts.id для multi-account режима. NULL для legacy.';

CREATE INDEX idx_user_creatives_account_id
  ON user_creatives(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- generated_creatives - сгенерированные AI креативы
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE generated_creatives
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_generated_creatives_account_id
  ON generated_creatives(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- account_directions - направления бизнеса (products/services)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE account_directions
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_account_directions_account_id
  ON account_directions(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- default_ad_settings - настройки рекламы по умолчанию
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE default_ad_settings
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_default_ad_settings_account_id
  ON default_ad_settings(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- brain_executions - выполнения AI агента (autopilot)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE brain_executions
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_brain_executions_account_id
  ON brain_executions(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- campaign_reports - отчёты по кампаниям
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE campaign_reports
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_campaign_reports_account_id
  ON campaign_reports(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- creative_tests - A/B тесты креативов
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE creative_tests
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_creative_tests_account_id
  ON creative_tests(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- whatsapp_phone_numbers - WhatsApp номера для аккаунтов
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE whatsapp_phone_numbers
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_whatsapp_phone_numbers_account_id
  ON whatsapp_phone_numbers(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- user_briefing_responses - ответы на брифинг
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE user_briefing_responses
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

-- Уникальный индекс: один брифинг на пользователя+аккаунт
CREATE UNIQUE INDEX idx_user_briefing_unique_per_account
  ON user_briefing_responses(user_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ═══════════════════════════════════════════════════════════════════════
-- leads - лиды для ROI аналитики (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE leads
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_account_id
  ON leads(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- purchases - продажи из AmoCRM (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE purchases
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_purchases_account_id
  ON purchases(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- sales - альтернативная таблица продаж (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE sales
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_sales_account_id
  ON sales(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- user_competitors - связь пользователя с конкурентами (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE user_competitors
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_user_competitors_account_id
  ON user_competitors(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- whatsapp_instances - WhatsApp инстансы (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE whatsapp_instances
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_whatsapp_instances_account_id
  ON whatsapp_instances(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- creative_metrics_history - история метрик креативов (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE creative_metrics_history
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_creative_metrics_history_account_id
  ON creative_metrics_history(account_id) WHERE account_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- creative_analysis - AI анализ креативов (миграция 067)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE creative_analysis
ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_creative_analysis_account_id
  ON creative_analysis(account_id) WHERE account_id IS NOT NULL;
```

---

## Миграции

### Полный список миграций

| № | Файл | Описание | Статус |
|---|------|----------|--------|
| 057 | `057_add_multi_account_tables.sql` | Создание таблицы `ad_accounts`, добавление `multi_account_enabled` в `user_accounts` | ✅ Applied |
| 058 | `058_add_whatsapp_phone_numbers.sql` | Таблица WhatsApp номеров с поддержкой `account_id` | ✅ Applied |
| 059 | `059_add_account_id_to_tables.sql` | Добавление FK колонок в основные таблицы (изначально `ad_account_id`) | ✅ Applied |
| 060 | `060_add_user_briefing_responses.sql` | Таблица брифингов с `account_id` | ✅ Applied |
| 063 | `063_add_brain_executions.sql` | Таблица выполнений autopilot с `account_id` | ✅ Applied |
| 064 | `064_add_ad_account_id_to_creative_tests.sql` | Добавление `account_id` в creative_tests (сразу с правильным именем) | ✅ Applied |
| 065 | `065_rename_ad_accounts_fb_columns.sql` | Переименование `fb_*` → стандартные имена в `ad_accounts` | ✅ Applied |
| 066 | `066_rename_fk_ad_account_id_to_account_id.sql` | Переименование FK колонок `ad_account_id` → `account_id` | ✅ Applied |
| 067 | `067_add_account_id_to_remaining_tables.sql` | Добавление `account_id` в ROI, конкуренты, WhatsApp и метрики | ⏳ Pending |

### Детали ключевых миграций

#### Миграция 065: Унификация полей ad_accounts

**Проблема:** Поля в `ad_accounts` имели префикс `fb_`, что отличалось от `user_accounts`:

```sql
-- До миграции 065:
ad_accounts.fb_access_token
ad_accounts.fb_ad_account_id
ad_accounts.fb_page_id

-- После миграции 065:
ad_accounts.access_token      -- Как в user_accounts
ad_accounts.ad_account_id     -- Как в user_accounts
ad_accounts.page_id           -- Как в user_accounts
```

**Преимущество:** Теперь код может использовать одинаковые имена полей независимо от источника:

```typescript
// Одинаковый код для обоих режимов
const token = data.access_token;
const fbAccountId = data.ad_account_id;
const pageId = data.page_id;
```

#### Миграция 066: Переименование FK колонок

**Проблема:** FK колонки назывались `ad_account_id` (UUID), что путалось с Facebook ID:

```sql
-- До миграции 066 (ПУТАНИЦА):
user_creatives.ad_account_id      -- UUID (FK к ad_accounts.id)
ad_accounts.ad_account_id         -- TEXT (Facebook act_xxx)
-- ^^^ Одинаковое имя, разные типы и назначения!

-- После миграции 066 (ЯСНО):
user_creatives.account_id         -- UUID (FK к ad_accounts.id)
ad_accounts.ad_account_id         -- TEXT (Facebook act_xxx)
-- ^^^ Разные имена для разных целей
```

#### Миграция 067: ROI аналитика и дополнительные таблицы

**Цель:** Расширить мультиаккаунтность на оставшиеся таблицы — ROI аналитику, конкурентов, WhatsApp и метрики.

**Затронутые таблицы:**

| Таблица | Назначение |
|---------|------------|
| `leads` | Лиды для ROI аналитики |
| `purchases` | Продажи из AmoCRM |
| `sales` | Альтернативная таблица продаж |
| `user_competitors` | Связь пользователя с конкурентами |
| `whatsapp_instances` | WhatsApp инстансы |
| `creative_metrics_history` | История метрик креативов (agent-brain) |
| `creative_analysis` | AI анализ креативов (agent-brain) |

**Код изменения:**

```sql
-- Добавление колонки с FK
ALTER TABLE leads ADD COLUMN account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

-- Partial индекс для быстрой фильтрации
CREATE INDEX idx_leads_account_id ON leads(account_id) WHERE account_id IS NOT NULL;

-- Комментарий для документации
COMMENT ON COLUMN leads.account_id IS 'UUID FK to ad_accounts.id for multi-account mode. NULL for legacy mode.';
```

**Backend изменения (agent-service):**

| Файл | Изменения |
|------|-----------|
| `routes/leads.ts` | Добавлен `accountId` в схему `CreateLeadSchema`, фильтрация в GET `/leads` |
| `routes/evolutionWebhooks.ts` | Передача `account_id` из WhatsApp инстанса в лиды |
| `workflows/amocrmSync.ts` | Сохранение `account_id` в purchases и sales при закрытии сделки |
| `workflows/amocrmLeadsSync.ts` | Передача `account_id` в purchases |

**Backend изменения (agent-brain):**

| Файл | Изменения |
|------|-----------|
| `server.js` | Функция `getAccountUUID()` для резолва UUID из Facebook ad_account_id |
| `scoring.js` | Передача `accountUUID` в `creative_metrics_history` |
| `analyzerService.js` | Передача `accountUUID` в `creative_analysis` |

**Frontend изменения:**

| Файл | Изменения |
|------|-----------|
| `services/manualLaunchApi.ts` | Добавлен `account_id` в `ManualLaunchRequest` |
| `services/competitorsApi.ts` | Добавлен `accountId` в `list()`, `getAllCreatives()`, `getTop10ForReference()` |
| `services/salesApi.ts` | Добавлен `accountId` в `getAllPurchases()`, `getROIData()`, `addSale()`, `addSaleWithCreative()`, `getLeadsForROI()` |
| `types/competitor.ts` | Добавлен `accountId` в `AddCompetitorRequest` |
| `pages/Creatives.tsx` | Передача `currentAdAccountId` в `manualLaunchAds()` |
| `components/VideoUpload.tsx` | Передача `currentAdAccountId` в `manualLaunchAds()` |

### Идемпотентность миграций

Все миграции написаны идемпотентно — их можно запускать повторно без ошибок:

```sql
-- Переименование колонки (только если существует старое имя)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_creatives'
    AND column_name = 'ad_account_id'
  ) THEN
    ALTER TABLE user_creatives RENAME COLUMN ad_account_id TO account_id;
  END IF;
END $$;

-- Создание индекса (только если колонка существует)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_creatives'
    AND column_name = 'account_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_creatives_account_id
    ON user_creatives(account_id) WHERE account_id IS NOT NULL;
  END IF;
END $$;

-- Удаление индекса (безопасно если не существует)
DROP INDEX IF EXISTS idx_user_creatives_ad_account_id;
```

---

## Логика работы в коде

### Главный хелпер: adAccountHelper.ts

**Файл:** `services/agent-service/src/lib/adAccountHelper.ts`

#### Интерфейс AdCredentials

```typescript
export interface AdCredentials {
  // Facebook
  fbAccessToken: string | null;
  fbAdAccountId: string | null;      // Facebook ID (act_xxx)
  fbPageId: string | null;
  fbInstagramId: string | null;
  fbInstagramUsername: string | null;
  fbBusinessId: string | null;
  igSeedAudienceId: string | null;
  whatsappPhoneNumber: string | null;

  // TikTok
  tiktokAccountId: string | null;
  tiktokBusinessId: string | null;
  tiktokAccessToken: string | null;

  // Prompts
  prompt1: string | null;
  prompt2: string | null;
  prompt3: string | null;
  prompt4: string | null;

  // Telegram
  telegramId: string | null;
  telegramId2: string | null;
  telegramId3: string | null;
  telegramId4: string | null;

  // API Keys
  openaiApiKey: string | null;
  geminiApiKey: string | null;

  // AmoCRM
  amocrmSubdomain: string | null;
  amocrmAccessToken: string | null;
  amocrmRefreshToken: string | null;
  amocrmTokenExpiresAt: string | null;
  amocrmClientId: string | null;
  amocrmClientSecret: string | null;

  // Custom audiences
  customAudiences: Array<{ id: string; name: string }>;

  // Tariff
  tarif: string | null;
  tarifExpires: string | null;

  // Settings
  defaultAdsetMode: 'api_create' | 'use_existing';

  // Meta (информация о режиме)
  isMultiAccountMode: boolean;
  adAccountId: string | null;        // UUID из ad_accounts.id
  adAccountName: string | null;
}
```

#### Функция getCredentials()

```typescript
/**
 * Получает учётные данные для пользователя.
 * Автоматически определяет режим работы по флагу multi_account_enabled.
 *
 * @param userAccountId - ID пользователя из user_accounts
 * @param accountId - UUID FK из ad_accounts.id (обязательно для multi-account)
 */
export async function getCredentials(
  userAccountId: string,
  accountId?: string
): Promise<AdCredentials> {

  // 1. Получаем данные пользователя
  const { data: user, error: userError } = await supabase
    .from('user_accounts')
    .select(`
      multi_account_enabled,
      default_adset_mode,
      access_token,
      ad_account_id,
      page_id,
      instagram_id,
      instagram_username,
      business_id,
      ig_seed_audience_id,
      whatsapp_phone_number,
      tiktok_account_id,
      tiktok_business_id,
      tiktok_access_token,
      prompt1, prompt2, prompt3, prompt4,
      telegram_id, telegram_id_2, telegram_id_3, telegram_id_4,
      openai_api_key, gemini_api_key,
      amocrm_subdomain, amocrm_access_token, amocrm_refresh_token,
      amocrm_token_expires_at, amocrm_client_id, amocrm_client_secret,
      custom_audiences,
      tarif, tarif_expires
    `)
    .eq('id', userAccountId)
    .single();

  if (userError || !user) {
    throw new Error(`User not found: ${userAccountId}`);
  }

  // 2. Проверяем режим работы СТРОГО по флагу
  if (user.multi_account_enabled) {

    // Multi-account режим - ТРЕБУЕМ account_id
    if (!accountId) {
      throw new Error('account_id is required when multi_account_enabled is true');
    }

    // Читаем из ad_accounts
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_account_id', userAccountId)  // Проверяем принадлежность!
      .single();

    if (adError || !adAccount) {
      throw new Error(`Ad account not found: ${accountId}`);
    }

    return {
      fbAccessToken: adAccount.access_token,
      fbAdAccountId: adAccount.ad_account_id,
      fbPageId: adAccount.page_id,
      // ... все поля из adAccount
      isMultiAccountMode: true,
      adAccountId: adAccount.id,
      adAccountName: adAccount.name,
    };
  }

  // 3. Legacy режим - читаем из user_accounts
  return {
    fbAccessToken: user.access_token,
    fbAdAccountId: user.ad_account_id,
    fbPageId: user.page_id,
    // ... все поля из user
    isMultiAccountMode: false,
    adAccountId: null,
    adAccountName: null,
  };
}
```

#### Вспомогательные функции

```typescript
/**
 * Получает дефолтный рекламный аккаунт пользователя
 */
export async function getDefaultAdAccount(userAccountId: string): Promise<string | null> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!user?.multi_account_enabled) {
    return null;  // Legacy режим - нет ad_accounts
  }

  const { data: adAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('user_account_id', userAccountId)
    .eq('is_default', true)
    .single();

  return adAccount?.id || null;
}

/**
 * Получает список всех рекламных аккаунтов пользователя
 */
export async function getAdAccounts(userAccountId: string) {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  if (!user?.multi_account_enabled) {
    return [];  // Legacy режим
  }

  const { data: adAccounts } = await supabase
    .from('ad_accounts')
    .select('id, name, username, is_default, is_active, tarif, tarif_expires, connection_status')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: true });

  return adAccounts || [];
}

/**
 * Проверяет, включён ли режим мультиаккаунтности
 */
export async function isMultiAccountEnabled(userAccountId: string): Promise<boolean> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled')
    .eq('id', userAccountId)
    .single();

  return user?.multi_account_enabled === true;
}
```

### Паттерн использования в роутах

```typescript
// routes/image.ts - пример полной реализации

import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// 1. Схема валидации с optional account_id
const CreateImageCreativeSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),  // UUID FK из ad_accounts.id
  creative_id: z.string().uuid(),
  direction_id: z.string().uuid()
});

app.post('/create-image-creative', async (request, reply) => {
  const body = CreateImageCreativeSchema.parse(request.body);
  const { user_id, account_id, creative_id, direction_id } = body;

  // 2. Получаем данные пользователя с флагом
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('id, multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username')
    .eq('id', user_id)
    .single();

  // 3. Определяем переменные для credentials
  let ACCESS_TOKEN: string;
  let fbAdAccountId: string;
  let pageId: string;
  let instagramId: string;
  let instagramUsername: string | null = null;

  // 4. Ветвление по флагу multi_account_enabled
  if (userAccount.multi_account_enabled) {

    // ═══════════════════════════════════════════════════════════
    // MULTI-ACCOUNT РЕЖИМ
    // ═══════════════════════════════════════════════════════════

    // 4.1. Требуем account_id
    if (!account_id) {
      return reply.status(400).send({
        success: false,
        error: 'account_id is required when multi_account_enabled is true'
      });
    }

    // 4.2. Загружаем из ad_accounts
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username')
      .eq('id', account_id)
      .eq('user_account_id', user_id)  // ⚠️ ВАЖНО: проверка принадлежности!
      .single();

    if (adError || !adAccount) {
      return reply.status(404).send({
        success: false,
        error: 'Ad account not found',
        details: adError?.message
      });
    }

    // 4.3. Проверяем полноту данных
    if (!adAccount.access_token || !adAccount.ad_account_id || !adAccount.page_id || !adAccount.instagram_id) {
      return reply.status(400).send({
        success: false,
        error: 'Ad account incomplete',
        message: 'Missing required fields: access_token, ad_account_id, page_id, or instagram_id'
      });
    }

    ACCESS_TOKEN = adAccount.access_token;
    fbAdAccountId = adAccount.ad_account_id;
    pageId = adAccount.page_id;
    instagramId = adAccount.instagram_id;
    instagramUsername = adAccount.instagram_username;

  } else {

    // ═══════════════════════════════════════════════════════════
    // LEGACY РЕЖИМ
    // ═══════════════════════════════════════════════════════════

    // 4.4. Проверяем полноту данных в user_accounts
    if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id || !userAccount.instagram_id) {
      return reply.status(400).send({
        success: false,
        error: 'User account incomplete (missing access_token, ad_account_id, page_id, or instagram_id)'
      });
    }

    ACCESS_TOKEN = userAccount.access_token;
    fbAdAccountId = userAccount.ad_account_id;
    pageId = userAccount.page_id;
    instagramId = userAccount.instagram_id;
    instagramUsername = userAccount.instagram_username;
  }

  // 5. Нормализация Facebook ID
  const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

  // 6. Работа с Facebook API
  const fbCreative = await createFacebookCreative(normalizedAdAccountId, ACCESS_TOKEN, ...);

  // 7. Сохранение с account_id для связи
  const { data: userCreative } = await supabase
    .from('user_creatives')
    .insert({
      user_id,
      account_id: account_id || null,  // UUID FK для мультиаккаунтности
      direction_id,
      fb_creative_id: fbCreative.id,
      // ...
    });

  return reply.send({ success: true, ... });
});

// Функция нормализации Facebook Ad Account ID
function normalizeAdAccountId(adAccountId: string): string {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}
```

### Блок-схема принятия решений

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ЗАПРОС К API С account_id                            │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ Получить user_accounts       │
                    │ WHERE id = user_id          │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │ multi_account_enabled = ?   │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
             ┌──────▼──────┐             ┌──────▼──────┐
             │   = false   │             │   = true    │
             │ (LEGACY)    │             │ (MULTI)     │
             └──────┬──────┘             └──────┬──────┘
                    │                           │
                    ▼                           ▼
        ┌───────────────────┐       ┌───────────────────────┐
        │ account_id        │       │ account_id передан?    │
        │ ИГНОРИРУЕТСЯ      │       └───────────┬───────────┘
        └─────────┬─────────┘                   │
                  │                   ┌─────────┴─────────┐
                  │                   │                   │
                  │            ┌──────▼──────┐     ┌──────▼──────┐
                  │            │     НЕТ     │     │     ДА      │
                  │            └──────┬──────┘     └──────┬──────┘
                  │                   │                   │
                  │                   ▼                   ▼
                  │         ┌─────────────────┐ ┌───────────────────┐
                  │         │ ERROR 400:      │ │ Загрузить         │
                  │         │ account_id      │ │ ad_accounts       │
                  │         │ is required     │ │ WHERE id =        │
                  │         └─────────────────┘ │ account_id AND    │
                  │                             │ user_account_id = │
                  │                             │ user_id           │
                  │                             └─────────┬─────────┘
                  │                                       │
                  │                             ┌─────────▼─────────┐
                  │                             │ Аккаунт найден?   │
                  │                             └─────────┬─────────┘
                  │                                       │
                  │                             ┌─────────┴─────────┐
                  │                             │                   │
                  │                      ┌──────▼──────┐     ┌──────▼──────┐
                  │                      │     НЕТ     │     │     ДА      │
                  │                      └──────┬──────┘     └──────┬──────┘
                  │                             │                   │
                  │                             ▼                   │
                  │                   ┌─────────────────┐           │
                  │                   │ ERROR 404:      │           │
                  │                   │ Ad account      │           │
                  │                   │ not found       │           │
                  │                   └─────────────────┘           │
                  │                                                 │
                  ▼                                                 ▼
        ┌───────────────────┐                         ┌───────────────────┐
        │ Credentials из    │                         │ Credentials из    │
        │ user_accounts     │                         │ ad_accounts       │
        └─────────┬─────────┘                         └─────────┬─────────┘
                  │                                             │
                  └─────────────────────┬───────────────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │ Выполнить бизнес-логику   │
                          │ с полученными credentials │
                          └───────────────────────────┘
```

---

## API эндпоинты

### Создание креативов

#### POST /api/create-image-creative

Создаёт Facebook Ad Creative из сгенерированного изображения.

```typescript
// Request
POST /api/create-image-creative
Content-Type: application/json

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",     // Обязательно
  "account_id": "660e8400-e29b-41d4-a716-446655440001",  // Обязательно если multi_account_enabled = true
  "creative_id": "770e8400-e29b-41d4-a716-446655440002", // ID из generated_creatives
  "direction_id": "880e8400-e29b-41d4-a716-446655440003" // Направление бизнеса
}

// Response (success)
{
  "success": true,
  "fb_creative_id": "123456789012345",
  "user_creative_id": "990e8400-e29b-41d4-a716-446655440004",
  "objective": "whatsapp"
}

// Response (error - account_id required)
{
  "success": false,
  "error": "account_id is required when multi_account_enabled is true"
}

// Response (error - account not found)
{
  "success": false,
  "error": "Ad account not found",
  "details": "No rows returned"
}
```

#### POST /api/create-carousel-creative

```typescript
// Request
{
  "user_id": "uuid",
  "account_id": "uuid",        // UUID FK к ad_accounts.id
  "carousel_id": "uuid",       // ID карусели из generated_creatives
  "direction_id": "uuid"
}

// Response
{
  "success": true,
  "fb_creative_id": "123456789",
  "user_creative_id": "uuid",
  "objective": "instagram_traffic",
  "cards_count": 5
}
```

#### POST /api/process-video

```typescript
// Request (multipart/form-data)
{
  "user_id": "uuid",
  "account_id": "uuid",        // UUID FK к ad_accounts.id
  "title": "Промо видео",
  "description": "Описание для Facebook",
  "direction_id": "uuid",
  "video": File                // Видео файл
}

// Response
{
  "success": true,
  "creative_id": "uuid",
  "fb_video_id": "123456789",
  "transcription": "Текст из видео..."
}
```

### Autopilot

#### GET /api/autopilot/executions

Получает историю выполнений AI агента.

```typescript
// Request
GET /api/autopilot/executions?userAccountId=uuid&accountId=uuid&limit=10

// Query params:
// - userAccountId (required): UUID пользователя
// - accountId (optional): UUID рекламного аккаунта для фильтрации
// - limit (optional): Количество записей (max 50)

// Response
{
  "success": true,
  "executions": [
    {
      "id": "uuid",
      "user_account_id": "uuid",
      "account_id": "uuid",           // UUID FK к ad_accounts.id
      "plan_json": {
        "goals": ["Увеличить CTR"],
        "steps": [...]
      },
      "actions_json": [
        { "type": "pause_ad", "ad_id": "123", "reason": "Low CTR" },
        { "type": "increase_budget", "campaign_id": "456", "amount": 1000 }
      ],
      "report_text": "Выполнено 3 действия...",
      "status": "success",
      "duration_ms": 45000,
      "created_at": "2025-12-01T10:30:00Z"
    }
  ]
}
```

#### GET /api/autopilot/status

```typescript
// Request
GET /api/autopilot/status?userAccountId=uuid&accountId=uuid

// Response
{
  "success": true,
  "autopilotEnabled": true,
  "lastExecution": {
    "id": "uuid",
    "status": "success",
    "created_at": "2025-12-01T10:30:00Z",
    "actions_json": [...],
    "report_text": "..."
  },
  "weekStats": {
    "totalExecutions": 14,
    "successfulExecutions": 12,
    "totalActions": 67
  }
}
```

### Leads (ROI Analytics)

#### POST /leads

Создаёт лид (с сайта или WhatsApp).

```typescript
// Request
POST /leads
Content-Type: application/json

{
  "userAccountId": "uuid",
  "accountId": "uuid",        // UUID FK к ad_accounts.id (опционально)
  "name": "Иван Петров",
  "phone": "+77001234567",
  "email": "ivan@example.com",
  "utm_source": "facebook",
  "utm_campaign": "promo_dec"
}

// Response
{
  "success": true,
  "lead": {
    "id": "uuid",
    "user_account_id": "uuid",
    "account_id": "uuid",
    "phone": "+77001234567",
    "created_at": "2025-12-01T10:00:00Z"
  }
}
```

#### GET /leads

Получает список лидов с фильтрацией по аккаунту.

```typescript
// Request
GET /leads?userAccountId=uuid&accountId=uuid&limit=50&offset=0

// Response
{
  "success": true,
  "leads": [
    {
      "id": "uuid",
      "user_account_id": "uuid",
      "account_id": "uuid",           // UUID FK для мультиаккаунтности
      "chat_id": "+77001234567",
      "creative_id": "uuid",
      "direction_id": "uuid",
      "created_at": "2025-12-01T10:00:00Z"
    }
  ]
}
```

### Creative Tests

#### POST /api/creative-test/start

```typescript
// Request
{
  "user_creative_id": "uuid",          // ID креатива для теста
  "user_id": "uuid",                   // ID пользователя
  "db_ad_account_id": "uuid"           // UUID из ad_accounts (для мультиаккаунтности)
}

// Response
{
  "success": true,
  "test_id": "uuid",
  "campaign_id": "123456789",
  "ad_id": "987654321",
  "status": "running"
}
```

---

## Frontend интеграция

### Хранение выбранного аккаунта

```typescript
// stores/accountStore.ts (пример с Zustand)

interface AccountState {
  selectedAccountId: string | null;
  accounts: AdAccount[];
  isMultiAccountMode: boolean;

  setSelectedAccount: (id: string) => void;
  loadAccounts: (userId: string) => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  selectedAccountId: null,
  accounts: [],
  isMultiAccountMode: false,

  setSelectedAccount: (id) => {
    set({ selectedAccountId: id });
    localStorage.setItem('selectedAccountId', id);
  },

  loadAccounts: async (userId) => {
    // Проверяем режим пользователя
    const { data: user } = await supabase
      .from('user_accounts')
      .select('multi_account_enabled')
      .eq('id', userId)
      .single();

    if (!user?.multi_account_enabled) {
      set({ isMultiAccountMode: false, accounts: [] });
      return;
    }

    // Загружаем аккаунты
    const { data: accounts } = await supabase
      .from('ad_accounts')
      .select('id, name, is_default, is_active, connection_status')
      .eq('user_account_id', userId)
      .eq('is_active', true);

    // Восстанавливаем выбранный аккаунт из localStorage
    const savedId = localStorage.getItem('selectedAccountId');
    const defaultAccount = accounts?.find(a => a.is_default);
    const selectedId = savedId && accounts?.find(a => a.id === savedId)
      ? savedId
      : defaultAccount?.id || accounts?.[0]?.id || null;

    set({
      isMultiAccountMode: true,
      accounts: accounts || [],
      selectedAccountId: selectedId
    });
  }
}));
```

### Передача account_id в запросах

```typescript
// hooks/useApiRequest.ts

import { useAccountStore } from '../stores/accountStore';

export function useApiRequest() {
  const { selectedAccountId, isMultiAccountMode } = useAccountStore();
  const userId = useUserId();

  const request = async (endpoint: string, options: RequestInit = {}) => {
    const body = options.body ? JSON.parse(options.body as string) : {};

    // Автоматически добавляем account_id для multi-account режима
    const enrichedBody = {
      ...body,
      user_id: userId,
      ...(isMultiAccountMode && selectedAccountId && { account_id: selectedAccountId })
    };

    return fetch(`/api${endpoint}`, {
      ...options,
      body: JSON.stringify(enrichedBody),
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  };

  return { request };
}

// Использование в компонентах
function CreateCreativeButton({ creativeId, directionId }) {
  const { request } = useApiRequest();

  const handleCreate = async () => {
    const response = await request('/create-image-creative', {
      method: 'POST',
      body: JSON.stringify({
        creative_id: creativeId,
        direction_id: directionId
        // user_id и account_id добавятся автоматически
      })
    });
  };
}
```

### Селектор аккаунта в UI

```tsx
// components/AccountSelector.tsx

import { useAccountStore } from '../stores/accountStore';

export function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccount, isMultiAccountMode } = useAccountStore();

  if (!isMultiAccountMode) {
    return null;  // Не показываем для legacy режима
  }

  return (
    <select
      value={selectedAccountId || ''}
      onChange={(e) => setSelectedAccount(e.target.value)}
      className="account-selector"
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
          {account.is_default && ' (по умолчанию)'}
          {account.connection_status === 'error' && ' ⚠️'}
        </option>
      ))}
    </select>
  );
}
```

---

## Примеры использования

### Пример 1: Создание креатива (Legacy режим)

```typescript
// user_accounts.multi_account_enabled = false

const response = await fetch('/api/create-image-creative', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: 'user-uuid-123',
    // account_id НЕ НУЖЕН - будет игнорирован
    creative_id: 'creative-uuid-456',
    direction_id: 'direction-uuid-789'
  })
});

// Credentials берутся из user_accounts
```

### Пример 2: Создание креатива (Multi-account режим)

```typescript
// user_accounts.multi_account_enabled = true

const response = await fetch('/api/create-image-creative', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: 'user-uuid-123',
    account_id: 'ad-account-uuid-456',  // ОБЯЗАТЕЛЬНО!
    creative_id: 'creative-uuid-789',
    direction_id: 'direction-uuid-012'
  })
});

// Credentials берутся из ad_accounts WHERE id = 'ad-account-uuid-456'
```

### Пример 3: Получение credentials через хелпер

```typescript
import { getCredentials } from '../lib/adAccountHelper';

// Legacy режим - account_id не нужен
const legacyCreds = await getCredentials('user-uuid-123');
console.log(legacyCreds.isMultiAccountMode);  // false
console.log(legacyCreds.fbAdAccountId);       // 'act_123456' из user_accounts

// Multi-account режим - account_id обязателен
const multiCreds = await getCredentials('user-uuid-123', 'ad-account-uuid-456');
console.log(multiCreds.isMultiAccountMode);   // true
console.log(multiCreds.fbAdAccountId);        // 'act_789012' из ad_accounts
console.log(multiCreds.adAccountId);          // 'ad-account-uuid-456' (UUID)
```

### Пример 4: Запрос с фильтрацией по account_id

```typescript
// Получить креативы конкретного рекламного аккаунта
const { data: creatives } = await supabase
  .from('user_creatives')
  .select('*')
  .eq('user_id', userId)
  .eq('account_id', accountId);  // UUID FK к ad_accounts.id

// Получить все креативы пользователя (legacy + все аккаунты)
const { data: allCreatives } = await supabase
  .from('user_creatives')
  .select('*')
  .eq('user_id', userId);

// Получить креативы без привязки к аккаунту (legacy)
const { data: legacyCreatives } = await supabase
  .from('user_creatives')
  .select('*')
  .eq('user_id', userId)
  .is('account_id', null);
```

### Пример 5: Работа с несколькими аккаунтами

```typescript
// Получить список аккаунтов пользователя
const { data: accounts } = await supabase
  .from('ad_accounts')
  .select('id, name, ad_account_id, is_default, is_active')
  .eq('user_account_id', userId)
  .eq('is_active', true)
  .order('is_default', { ascending: false });

// accounts = [
//   { id: 'uuid-1', name: 'Основной', ad_account_id: 'act_123', is_default: true },
//   { id: 'uuid-2', name: 'Второй проект', ad_account_id: 'act_456', is_default: false },
// ]

// Создать креатив для конкретного аккаунта
for (const account of accounts) {
  await fetch('/api/create-image-creative', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      account_id: account.id,  // UUID, не Facebook ID!
      creative_id: creativeId,
      direction_id: directionId
    })
  });
}
```

### Пример 6: ROI аналитика с фильтрацией по аккаунту

```typescript
// Получить лиды конкретного рекламного аккаунта
const { data: leads } = await supabase
  .from('leads')
  .select('*')
  .eq('user_account_id', userId)
  .eq('account_id', accountId);  // UUID FK к ad_accounts.id

// Получить продажи конкретного аккаунта
const { data: purchases } = await supabase
  .from('purchases')
  .select('*')
  .eq('user_account_id', userId)
  .eq('account_id', accountId);

// Frontend: использование salesApi с accountId
import { salesApi } from '@/services/salesApi';

const roiData = await salesApi.getROIData(
  userAccountId,
  directionId,
  30,           // timeframeDays
  'video',      // mediaType
  accountId     // UUID для мультиаккаунтности
);

// Добавление продажи с привязкой к аккаунту
await salesApi.addSale({
  client_phone: '+77001234567',
  amount: 50000,
  user_account_id: userId,
  account_id: currentAdAccountId,  // UUID для мультиаккаунтности
  direction_id: directionId
});
```

### Пример 7: Конкуренты с фильтрацией по аккаунту

```typescript
import { competitorsApi } from '@/services/competitorsApi';

// Получить конкурентов конкретного аккаунта
const competitors = await competitorsApi.list(userAccountId, accountId);

// Получить креативы конкурентов с фильтром по аккаунту
const { creatives, pagination } = await competitorsApi.getAllCreatives(
  userAccountId,
  {
    page: 1,
    limit: 20,
    mediaType: 'video',
    accountId: currentAdAccountId  // UUID для мультиаккаунтности
  }
);

// Получить TOP-10 креативов для референса
const top10 = await competitorsApi.getTop10ForReference(
  userAccountId,
  {
    mediaType: 'image',
    limit: 10,
    accountId: currentAdAccountId
  }
);
```

---

## Troubleshooting

### Ошибка: "account_id is required when multi_account_enabled is true"

**Причина:** Пользователь имеет `multi_account_enabled = true`, но в запросе не передан `account_id`.

**Диагностика:**
```sql
-- Проверить режим пользователя
SELECT id, multi_account_enabled
FROM user_accounts
WHERE id = 'user-uuid';
```

**Решение:** Передавайте `account_id` (UUID из `ad_accounts.id`) во всех запросах для пользователей с включённой мультиаккаунтностью.

---

### Ошибка: "Ad account not found"

**Причины:**
1. Переданный `account_id` не существует в `ad_accounts`
2. Аккаунт принадлежит другому пользователю
3. Передан Facebook ID вместо UUID

**Диагностика:**
```sql
-- Проверить существование аккаунта
SELECT id, user_account_id, name, ad_account_id
FROM ad_accounts
WHERE id = 'переданный-account_id';

-- Проверить принадлежность
SELECT id, name FROM ad_accounts
WHERE id = 'account-uuid' AND user_account_id = 'user-uuid';
```

**Решение:** Убедитесь, что:
- `account_id` — это UUID из `ad_accounts.id` (НЕ Facebook ID `act_xxx`!)
- Аккаунт принадлежит текущему пользователю

---

### Ошибка: "column ad_account_id does not exist"

**Причина:** Код использует старое имя колонки, а миграция 066 уже переименовала её в `account_id`.

**Решение:** Обновите код для использования `account_id` вместо `ad_account_id`:

```typescript
// НЕПРАВИЛЬНО ❌
.eq('ad_account_id', accountId)

// ПРАВИЛЬНО ✅
.eq('account_id', accountId)
```

---

### Путаница: какой ID использовать?

| Контекст | Используйте | Тип | Пример |
|----------|-------------|-----|--------|
| API параметр для выбора аккаунта | `account_id` | UUID | `550e8400-e29b-...` |
| Вызов Facebook Marketing API | `ad_account_id` | TEXT | `act_123456789` |
| FK в связанных таблицах | `account_id` | UUID | `550e8400-e29b-...` |
| Хранение Facebook ID в базе | `ad_account_id` | TEXT | `act_123456789` |

---

### Проверочные SQL запросы

```sql
-- Проверить режим пользователя
SELECT id, multi_account_enabled
FROM user_accounts
WHERE id = 'user-uuid';

-- Список рекламных аккаунтов пользователя
SELECT id, name, ad_account_id, is_default, is_active, connection_status
FROM ad_accounts
WHERE user_account_id = 'user-uuid';

-- Проверить креативы конкретного аккаунта
SELECT id, title, account_id, created_at
FROM user_creatives
WHERE user_id = 'user-uuid'
  AND account_id = 'account-uuid';

-- Проверить креативы без привязки к аккаунту (legacy)
SELECT id, title, account_id, created_at
FROM user_creatives
WHERE user_id = 'user-uuid'
  AND account_id IS NULL;

-- Статистика по аккаунтам
SELECT
  aa.name,
  COUNT(uc.id) as creatives_count,
  COUNT(be.id) as executions_count
FROM ad_accounts aa
LEFT JOIN user_creatives uc ON uc.account_id = aa.id
LEFT JOIN brain_executions be ON be.account_id = aa.id
WHERE aa.user_account_id = 'user-uuid'
GROUP BY aa.id, aa.name;

-- ROI статистика по аккаунтам
SELECT
  aa.name,
  COUNT(DISTINCT l.id) as leads_count,
  COUNT(DISTINCT p.id) as purchases_count,
  COALESCE(SUM(p.amount), 0) as total_revenue
FROM ad_accounts aa
LEFT JOIN leads l ON l.account_id = aa.id
LEFT JOIN purchases p ON p.account_id = aa.id
WHERE aa.user_account_id = 'user-uuid'
GROUP BY aa.id, aa.name;

-- Лиды и продажи конкретного аккаунта
SELECT l.*, p.amount as purchase_amount
FROM leads l
LEFT JOIN purchases p ON p.client_phone = l.chat_id
WHERE l.user_account_id = 'user-uuid'
  AND l.account_id = 'account-uuid'
ORDER BY l.created_at DESC;

-- Конкуренты по аккаунтам
SELECT
  aa.name as account_name,
  COUNT(uc.id) as competitors_count
FROM ad_accounts aa
LEFT JOIN user_competitors uc ON uc.account_id = aa.id
WHERE aa.user_account_id = 'user-uuid'
GROUP BY aa.id, aa.name;
```

---

## Чеклист для разработчика

### При создании нового эндпоинта

- [ ] Добавить `account_id: z.string().uuid().optional()` в Zod схему
- [ ] Загрузить `user_accounts` с полем `multi_account_enabled`
- [ ] Добавить проверку `if (user.multi_account_enabled)`
- [ ] В multi-account ветке требовать `account_id`:
  ```typescript
  if (!account_id) {
    return reply.status(400).send({
      error: 'account_id is required when multi_account_enabled is true'
    });
  }
  ```
- [ ] Загружать `ad_accounts` с проверкой принадлежности:
  ```typescript
  .eq('id', account_id)
  .eq('user_account_id', user_id)
  ```
- [ ] Проверять полноту credentials
- [ ] Сохранять `account_id` в создаваемые записи:
  ```typescript
  account_id: account_id || null
  ```

### При работе с базой данных

- [ ] Использовать `account_id` для UUID FK (НЕ `ad_account_id`)
- [ ] Использовать `ad_account_id` только для Facebook ID
- [ ] Создавать partial индексы: `WHERE account_id IS NOT NULL`
- [ ] Документировать колонки через `COMMENT ON COLUMN`

### При создании миграций

- [ ] Делать миграции идемпотентными
- [ ] Использовать `IF EXISTS` / `IF NOT EXISTS`
- [ ] Оборачивать логику в DO-блоки
- [ ] Проверять существование колонок перед операциями
- [ ] Тестировать повторный запуск миграции

### Code Review чеклист

- [ ] Нет путаницы между `account_id` и `ad_account_id`
- [ ] Ветвление идёт по `multi_account_enabled`, а не по наличию `account_id`
- [ ] Есть проверка принадлежности аккаунта пользователю
- [ ] `account_id` сохраняется в связанные записи

---

## FAQ

### Q: Можно ли передавать account_id в legacy режиме?

**A:** Да, но он будет игнорироваться. Система определяет режим работы ТОЛЬКО по флагу `multi_account_enabled`, а не по наличию `account_id` в запросе.

### Q: Что происходит при удалении ad_account?

**A:** Связанные записи (user_creatives, brain_executions и др.) сохраняются, но их `account_id` становится `NULL` благодаря `ON DELETE SET NULL`.

### Q: Как мигрировать пользователя с legacy на multi-account?

**A:**
1. Создать запись в `ad_accounts` с credentials из `user_accounts`
2. Установить `is_default = true`
3. Установить `multi_account_enabled = true` в `user_accounts`
4. Опционально: обновить `account_id` в существующих записях

### Q: Почему account_id nullable?

**A:** Для обратной совместимости с legacy данными. Записи, созданные до включения мультиаккаунтности, имеют `account_id = NULL`.

### Q: Как получить дефолтный аккаунт?

**A:** Использовать функцию `getDefaultAdAccount(userId)` или:
```sql
SELECT id FROM ad_accounts
WHERE user_account_id = 'user-uuid'
  AND is_default = true;
```

---

## История изменений

| Дата | Версия | Автор | Изменения |
|------|--------|-------|-----------|
| 2025-12-01 | 1.0 | - | Начальная документация |
| 2025-12-01 | 1.1 | - | Переименование FK колонок ad_account_id → account_id |
| 2025-12-01 | 1.2 | - | Идемпотентные миграции с DO-блоками |
| 2025-12-01 | 2.0 | - | Расширенная документация: блок-схемы, frontend интеграция, FAQ |
| 2025-12-01 | 2.1 | - | Миграция 067: ROI аналитика (leads, purchases, sales), конкуренты, WhatsApp, метрики |
| 2025-12-01 | 2.2 | - | Имплементация account_id в webhooks, frontend, agent-brain (см. ниже) |

### Версия 2.2 — Детали имплементации

**Webhooks (agent-service):**

| Файл | Изменения |
|------|-----------|
| `routes/greenApiWebhooks.ts` | Добавлен `account_id` в `findWhatsAppNumber()` return type и select query. Передача в создание лидов. |
| `routes/evolutionWebhooks.ts` | Уже поддерживал `account_id` (проверено при аудите) |

**Frontend:**

| Файл | Изменения |
|------|-----------|
| `pages/ROIAnalytics.tsx` | Добавлен `currentAdAccountId` из `useAppContext()`, передача в `salesApi.getROIData()`, добавлен в deps `useEffect` |
| `pages/Competitors.tsx` | Добавлен `currentAdAccountId` из `useAppContext()`, передача в `competitorsApi.list()` и `getAllCreatives()` |
| `components/common/PageHero.tsx` | Добавлен prop `rightContent?: React.ReactNode` для размещения `AdAccountSwitcher` |

**Agent-brain:**

| Файл | Изменения |
|------|-----------|
| `server.js` | Добавлен `account_id` в select креатива и insert в `creative_analysis` (endpoint `/api/analyzer/analyze-creative`) |
| `analyzerService.js` | Добавлен `account_id` в select креатива и upsert в `creative_analysis` (endpoint `/analyze-creative`) |

**Паттерн изменений:**

```typescript
// 1. Получение account_id из связанной сущности
const { data: creative } = await supabase
  .from('user_creatives')
  .select('id, title, account_id')  // ← добавлен account_id
  .eq('id', creative_id)
  .single();

const accountId = creative.account_id || null;  // null для legacy

// 2. Передача в insert/upsert
await supabase
  .from('creative_analysis')
  .insert({
    creative_id,
    user_account_id: user_id,
    account_id: accountId,  // ← UUID для мультиаккаунтности, null для legacy
    // ...
  });
```

**Готовность к тестированию:** ✅

- Все компоненты поддерживают nullable `account_id`
- Legacy режим (>150 клиентов) не затронут — везде паттерн `|| null`
- Webhooks передают `account_id` в leads
- Frontend страницы фильтруют по выбранному аккаунту
- agent-brain сохраняет `account_id` в `creative_analysis`
