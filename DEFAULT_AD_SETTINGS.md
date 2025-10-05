# 🎯 Дефолтные настройки рекламы (Default Ad Settings)

## Описание

Система автоматического применения предустановленных параметров при создании рекламных кампаний через AI-агента.

Когда агент принимает решение запустить новую кампанию, он автоматически использует дефолтные настройки из таблицы `default_ad_settings` в Supabase.

## Таблица `default_ad_settings`

### Структура

```sql
CREATE TABLE default_ad_settings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_accounts(id),
  
  -- Тип цели кампании
  campaign_goal TEXT NOT NULL CHECK (campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Таргетинг
  cities TEXT[],              -- Массив ID городов Facebook
  age_min INTEGER DEFAULT 18, -- Минимальный возраст (18-65)
  age_max INTEGER DEFAULT 65, -- Максимальный возраст (18-65)
  gender TEXT DEFAULT 'all',  -- 'all', 'male', 'female'
  
  -- Общие настройки
  description TEXT,           -- Текст под видео
  
  -- Для WhatsApp (campaign_goal = 'whatsapp')
  client_question TEXT,       -- Стартовое сообщение в WhatsApp
  
  -- Для Instagram Traffic (campaign_goal = 'instagram_traffic')
  instagram_url TEXT,         -- URL профиля Instagram
  
  -- Для Site Leads (campaign_goal = 'site_leads')
  site_url TEXT,              -- URL сайта
  pixel_id TEXT,              -- ID пикселя Facebook
  utm_tag TEXT,               -- UTM метки
  
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  
  UNIQUE(user_id, campaign_goal)
);
```

### Ограничение

**Один набор настроек на пользователя и тип цели.** 

Если нужно изменить настройки - используйте `UPDATE` или `UPSERT`.

## Типы целей кампании

### 1. `whatsapp` - Переписка в WhatsApp

**Используемые поля:**
- `cities` - города для таргетинга
- `age_min`, `age_max` - возраст аудитории
- `gender` - пол аудитории
- `description` - текст под видео
- `client_question` - первое сообщение от клиента в WhatsApp

**Пример:**
```sql
INSERT INTO default_ad_settings (
  user_id,
  campaign_goal,
  cities,
  age_min,
  age_max,
  gender,
  description,
  client_question
) VALUES (
  'ваш-user-id',
  'whatsapp',
  ARRAY['2643743', '2635167'], -- Алматы, Астана
  25,
  45,
  'all',
  'Узнайте подробности в WhatsApp!',
  'Здравствуйте! Интересует ваше предложение.'
) ON CONFLICT (user_id, campaign_goal) 
DO UPDATE SET
  cities = EXCLUDED.cities,
  age_min = EXCLUDED.age_min,
  age_max = EXCLUDED.age_max,
  description = EXCLUDED.description,
  client_question = EXCLUDED.client_question,
  updated_at = NOW();
```

### 2. `instagram_traffic` - Визиты в профиль Instagram

**Используемые поля:**
- `cities` - города для таргетинга
- `age_min`, `age_max` - возраст аудитории
- `gender` - пол аудитории
- `description` - текст под видео
- `instagram_url` - URL профиля Instagram

**Пример:**
```sql
INSERT INTO default_ad_settings (
  user_id,
  campaign_goal,
  cities,
  age_min,
  age_max,
  gender,
  description,
  instagram_url
) VALUES (
  'ваш-user-id',
  'instagram_traffic',
  ARRAY['2643743'],
  18,
  65,
  'female',
  'Переходите в наш Instagram!',
  'https://instagram.com/your_profile'
) ON CONFLICT (user_id, campaign_goal) 
DO UPDATE SET
  cities = EXCLUDED.cities,
  age_min = EXCLUDED.age_min,
  age_max = EXCLUDED.age_max,
  description = EXCLUDED.description,
  instagram_url = EXCLUDED.instagram_url,
  updated_at = NOW();
```

### 3. `site_leads` - Лиды на сайте

**Используемые поля:**
- `cities` - города для таргетинга
- `age_min`, `age_max` - возраст аудитории
- `gender` - пол аудитории
- `description` - текст под видео
- `site_url` - URL сайта для переходов
- `pixel_id` - ID пикселя Facebook для отслеживания
- `utm_tag` - UTM метки для аналитики

**Пример:**
```sql
INSERT INTO default_ad_settings (
  user_id,
  campaign_goal,
  cities,
  age_min,
  age_max,
  gender,
  description,
  site_url,
  pixel_id,
  utm_tag
) VALUES (
  'ваш-user-id',
  'site_leads',
  ARRAY['2643743', '2635167'],
  20,
  50,
  'all',
  'Оставьте заявку на сайте!',
  'https://yourdomain.com/landing',
  '1234567890',
  'utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}'
) ON CONFLICT (user_id, campaign_goal) 
DO UPDATE SET
  cities = EXCLUDED.cities,
  site_url = EXCLUDED.site_url,
  pixel_id = EXCLUDED.pixel_id,
  utm_tag = EXCLUDED.utm_tag,
  updated_at = NOW();
```

## Как это работает

### 1. Агент принимает решение о запуске кампании

```javascript
{
  "action": "create_campaign_with_creative",
  "params": {
    "user_creative_id": "uuid-креатива",
    "objective": "WhatsApp",
    "campaign_name": "Новая кампания",
    "daily_budget_cents": 100000,
    "use_default_settings": true  // ✅ По умолчанию true
  }
}
```

### 2. Система автоматически:

1. **Получает дефолтные настройки** из `default_ad_settings` по `user_id` и соответствующему `campaign_goal`
2. **Преобразует в формат Facebook API**:
   ```javascript
   {
     age_min: 25,
     age_max: 45,
     genders: [1, 2], // или не указывается для 'all'
     geo_locations: {
       cities: [
         { key: '2643743' },
         { key: '2635167' }
       ]
     }
   }
   ```
3. **Применяет к AdSet** при создании кампании
4. **Использует текст** из `description` для креатива

### 3. Фолбек (если настроек нет)

Если настройки не найдены в БД, используются стандартные:
- Возраст: 18-65
- Пол: все
- Города: не указаны (таргетинг на всю страну)
- Текст: "Напишите нам, чтобы узнать подробности"

## API для работы с настройками

### Получить настройки

```typescript
import { getDefaultAdSettings } from './lib/defaultSettings';

const settings = await getDefaultAdSettings(user_id, 'whatsapp');

if (settings) {
  console.log('Age range:', settings.age_min, '-', settings.age_max);
  console.log('Cities:', settings.cities);
}
```

### Получить настройки с фолбеком

```typescript
import { getDefaultAdSettingsWithFallback } from './lib/defaultSettings';

// Всегда вернет настройки (либо из БД, либо стандартные)
const settings = await getDefaultAdSettingsWithFallback(user_id, 'whatsapp');
```

### Создать/обновить настройки

```typescript
import { upsertDefaultAdSettings } from './lib/defaultSettings';

await upsertDefaultAdSettings({
  user_id: 'ваш-user-id',
  campaign_goal: 'whatsapp',
  cities: ['2643743'],
  age_min: 25,
  age_max: 45,
  gender: 'all',
  description: 'Свяжитесь с нами в WhatsApp!',
  client_question: 'Здравствуйте! Интересует услуга.'
});
```

### Преобразовать в Facebook Targeting

```typescript
import { convertToFacebookTargeting } from './lib/defaultSettings';

const fbTargeting = convertToFacebookTargeting(settings);
// Результат готов для передачи в Facebook API
```

## Переопределение настроек

Если нужно создать кампанию с **другими настройками**, передайте параметры явно:

```javascript
{
  "action": "create_campaign_with_creative",
  "params": {
    "user_creative_id": "uuid",
    "objective": "WhatsApp",
    "campaign_name": "Кампания",
    "daily_budget_cents": 100000,
    "use_default_settings": false,  // ❌ Отключаем дефолтные
    "targeting": {                   // ✅ Передаем свои
      "age_min": 30,
      "age_max": 50,
      "genders": [2],
      "geo_locations": {
        "cities": [{ "key": "2643743" }]
      }
    }
  }
}
```

## Получение ID городов Facebook

Используйте Facebook Marketing API:

```bash
curl -G \
  -d "type=adgeolocation" \
  -d "location_types=['city']" \
  -d "q=Алматы" \
  -d "access_token=YOUR_TOKEN" \
  "https://graph.facebook.com/v20.0/search"
```

Ответ:
```json
{
  "data": [
    {
      "key": "2643743",
      "name": "Almaty",
      "type": "city",
      "country_code": "KZ"
    }
  ]
}
```

## Миграция в Supabase

Выполните миграцию:

```bash
psql -h YOUR_SUPABASE_DB_HOST \
     -U postgres \
     -d postgres \
     -f migrations/004_default_ad_settings.sql
```

Или через Supabase Dashboard:
1. Перейдите в SQL Editor
2. Скопируйте содержимое `migrations/004_default_ad_settings.sql`
3. Выполните запрос

## Примеры использования

### Создание набора настроек для всех целей

```sql
-- WhatsApp
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, description, client_question)
VALUES ('ваш-user-id', 'whatsapp', ARRAY['2643743'], 25, 45, 'Свяжитесь в WhatsApp', 'Здравствуйте!');

-- Instagram
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, description, instagram_url)
VALUES ('ваш-user-id', 'instagram_traffic', ARRAY['2643743'], 18, 35, 'Подписывайтесь!', 'https://instagram.com/your_profile');

-- Site Leads
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, description, site_url, pixel_id)
VALUES ('ваш-user-id', 'site_leads', ARRAY['2643743'], 25, 55, 'Оставьте заявку', 'https://yourdomain.com', '123456');
```

### Обновление существующих настроек

```sql
UPDATE default_ad_settings
SET 
  cities = ARRAY['2643743', '2635167', '2639689'], -- Добавили Шымкент
  age_min = 20,
  age_max = 50,
  description = 'Новый текст под видео',
  updated_at = NOW()
WHERE user_id = 'ваш-user-id' 
  AND campaign_goal = 'whatsapp';
```

### Просмотр всех настроек пользователя

```sql
SELECT 
  campaign_goal,
  age_min,
  age_max,
  gender,
  array_length(cities, 1) as cities_count,
  description,
  updated_at
FROM default_ad_settings
WHERE user_id = 'ваш-user-id'
ORDER BY campaign_goal;
```

## Преимущества

✅ **Консистентность** - одинаковые настройки для всех кампаний одного типа  
✅ **Скорость** - агент не тратит время на определение таргетинга  
✅ **Гибкость** - можно переопределить для конкретной кампании  
✅ **Управление** - изменяются в одном месте для всех будущих кампаний  

## Поддержка

При возникновении проблем проверьте:
1. ✅ Миграция выполнена в Supabase
2. ✅ У `service_role` есть права на таблицу
3. ✅ `user_id` существует в `user_accounts`
4. ✅ `campaign_goal` имеет правильное значение ('whatsapp', 'instagram_traffic', 'site_leads')

---

**Документация обновлена:** 05.10.2025  
**Версия:** 1.0.0
