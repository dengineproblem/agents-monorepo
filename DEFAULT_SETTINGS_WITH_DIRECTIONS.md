# Default Ad Settings + Directions

## 🎯 Концепция

**ДО:** Настройки привязаны к пользователю + цели
```
user_id + campaign_goal = 1 набор настроек
```

**ПОСЛЕ:** Настройки привязаны к направлению
```
direction_id = 1 набор настроек (цель уже в direction.objective)
```

---

## 📊 Структура таблицы (после миграции 010)

```sql
default_ad_settings {
  id UUID
  user_id UUID NULL              -- для legacy (старые записи без directions)
  direction_id UUID NULL          -- для новой логики (с directions)
  campaign_goal TEXT              -- должен совпадать с direction.objective
  cities TEXT[]
  age_min INTEGER
  age_max INTEGER
  gender TEXT
  description TEXT
  client_question TEXT            -- для whatsapp
  instagram_url TEXT              -- для instagram_traffic
  site_url TEXT                   -- для site_leads
  pixel_id TEXT                   -- для site_leads
  utm_tag TEXT                    -- для site_leads
  
  UNIQUE(direction_id)
  CHECK: (user_id IS NOT NULL AND direction_id IS NULL) 
      OR (user_id IS NULL AND direction_id IS NOT NULL)
}
```

---

## 🔄 Логика работы

### 1. Создание направления
```javascript
// Фронтенд создаёт направление
POST /api/directions
{
  name: "Имплантация",
  objective: "whatsapp",
  daily_budget_cents: 5000,
  target_cpl_cents: 200
}

// Backend создаёт:
// 1. Запись в account_directions
// 2. Facebook Campaign (ACTIVE)
// 3. (Опционально) Дефолтные настройки для этого направления
```

### 2. Настройки по умолчанию для направления

**API endpoint:** `POST /api/default-settings`

```javascript
{
  direction_id: "uuid-направления",
  campaign_goal: "whatsapp",  // Должно совпадать с direction.objective!
  cities: ["2643743"],         // ID городов Facebook
  age_min: 25,
  age_max: 45,
  gender: "all",
  description: "Узнайте подробности!",
  client_question: "Здравствуйте! Хочу узнать об услуге."
}
```

### 3. Использование настроек при создании Ad Set

Когда Brain Agent создаёт Ad Set для направления:
```javascript
// 1. Найти направление
const direction = await getDirection(directionId);

// 2. Получить дефолтные настройки для этого направления
const settings = await getDefaultSettings(directionId);

// 3. Использовать при создании Ad Set
const adSet = {
  campaign_id: direction.fb_campaign_id,
  targeting: {
    geo_locations: { cities: settings.cities },
    age_min: settings.age_min,
    age_max: settings.age_max,
    genders: settings.gender === 'all' ? undefined : [settings.gender]
  },
  // ... и т.д.
}
```

---

## 🆚 Legacy vs Directions

### Legacy (старая логика):
```sql
-- Настройки пользователя БЕЗ направлений
SELECT * FROM default_ad_settings
WHERE user_id = 'user-uuid'
  AND campaign_goal = 'whatsapp'
  AND direction_id IS NULL;
```

### Directions (новая логика):
```sql
-- Настройки конкретного направления
SELECT * FROM default_ad_settings
WHERE direction_id = 'direction-uuid';

-- campaign_goal уже известен из direction.objective
```

---

## 📋 Миграция данных (если нужно)

Если у пользователя были старые настройки и он создал направления, можно перенести:

```sql
-- Пример: перенести настройки whatsapp на новое направление "Имплантация"
UPDATE default_ad_settings
SET 
  direction_id = 'new-direction-uuid',
  user_id = NULL
WHERE 
  user_id = 'user-uuid'
  AND campaign_goal = 'whatsapp';
```

Но обычно проще **создать новые настройки** для каждого направления через UI.

---

## 🎨 UI/UX для фронтенда

### 1. Страница "Направления"
```
┌─────────────────────────────────────┐
│ Направление: Имплантация            │
│ ├─ Цель: WhatsApp                   │
│ ├─ Бюджет: $50/день                 │
│ └─ [⚙️ Настройки рекламы]  ← клик   │
└─────────────────────────────────────┘
```

### 2. Модальное окно "Настройки рекламы"
```
┌─────────────────────────────────────┐
│ Настройки для: Имплантация          │
│                                     │
│ Города: [Выбрать города]           │
│ Возраст: [25] - [45]                │
│ Пол: [● Все ○ М ○ Ж]                │
│                                     │
│ Текст под видео:                    │
│ [Узнайте подробности в WhatsApp!]   │
│                                     │
│ Вопрос клиента (WhatsApp):          │
│ [Здравствуйте! Хочу узнать...]      │
│                                     │
│ [Отмена]  [Сохранить]               │
└─────────────────────────────────────┘
```

### 3. Поля зависят от objective:

**WhatsApp:**
- cities, age, gender, description
- ✅ client_question

**Instagram Traffic:**
- cities, age, gender, description
- ✅ instagram_url

**Site Leads:**
- cities, age, gender, description
- ✅ site_url
- ✅ pixel_id
- ✅ utm_tag

---

## 🚀 Порядок внедрения

1. ✅ **Backend:** Применить миграцию `010_link_default_settings_to_directions.sql`
2. ⏳ **Backend:** Создать API endpoints для default_settings с direction_id
3. ⏳ **Frontend:** Добавить UI для настройки дефолтных параметров направления
4. ⏳ **Brain Agent:** Использовать настройки направления при создании Ad Sets

---

## 📞 API Endpoints (нужно создать)

```typescript
// Получить настройки направления
GET /api/default-settings?directionId=uuid

// Создать/обновить настройки направления
POST /api/default-settings
{
  direction_id: "uuid",
  campaign_goal: "whatsapp",
  cities: [...],
  // ...
}

// Удалить настройки
DELETE /api/default-settings/:id
```

---

**Готово к внедрению!** 🎯

