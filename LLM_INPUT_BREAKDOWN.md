# 📊 ПОЛНЫЙ РАЗБОР LLM INPUT

## Структура данных, которые попадают в LLM

```javascript
llmInput = {
  userAccountId: "...",
  ad_account_id: "act_...",
  account: { timezone, report_date, dispatch },
  limits: { min_cents, max_cents, step_up, step_down },
  targets: { cpl_cents, daily_budget_cents },
  
  scoring: {                    // ← От Scoring Agent
    adsets: [...],              // Adsets с предикшенами
    ready_creatives: [...],     // ← ПРОБЛЕМНАЯ СЕКЦИЯ!
    unused_creatives: [...]     // ← Креативы для новых кампаний
  },
  
  analysis: {                   // ← От Brain (Facebook API)
    campaigns: [...],           // Активные кампании с метриками
    adsets: [...],              // Активные adsets с ads
    hsSummary: [...]            // Health Scores
  },
  
  report: {                     // ← Для отчёта
    yesterday_totals: {...},
    campaigns_yesterday: [...],
    header_first_lines: "..."
  }
}
```

---

## 🔍 ДЕТАЛЬНЫЙ РАЗБОР ПО СЕКЦИЯМ

### 1️⃣ **scoring.ready_creatives** 

**Источник**: `services/agent-brain/src/scoring.js`, функция `runScoringAgent()`, строки 638-696

**Процесс**:
1. Берёт ВСЕ креативы из Supabase `user_creatives` где `is_active=true` AND `status='ready'`
2. Для КАЖДОГО креатива вызывает **Facebook API** `/insights` с фильтром `ad.creative_id = <fb_creative_id>`
3. Facebook возвращает **агрегированную статистику** за last_30d по ВСЕМ ads где этот креатив использовался

**Запрос к Facebook** (строка 385-400):
```
GET https://graph.facebook.com/v20.0/act_XXXX/insights
  ?level=ad
  &filtering=[{"field":"ad.creative_id","operator":"EQUAL","value":"1297581724889438"}]
  &fields=ctr,cpm,cpp,cpc,frequency,impressions,spend,actions,reach
  &date_preset=last_30d
  &limit=500
```

**Что возвращается** (строки 438-447):
```javascript
{
  impressions: 12450,      // Сумма по всем ads с этим креативом
  spend: 245.67,           // Сумма затрат
  reach: 11200,
  avg_ctr: 1.85,           // Среднее
  avg_cpm: 19.73,
  avg_frequency: 1.11,
  total_leads: 48,         // Сумма лидов
  avg_cpl: 5.12            // spend / leads
}
```

**Итоговая структура** `ready_creatives`:
```javascript
[
  {
    name: "1 ролик.mov",                    // Из Supabase
    creatives: [
      {
        objective: "MESSAGES",               // WhatsApp
        fb_creative_id: "1297581724889438",
        performance: {                       // ← Из Facebook API!
          impressions: 12450,
          spend: 245.67,
          total_leads: 48,
          avg_cpl: 5.12,
          ...
        }
      },
      {
        objective: "OUTCOME_TRAFFIC",        // Instagram
        fb_creative_id: "1197859198838451",
        performance: {...}                   // ← Тоже из Facebook
      }
    ]
  }
]
```

**Назначение**: Показать LLM **историческую performance** креативов - какие работали хорошо, какие плохо.

---

### 2️⃣ **scoring.unused_creatives**

**Источник**: `services/agent-brain/src/scoring.js`, строки 709-758

**Процесс**:
1. Запрашивает у Facebook **все ACTIVE ads** (строки 469-495):
   ```
   GET /ads?fields=id,name,status,effective_status,creative{id}&limit=500
   ```
2. Извлекает `creative_id` из всех активных ads → `Set activeCreativeIds`
3. Фильтрует креативы из `user_creatives`:
   ```javascript
   const isUnused = creativeIds.length > 0 && 
                    !creativeIds.some(id => activeCreativeIds.has(id));
   ```
4. Если **НИ ОДИН** fb_creative_id креатива не в activeCreativeIds → добавляет в `unused_creatives`

**Итоговая структура** `unused_creatives`:
```javascript
[
  {
    id: "uuid",                             // ID в Supabase
    title: "3 ролик.mov",
    fb_creative_id_whatsapp: "...",
    fb_creative_id_instagram_traffic: "...",
    fb_creative_id_site_leads: null,
    recommended_objective: "WhatsApp",      // Определяется по наличию fb_creative_id
    created_at: "2025-..."
  }
]
```

**ВАЖНО**: Нет статистики! Только метаданные.

**Назначение**: Показать LLM какие креативы **ДОСТУПНЫ** для создания новых кампаний.

---

### 3️⃣ **analysis.campaigns**

**Источник**: `services/agent-brain/src/server.js`, строки 1617-1630

**Процесс**:
1. Берёт список кампаний из Facebook API `/campaigns` (строка 1413)
2. Фильтрует только `ACTIVE`
3. Для каждой кампании добавляет метрики по окнам времени из `/insights level=campaign`

**Запросы к Facebook** (строки 1408-1412):
```javascript
fetchCampaignInsightsPreset(access_token, 'yesterday')  // campY
fetchCampaignInsightsPreset(access_token, 'last_3d')    // camp3
fetchCampaignInsightsPreset(access_token, 'last_7d')    // camp7
fetchCampaignInsightsPreset(access_token, 'last_30d')   // camp30
fetchCampaignInsightsPreset(access_token, 'today')      // campT
```

**Структура**:
```javascript
[
  {
    campaign_id: "120235242822790463",
    name: "PRFMNT",
    status: "ACTIVE",
    daily_budget: 0,
    lifetime_budget: 0,
    windows: {
      yesterday: {              // ← Из Facebook API campY
        spend: 34.3,
        impressions: 3876,
        actions: [...]
      },
      last_3d: {...},
      last_7d: {...},
      last_30d: {...},
      today: {...}
    }
  }
]
```

---

### 4️⃣ **analysis.adsets**

**Источник**: `services/agent-brain/src/server.js`, строки 1631-1670

**Процесс**:
1. Берёт список adsets из Facebook API `/adsets` (строка 1398)
2. Фильтрует: только `ACTIVE` + есть затраты вчера
3. Для каждого adset:
   - Добавляет метрики по окнам (yesterday, last_3d, etc.) из `/insights level=adset`
   - Добавляет список **ads** из `/insights level=ad` (строки 1645-1651)

**Запросы к Facebook** (строки 1402-1407):
```javascript
fetchInsightsPreset(access_token, 'yesterday')      // yRows (adset-level)
fetchAdLevelInsightsPreset(access_token, 'yesterday')  // adRowsY (ad-level)
```

**Структура ads внутри adset** (строки 1645-1651):
```javascript
ads: [
  {
    ad_id: "120235242888440463",
    ad_name: "Заменим",
    spend: 17.23,
    impressions: 2490,
    actions: [...]              // Но НЕТ creative_id! ❌
  }
]
```

**ПРОБЛЕМА**: В `ads` **НЕТ** `creative_id`! Facebook Insights API не возвращает его на уровне ad.

---

## 🐛 В ЧЁМ ПРОБЛЕМА?

### Сценарий:
1. **Креатив "1 ролик.mov"** используется в активном ad "WhatsApp Campaign - Ad 1"
2. **Scoring Agent**:
   - `getActiveCreativeIds()` находит `creative_id: 1297581724889438` в активных ads ✅
   - Фильтрует креатив: `unused_creatives = []` ✅
   - НО добавляет в `ready_creatives` **СО СТАТИСТИКОЙ** (impressions: 1255, leads: 2) ✅

3. **LLM получает**:
   ```javascript
   {
     scoring: {
       ready_creatives: [
         {
           name: "1 ролик.mov",
           creatives: [{
             fb_creative_id: "1297581724889438",
             performance: { impressions: 1255, leads: 2, ... }  // ← Есть данные!
           }]
         }
       ],
       unused_creatives: []  // ← Пустой!
     },
     analysis: {
       adsets: [{
         name: "WhatsApp Campaign - AdSet 1",
         ads: [{
           ad_name: "WhatsApp Campaign - Ad 1",  // ← НЕТ creative_id!
           spend: 10.42,
           leads: 2
         }]
       }]
     }
   }
   ```

4. **LLM видит**:
   - ✅ В `ready_creatives` есть "1 ролик.mov" со статистикой
   - ✅ В `unused_creatives` пусто
   - ❌ В `analysis.adsets[].ads` **НЕ ВИДИТ** что этот креатив используется
   
5. **LLM думает**: "О, у меня нет unused креативов, но есть ready креатив с хорошей статистикой - давай его использую!"

---

## 💡 РЕШЕНИЯ

### Вариант 1: Убрать `ready_creatives` (простой)
- Удалить всю секцию `ready_creatives` из `scoringRawData`
- LLM будет видеть только `unused_creatives` для новых кампаний
- Минус: LLM не увидит historical performance креативов

### Вариант 2: Добавить флаг `is_currently_used` (средний)
```javascript
ready_creatives: [
  {
    name: "1 ролик.mov",
    is_currently_used: true,  // ← Новое поле!
    used_in_ads: ["120235395869530463"],
    creatives: [...]
  }
]
```

### Вариант 3: Добавить `creative_id` в ads (сложный)
- Сделать дополнительный запрос к `/ads` с `fields=creative{id}`
- Добавить в `analysis.adsets[].ads[]` поле `creative_id`
- LLM сама сопоставит креативы

### Вариант 4: Улучшить промпт (быстрый)
Добавить в промпт:
```
ВАЖНО: ready_creatives - это ТОЛЬКО для анализа performance! 
НЕ используй креативы из ready_creatives для новых кампаний!
Используй ТОЛЬКО unused_creatives!
```

---

## 🤔 РЕКОМЕНДАЦИЯ

**Комбинация Вариант 2 + Вариант 4**:
1. Добавить `is_currently_used: boolean` в `ready_creatives`
2. Улучшить промпт с явным указанием не использовать used креативы
3. Это даст LLM полную картину и защиту от ошибок

