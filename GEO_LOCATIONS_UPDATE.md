# 🌍 ОБНОВЛЕНИЕ: geo_locations формат

## ✅ ЧТО СДЕЛАНО

### 1. **Новая структура хранения таргетинга**

**ДО:**
```json
{
  "cities": ["2420877", "2452344"]  // Непонятно: это страны или города?
}
```

**ПОСЛЕ:**
```json
{
  "geo_locations": {
    "countries": ["RU", "KZ"]  // Ясно: это страны
  }
}
```

ИЛИ

```json
{
  "geo_locations": {
    "cities": [
      {"key": "2420877", "radius": 25, "distance_unit": "kilometer"},
      {"key": "2452344"}
    ]
  }
}
```

---

## 🔧 ИЗМЕНЕНИЯ В КОДЕ

### 1. Миграция базы данных

**Файл:** `migrations/005_update_geo_locations_format.sql`

- Добавлена колонка `geo_locations` (JSONB)
- Автоматическая миграция существующих `cities` → `geo_locations`
- Колонка `cities` оставлена для обратной совместимости

### 2. TypeScript интерфейс

**Файл:** `services/agent-service/src/lib/defaultSettings.ts`

```typescript
export interface DefaultAdSettings {
  cities?: string[];        // Legacy, deprecated
  geo_locations?: any;      // Новый формат!
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  // ...
}
```

### 3. Функция `convertToFacebookTargeting`

**Логика:**
1. Если есть `geo_locations` → подставляем напрямую ✅
2. Если нет, но есть `cities` → конвертируем (legacy)
3. Если ничего нет → по умолчанию `{"countries": ["RU"]}`

```typescript
export function convertToFacebookTargeting(settings: DefaultAdSettings) {
  const targeting: any = {
    age_min: settings.age_min,
    age_max: settings.age_max,
  };

  // Используем geo_locations напрямую!
  if (settings.geo_locations && Object.keys(settings.geo_locations).length > 0) {
    targeting.geo_locations = settings.geo_locations;
  } else if (settings.cities && settings.cities.length > 0) {
    // Legacy fallback
    targeting.geo_locations = {
      cities: settings.cities.map(cityId => ({ key: cityId }))
    };
  } else {
    // Default
    targeting.geo_locations = { countries: ['RU'] };
  }

  // ...
  return targeting;
}
```

---

## 📋 ИНСТРУКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ

### Шаг 1: Выполнить миграцию в Supabase

1. Открой Supabase Dashboard → SQL Editor
2. Скопируй содержимое `migrations/005_update_geo_locations_format.sql`
3. Запусти SQL

### Шаг 2: Обновить тестовые данные

```sql
-- Вариант А: Таргетинг на страны (Россия + Казахстан)
UPDATE default_ad_settings
SET geo_locations = '{"countries": ["RU", "KZ"]}'::jsonb
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
  AND campaign_goal = 'whatsapp';

-- Вариант Б: Таргетинг на города (Алматы + Астана) с радиусом
UPDATE default_ad_settings
SET geo_locations = '{
  "cities": [
    {"key": "2420877", "radius": 25, "distance_unit": "kilometer"},
    {"key": "2452344", "radius": 25, "distance_unit": "kilometer"}
  ]
}'::jsonb
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' 
  AND campaign_goal = 'whatsapp';
```

### Шаг 3: Проверить что данные сохранились

```sql
SELECT 
  user_id,
  campaign_goal,
  cities,           -- Legacy, может быть пустым
  geo_locations,    -- Новый формат
  age_min,
  age_max
FROM default_ad_settings
WHERE user_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
```

### Шаг 4: Протестировать CreateCampaignWithCreative

```bash
curl -X POST http://localhost:8080/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-geo-'$(date +%s)'",
    "source": "test",
    "account": {"userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"},
    "actions": [{
      "type": "CreateCampaignWithCreative",
      "params": {
        "user_creative_id": "48b5599f-68d5-4142-8e63-5f8d109439b8",
        "objective": "WhatsApp",
        "campaign_name": "ТЕСТ Гео",
        "daily_budget_cents": 40000,
        "use_default_settings": true,
        "auto_activate": false
      }
    }]
  }' | jq '.'
```

**Ожидаемый результат:**
- ✅ Кампания создана успешно
- ✅ В targeting подставился правильный `geo_locations` (countries или cities)
- ❌ Нет ошибки "Invalid parameter"

---

## 📚 ПРИМЕРЫ geo_locations

### 1. Только страны

```json
{
  "countries": ["RU", "KZ", "BY"]
}
```

### 2. Только города

```json
{
  "cities": [
    {"key": "2420877"},  // Алматы
    {"key": "2452344"}   // Астана
  ]
}
```

### 3. Города с радиусом

```json
{
  "cities": [
    {
      "key": "2420877",
      "radius": 25,
      "distance_unit": "kilometer"
    }
  ]
}
```

### 4. Смешанное (города + исключения)

```json
{
  "cities": [{"key": "2420877"}],
  "excluded_countries": ["BY"]
}
```

### 5. Регионы

```json
{
  "regions": [
    {"key": "3857"}  // California
  ]
}
```

### 6. ZIP коды (только США)

```json
{
  "zips": [
    {"key": "US:94304"}
  ]
}
```

---

## 🔄 ОБРАТНАЯ СОВМЕСТИМОСТЬ

### Legacy код (старый формат cities)

Если в базе еще есть данные со старым форматом:

```json
{
  "cities": ["2420877", "2452344"],
  "geo_locations": null
}
```

**Что произойдет:**
- `convertToFacebookTargeting` автоматически преобразует `cities` → `geo_locations.cities`
- Все будет работать корректно
- Рекомендуется мигрировать на новый формат

---

## ✅ ПРЕИМУЩЕСТВА НОВОГО ФОРМАТА

1. **Ясность**: Понятно что это - страна или город
2. **Гибкость**: Поддержка радиуса, регионов, ZIP кодов
3. **Прямая подстановка**: Нет конвертации, просто копируем JSON
4. **Facebook-ready**: Формат соответствует Facebook Graph API
5. **Дублирование**: Легко скопировать таргетинг из существующей кампании

---

## 🎯 USE CASE: Копирование таргетинга при дублировании

При дублировании кампании:

1. Получаем `targeting` из исходного adset через Facebook API
2. Извлекаем `geo_locations` объект
3. Сохраняем в `default_ad_settings.geo_locations` (опционально)
4. При создании новой кампании - подставляем напрямую

**Код:**
```typescript
// Получили targeting из Facebook
const sourceTargeting = await facebookAPI.getAdSet(adset_id, {fields: 'targeting'});

// Сохраняем geo_locations
await upsertDefaultAdSettings({
  user_id,
  campaign_goal,
  geo_locations: sourceTargeting.targeting.geo_locations,  // Прямая копия!
  // ...
});
```

---

## 📁 ИЗМЕНЕННЫЕ ФАЙЛЫ

1. ✅ `migrations/005_update_geo_locations_format.sql` - миграция БД
2. ✅ `services/agent-service/src/lib/defaultSettings.ts` - логика
3. ✅ `GEO_LOCATIONS_UPDATE.md` - документация
4. ✅ `test-geo-locations.sql` - тестовые запросы

---

## 🧪 CHECKLIST ТЕСТИРОВАНИЯ

- [ ] Выполнить миграцию `005_update_geo_locations_format.sql`
- [ ] Обновить тестовые данные (страны или города)
- [ ] Перезапустить agent-service
- [ ] Протестировать CreateCampaignWithCreative
- [ ] Проверить что кампания создалась без ошибок
- [ ] Проверить targeting в созданном adset через Facebook

---

📅 **Дата:** 5 октября 2025  
🔧 **Версия:** 2.2  
✅ **Статус:** Ready for Testing
