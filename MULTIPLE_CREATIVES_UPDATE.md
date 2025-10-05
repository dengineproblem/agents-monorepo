# 🎨 Обновление: Множественные креативы в одном adset

## 📅 Дата: 5 октября 2025

---

## 🎯 ЧТО ИЗМЕНИЛОСЬ

**БЫЛО:** `CreateCampaignWithCreative` создавал кампанию с **ОДНИМ** креативом

**СТАЛО:** `CreateCampaignWithCreative` создает кампанию с **1-3** креативами в **ОДНОМ adset**

---

## 📊 СТРУКТУРА

### ДО изменений:
```
LLM вызывает 3 раза:
  CreateCampaignWithCreative(uuid-1)
  CreateCampaignWithCreative(uuid-2)
  CreateCampaignWithCreative(uuid-3)

Результат: 3 ОТДЕЛЬНЫЕ КАМПАНИИ
  Campaign "Креатив 1" → AdSet → Ad 1
  Campaign "Креатив 2" → AdSet → Ad 2
  Campaign "Креатив 3" → AdSet → Ad 3
```

### ПОСЛЕ изменений:
```
LLM вызывает 1 раз:
  CreateCampaignWithCreative(["uuid-1", "uuid-2", "uuid-3"])

Результат: 1 КАМПАНИЯ, 3 ADS В ОДНОМ ADSET
  Campaign "Тест новых креативов"
    └─ AdSet "AdSet 1" ($50/день)
        ├─ Ad 1 → Creative uuid-1
        ├─ Ad 2 → Creative uuid-2
        └─ Ad 3 → Creative uuid-3
```

---

## 🔧 ТЕХНИЧЕСКИЕ ИЗМЕНЕНИЯ

### 1. **Параметры действия**

**БЫЛО:**
```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_id": "uuid-1",  // ← Одиночный
    "objective": "WhatsApp",
    "campaign_name": "Тест",
    "daily_budget_cents": 5000
  }
}
```

**СТАЛО:**
```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],  // ← МАССИВ!
    "objective": "WhatsApp",
    "campaign_name": "Тест новых креативов",
    "daily_budget_cents": 5000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

### 2. **Обратная совместимость**

Старый формат с `user_creative_id` (одиночный) **по-прежнему работает**:

```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_id": "uuid-1",  // ← Старый формат
    "objective": "WhatsApp",
    "campaign_name": "Тест",
    "daily_budget_cents": 5000
  }
}
```

Автоматически преобразуется в `user_creative_ids: ["uuid-1"]`

---

## 📝 ЧТО БЫЛО ИЗМЕНЕНО

### `services/agent-service/src/workflows/createCampaignWithCreative.ts`

1. **Параметры:**
   ```typescript
   // БЫЛО:
   user_creative_id: string;
   
   // СТАЛО:
   user_creative_ids: string[]; // МАССИВ
   ```

2. **Логика:**
   - Получаем ВСЕ креативы из Supabase одним запросом
   - Создаем Campaign → AdSet (один)
   - В цикле создаем Ad для каждого креатива
   - Все ads попадают в один adset

3. **Возвращаемое значение:**
   ```typescript
   return {
     success: true,
     campaign_id: "123",
     adset_id: "456",
     ads: [
       { ad_id: "ad1", user_creative_id: "uuid-1", fb_creative_id: "fb1" },
       { ad_id: "ad2", user_creative_id: "uuid-2", fb_creative_id: "fb2" },
       { ad_id: "ad3", user_creative_id: "uuid-3", fb_creative_id: "fb3" }
     ],
     ads_count: 3
   };
   ```

### `services/agent-service/src/routes/actions.ts`

Добавлена поддержка обоих форматов:
```typescript
// Поддержка обоих форматов
let creative_ids: string[];
if (p.user_creative_ids && Array.isArray(p.user_creative_ids)) {
  creative_ids = p.user_creative_ids; // Новый формат (массив)
} else if (p.user_creative_id) {
  creative_ids = [p.user_creative_id]; // Старый формат (одиночный)
} else {
  throw new Error('user_creative_id or user_creative_ids required');
}
```

### `services/agent-brain/src/server.js`

Обновлены:
1. Описание действия в промпте
2. Инструкции по использованию
3. Примеры 3A и 3B

---

## 💡 ПРЕИМУЩЕСТВА

### 1. **Facebook Machine Learning**
- Facebook сам выбирает лучший креатив
- Автоматическая оптимизация между ads
- Не нужно вручную тестировать каждый

### 2. **Упрощение для LLM**
- **ДО:** 3 вызова CreateCampaignWithCreative
- **ПОСЛЕ:** 1 вызов с массивом

### 3. **Единая кампания**
- Одна кампания → проще управлять
- Один бюджет распределяется между ads
- Один adset → единый таргетинг

### 4. **Эффективность**
- Меньше кампаний в аккаунте
- Более чистая структура
- Легче анализировать результаты

---

## 📚 ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ

### Пример 1: 3 креатива (optimal)
```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],
    "objective": "WhatsApp",
    "campaign_name": "Новая кампания — Тест 3 креативов",
    "daily_budget_cents": 5000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

**Результат:**
```
Campaign "Новая кампания — Тест 3 креативов"
  └─ AdSet "Новая кампания — Тест 3 креативов - AdSet 1" ($50/день)
      ├─ Ad 1 (Новая кампания — Тест 3 креативов - Ad 1) → Creative uuid-1
      ├─ Ad 2 (Новая кампания — Тест 3 креативов - Ad 2) → Creative uuid-2
      └─ Ad 3 (Новая кампания — Тест 3 креативов - Ad 3) → Creative uuid-3
```

### Пример 2: 2 креатива
```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_ids": ["uuid-2", "uuid-5"],
    "objective": "WhatsApp",
    "campaign_name": "Тест 2 креативов",
    "daily_budget_cents": 3000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

### Пример 3: 1 креатив (backward compatible)
```json
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_id": "uuid-7",  // Старый формат
    "objective": "WhatsApp",
    "campaign_name": "Тест одного креатива",
    "daily_budget_cents": 2000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

---

## 🧠 ЛОГИКА BRAIN AGENT

### Правила:
1. **Если unused_creatives.length ≥ 3** → передать ВСЕ 3 в массиве
2. **Если unused_creatives.length = 2** → передать оба
3. **Если unused_creatives.length = 1** → передать один (массив или одиночный)

### Пример из промпта:
```javascript
'- ВАЖНО: Передавай ВСЕ user_creative_ids ОДНИМ вызовом в МАССИВЕ: user_creative_ids: ["uuid-1", "uuid-2", "uuid-3"]'
'- Результат: 1 Campaign → 1 AdSet → 3 Ads (по одному на каждый креатив)'
'- Facebook сам выберет лучший креатив через machine learning!'
```

---

## 🎯 ИТОГ

### ЧТО БЫЛО:
- ❌ Несколько отдельных кампаний
- ❌ Каждая кампания = отдельный adset
- ❌ LLM вызывает действие несколько раз
- ❌ Сложнее управлять

### ЧТО СТАЛО:
- ✅ **Одна кампания, несколько ads в одном adset**
- ✅ **LLM вызывает действие ОДИН раз с массивом**
- ✅ **Facebook автоматически выбирает лучший креатив**
- ✅ **Проще управлять, чище структура**

---

## 🔗 СВЯЗАННЫЕ ДОКУМЕНТЫ

- `BUDGET_LOGIC_UPDATE.md` — логика расчета бюджета
- `REANIMATION_STRATEGY.md` — стратегия реанимации
- `UNUSED_CREATIVES.md` — система unused_creatives
- `DEFAULT_AD_SETTINGS.md` — дефолтные настройки

---

**Готово к продакшену!** 🚀
