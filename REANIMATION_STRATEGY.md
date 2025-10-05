# 🔄 СТРАТЕГИЯ РЕАНИМАЦИИ КАМПАНИЙ

## 📋 ОБЗОР

Обновлена логика Brain Agent для обработки плохих результатов кампаний (`slightly_bad` / `bad`). Новая стратегия приоритизирует тестирование НОВОГО контента над дублированием существующих adsets.

---

## 🎯 ДВА ИНСТРУМЕНТА

### 1. **CreateCampaignWithCreative** (ПРИОРИТЕТ 1)
**Что делает**: Создает новую кампанию с 1-3 unused креативами в одном adset

**Когда использовать**: Если `scoring.unused_creatives` содержит хотя бы 1 креатив

**Преимущества**:
- ✅ Тестирует новый контент
- ✅ Свежий старт для Facebook алгоритма
- ✅ Можно запустить 2-3 креатива сразу в одном adset
- ✅ Старые кампании продолжают обучение без конкуренции

**Параметры**:
```json
{
  "user_creative_id": "uuid",
  "objective": "WhatsApp",  // из recommended_objective
  "campaign_name": "Тест новых креативов октябрь",
  "daily_budget_cents": 40000,  // $40/день
  "use_default_settings": true,  // авто таргетинг
  "auto_activate": true  // сразу запуск!
}
```

---

### 2. **Audience.DuplicateAdSetWithAudience** (ПРИОРИТЕТ 2 - фолбэк)
**Что делает**: Дублирует существующий adset с LAL 3% IG Engagers аудиторией

**Когда использовать**: ТОЛЬКО если `scoring.unused_creatives = []` или `null`

**Преимущества**:
- ✅ Быстрое решение
- ✅ Малый бюджет ($10/день max)
- ✅ Тестирует новую аудиторию с тем же креативом

**Параметры**:
```json
{
  "source_adset_id": "adset_id",
  "audience_id": "test_lal_ig_365d",
  "daily_budget": 1000,  // $10 max
  "name_suffix": "LAL3"
}
```

---

## 🔀 ЛОГИКА ВЫБОРА (ВАРИАНТ 1)

```
ПРИ ПЛОХИХ РЕЗУЛЬТАТАХ (slightly_bad / bad):

1. Проверить scoring.unused_creatives:
   
   ├─ unused_creatives.length ≥ 3?
   │  └─ CreateCampaignWithCreative × 3 (ТОП-3 креатива)
   │     campaign_name = ОДИНАКОВЫЙ для всех 3
   │     → Попадут в ОДИН adset как разные ads
   │
   ├─ unused_creatives.length = 2?
   │  └─ CreateCampaignWithCreative × 2
   │     campaign_name = ОДИНАКОВЫЙ для обоих
   │
   ├─ unused_creatives.length = 1?
   │  └─ CreateCampaignWithCreative × 1
   │
   └─ unused_creatives.length = 0 или null?
      └─ Audience.DuplicateAdSetWithAudience (фолбэк на LAL)
```

---

## 📊 МАТРИЦА ДЕЙСТВИЙ

### slightly_bad (HS: -25..-6)

| Условие | Действие 1 | Действие 2 |
|---------|-----------|-----------|
| unused_creatives ≥ 1 | Снизить бюджет -20..-50% | CreateCampaignWithCreative (новый контент) |
| unused_creatives = 0 | Снизить бюджет -20..-50% | Audience.DuplicateAdSetWithAudience (LAL) |

### bad (HS: ≤ -25)

| Условие | Действие 1 | Действие 2 | Действие 3 |
|---------|-----------|-----------|-----------|
| Несколько adsets | Найти adset-пожиратель | PauseAdSet(пожиратель) | - |
| 1 adset + unused ≥ 1 | Снизить бюджет -50% | PauseAd(пожиратель ad) | CreateCampaignWithCreative |
| 1 adset + unused = 0 | Снизить бюджет -50% | PauseAd(пожиратель ad) | Audience.DuplicateAdSetWithAudience |

---

## 💡 КЛЮЧЕВЫЕ ИЗМЕНЕНИЯ В ПРОМПТЕ

### 1. Секция "МАТРИЦА ДЕЙСТВИЙ"

**ДО:**
```
- bad: допускается отключение ad set или «реанимация»: 
       дубль с отключением оригинала
```

**ПОСЛЕ:**
```
- bad: (1) если несколько adsets → найди и выключи adset-пожиратель
       (2) если нет пожирателя ИЛИ только 1 ad внутри 
           → ВМЕСТО дублирования проверь unused_creatives 
           и создай новую кампанию с несколькими креативами
```

---

### 2. Новая секция "СТРАТЕГИЯ РЕАНИМАЦИИ"

```
🎯 ПРИОРИТЕТ 1: НОВЫЙ КОНТЕНТ (если есть unused_creatives)
- ВСЕГДА проверяй поле scoring.unused_creatives ПЕРЕД любым дублированием!
- Если unused_creatives.length ≥ 3: создай кампанию с ТОП-3 креативами
- Если unused_creatives.length = 2: создай кампанию с обоими креативами
- Если unused_creatives.length = 1: создай кампанию с одним креативом
- ВСЕ креативы идут в ОДИН adset
- Параметры: auto_activate=true, daily_budget_cents=30000-50000

🎯 ПРИОРИТЕТ 2: LAL ДУБЛЬ (если unused_creatives пусто)
- Применяется ТОЛЬКО если scoring.unused_creatives = [] ИЛИ null
- Условия: HS ≤ -6, CPL_ratio ≥ 2.0, impressions ≥ 1000
- Экшен: Audience.DuplicateAdSetWithAudience
```

---

### 3. Обновленное описание CreateCampaignWithCreative

```
ПРИОРИТЕТНЫЙ инструмент для реанимации!

ДЛЯ НЕСКОЛЬКИХ КРЕАТИВОВ В ОДНОМ ADSET: 
вызови это действие НЕСКОЛЬКО РАЗ с ОДИНАКОВЫМ campaign_name 
— они автоматически попадут в один adset как разные ads.

КОГДА: 
(1) ВСЕГДА если есть unused_creatives при slightly_bad/bad
(2) если нужно масштабирование но текущие кампании в обучении
```

---

## 📝 ПРИМЕРЫ

### Пример 1: 3 креатива в одном adset

**Ситуация:**
- HS = bad (-30)
- unused_creatives.length = 3

**Решение Brain Agent:**
```json
{
  "planNote": "HS bad, unused_creatives=3. Создаем новую кампанию с 3 креативами в одном adset вместо дублирования.",
  "actions": [
    {
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "uuid-1",
        "objective": "WhatsApp",
        "campaign_name": "Тест новых креативов октябрь",
        "daily_budget_cents": 40000,
        "use_default_settings": true,
        "auto_activate": true
      }
    },
    {
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "uuid-2",
        "objective": "WhatsApp",
        "campaign_name": "Тест новых креативов октябрь",  // ТОТ ЖЕ NAME!
        "daily_budget_cents": 40000,
        "use_default_settings": true,
        "auto_activate": true
      }
    },
    {
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "uuid-3",
        "objective": "WhatsApp",
        "campaign_name": "Тест новых креативов октябрь",  // ТОТ ЖЕ NAME!
        "daily_budget_cents": 40000,
        "use_default_settings": true,
        "auto_activate": true
      }
    }
  ]
}
```

**Результат:**
- Создается 1 кампания: "Тест новых креативов октябрь"
- В ней 1 adset с 3 ads (по одному на каждый креатив)
- Бюджет $40/день
- Запуск немедленный (auto_activate=true)

---

### Пример 2: Фолбэк на LAL дубль

**Ситуация:**
- HS = bad (-30)
- unused_creatives.length = 0

**Решение Brain Agent:**
```json
{
  "planNote": "HS bad, unused_creatives=[]. Фолбэк: LAL дубль т.к. нет новых креативов.",
  "actions": [
    {
      "type": "GetCampaignStatus",
      "params": { "campaign_id": "camp_123" }
    },
    {
      "type": "Audience.DuplicateAdSetWithAudience",
      "params": {
        "source_adset_id": "adset_456",
        "audience_id": "test_lal_ig_365d",
        "daily_budget": 1000,
        "name_suffix": "LAL3"
      }
    }
  ]
}
```

**Результат:**
- Создается дубль adset с LAL 3% аудиторией
- Бюджет $10/день
- Креатив остается тот же

---

## 🔍 КАК ЭТО РАБОТАЕТ В AGENT-SERVICE

### Workflow CreateCampaignWithCreative

**Файл:** `services/agent-service/src/workflows/createCampaignWithCreative.ts`

**Логика:**
1. Получает `user_creative_id` из запроса
2. Загружает креатив из `user_creatives`
3. Создает Campaign (или использует существующую с тем же именем)
4. Создает AdSet (или использует существующий из той же кампании)
5. Создает Ad с указанным креативом
6. Статус = `ACTIVE` если `auto_activate=true`, иначе `PAUSED`

**Поддержка множественных креативов:**
- Если вызвать несколько раз с одинаковым `campaign_name`
- Все ads попадут в ОДИН adset
- Facebook автоматически распределяет бюджет между ads

---

## ✅ ПРЕИМУЩЕСТВА НОВОЙ СТРАТЕГИИ

1. **Приоритет новому контенту**
   - Старые креативы могли выгореть
   - Новые креативы = свежая аудитория

2. **Оптимальное использование ресурсов**
   - 2-3 креатива в одном adset = эффективнее чем отдельные кампании
   - Facebook сам выберет лучший креатив

3. **Продолжение обучения старых кампаний**
   - Не дублируем → не сбрасываем обучение
   - Старые кампании продолжают работать и учиться

4. **Избежание конкуренции**
   - Новая кампания не конкурирует со старой за аудиторию
   - Разные креативы → разные сегменты

5. **Фолбэк на проверенный метод**
   - Если нет unused креативов → LAL дубль
   - Не теряем возможность реанимации

---

## 📁 ИЗМЕНЕННЫЕ ФАЙЛЫ

1. ✅ `services/agent-brain/src/server.js`
   - Секция "МАТРИЦА ДЕЙСТВИЙ"
   - Новая секция "СТРАТЕГИЯ РЕАНИМАЦИИ"
   - Описание CreateCampaignWithCreative
   - ПРИМЕР 3 и ПРИМЕР 4

2. ✅ `services/agent-brain/src/scoring.js`
   - Функция `getActiveCreativeIds()`
   - Логика `unused_creatives`

3. ✅ `services/agent-service/src/workflows/createCampaignWithCreative.ts`
   - Поддержка `auto_activate`
   - Поддержка `use_default_settings`

---

## 🧪 ТЕСТИРОВАНИЕ

### 1. Проверить unused_creatives в Scoring Agent

```bash
curl -X POST http://localhost:7080/api/brain/test-scoring \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "user-uuid"}' \
  | jq '.scoring.unused_creatives'
```

**Ожидаемый результат:**
```json
[
  {
    "id": "creative-uuid",
    "title": "Название креатива",
    "recommended_objective": "WhatsApp",
    "created_at": "2025-10-05T..."
  }
]
```

### 2. Протестировать Brain Agent с unused креативами

```bash
curl -X POST http://localhost:7080/api/brain/run \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "user-uuid",
    "dispatch": false
  }'
```

**Проверить в actions:**
- Должны быть несколько `CreateCampaignWithCreative` с одинаковым `campaign_name`
- `auto_activate: true`
- `use_default_settings: true`

### 3. Протестировать фолбэк (если unused = [])

**Ожидается:**
- `Audience.DuplicateAdSetWithAudience` в actions
- Упоминание в reportText про LAL аудиторию

---

## 🎓 FAQ

### Q: Что если у меня 5 unused креативов?
**A:** Brain Agent выберет ТОП-3 (первые 3 из списка).

### Q: Можно ли создать отдельные кампании для каждого креатива?
**A:** Нет, новая стратегия всегда создает ОДИН adset с несколькими ads. Это эффективнее.

### Q: Что если я хочу протестировать только 1 креатив?
**A:** Нормально! Если `unused_creatives.length = 1`, создастся кампания с 1 креативом.

### Q: LAL дубль все еще используется?
**A:** Да, как ФОЛБЭК если нет unused креативов.

### Q: Можно ли вручную выбрать между CreateCampaign и LAL дублем?
**A:** Нет, Brain Agent выбирает автоматически по приоритету (unused креативы → LAL).

---

## 📅 CHANGELOG

### v2.1 (2025-10-05)

#### ✨ Новое:
- Приоритизация CreateCampaignWithCreative над Audience.DuplicateAdSetWithAudience
- Поддержка множественных креативов в одном adset
- Обновленная секция "СТРАТЕГИЯ РЕАНИМАЦИИ" в промпте
- Новые примеры ПРИМЕР 3 и ПРИМЕР 4

#### 🔄 Изменено:
- Матрица действий для slightly_bad/bad
- Описание action CreateCampaignWithCreative
- Логика использования unused_creatives

#### 🗑️ Удалено:
- Старая секция "ДОПОЛНИТЕЛЬНЫЙ ИНСТРУМЕНТ: ДУБЛЬ НА ТЁПЛУЮ АУДИТОРИЮ"

---

📅 **Дата:** 5 октября 2025  
🔧 **Версия:** 2.1  
✅ **Статус:** Implemented & Documented
