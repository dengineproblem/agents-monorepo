# Спецификация для бэкенд-разработчика: API Дефолтных настроек рекламы

## 📍 Базовая информация

**Base URL:** `http://localhost:3000` (локально) / `https://agents.performanteaiagency.com` (продакшн)

**Таблица в Supabase:** `default_ad_settings`

**Важно:** 
- ✅ RLS можно **отключить** для этой таблицы (бэкенд работает через service role)
- ✅ Авторизация проверяется на уровне бэкенда
- ✅ Бэкенд имеет полный доступ к таблице через Supabase service role
- ✅ Каждое направление (`account_directions`) имеет свои дефолтные настройки рекламы

---

## 🗄️ Структура таблицы `default_ad_settings`

```sql
-- Таблица для хранения дефолтных настроек рекламы для каждого направления
CREATE TABLE IF NOT EXISTS default_ad_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Тип цели кампании (должен совпадать с direction.objective)
  campaign_goal TEXT NOT NULL CHECK (campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Общие настройки таргетинга
  cities TEXT[], -- Массив ID городов
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  gender TEXT DEFAULT 'all' CHECK (gender IN ('all', 'male', 'female')),
  
  -- Текст под видео
  description TEXT DEFAULT 'Напишите нам, чтобы узнать подробности',
  
  -- Настройки для WhatsApp (используется когда campaign_goal = 'whatsapp')
  client_question TEXT DEFAULT 'Здравствуйте! Хочу узнать об этом подробнее.',
  
  -- Настройки для посещения профиля Instagram (campaign_goal = 'instagram_traffic')
  instagram_url TEXT,
  
  -- Настройки для лидов на сайте (campaign_goal = 'site_leads')
  site_url TEXT,
  pixel_id TEXT,
  utm_tag TEXT DEFAULT 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}',
  
  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Уникальность: один набор настроек на направление
  UNIQUE(direction_id)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_direction_id ON default_ad_settings(direction_id);
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_user_id ON default_ad_settings(user_id);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_default_ad_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_default_ad_settings_updated_at
BEFORE UPDATE ON default_ad_settings
FOR EACH ROW
EXECUTE FUNCTION update_default_ad_settings_updated_at();
```

---

## 🔌 API Endpoints

### 1. **GET** `/api/default-settings`

Получить дефолтные настройки для направления.

#### Query Parameters:
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `directionId` | UUID | ✅ | ID направления из таблицы `account_directions` |

#### Request Example:
```http
GET /api/default-settings?directionId=d152dc91-da79-4d82-946c-9f4bfbe1f7cd
```

#### Response 200 (настройки найдены):
```json
{
  "success": true,
  "settings": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "direction_id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "campaign_goal": "whatsapp",
    "cities": ["1289662", "1301648"],
    "age_min": 18,
    "age_max": 65,
    "gender": "all",
    "description": "Напишите нам, чтобы узнать подробности",
    "client_question": "Здравствуйте! Хочу узнать об этом подробнее.",
    "instagram_url": null,
    "site_url": null,
    "pixel_id": null,
    "utm_tag": null,
    "created_at": "2025-10-13T21:30:00.000Z",
    "updated_at": "2025-10-13T21:30:00.000Z"
  }
}
```

#### Response 404 (настройки не найдены):
```json
{
  "success": false,
  "error": "Settings not found"
}
```

#### SQL запрос:
```sql
SELECT * FROM default_ad_settings
WHERE direction_id = $1
LIMIT 1;
```

---

### 2. **POST** `/api/default-settings`

Создать дефолтные настройки для направления (UPSERT - создать или обновить).

#### Request Body:
```json
{
  "direction_id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
  "campaign_goal": "whatsapp",
  "cities": ["1289662", "1301648"],
  "age_min": 18,
  "age_max": 65,
  "gender": "all",
  "description": "Напишите нам, чтобы узнать подробности",
  "client_question": "Здравствуйте! Хочу узнать об этом подробнее."
}
```

#### Поля запроса:
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `direction_id` | UUID | ✅ | ID направления |
| `campaign_goal` | enum | ✅ | `"whatsapp"` \| `"instagram_traffic"` \| `"site_leads"` |
| `cities` | string[] | ❌ | Массив ID городов |
| `age_min` | integer | ❌ | Минимальный возраст (по умолчанию 18) |
| `age_max` | integer | ❌ | Максимальный возраст (по умолчанию 65) |
| `gender` | enum | ❌ | `"all"` \| `"male"` \| `"female"` (по умолчанию "all") |
| `description` | string | ❌ | Текст под видео |
| `client_question` | string | ❌ | Вопрос клиента (только для WhatsApp) |
| `instagram_url` | string | ❌ | URL Instagram (только для Instagram Traffic) |
| `site_url` | string | ❌ | URL сайта (только для Site Leads) |
| `pixel_id` | string | ❌ | ID пикселя Facebook (только для Site Leads) |
| `utm_tag` | string | ❌ | UTM метки (только для Site Leads) |

#### Response 201:
```json
{
  "success": true,
  "settings": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "direction_id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "campaign_goal": "whatsapp",
    "cities": ["1289662", "1301648"],
    "age_min": 18,
    "age_max": 65,
    "gender": "all",
    "description": "Напишите нам, чтобы узнать подробности",
    "client_question": "Здравствуйте! Хочу узнать об этом подробнее.",
    "instagram_url": null,
    "site_url": null,
    "pixel_id": null,
    "utm_tag": null,
    "created_at": "2025-10-13T21:30:00.000Z",
    "updated_at": "2025-10-13T21:30:00.000Z"
  }
}
```

#### Бизнес-логика:
1. **Получить `user_id`** из направления:
   ```sql
   SELECT user_account_id FROM account_directions WHERE id = $directionId;
   ```

2. **Валидация `campaign_goal`**: Убедиться, что `campaign_goal` совпадает с `direction.objective`:
   ```sql
   SELECT objective FROM account_directions WHERE id = $directionId;
   ```
   Если не совпадает → вернуть ошибку 400.

3. **UPSERT настройки**:
   ```sql
   INSERT INTO default_ad_settings (
     direction_id, 
     user_id, 
     campaign_goal, 
     cities, 
     age_min, 
     age_max, 
     gender, 
     description, 
     client_question, 
     instagram_url, 
     site_url, 
     pixel_id, 
     utm_tag
   ) 
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
   ON CONFLICT (direction_id) 
   DO UPDATE SET
     campaign_goal = EXCLUDED.campaign_goal,
     cities = EXCLUDED.cities,
     age_min = EXCLUDED.age_min,
     age_max = EXCLUDED.age_max,
     gender = EXCLUDED.gender,
     description = EXCLUDED.description,
     client_question = EXCLUDED.client_question,
     instagram_url = EXCLUDED.instagram_url,
     site_url = EXCLUDED.site_url,
     pixel_id = EXCLUDED.pixel_id,
     utm_tag = EXCLUDED.utm_tag,
     updated_at = NOW()
   RETURNING *;
   ```

#### Errors:
- `400 Bad Request` - Невалидные данные или `campaign_goal` не совпадает с `direction.objective`
- `404 Not Found` - Направление не найдено
- `500 Internal Server Error` - Ошибка базы данных

---

### 3. **PATCH** `/api/default-settings/:id`

Частично обновить настройки.

#### Request Example:
```http
PATCH /api/default-settings/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

#### Request Body:
```json
{
  "cities": ["1289662"],
  "age_min": 25,
  "age_max": 45,
  "description": "Обновленный текст"
}
```

#### Response 200:
```json
{
  "success": true,
  "settings": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "direction_id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
    "cities": ["1289662"],
    "age_min": 25,
    "age_max": 45,
    "description": "Обновленный текст",
    ...
  }
}
```

#### SQL запрос:
```sql
UPDATE default_ad_settings
SET 
  cities = COALESCE($2, cities),
  age_min = COALESCE($3, age_min),
  age_max = COALESCE($4, age_max),
  gender = COALESCE($5, gender),
  description = COALESCE($6, description),
  client_question = COALESCE($7, client_question),
  instagram_url = COALESCE($8, instagram_url),
  site_url = COALESCE($9, site_url),
  pixel_id = COALESCE($10, pixel_id),
  utm_tag = COALESCE($11, utm_tag)
WHERE id = $1
RETURNING *;
```

**⚠️ Важно:** 
- Нельзя изменять `direction_id`, `user_id`, `campaign_goal`
- Триггер автоматически обновит `updated_at`

---

### 4. **DELETE** `/api/default-settings/:id`

Удалить настройки.

#### Request Example:
```http
DELETE /api/default-settings/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

#### Response 200:
```json
{
  "success": true,
  "message": "Settings deleted"
}
```

#### Response 404:
```json
{
  "success": false,
  "error": "Settings not found"
}
```

#### SQL запрос:
```sql
DELETE FROM default_ad_settings
WHERE id = $1;
```

---

## 📝 Примеры кода для Node.js/Express

```javascript
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // 🔑 Service role для полного доступа
);

// GET /api/default-settings
app.get('/api/default-settings', async (req, res) => {
  const { directionId } = req.query;
  
  if (!directionId) {
    return res.status(400).json({ 
      success: false, 
      error: 'directionId is required' 
    });
  }
  
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('direction_id', directionId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ 
        success: false, 
        error: 'Settings not found' 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ 
    success: true, 
    settings: data 
  });
});

// POST /api/default-settings (UPSERT)
app.post('/api/default-settings', async (req, res) => {
  const { 
    direction_id, 
    campaign_goal, 
    cities, 
    age_min, 
    age_max, 
    gender, 
    description,
    client_question,
    instagram_url,
    site_url,
    pixel_id,
    utm_tag
  } = req.body;
  
  // Валидация
  if (!direction_id || !campaign_goal) {
    return res.status(400).json({ 
      success: false, 
      error: 'direction_id and campaign_goal are required' 
    });
  }
  
  // Получить user_id и objective из направления
  const { data: direction, error: directionError } = await supabase
    .from('account_directions')
    .select('user_account_id, objective')
    .eq('id', direction_id)
    .single();
    
  if (directionError || !direction) {
    return res.status(404).json({ 
      success: false, 
      error: 'Direction not found' 
    });
  }
  
  // Проверить, что campaign_goal совпадает с direction.objective
  if (campaign_goal !== direction.objective) {
    return res.status(400).json({ 
      success: false, 
      error: `campaign_goal (${campaign_goal}) must match direction objective (${direction.objective})` 
    });
  }
  
  // UPSERT настройки
  const { data, error } = await supabase
    .from('default_ad_settings')
    .upsert({
      direction_id,
      user_id: direction.user_account_id,
      campaign_goal,
      cities,
      age_min: age_min || 18,
      age_max: age_max || 65,
      gender: gender || 'all',
      description: description || 'Напишите нам, чтобы узнать подробности',
      client_question,
      instagram_url,
      site_url,
      pixel_id,
      utm_tag
    }, {
      onConflict: 'direction_id'
    })
    .select()
    .single();
  
  if (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.status(201).json({ 
    success: true, 
    settings: data 
  });
});

// PATCH /api/default-settings/:id
app.patch('/api/default-settings/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  // Запрещаем изменение критичных полей
  delete updates.direction_id;
  delete updates.user_id;
  delete updates.campaign_goal;
  
  const { data, error } = await supabase
    .from('default_ad_settings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ 
        success: false, 
        error: 'Settings not found' 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ 
    success: true, 
    settings: data 
  });
});

// DELETE /api/default-settings/:id
app.delete('/api/default-settings/:id', async (req, res) => {
  const { id } = req.params;
  
  const { error } = await supabase
    .from('default_ad_settings')
    .delete()
    .eq('id', id);
  
  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ 
        success: false, 
        error: 'Settings not found' 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ 
    success: true, 
    message: 'Settings deleted' 
  });
});

app.listen(3000, () => {
  console.log('API running on http://localhost:3000');
});
```

---

## ✅ Тестовые сценарии

### 1. Создание настроек для WhatsApp направления
```bash
curl -X POST http://localhost:3000/api/default-settings \
  -H "Content-Type: application/json" \
  -d '{
    "direction_id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
    "campaign_goal": "whatsapp",
    "cities": ["1289662", "1301648"],
    "age_min": 18,
    "age_max": 65,
    "gender": "all",
    "description": "Напишите нам, чтобы узнать подробности",
    "client_question": "Здравствуйте! Хочу узнать об этом подробнее."
  }'
```

### 2. Получение настроек
```bash
curl http://localhost:3000/api/default-settings?directionId=d152dc91-da79-4d82-946c-9f4bfbe1f7cd
```

### 3. Обновление настроек
```bash
curl -X PATCH http://localhost:3000/api/default-settings/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Content-Type: application/json" \
  -d '{
    "age_min": 25,
    "age_max": 45
  }'
```

### 4. Удаление настроек
```bash
curl -X DELETE http://localhost:3000/api/default-settings/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## 🚨 Важные замечания

1. **UPSERT логика**: При POST если настройки для направления уже существуют, они обновляются (не создаются новые).

2. **Валидация `campaign_goal`**: Обязательно проверять, что `campaign_goal` в настройках совпадает с `objective` направления.

3. **Каскадное удаление**: При удалении направления (`account_directions`) все связанные настройки удаляются автоматически (ON DELETE CASCADE).

4. **Дефолтные значения**: Используйте дефолтные значения из схемы БД, если фронтенд не передал некоторые поля.

5. **RLS отключен**: Таблица `default_ad_settings` должна работать через service role, RLS не используется.

