# 🧠 УМНАЯ ЛОГИКА РАСПОЗНАВАНИЯ СТРАН/ГОРОДОВ

## ✅ ФИНАЛЬНОЕ РЕШЕНИЕ (БЕЗ МИГРАЦИЙ!)

**Supabase остается БЕЗ ИЗМЕНЕНИЙ:**
- Колонка `cities TEXT[]` - как есть
- Никаких миграций не нужно!

**В коде автоматическое распознавание:**
- `"RU", "KZ"` (2 символа, заглавные) → страны
- `"2420877", "524901"` (длинные ID) → города

---

## 🎯 КАК ЭТО РАБОТАЕТ

### Алгоритм распознавания:

```typescript
for (const item of cities) {
  if (item.length === 2 && /^[A-Z]{2}$/.test(item)) {
    // 2 заглавные буквы = код страны ISO 3166-1 alpha-2
    countries.push(item);
  } else {
    // Все остальное = ID города из Facebook API
    cities.push(item);
  }
}
```

---

## 📊 ПРИМЕРЫ (ПРОТЕСТИРОВАНО)

### ✅ Несколько стран
```javascript
Input:  cities = ["RU", "KZ", "BY"]
Output: geo_locations = {
  "countries": ["RU", "KZ", "BY"]
}
```

### ✅ Несколько городов
```javascript
Input:  cities = ["2420877", "2452344", "524901"]
Output: geo_locations = {
  "cities": [
    {"key": "2420877"},  // Алматы
    {"key": "2452344"},  // Астана
    {"key": "524901"}    // Москва
  ]
}
```

### ✅ Смешанное (страны + города)
```javascript
Input:  cities = ["RU", "KZ", "2420877"]
Output: geo_locations = {
  "countries": ["RU", "KZ"],
  "cities": [{"key": "2420877"}]
}
```
**Facebook поддерживает такую комбинацию!**

### ✅ Одна страна
```javascript
Input:  cities = ["RU"]
Output: geo_locations = {
  "countries": ["RU"]
}
```

### ✅ Пустой массив (default)
```javascript
Input:  cities = []
Output: geo_locations = {
  "countries": ["RU"]  // По умолчанию - Россия
}
```

---

## 🔧 ФАЙЛЫ

**Обновлен:** `services/agent-service/src/lib/defaultSettings.ts`

**Функция:** `convertToFacebookTargeting()`

**Тесты:** `test-geo-logic.js` (6 тестов, все прошли ✅)

---

## 📋 ИНСТРУКЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЯ

### Что делать в Supabase:

**НИЧЕГО! 🎉**

Просто сохраняй данные как обычно:

```sql
-- Вариант А: Страны (используй заглавные двухсимвольные коды)
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, gender, description)
VALUES (
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  'whatsapp',
  ARRAY['RU', 'KZ'],  -- ✅ Автоматически распознаются как страны
  25,
  55,
  'all',
  'Напишите нам для консультации'
);

-- Вариант Б: Города (используй ID городов из Facebook)
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, gender, description)
VALUES (
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  'whatsapp',
  ARRAY['2420877', '2452344'],  -- ✅ Автоматически распознаются как города
  25,
  55,
  'all',
  'Напишите нам для консультации'
);

-- Вариант В: Смешанное (Facebook поддерживает!)
INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, gender, description)
VALUES (
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  'whatsapp',
  ARRAY['RU', 'KZ', '2420877'],  -- ✅ RU, KZ → страны, 2420877 → город
  25,
  55,
  'all',
  'Напишите нам для консультации'
);
```

---

## ⚠️ ВАЖНО: РЕГИСТР ИМЕЕТ ЗНАЧЕНИЕ

**Правильно:**
```sql
ARRAY['RU', 'KZ']  -- ✅ Заглавные - распознаются как страны
```

**Неправильно:**
```sql
ARRAY['ru', 'kz']  -- ❌ Lowercase - распознаются как города!
```

---

## 🎯 ДЛЯ ДУБЛИРОВАНИЯ КАМПАНИЙ

При копировании таргетинга из существующего adset:

```typescript
// Получаем targeting из Facebook
const sourceTargeting = await fb.getAdSet(adset_id, {fields: 'targeting'});

// Извлекаем geo_locations
const geoLoc = sourceTargeting.targeting.geo_locations;

// Формируем cities массив для Supabase
const cities = [];

if (geoLoc.countries) {
  cities.push(...geoLoc.countries);  // Добавляем коды стран
}

if (geoLoc.cities) {
  cities.push(...geoLoc.cities.map(c => c.key));  // Добавляем ID городов
}

// Сохраняем в Supabase
await supabase
  .from('default_ad_settings')
  .upsert({
    user_id,
    campaign_goal: 'whatsapp',
    cities: cities,  // ["RU", "KZ", "2420877"] - автоматически распознается!
    // ...
  });
```

---

## ✅ ПРЕИМУЩЕСТВА

1. **Простота:** Не нужны миграции БД
2. **Обратная совместимость:** Старые данные работают
3. **Гибкость:** Поддержка стран, городов, и смешанного
4. **Автоматизм:** Не нужно думать о формате при сохранении
5. **Дублирование:** Легко копировать таргетинг из Facebook

---

## 🧪 ТЕСТИРОВАНИЕ

```bash
# Запустить тесты логики
node test-geo-logic.js

# Все 6 тестов должны пройти ✅
```

---

## 🚀 ГОТОВО!

**Agent-service перезапущен с новой логикой!**

Можно тестировать CreateCampaignWithCreative прямо сейчас! 🎉

---

📅 **Дата:** 5 октября 2025  
🔧 **Версия:** 2.3 (Final)  
✅ **Статус:** Production Ready
