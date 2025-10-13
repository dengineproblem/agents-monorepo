# TODO: Завершить реализацию /auto-launch-v2

## ✅ Что уже сделано:

1. Создан endpoint `/api/campaign-builder/auto-launch-v2`
2. Находит все активные направления с objective
3. Получает креативы для каждого направления
4. Пропускает направления без креативов

---

## ⏳ Что нужно доделать:

### 1. Создание Ad Sets в существующей кампании

**Текущий код (заглушка):**
```typescript
// TODO: Создать ad sets в существующей кампании direction.fb_campaign_id
results.push({
  direction_id: direction.id,
  direction_name: direction.name,
  campaign_id: direction.fb_campaign_id,
  daily_budget_cents: direction.daily_budget_cents,
  creatives_count: creatives.length,
  status: 'pending_implementation',
});
```

**Что нужно:**
```typescript
// Получить дефолтные настройки направления
const defaultSettings = await getDefaultSettings(direction.id);

// Создать ad set в существующей кампании
const adset = await createAdSetInCampaign({
  campaignId: direction.fb_campaign_id,
  adAccountId: userAccount.ad_account_id,
  accessToken: userAccount.access_token,
  name: `${direction.name} - ${new Date().toISOString().split('T')[0]}`,
  dailyBudget: direction.daily_budget_cents,
  targeting: buildTargeting(defaultSettings),
  optimization_goal: getOptimizationGoal(objective),
  billing_event: getBillingEvent(objective),
});

// Создать ads с креативами
const ads = await createAdsInAdSet({
  adsetId: adset.id,
  creatives: creatives.slice(0, 5), // Макс 5 креативов на ad set
  accessToken: userAccount.access_token,
});

results.push({
  direction_id: direction.id,
  direction_name: direction.name,
  campaign_id: direction.fb_campaign_id,
  adset_id: adset.id,
  adset_name: adset.name,
  daily_budget_cents: direction.daily_budget_cents,
  ads_created: ads.length,
  creatives_used: creatives.slice(0, 5).map(c => c.id),
  status: 'success',
});
```

---

### 2. Функция `getDefaultSettings(direction_id)`

**Путь:** `services/agent-service/src/lib/campaignBuilder.ts`

```typescript
async function getDefaultSettings(directionId: string) {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('direction_id', directionId)
    .maybeSingle();

  if (error) {
    console.error('[CampaignBuilder] Error fetching default settings:', error);
    return null;
  }

  return data;
}
```

---

### 3. Функция `createAdSetInCampaign()`

**Путь:** `services/agent-service/src/lib/campaignBuilder.ts`

```typescript
async function createAdSetInCampaign(params: {
  campaignId: string;
  adAccountId: string;
  accessToken: string;
  name: string;
  dailyBudget: number;
  targeting: any;
  optimization_goal: string;
  billing_event: string;
}) {
  const { campaignId, adAccountId, accessToken, name, dailyBudget, targeting, optimization_goal, billing_event } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${normalizedAdAccountId}/adsets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        name,
        campaign_id: campaignId,
        daily_budget: dailyBudget,
        billing_event,
        optimization_goal,
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        targeting,
        status: 'ACTIVE',
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create ad set: ${JSON.stringify(error)}`);
  }

  return await response.json();
}
```

---

### 4. Функция `buildTargeting(defaultSettings)`

**Путь:** `services/agent-service/src/lib/campaignBuilder.ts`

```typescript
function buildTargeting(defaultSettings: any) {
  if (!defaultSettings) {
    // Дефолтный таргетинг если настроек нет
    return {
      geo_locations: { countries: ['RU'] },
      age_min: 18,
      age_max: 65,
    };
  }

  const targeting: any = {
    age_min: defaultSettings.age_min || 18,
    age_max: defaultSettings.age_max || 65,
  };

  // Пол
  if (defaultSettings.gender && defaultSettings.gender !== 'all') {
    targeting.genders = defaultSettings.gender === 'male' ? [1] : [2];
  }

  // Города (geo_locations)
  if (defaultSettings.cities && defaultSettings.cities.length > 0) {
    targeting.geo_locations = {
      cities: defaultSettings.cities.map((cityId: string) => ({
        key: cityId,
      })),
    };
  } else {
    targeting.geo_locations = { countries: ['RU'] };
  }

  return targeting;
}
```

---

### 5. Функция `createAdsInAdSet()`

**Путь:** `services/agent-service/src/lib/campaignBuilder.ts`

```typescript
async function createAdsInAdSet(params: {
  adsetId: string;
  creatives: AvailableCreative[];
  accessToken: string;
}) {
  const { adsetId, creatives, accessToken } = params;

  const ads = [];

  for (const creative of creatives) {
    const creativeId = getCreativeIdForObjective(creative, /* objective */);
    
    if (!creativeId) {
      console.warn('[CampaignBuilder] No creative ID for creative:', creative.id);
      continue;
    }

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${adsetId}/ads`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          name: `Ad - ${creative.title}`,
          adset_id: adsetId,
          creative: { creative_id: creativeId },
          status: 'ACTIVE',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('[CampaignBuilder] Failed to create ad:', error);
      continue;
    }

    const ad = await response.json();
    ads.push(ad);
  }

  return ads;
}

function getCreativeIdForObjective(creative: AvailableCreative, objective: CampaignObjective): string | null {
  switch (objective) {
    case 'whatsapp':
      return creative.fb_creative_id_whatsapp;
    case 'instagram_traffic':
      return creative.fb_creative_id_instagram_traffic;
    case 'site_leads':
      return creative.fb_creative_id_site_leads;
    default:
      return null;
  }
}
```

---

### 6. Обработка ошибок

Добавить try-catch для каждого направления:

```typescript
for (const direction of directions) {
  try {
    // ... создание ad sets и ads
  } catch (error: any) {
    console.error('[CampaignBuilder V2] Error processing direction:', direction.name, error);
    results.push({
      direction_id: direction.id,
      direction_name: direction.name,
      error: error.message,
      status: 'failed',
    });
  }
}
```

---

### 7. Тестирование

После реализации протестировать:

```bash
curl -X POST https://agents.performanteaiagency.com/api/campaign-builder/auto-launch-v2 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "objective": "whatsapp"
  }'
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "results": [
    {
      "direction_id": "uuid-1",
      "direction_name": "Имплантация",
      "campaign_id": "123456",
      "adset_id": "789",
      "ads_created": 3,
      "status": "success"
    },
    {
      "direction_id": "uuid-2",
      "direction_name": "Виниры",
      "skipped": true,
      "reason": "No ready creatives"
    }
  ]
}
```

---

## Приоритет задач:

1. ✅ **HIGH:** Базовая структура endpoint (DONE)
2. 🔥 **HIGH:** Функция `createAdSetInCampaign()` 
3. 🔥 **HIGH:** Функция `createAdsInAdSet()`
4. 📊 **MEDIUM:** Функция `getDefaultSettings()`
5. 📊 **MEDIUM:** Функция `buildTargeting()`
6. 🛡️ **MEDIUM:** Обработка ошибок
7. 🧪 **LOW:** Тестирование

---

## Оценка времени:

- Реализация функций: **2-3 часа**
- Тестирование и отладка: **1-2 часа**
- **Итого: 3-5 часов**

---

## Статус:

⏳ **В процессе** - базовая структура готова, нужна реализация создания ad sets

