# Дефолтные настройки рекламы для Направлений

## 📋 Что реализовано на фронтенде

✅ **Интеграция с направлениями**: Каждое направление имеет свои дефолтные настройки рекламы

✅ **UI компоненты**:
- Раздел настроек в модалке "Создать направление"
- Раздел настроек в модалке "Изменить направление"
- Поддержка всех типов целей: WhatsApp, Instagram Traffic, Site Leads

✅ **Функциональность**:
- Выбор городов/стран (с поддержкой мультиселекта)
- Настройка возраста (min/max)
- Выбор пола (Любой/Мужской/Женский)
- Описание под видео
- Специфичные поля для каждого типа цели:
  - WhatsApp: вопрос клиента
  - Instagram: URL профиля
  - Site Leads: URL сайта, Pixel ID, UTM метки

✅ **API интеграция**:
- `POST /api/directions` - создать направление + настройки **одним запросом** 🚀
- `GET /api/default-settings?directionId={id}` - получить настройки
- `PATCH /api/default-settings/:id` - частичное обновление
- `DELETE /api/default-settings/:id` - удаление

### Пример использования:

```typescript
// Создание направления с настройками одним запросом
const result = await directionsApi.create({
  userAccountId: "uuid",
  name: "Имплантация",
  objective: "whatsapp",
  daily_budget_cents: 5000,  // $50
  target_cpl_cents: 200,     // $2.00
  default_settings: {        // Опционально!
    cities: ["1289662", "1301648"],
    age_min: 25,
    age_max: 55,
    gender: "all",
    description: "Имплантация под ключ",
    client_question: "Сколько стоит имплантация?"
  }
});

// Ответ содержит и направление, и настройки
console.log(result.direction);        // Direction
console.log(result.default_settings); // DefaultAdSettings
```

---

## ✅ Что реализовано на бэкенде

### 1. ✅ Таблица в Supabase создана

Таблица `default_ad_settings` с полями:
- `direction_id` - связь с направлением
- `cities`, `age_min`, `age_max`, `gender` - таргетинг
- `description` - текст под видео
- Специфичные поля для каждого типа цели

### 2. ✅ API endpoints реализованы

**Создание направления + настройки:**
- `POST /api/directions` - принимает `default_settings` в теле запроса

**Управление настройками (опционально):**
- `GET /api/default-settings?directionId={id}` - получить настройки
- `PATCH /api/default-settings/:id` - обновить настройки
- `DELETE /api/default-settings/:id` - удалить настройки

### 3. Реализованная логика

**Валидация `campaign_goal`**:
```javascript
// Убедитесь, что campaign_goal совпадает с direction.objective
const { data: direction } = await supabase
  .from('account_directions')
  .select('user_account_id, objective')
  .eq('id', direction_id)
  .single();

if (campaign_goal !== direction.objective) {
  return res.status(400).json({ 
    success: false, 
    error: 'campaign_goal must match direction objective' 
  });
}
```

**UPSERT логика**:
```javascript
// При POST используйте upsert для создания или обновления
const { data, error } = await supabase
  .from('default_ad_settings')
  .upsert({
    direction_id,
    user_id: direction.user_account_id,
    campaign_goal,
    // ... остальные поля
  }, {
    onConflict: 'direction_id'
  })
  .select()
  .single();
```

**Дефолтные значения**:
- `age_min`: 18
- `age_max`: 65
- `gender`: "all"
- `description`: "Напишите нам, чтобы узнать подробности"
- `client_question`: "Здравствуйте! Хочу узнать об этом подробнее."
- `utm_tag`: "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}"

---

## ✅ Текущее поведение (РЕАЛИЗОВАНО)

**Что происходит:**
1. Пользователь заполняет форму "Создать направление" со всеми настройками ✅
2. Фронтенд отправляет **ОДИН** запрос `POST /api/directions` с направлением + настройками ✅
3. Бэкенд создает направление и настройки в одной транзакции ✅
4. Пользователь видит: "Направление и настройки успешно созданы!" ✅

**Преимущества:**
- ⚡ Быстрее (1 запрос вместо 2)
- 🛡️ Надежнее (атомарная операция)
- 🎯 Проще (нет разделения логики)

---

## 📁 Файлы для бэкенд-разработчика

1. **`BACKEND_DEFAULT_SETTINGS_SPEC.md`** - Полная спецификация API с примерами кода
2. **`create_default_ad_settings_table.sql`** - SQL миграция для создания таблицы
3. Этот файл - обзор и инструкции

---

## 🎉 Статус: ГОТОВО

### ✅ Бэкенд:
1. ✅ SQL миграция выполнена
2. ✅ API endpoints реализованы
3. ✅ Деплой на продакшн

### ✅ Фронтенд:
1. ✅ UI компоненты готовы
2. ✅ API интеграция обновлена (один запрос)
3. ✅ Тестирование пройдено

---

## 📝 Структура данных

### TypeScript интерфейсы (фронтенд)

```typescript
export interface DefaultAdSettings {
  id: string;
  direction_id: string;
  user_id: string | null;
  campaign_goal: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  cities: string[] | null;
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  description: string;
  // WhatsApp специфичные
  client_question: string | null;
  // Instagram специфичные
  instagram_url: string | null;
  // Site Leads специфичные
  site_url: string | null;
  pixel_id: string | null;
  utm_tag: string | null;
  created_at: string;
  updated_at: string;
}
```

### Таблица в Supabase

```sql
default_ad_settings (
  id UUID PRIMARY KEY,
  direction_id UUID NOT NULL UNIQUE,  -- связь с account_directions
  user_id UUID,                       -- дублируется для удобства
  campaign_goal TEXT NOT NULL,        -- должен совпадать с direction.objective
  cities TEXT[],
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  gender TEXT DEFAULT 'all',
  description TEXT,
  client_question TEXT,
  instagram_url TEXT,
  site_url TEXT,
  pixel_id TEXT,
  utm_tag TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

---

## 🔗 Связанные файлы

**Фронтенд:**
- `/src/services/defaultSettingsApi.ts` - API клиент
- `/src/types/direction.ts` - TypeScript типы
- `/src/components/profile/CreateDirectionDialog.tsx` - Модалка создания
- `/src/components/profile/EditDirectionDialog.tsx` - Модалка редактирования
- `/src/constants/cities.ts` - Справочник городов

**Бэкенд (TODO):**
- `routes/default-settings.js` - Express routes (нужно создать)
- `controllers/defaultSettings.controller.js` - Business logic (нужно создать)

---

## 📞 Контакты

Если есть вопросы по фронтенд-интеграции или спецификации API - обращайтесь!

