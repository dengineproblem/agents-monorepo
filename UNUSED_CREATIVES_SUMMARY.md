# ✅ РЕАЛИЗОВАНО: UNUSED CREATIVES СИСТЕМА

## 🎯 ЧТО БЫЛО СДЕЛАНО

### 1. **Scoring Agent** - Определение неиспользованных креативов

**Файл:** `services/agent-brain/src/scoring.js`

#### ➕ Добавлено:

```javascript
// Функция получения активных creative_id из Facebook
async function getActiveCreativeIds(adAccountId, accessToken)

// Логика в runScoringAgent():
const activeCreativeIds = await getActiveCreativeIds(ad_account_id, access_token);

const unusedCreatives = [];
for (const uc of userCreatives) {
  // Проверяем: НИ ОДИН из fb_creative_id_* не используется в активных ads
  if (isUnused) {
    unusedCreatives.push({ 
      id, title, recommended_objective, created_at, ...
    });
  }
}

// Возвращаем в результате
const scoringRawData = {
  adsets: adsetsWithTrends,
  ready_creatives: readyCreatives,
  unused_creatives: unusedCreatives  // 🆕 НОВОЕ!
};
```

---

### 2. **Brain Agent Prompt** - Обновленная логика

**Файл:** `services/agent-brain/src/server.js`

#### 🔄 Изменено:

**СТРУКТУРА ДАННЫХ:**
```
scoring: {
  summary: { ... },
  items: [ ... ],
  active_creatives_ready: [ ... ],
  unused_creatives: [ ... ],  // 🆕 НОВОЕ!
  recommendations_for_brain: [ ... ]
}
```

**ИНСТРУКЦИИ ДЛЯ LLM:**

❌ **УДАЛЕНО:**
- Упоминание "утро" и "created_at сегодня/вчера"
- Неточные критерии создания кампаний

✅ **ДОБАВЛЕНО:**
```
3. **Неиспользованные креативы (КЛЮЧЕВОЕ!)**:
   - Если в unused_creatives есть креативы → рассмотри создание НОВОЙ кампании 
     через CreateCampaignWithCreative ВМЕСТО дублирования существующей
   - Это дает шанс текущим кампаниям продолжить обучение + тестирует новый 
     контент без конкуренции
```

**CreateCampaignWithCreative:**
```
КОГДА ИСПОЛЬЗОВАТЬ:
(1) если в scoring.unused_creatives есть креативы — создай кампанию ВМЕСТО 
    дублирования, используя recommended_objective
(2) если нужно масштабирование но текущие кампании в обучении — создай новую 
    вместо апа бюджета
```

**Fallback данные:**
```javascript
scoringOutput = {
  // ...
  unused_creatives: [],  // 🆕 НОВОЕ!
  // ...
};
```

---

## 📊 ЛОГИКА РАБОТЫ

### Критерии "неиспользованного" креатива:

1. ✅ `is_active = true`
2. ✅ `status = 'ready'`
3. ✅ Хотя бы один `fb_creative_id_*` заполнен
4. ✅ **НИ ОДИН** из `fb_creative_id_*` не используется в активных ads

### Пример:

```
user_creatives:
- Креатив A: fb_creative_id_whatsapp="123" → используется в Ad #1 ❌
- Креатив B: fb_creative_id_whatsapp="456" → НЕ используется ✅
- Креатив C: fb_creative_id_whatsapp="789" → НЕ используется ✅

unused_creatives: [B, C]  // Только эти два
```

---

## 🚀 РЕЗУЛЬТАТ

### ДО:
```
Brain Agent:
  ├─ Scoring показывает: нужно масштабирование
  ├─ Решение: Дублировать Campaign X
  └─ Результат: Campaign X (old) конкурирует с Campaign X (new)
```

### ПОСЛЕ:
```
Brain Agent:
  ├─ Scoring показывает: 
  │   ├─ нужно масштабирование
  │   └─ есть unused_creatives: [Креатив B, Креатив C]
  ├─ Решение: CreateCampaignWithCreative(Креатив B, WhatsApp)
  └─ Результат:
      ├─ Campaign X продолжает обучение ✅
      └─ Campaign "NEW" стартует с новым контентом ✅
```

---

## 📁 ИЗМЕНЕННЫЕ ФАЙЛЫ

1. ✅ `services/agent-brain/src/scoring.js`
   - Добавлена `getActiveCreativeIds()`
   - Добавлена логика определения `unusedCreatives`
   - Обновлен `scoringRawData` с полем `unused_creatives`

2. ✅ `services/agent-brain/src/server.js`
   - Обновлен `SYSTEM_PROMPT` с инструкциями по `unused_creatives`
   - Обновлены инструкции для `CreateCampaignWithCreative`
   - Добавлен `unused_creatives: []` в fallback данные

3. ✅ `UNUSED_CREATIVES.md` - Полная документация
4. ✅ `UNUSED_CREATIVES_SUMMARY.md` - Краткое резюме

---

## 🧪 КАК ТЕСТИРОВАТЬ

### 1. Проверить Scoring Agent:

```bash
curl -X POST http://localhost:9091/api/scoring/run \
  -H "Content-Type: application/json" \
  -d '{"user_id": "YOUR_USER_ID"}'
```

**Ожидаемый результат:**
```json
{
  "unused_creatives": [
    {
      "id": "...",
      "title": "...",
      "recommended_objective": "WhatsApp",
      "created_at": "..."
    }
  ]
}
```

### 2. Проверить Brain Agent:

```bash
curl -X POST http://localhost:9091/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "dispatch": false
  }'
```

**Brain Agent должен:**
- Видеть `scoring.unused_creatives` в LLM input
- Рассматривать создание новой кампании вместо дублирования
- Использовать `recommended_objective` из unused_creatives

---

## ✅ ПРЕИМУЩЕСТВА

1. **Оптимизация обучения** - Текущие кампании не сбрасываются
2. **Тестирование нового контента** - Автоматическое использование готовых креативов
3. **Избежание конкуренции** - Нет борьбы за одну аудиторию
4. **Данные для решений** - Полная прозрачность использования креативов

---

## 📅 СТАТУС

✅ **ГОТОВО К ТЕСТИРОВАНИЮ**

**Следующие шаги:**
1. Собрать и задеплоить agent-brain
2. Протестировать с реальными данными
3. Проверить создание новых кампаний через CreateCampaignWithCreative

---

📅 **Дата:** 5 октября 2025  
🔧 **Версия:** 2.0  
✅ **Статус:** Implemented & Documented
