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

### Получение доступных приложений
```javascript
// GET /{ad_account_id}/advertisable_applications
const apps = await graph('GET', `act_${adAccountId}/advertisable_applications`, accessToken, {
  fields: 'id,name,object_store_urls,supported_platforms'
});
```

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        СОЗДАНИЕ НАПРАВЛЕНИЯ                                  │
└─────────────────────────────────────────────────────────────────────────────┘

1. Пользователь выбирает objective = 'app_installs'
2. Выбирает приложение из списка (getAdvertisableApplications API)
3. Указывает URL в App Store / Google Play
4. Создаётся креатив с fb_creative_id_app_installs
5. При запуске создаётся AdSet с:
   - optimization_goal: APP_INSTALLS
   - promoted_object: { application_id, object_store_url }

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
              analytics & ROI tracking
```

## План изменений

### Миграции БД

| Файл | Описание |
|------|----------|
| `migrations/XXX_add_app_installs_objective.sql` | Добавление полей для app_installs |

```sql
-- 1. Добавить поля в default_ad_settings
ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS app_store_url TEXT;

COMMENT ON COLUMN default_ad_settings.app_id IS 'Facebook Application ID для app_installs objective';
COMMENT ON COLUMN default_ad_settings.app_store_url IS 'URL в App Store/Google Play для app_installs objective';

-- 2. Добавить fb_creative_id_app_installs в user_creatives
ALTER TABLE user_creatives
  ADD COLUMN IF NOT EXISTS fb_creative_id_app_installs TEXT;

COMMENT ON COLUMN user_creatives.fb_creative_id_app_installs IS 'Facebook Creative ID для App Install кампаний';

-- 3. Обновить CHECK constraint на account_directions
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS check_objective;

ALTER TABLE account_directions
  ADD CONSTRAINT check_objective CHECK (
    objective IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')
  );

-- 4. Обновить CHECK constraint на default_ad_settings
ALTER TABLE default_ad_settings
  DROP CONSTRAINT IF EXISTS default_ad_settings_campaign_goal_check;

ALTER TABLE default_ad_settings
  ADD CONSTRAINT default_ad_settings_campaign_goal_check CHECK (
    campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs')
  );
```

---

### Backend (agent-service)

#### Типы и настройки

| Файл | Изменения |
|------|-----------|
| `src/lib/settingsHelpers.ts` | Добавить `'app_installs'` в `CampaignObjective` |
| `src/lib/defaultSettings.ts` | Добавить `'app_installs'` в `CampaignGoal`, дефолтные настройки |
| `src/routes/defaultSettings.ts` | Обновить Zod схему для `app_installs` |

#### Campaign Builder

| Файл | Изменения |
|------|-----------|
| `src/lib/campaignBuilder.ts` | `getOptimizationGoal`: app_installs → APP_INSTALLS |
|  | `getBillingEvent`: app_installs → IMPRESSIONS |
|  | `objectiveToLLMFormat`: добавить 'AppInstalls' |
| `src/routes/campaignBuilder.ts` | promoted_object с application_id + object_store_url |

#### Креативы

| Файл | Изменения |
|------|-----------|
| `src/routes/image.ts` | Создание image creative для app_installs |
| `src/routes/video.ts` | Создание video creative для app_installs |
| `src/routes/carouselCreative.ts` | Поддержка для app_installs |
| `src/routes/actions.ts` | Выбор fb_creative_id_app_installs |
| `src/adapters/facebook.ts` | `createAppInstallVideoCreative()`, `createAppInstallImageCreative()` |

#### Workflows

| Файл | Изменения |
|------|-----------|
| `src/workflows/createAdSetInDirection.ts` | Полная поддержка app_installs objective |
| `src/workflows/createCampaignWithCreative.ts` | AppInstalls в ObjectiveType |
| `src/workflows/creativeTest.ts` | Поддержка app_installs в creative test |

#### API Endpoints

| Файл | Изменения |
|------|-----------|
| `src/routes/facebook.ts` или новый файл | **НОВОЕ**: GET /facebook/advertisable-apps для получения списка приложений |

---

### Agent Brain

| Файл | Изменения |
|------|-----------|
| `src/chatAssistant/agents/ads/handlers.js` | objectiveMap, creativeIdField, goalToObjective для app_installs |
| `src/scoring.js` | Метрики для app_installs objective (installs вместо leads) |
| `src/chatAssistant/agents/creative/toolDefs.js` | app_installs в допустимых objectives |
| `src/server.js` | appInstalls в computeLeadsFromActions |

---

### Frontend

| Файл | Изменения |
|------|-----------|
| `src/types/direction.ts` | `'app_installs'` в DirectionObjective, OBJECTIVE_LABELS, OBJECTIVE_DESCRIPTIONS |
| `src/context/AppContext.tsx` | `'app_installs'` в DirectionObjective |
| `src/components/VideoUpload.tsx` | `'app_installs'` в типах |
| `src/components/profile/CreateDirectionDialog.tsx` | Форма с полями для app_installs (app_id, app_store_url) |
| `src/components/profile/EditDirectionDialog.tsx` | Валидация для app_installs |
| `src/services/facebookApi.ts` | `getAdvertisableApplications()` API |

---

## Детали реализации

### 1. Новая функция в facebook.ts

```typescript
/**
 * Создает App Install видео креатив
 * Для продвижения мобильных приложений
 */
export async function createAppInstallVideoCreative(
  adAccountId: string,
  token: string,
  params: {
    videoId: string;
    pageId: string;
    instagramId: string;
    message: string;
    appStoreUrl: string;  // URL в App Store или Google Play
    thumbnailHash?: string;
  }
): Promise<{ id: string }> {
  const videoData: any = {
    video_id: params.videoId,
    message: params.message,
    call_to_action: {
      type: "INSTALL_MOBILE_APP",
      value: {
        link: params.appStoreUrl
      }
    }
  };

  if (params.thumbnailHash) {
    videoData.image_hash = params.thumbnailHash;
  }

  const payload: any = {
    name: "App Install Video Creative",
    object_story_spec: {
      page_id: params.pageId,
      instagram_actor_id: params.instagramId,
      video_data: videoData
    }
  };

  return await graph('POST', `${adAccountId}/adcreatives`, token, payload);
}
```

### 2. Обновление createAdSetInDirection.ts

```typescript
// В switch (direction.objective)
case 'app_installs':
  fb_objective = 'OUTCOME_APP_PROMOTION';
  optimization_goal = 'APP_INSTALLS';
  break;

// В формировании adsetBody для app_installs
if (direction.objective === 'app_installs') {
  const appId = defaultSettings?.app_id;
  const appStoreUrl = defaultSettings?.app_store_url;

  if (!appId || !appStoreUrl) {
    throw new Error(
      `Cannot create app_installs adset for direction "${direction.name}": ` +
      `app_id and app_store_url are required. Please configure them in direction settings.`
    );
  }

  adsetBody.promoted_object = {
    application_id: String(appId),
    object_store_url: appStoreUrl
  };
}
```

### 3. Получение списка приложений

```typescript
// В facebookApi.ts (frontend)
export const getAdvertisableApplications = async (adAccountId: string, accessToken: string) => {
  const response = await fetch(
    `${API_BASE_URL}/facebook/advertisable-apps?adAccountId=${adAccountId}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );
  return response.json();
};

// В backend routes/facebook.ts
app.get('/facebook/advertisable-apps', async (request, reply) => {
  const { adAccountId } = request.query;
  const accessToken = request.headers.authorization?.replace('Bearer ', '');

  const normalizedAdAccountId = adAccountId.startsWith('act_')
    ? adAccountId
    : `act_${adAccountId}`;

  const result = await graph('GET', `${normalizedAdAccountId}/advertisable_applications`, accessToken, {
    fields: 'id,name,object_store_urls,supported_platforms'
  });

  return { success: true, applications: result.data || [] };
});
```

### 4. Метрики для app_installs (Agent Brain)

```javascript
// В scoring.js / handlers.js
// Для app_installs вместо leads считаем installs

if (insights.actions && Array.isArray(insights.actions)) {
  for (const action of insights.actions) {
    if (action.action_type === 'mobile_app_install' ||
        action.action_type === 'app_install') {
      appInstalls = parseInt(action.value || '0', 10);
    }
    // Также можно отслеживать in-app events
    if (action.action_type === 'app_custom_event.fb_mobile_purchase') {
      appPurchases = parseInt(action.value || '0', 10);
    }
  }
}
```

### 5. UI компоненты

В `CreateDirectionDialog.tsx` добавить:

```tsx
{objective === 'app_installs' && (
  <>
    <div className="space-y-2">
      <Label>Приложение</Label>
      <Select
        value={appId}
        onValueChange={setAppId}
        disabled={isLoadingApps}
      >
        <SelectTrigger>
          <SelectValue placeholder="Выберите приложение" />
        </SelectTrigger>
        <SelectContent>
          {applications.map((app) => (
            <SelectItem key={app.id} value={app.id}>
              {app.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label>URL в App Store / Google Play</Label>
      <Input
        type="url"
        value={appStoreUrl}
        onChange={(e) => setAppStoreUrl(e.target.value)}
        placeholder="https://play.google.com/store/apps/details?id=..."
      />
    </div>
  </>
)}
```

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

### Проверка доступа

```bash
# Получить список приложений доступных для рекламы
curl -X GET "https://graph.facebook.com/v20.0/act_{AD_ACCOUNT_ID}/advertisable_applications?fields=id,name,object_store_urls&access_token={ACCESS_TOKEN}"
```

---

## Что нужно сделать для запуска

### 1. Применить миграции

```bash
psql -h YOUR_SUPABASE_HOST -U postgres -d postgres -f migrations/XXX_add_app_installs_objective.sql
```

### 2. Деплой backend

```bash
cd services/agent-service
npm run build
# Рестарт сервиса
```

### 3. Деплой agent-brain

```bash
cd services/agent-brain
npm run build
# Рестарт сервиса
```

### 4. Деплой frontend

```bash
cd services/frontend
npm run build
# Обновить static файлы
```

---

## Тестирование

### 1. Проверка API приложений

```bash
curl "https://performanteaiagency.com/api/facebook/advertisable-apps?adAccountId=YOUR_AD_ACCOUNT" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Создание direction с app_installs

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
      "app_id": "YOUR_APP_ID",
      "app_store_url": "https://play.google.com/store/apps/details?id=com.example.app",
      "cities": ["RU"],
      "age_min": 18,
      "age_max": 45
    }
  }'
```

---

## Мониторинг

### SQL запросы

```sql
-- Directions с app_installs objective
SELECT * FROM account_directions
WHERE objective = 'app_installs'
ORDER BY created_at DESC;

-- Креативы с app_installs
SELECT id, title, fb_creative_id_app_installs, created_at
FROM user_creatives
WHERE fb_creative_id_app_installs IS NOT NULL
ORDER BY created_at DESC;
```

---

## Сравнение с Lead Forms

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

## Связанные документы

- [LEAD_FORMS_INTEGRATION.md](./LEAD_FORMS_INTEGRATION.md) — Аналогичная интеграция Lead Forms
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — Деплой и инфраструктура
- [FRONTEND_API_CONVENTIONS.md](./FRONTEND_API_CONVENTIONS.md) — API конвенции

---

## Changelog

### v1.0.0 (TBD)
- Добавлена поддержка app_installs objective во всех workflows
- Миграции для app_id, app_store_url, fb_creative_id_app_installs
- API endpoint для получения списка приложений
- UI формы для создания направлений с app_installs
- Метрики installs/cpi в Agent Brain

---

## Вопросы для уточнения

1. **Нужна ли поддержка iOS и Android раздельно?**
   - Facebook позволяет указать разные object_store_url для разных платформ
   - Можно добавить поля: `app_store_url_ios`, `app_store_url_android`

2. **Нужен ли tracking in-app events?**
   - Можно отслеживать: purchases, registrations, add_to_cart и т.д.
   - Требует дополнительной интеграции с Facebook SDK

3. **Re-engagement кампании?**
   - CTA: "USE_MOBILE_APP" вместо "INSTALL_MOBILE_APP"
   - Таргетинг на пользователей которые уже установили приложение
