# 🎯 UNUSED CREATIVES СИСТЕМА

## 📋 ОБЗОР

Реализована система автоматического определения неиспользованных креативов для оптимального управления рекламными кампаниями. Вместо дублирования существующих кампаний, Brain Agent теперь может создавать новые кампании с готовыми креативами, которые еще не используются в активных объявлениях.

---

## 🎯 ПРОБЛЕМА КОТОРУЮ РЕШАЕМ

### ДО:
- ❌ Brain Agent дублировал кампании когда нужно было масштабирование
- ❌ Готовые креативы в базе `user_creatives` не использовались автоматически
- ❌ Текущие кампании конкурировали с дублированными за одну аудиторию
- ❌ Обучение Facebook Ads прерывалось при дублировании

### ПОСЛЕ:
- ✅ Scoring Agent определяет какие креативы НЕ используются в активных ads
- ✅ Brain Agent создает НОВУЮ кампанию вместо дублирования
- ✅ Текущие кампании продолжают обучение без конкуренции
- ✅ Тестируется новый контент с оптимальными настройками

---

## 🏗️ АРХИТЕКТУРА

### 1. **Scoring Agent** (services/agent-brain/src/scoring.js)

#### Новая функция: `getActiveCreativeIds()`

```javascript
async function getActiveCreativeIds(adAccountId, accessToken) {
  // 1. Получаем все ads из Facebook Graph API
  const ads = await fetch(`${FB_API_VERSION}/${adAccountId}/ads?fields=creative{id}`);
  
  // 2. Фильтруем только ACTIVE ads
  const activeAds = ads.filter(ad => 
    ad.status === 'ACTIVE' && ad.effective_status === 'ACTIVE'
  );
  
  // 3. Возвращаем Set с creative IDs
  return new Set(activeAds.map(ad => ad.creative?.id));
}
```

#### Логика определения неиспользованных креативов:

```javascript
const unusedCreatives = [];

for (const creative of userCreatives) {
  // Все fb_creative_id этого креатива
  const creativeIds = [
    creative.fb_creative_id_whatsapp,
    creative.fb_creative_id_instagram_traffic,
    creative.fb_creative_id_site_leads
  ].filter(id => id);
  
  // Если НИ ОДИН не используется в активных ads
  const isUnused = creativeIds.length > 0 && 
                   !creativeIds.some(id => activeCreativeIds.has(id));
  
  if (isUnused) {
    unusedCreatives.push({
      id: creative.id,
      title: creative.title,
      fb_creative_id_whatsapp: creative.fb_creative_id_whatsapp,
      fb_creative_id_instagram_traffic: creative.fb_creative_id_instagram_traffic,
      fb_creative_id_site_leads: creative.fb_creative_id_site_leads,
      recommended_objective: 'WhatsApp', // На основе наличия креативов
      created_at: creative.created_at
    });
  }
}
```

#### Результат возвращается в `scoringRawData`:

```javascript
const scoringRawData = {
  adsets: adsetsWithTrends,
  ready_creatives: readyCreatives,
  unused_creatives: unusedCreatives  // 🆕 НОВОЕ!
};
```

---

### 2. **Brain Agent Prompt** (services/agent-brain/src/server.js)

#### Обновленная структура данных:

```
scoring: {
  summary: { ... },
  items: [ ... ],
  active_creatives_ready: [ ... ],
  unused_creatives: [              // 🆕 НОВОЕ!
    {
      id: "uuid",
      title: "Название креатива",
      fb_creative_id_whatsapp: "123...",
      fb_creative_id_instagram_traffic: "456...",
      fb_creative_id_site_leads: "789...",
      recommended_objective: "WhatsApp",
      created_at: "2025-10-05T10:00:00Z"
    }
  ],
  recommendations_for_brain: [ ... ]
}
```

#### Обновленные инструкции для LLM:

**КАК ИСПОЛЬЗОВАТЬ SCORING DATA:**

```
3. **Неиспользованные креативы (КЛЮЧЕВОЕ!)**:
   - Если в unused_creatives есть креативы → рассмотри создание НОВОЙ кампании 
     через CreateCampaignWithCreative ВМЕСТО дублирования существующей
   - Это дает шанс текущим кампаниям продолжить обучение + тестирует новый 
     контент без конкуренции
```

**CreateCampaignWithCreative действие:**

```
КОГДА ИСПОЛЬЗОВАТЬ:
(1) если в scoring.unused_creatives есть креативы — создай кампанию ВМЕСТО 
    дублирования существующей, используя recommended_objective из unused_creatives
(2) если нужно масштабирование но текущие кампании в обучении — создай новую 
    вместо апа бюджета на существующей
```

---

## 🔄 WORKFLOW

### Пример 1: Масштабирование с неиспользованным креативом

```
Ситуация:
- У пользователя 3 креатива в user_creatives
- 1 креатив используется в активной кампании (CPL=300₽)
- 2 креатива НЕ используются

Scoring Agent возвращает:
{
  "unused_creatives": [
    {
      "id": "abc-123",
      "title": "Новое видео про услуги",
      "recommended_objective": "WhatsApp"
    },
    {
      "id": "def-456",
      "title": "Акция сентября",
      "recommended_objective": "WhatsApp"
    }
  ]
}

Brain Agent решает:
1. ❌ НЕ дублировать текущую кампанию
2. ✅ Создать новую кампанию с креативом "abc-123"
3. ✅ Использовать CreateCampaignWithCreative с auto_activate=true

Результат:
- Старая кампания продолжает обучение → CPL может улучшаться
- Новая кампания стартует с новым контентом → свежая аудитория
- Нет конкуренции между кампаниями за одну аудиторию
```

---

### Пример 2: Нет неиспользованных креативов

```
Ситуация:
- Все креативы из user_creatives используются в активных ads

Scoring Agent возвращает:
{
  "unused_creatives": []
}

Brain Agent решает:
1. ✅ Использовать стандартную стратегию (дублирование/масштабирование)
2. ✅ Или подождать появления новых креативов
```

---

## 📊 СТРУКТУРА ДАННЫХ

### user_creatives (Supabase)

```sql
CREATE TABLE user_creatives (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  fb_video_id TEXT,
  fb_creative_id_whatsapp TEXT,           -- Creative для WhatsApp
  fb_creative_id_instagram_traffic TEXT,  -- Creative для Instagram Traffic
  fb_creative_id_site_leads TEXT,         -- Creative для Site Leads
  is_active BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'ready',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Критерии для unused_creatives:

1. ✅ `is_active = true`
2. ✅ `status = 'ready'`
3. ✅ Хотя бы один `fb_creative_id_*` заполнен
4. ✅ **НИ ОДИН** из `fb_creative_id_*` не используется в активных ads

---

## 🎯 ЛОГИКА РЕКОМЕНДАЦИИ OBJECTIVE

```javascript
let recommendedObjective = 'WhatsApp'; // По умолчанию

if (creative.fb_creative_id_whatsapp) {
  recommendedObjective = 'WhatsApp';
} else if (creative.fb_creative_id_instagram_traffic) {
  recommendedObjective = 'Instagram';
} else if (creative.fb_creative_id_site_leads) {
  recommendedObjective = 'SiteLeads';
}
```

**Приоритет:** WhatsApp > Instagram > SiteLeads

---

## 🚀 ИНТЕГРАЦИЯ С CreateCampaignWithCreative

### Параметры действия:

```typescript
{
  user_creative_id: string;         // ID из unused_creatives
  objective: ObjectiveType;         // recommended_objective
  campaign_name: string;
  daily_budget_cents: number;
  use_default_settings?: boolean;   // true = авто таргетинг
  auto_activate?: boolean;          // true = сразу запуск
}
```

### Пример вызова Brain Agent:

```json
{
  "tool": "CreateCampaignWithCreative",
  "params": {
    "user_creative_id": "abc-123",
    "objective": "WhatsApp",
    "campaign_name": "Новый креатив - Услуги",
    "daily_budget_cents": 50000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

---

## 📈 ПРЕИМУЩЕСТВА

### 1. **Оптимизация обучения Facebook Ads**
- Текущие кампании продолжают накапливать данные
- Алгоритм Facebook не сбрасывается при дублировании
- Улучшение CPL со временем вместо "холодного старта"

### 2. **Тестирование нового контента**
- Автоматическое использование новых креативов
- Минимум ручной работы для пользователя
- Быстрая реакция на появление качественного контента

### 3. **Избежание конкуренции**
- Нет борьбы между кампаниями за одну аудиторию
- Каждая кампания находит свою целевую группу
- Более эффективное распределение бюджета

### 4. **Данные для принятия решений**
- Scoring Agent точно знает что используется
- Brain Agent принимает обоснованные решения
- Полная прозрачность использования креативов

---

## 🔍 МОНИТОРИНГ И ЛОГИ

### Scoring Agent логи:

```javascript
logger.info({ 
  where: 'scoring_agent', 
  phase: 'creatives_fetched', 
  total_creatives: userCreatives.length,
  active_in_ads: activeCreativeIds.size  // Сколько используется
});

logger.info({ 
  where: 'scoring_agent', 
  phase: 'unused_creatives_identified',
  count: unusedCreatives.length  // Сколько не используется
});
```

### Пример вывода:

```json
{
  "where": "scoring_agent",
  "phase": "creatives_fetched",
  "total_creatives": 5,
  "active_in_ads": 8
}

{
  "where": "scoring_agent",
  "phase": "unused_creatives_identified",
  "count": 2
}
```

---

## 🧪 ТЕСТИРОВАНИЕ

### 1. Подготовка тестовых данных:

```sql
-- Создать тестовый креатив
INSERT INTO user_creatives (
  id, user_id, title, 
  fb_creative_id_whatsapp, 
  is_active, status
) VALUES (
  gen_random_uuid(),
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  'Тестовый креатив - не используется',
  '123456789',
  true,
  'ready'
);
```

### 2. Проверка через Scoring Agent:

```bash
# Запустить scoring agent
curl -X POST http://localhost:9091/api/scoring/run \
  -H "Content-Type: application/json" \
  -d '{"user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"}'
```

### 3. Проверка результата:

```json
{
  "unused_creatives": [
    {
      "id": "...",
      "title": "Тестовый креатив - не используется",
      "recommended_objective": "WhatsApp"
    }
  ]
}
```

### 4. Тест Brain Agent:

```bash
# Запустить brain agent
curl -X POST http://localhost:9091/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "dispatch": true
  }'
```

---

## 📝 CHANGELOG

### v2.0 (2025-10-05)

#### ✨ Новое:
- Функция `getActiveCreativeIds()` в scoring.js
- Поле `unused_creatives` в результатах Scoring Agent
- Обновленный промпт Brain Agent с инструкциями по `unused_creatives`
- Приоритизация создания новых кампаний над дублированием

#### 🔄 Изменено:
- `getActiveCreatives()` теперь возвращает `created_at`
- Fallback данные в server.js включают `unused_creatives: []`
- CreateCampaignWithCreative инструкции обновлены

#### 🗑️ Удалено:
- ❌ Упоминание "утро" и "created_at сегодня/вчера" из промпта
- ❌ Неточные критерии для создания новых кампаний

---

## 🔗 СВЯЗАННЫЕ ФАЙЛЫ

- `services/agent-brain/src/scoring.js` - Scoring Agent логика
- `services/agent-brain/src/server.js` - Brain Agent промпт
- `services/agent-service/src/workflows/createCampaignWithCreative.ts` - Workflow
- `DEFAULT_AD_SETTINGS.md` - Система дефолтных настроек
- `CAMPAIGN_TIMING.md` - Логика времени работы кампаний
- `BRAIN_PROMPT_CHANGES.md` - История изменений промпта

---

## 🎓 FAQ

### Q: Что если ВСЕ креативы используются?
**A:** Scoring Agent вернет `unused_creatives: []`, Brain Agent будет использовать стандартную стратегию дублирования/масштабирования.

### Q: Может ли один креатив быть "частично неиспользованным"?
**A:** Нет. Если ХОТЯ БЫ ОДИН из `fb_creative_id_*` используется в активном ad, весь креатив считается "используемым".

### Q: Как часто проверяется статус креативов?
**A:** При каждом запуске Scoring Agent (обычно перед каждым решением Brain Agent).

### Q: Что если создается новая кампания но она не запускается?
**A:** Используйте `auto_activate: true` в CreateCampaignWithCreative для немедленного запуска.

### Q: Можно ли вручную пометить креатив как "не используется"?
**A:** Нет необходимости. Система автоматически определяет это на основе реальных активных ads в Facebook.

---

## ✅ ИТОГО

**ЧТО СДЕЛАНО:**
1. ✅ Автоматическое определение неиспользованных креативов
2. ✅ Интеграция с Scoring Agent и Brain Agent
3. ✅ Приоритизация создания новых кампаний над дублированием
4. ✅ Полная документация и примеры

**РЕЗУЛЬТАТ:**
- Более эффективное использование креативов
- Оптимальное обучение Facebook Ads
- Минимум ручной работы
- Максимум автоматизации

---

📅 **Дата создания:** 5 октября 2025  
👤 **Автор:** Agent System  
🔄 **Версия:** 2.0
