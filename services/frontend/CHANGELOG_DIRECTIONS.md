# Changelog: Направления + Дефолтные настройки рекламы

## 🎉 [v2.0] - 2025-10-13 - ГОТОВО

### ✨ Новая функциональность

#### Создание направления + настройки одним запросом

**До:**
```javascript
// 1. Создать направление
const direction = await directionsApi.create({...});

// 2. Создать настройки отдельно
const settings = await defaultSettingsApi.save({
  direction_id: direction.id,
  ...
});
```

**Сейчас:**
```javascript
// Все в одном запросе!
const result = await directionsApi.create({
  userAccountId: "uuid",
  name: "Имплантация",
  objective: "whatsapp",
  daily_budget_cents: 5000,
  target_cpl_cents: 200,
  default_settings: {  // ← Опционально
    cities: ["1289662"],
    age_min: 25,
    description: "...",
    client_question: "..."
  }
});

// Результат: { direction, default_settings }
```

### 🔧 Изменения в API

#### Обновлен endpoint: `POST /api/directions`

**Новое поле в теле запроса:**
```typescript
{
  userAccountId: string;
  name: string;
  objective: 'whatsapp' | 'instagram_traffic' | 'site_leads';
  daily_budget_cents: number;
  target_cpl_cents: number;
  
  // ⬇️ НОВОЕ (опционально)
  default_settings?: {
    cities?: string[];
    age_min?: number;
    age_max?: number;
    gender?: 'all' | 'male' | 'female';
    description?: string;
    // Специфичные поля в зависимости от objective:
    client_question?: string;      // для whatsapp
    instagram_url?: string;        // для instagram_traffic
    site_url?: string;             // для site_leads
    pixel_id?: string;             // для site_leads
    utm_tag?: string;              // для site_leads
  };
}
```

**Новое поле в ответе:**
```typescript
{
  success: true,
  direction: { ... },
  
  // ⬇️ НОВОЕ (null если не передавали default_settings)
  default_settings: {
    id: "uuid",
    direction_id: "uuid",
    cities: [...],
    age_min: 25,
    // ...
  } | null
}
```

### 📦 Измененные файлы

#### Фронтенд:
- ✅ `/src/types/direction.ts` - добавлено `default_settings` в `CreateDirectionPayload`
- ✅ `/src/services/directionsApi.ts` - обновлен метод `create()` для возврата `default_settings`
- ✅ `/src/components/profile/DirectionsCard.tsx` - убран отдельный вызов `defaultSettingsApi.save()`
- ✅ `/README_DEFAULT_SETTINGS.md` - обновлена документация

#### Бэкенд:
- ✅ Обновлен endpoint `POST /api/directions` для приема `default_settings`
- ✅ Создание направления + настройки в одной транзакции

### 🚀 Преимущества

1. **Быстрее** - 1 HTTP запрос вместо 2
2. **Надежнее** - атомарная операция (или оба создаются, или оба откатываются)
3. **Проще** - меньше логики на фронтенде
4. **Лучше UX** - одно уведомление вместо двух

### ⚠️ Breaking Changes

**Нет!** Изменения обратно совместимы:
- Если не передавать `default_settings` → работает как раньше
- Старые клиенты могут продолжать работать без изменений

### 🧪 Тестирование

```bash
# Тест 1: Создание с настройками
curl -X POST https://agents.performanteaiagency.com/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "...",
    "name": "Тест",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "default_settings": {
      "cities": ["1289662"],
      "age_min": 25,
      "client_question": "Вопрос"
    }
  }'

# Тест 2: Создание без настроек (как раньше)
curl -X POST https://agents.performanteaiagency.com/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "...",
    "name": "Тест",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200
  }'
```

---

## 📚 Документация

- **`README_DEFAULT_SETTINGS.md`** - Полное руководство по функциональности
- **`BACKEND_DEFAULT_SETTINGS_SPEC.md`** - Спецификация API для бэкенда
- **`create_default_ad_settings_table.sql`** - SQL миграция

---

## 👥 Команда

- **Фронтенд**: Реализация UI + API интеграция
- **Бэкенд**: Обновление endpoint + создание таблицы
- **Дата релиза**: 13 октября 2025

---

## 🎯 Следующие задачи

1. ✅ Создание направления с настройками
2. ⏳ Редактирование настроек существующего направления через `EditDirectionDialog`
3. ⏳ Отображение настроек в карточке направления

---

_Для вопросов и предложений обращайтесь к команде разработки._

