# Facebook App Installs Integration

Документация по интеграции цели "Скачивание приложений" (App Installs) для таргетированной рекламы.

## Обзор

Добавление нового типа направления (objective) `app_installs` для рекламных кампаний с целью установки мобильных приложений.

**Существующие objectives:**
- `whatsapp` → OUTCOME_ENGAGEMENT, CONVERSATIONS
- `instagram_traffic` → OUTCOME_TRAFFIC, LINK_CLICKS
- `site_leads` → OUTCOME_LEADS, OFFSITE_CONVERSIONS
- `lead_forms` → OUTCOME_LEADS, LEAD_GENERATION

**Новый objective:**
- `app_installs` → **OUTCOME_APP_PROMOTION**, **APP_INSTALLS**

## Статус реализации: ✅ ЗАВЕРШЕНО

### Что реализовано:
- ✅ Миграция БД (`migrations/134_add_app_installs_objective.sql`)
- ✅ Backend типы и роуты
- ✅ Facebook adapter (createAppInstallVideoCreative, createAppInstallImageCreative)
- ✅ Workflows (createAdSetInDirection, creativeTest)
- ✅ Agent Brain (handlers.js, scoring.js)
- ✅ Frontend (CreateDirectionDialog с валидацией)
- ✅ Валидация URL и App ID
- ✅ Подробное логирование

---

## Требования Facebook Marketing API

### Campaign Level
```javascript
{
  objective: "OUTCOME_APP_PROMOTION",
  special_ad_categories: []
}
```

### Ad Set Level
```javascript
{
  optimization_goal: "APP_INSTALLS",
  billing_event: "IMPRESSIONS",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  promoted_object: {
    application_id: "YOUR_APP_ID",       // Facebook Application ID (обязательно!)
    object_store_url: "https://play.google.com/store/apps/details?id=com.example.app"  // URL в App Store/Play Store (обязательно!)
  }
}
```

### Creative Level
```javascript
{
  object_story_spec: {
    page_id: "PAGE_ID",
    instagram_actor_id: "INSTAGRAM_ID",
    video_data: {
      video_id: "VIDEO_ID",
      message: "Скачай приложение!",
      call_to_action: {
        type: "INSTALL_MOBILE_APP",  // или "USE_MOBILE_APP" для re-engagement
        value: {
          link: "https://play.google.com/store/apps/details?id=com.example.app"
        }
      }
    }
  }
}
```

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        СОЗДАНИЕ НАПРАВЛЕНИЯ                                  │
└─────────────────────────────────────────────────────────────────────────────┘

1. Пользователь выбирает objective = 'app_installs'
2. Вводит Facebook App ID (10-20 цифр)
3. Указывает URL в App Store / Google Play (или оба)
4. Создаётся креатив с fb_creative_id_app_installs
5. При запуске создаётся AdSet с:
   - optimization_goal: APP_INSTALLS
   - promoted_object: { application_id, object_store_url }

┌─────────────────────────────────────────────────────────────────────────────┐
│                        ВАЛИДАЦИЯ                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Frontend (CreateDirectionDialog.tsx):
  ├── App ID: /^\d{10,20}$/
  ├── iOS URL: /^https?:\/\/(apps|itunes)\.apple\.com\/.+\/app\/.+\/id\d+/i
  └── Android URL: /^https?:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/i

Backend (facebook.ts):
  ├── validateFacebookAppId() → { valid, error }
  └── validateAppStoreUrl() → { valid, platform, error }

Workflow (createAdSetInDirection.ts):
  └── Полная валидация перед созданием AdSet

┌─────────────────────────────────────────────────────────────────────────────┐
│                        ТРЕКИНГ УСТАНОВОК                                     │
└─────────────────────────────────────────────────────────────────────────────┘

Facebook → SDK Events → Insights API
                            ↓
                    actions: [
                      { action_type: "mobile_app_install", value: "X" },
                      { action_type: "app_custom_event.fb_mobile_purchase", value: "Y" }
                    ]
                            ↓
              analytics & ROI tracking (cost_per_install)
```

---

## Файлы и изменения

### Миграция БД

**Файл:** `migrations/134_add_app_installs_objective.sql`

```sql
-- Добавить поля в default_ad_settings
ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url_ios TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url_android TEXT;

-- Добавить fb_creative_id_app_installs в user_creatives
ALTER TABLE user_creatives
  ADD COLUMN IF NOT EXISTS fb_creative_id_app_installs TEXT;

-- Обновить CHECK constraint на account_directions
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE account_directions
  ADD CONSTRAINT check_objective CHECK (
    objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')
  );
```

---

### Backend (agent-service)

| Файл | Изменения |
|------|-----------|
| `src/lib/settingsHelpers.ts` | `'app_installs'` в `CampaignObjective` |
| `src/lib/defaultSettings.ts` | `'app_installs'` в `CampaignGoal`, поля app_id, app_store_url_ios/android |
| `src/lib/campaignBuilder.ts` | `objectiveToLLMFormat`: 'AppInstalls', `AvailableCreative`: fb_creative_id_app_installs |
| `src/routes/defaultSettings.ts` | Zod схема с валидацией app_installs |
| `src/adapters/facebook.ts` | `validateAppStoreUrl()`, `validateFacebookAppId()`, `createAppInstallVideoCreative()`, `createAppInstallImageCreative()` |
| `src/routes/video.ts` | Создание video creative для app_installs с логированием |
| `src/routes/image.ts` | Создание image creative для app_installs с логированием |
| `src/workflows/createAdSetInDirection.ts` | Полная поддержка app_installs с валидацией и promoted_object |
| `src/workflows/creativeTest.ts` | Поддержка app_installs в creative test, метрики mobile_app_install |

---

### Agent Brain

| Файл | Изменения |
|------|-----------|
| `src/chatAssistant/agents/ads/handlers.js` | objectiveMap, creativeIdField, goalToObjective для app_installs |
| `src/scoring.js` | Метрики для app_installs (installs, cost_per_install) |

**objectiveMap:**
```javascript
app_installs: {
  optimization_goal: 'APP_INSTALLS',
  billing_event: 'IMPRESSIONS',
  destination_type: null
}
```

**goalToObjective:**
```javascript
'APP_INSTALLS': 'app_installs'
```

**Metrics (scoring.js):**
```javascript
} else if (objective === 'app_installs') {
  const appInstalls = extractActionValue(actions, 'mobile_app_install') ||
                      extractActionValue(actions, 'app_install');
  const costPerInstall = appInstalls > 0 ? totalSpend / appInstalls : 0;

  objectiveMetrics = {
    app_installs_metrics: {
      installs: appInstalls,
      cost_per_install: costPerInstall.toFixed(2),
      all_action_types: allActionTypes
    }
  };
}
```

---

### Frontend

| Файл | Изменения |
|------|-----------|
| `src/types/direction.ts` | `'app_installs'` в DirectionObjective, OBJECTIVE_LABELS, OBJECTIVE_DESCRIPTIONS |
| `src/components/profile/CreateDirectionDialog.tsx` | Форма с полями app_id, app_store_url_ios, app_store_url_android, валидация |

**Валидация на фронтенде:**
```typescript
if (objective === 'app_installs') {
  // App ID: 10-20 цифр
  if (!/^\d{10,20}$/.test(appId.trim())) {
    setError('Неверный формат Facebook App ID. Должен содержать 10-20 цифр');
    return;
  }

  // iOS URL валидация
  if (appStoreUrlIos.trim()) {
    const iosPattern = /^https?:\/\/(apps|itunes)\.apple\.com\/.+\/app\/.+\/id\d+/i;
    if (!iosPattern.test(appStoreUrlIos.trim())) {
      setError('Неверный формат App Store URL');
      return;
    }
  }

  // Android URL валидация
  if (appStoreUrlAndroid.trim()) {
    const androidPattern = /^https?:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/i;
    if (!androidPattern.test(appStoreUrlAndroid.trim())) {
      setError('Неверный формат Google Play URL');
      return;
    }
  }
}
```

---

## API функции

### validateAppStoreUrl()

```typescript
/**
 * Валидирует URL магазина приложений (App Store или Google Play)
 * @returns { valid: boolean, platform: 'ios' | 'android' | null, error?: string }
 */
export function validateAppStoreUrl(url: string): {
  valid: boolean;
  platform: 'ios' | 'android' | null;
  error?: string
}

// Примеры:
validateAppStoreUrl('https://apps.apple.com/ru/app/myapp/id123456789')
// → { valid: true, platform: 'ios' }

validateAppStoreUrl('https://play.google.com/store/apps/details?id=com.example.app')
// → { valid: true, platform: 'android' }

validateAppStoreUrl('https://example.com')
// → { valid: false, platform: null, error: 'Invalid app store URL...' }
```

### validateFacebookAppId()

```typescript
/**
 * Валидирует Facebook App ID (должен быть числовой строкой 10-20 символов)
 */
export function validateFacebookAppId(appId: string): {
  valid: boolean;
  error?: string
}

// Примеры:
validateFacebookAppId('1234567890123456')  // → { valid: true }
validateFacebookAppId('abc123')             // → { valid: false, error: '...' }
```

### createAppInstallVideoCreative()

```typescript
export async function createAppInstallVideoCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId: string;
    message: string;
    appStoreUrl: string;
    thumbnailHash?: string;
  }
): Promise<{ id: string }>
```

### createAppInstallImageCreative()

```typescript
export async function createAppInstallImageCreative(
  adAccountId: string,
  token: string,
  params: {
    imageHash: string;
    pageId: string;
    instagramId: string;
    message: string;
    appStoreUrl: string;
  }
): Promise<{ id: string }>
```

---

## Логирование

### facebook.ts
```
INFO  Creating App Install video creative
      { adAccountId, videoId, pageId, instagramId, appStoreUrl, platform, hasThumbnail }

INFO  App Install video creative created successfully
      { adAccountId, creativeId, platform }

ERROR Invalid app store URL for video creative
      { adAccountId, appStoreUrl, error }

ERROR Failed to create App Install video creative
      { adAccountId, videoId, appStoreUrl, error, fbError }
```

### createAdSetInDirection.ts
```
INFO  app_installs: Checking configuration
      { direction_id, direction_name, app_id, app_store_url_ios, app_store_url_android, selected_url }

ERROR app_installs: Missing app_id
      { direction_id, direction_name }

ERROR app_installs: Invalid app_id format
      { direction_id, direction_name, app_id, error }

ERROR app_installs: Invalid app_store_url format
      { direction_id, direction_name, app_store_url, error }

INFO  app_installs: Configuration validated successfully
      { direction_id, direction_name, app_id, app_store_url, platform, promoted_object }
```

---

## Тестирование

### Создание direction с app_installs

```bash
curl -X POST "https://performanteaiagency.com/api/directions" \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "USER_UUID",
    "name": "App Install Campaign",
    "objective": "app_installs",
    "daily_budget_cents": 2000,
    "target_cpl_cents": 100,
    "default_settings": {
      "app_id": "1234567890123456",
      "app_store_url_android": "https://play.google.com/store/apps/details?id=com.example.app",
      "app_store_url_ios": "https://apps.apple.com/ru/app/myapp/id123456789",
      "cities": ["RU"],
      "age_min": 18,
      "age_max": 45
    }
  }'
```

### SQL запросы для мониторинга

```sql
-- Directions с app_installs objective
SELECT id, name, objective, created_at
FROM account_directions
WHERE objective = 'app_installs'
ORDER BY created_at DESC;

-- Креативы с app_installs
SELECT id, title, fb_creative_id_app_installs, created_at
FROM user_creatives
WHERE fb_creative_id_app_installs IS NOT NULL
ORDER BY created_at DESC;

-- Настройки app_installs
SELECT ds.id, ds.app_id, ds.app_store_url_ios, ds.app_store_url_android, ad.name
FROM default_ad_settings ds
JOIN account_directions ad ON ds.direction_id = ad.id
WHERE ad.objective = 'app_installs';
```

---

## Сравнение с другими objectives

| Аспект | Lead Forms | App Installs |
|--------|------------|--------------|
| Objective | OUTCOME_LEADS | OUTCOME_APP_PROMOTION |
| Optimization | LEAD_GENERATION | APP_INSTALLS |
| Destination | ON_AD | - |
| Promoted Object | page_id, lead_gen_form_id | application_id, object_store_url |
| CTA | SIGN_UP | INSTALL_MOBILE_APP |
| Tracking | Webhook (leadgen) | SDK Events |
| Metrics | leads, cpl | installs, cpi |

---

## Требования Facebook App

Для использования App Install campaigns необходимо:

1. **Зарегистрировать приложение** в Facebook Developers
2. **Интегрировать Facebook SDK** в мобильное приложение
3. **Настроить App Events** для отслеживания установок
4. **Связать приложение с Ad Account**

### Permissions

- `ads_management` — создание и управление рекламой
- `ads_read` — чтение статистики

### Поддерживаемые URL форматы

**iOS (App Store):**
- `https://apps.apple.com/{country}/app/{app-name}/id{app-id}`
- `https://itunes.apple.com/{country}/app/{app-name}/id{app-id}`

**Android (Google Play):**
- `https://play.google.com/store/apps/details?id={package-name}`

---

## Changelog

### v1.1.0 (2024-12-30) — ТЕКУЩАЯ ВЕРСИЯ
- ✅ Добавлена валидация App ID и App Store URLs
- ✅ Добавлено подробное логирование во все компоненты
- ✅ Исправлена консистентность instagram_actor_id vs instagram_user_id
- ✅ Улучшены сообщения об ошибках
- ✅ Добавлена валидация на фронтенде

### v1.0.0 (2024-12-30)
- Добавлена поддержка app_installs objective во всех workflows
- Миграции для app_id, app_store_url_ios, app_store_url_android, fb_creative_id_app_installs
- UI формы для создания направлений с app_installs
- Метрики installs/cost_per_install в Agent Brain

---

## Связанные документы

- [LEAD_FORMS_INTEGRATION.md](./LEAD_FORMS_INTEGRATION.md) — Аналогичная интеграция Lead Forms
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — Деплой и инфраструктура
- [FRONTEND_API_CONVENTIONS.md](./FRONTEND_API_CONVENTIONS.md) — API конвенции
