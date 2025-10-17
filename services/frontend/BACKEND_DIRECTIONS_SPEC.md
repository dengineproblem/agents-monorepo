# Спецификация для бэкенд-разработчика: API Направлений

## 📍 Базовая информация

**Base URL:** `http://localhost:3000`

**Таблица в Supabase:** `account_directions`

**Важно:** 
- ✅ RLS можно **отключить** для этой таблицы (бэкенд работает через service role)
- ✅ Авторизация проверяется на уровне бэкенда
- ✅ Бэкенд имеет полный доступ к таблице через Supabase service role

---

## 🗄️ Структура таблицы `account_directions`

```sql
CREATE TABLE account_directions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
    objective TEXT NOT NULL DEFAULT 'whatsapp' CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads')),
    fb_campaign_id TEXT,
    campaign_status TEXT DEFAULT 'PAUSED' CHECK (campaign_status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
    daily_budget_cents INTEGER NOT NULL DEFAULT 1000 CHECK (daily_budget_cents >= 1000),
    target_cpl_cents INTEGER NOT NULL DEFAULT 50 CHECK (target_cpl_cents >= 50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_direction_name_per_user UNIQUE (user_account_id, name)
);
```

---

## 🔌 API Endpoints

### 1. **GET** `/api/directions`

Получить список направлений пользователя.

#### Query Parameters:
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `userAccountId` | UUID | ✅ | ID пользователя из таблицы `user_accounts` |

#### Request Example:
```http
GET /api/directions?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b
```

#### Response 200:
```json
{
  "success": true,
  "data": {
    "directions": [
      {
        "id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
        "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
        "name": "Имплантация",
        "objective": "whatsapp",
        "fb_campaign_id": "120235536689930463",
        "campaign_status": "PAUSED",
        "daily_budget_cents": 5000,
        "target_cpl_cents": 200,
        "is_active": true,
        "created_at": "2025-10-11T12:39:21.212653Z",
        "updated_at": "2025-10-11T12:39:21.212653Z"
      }
    ]
  }
}
```

#### SQL запрос:
```sql
SELECT * FROM account_directions
WHERE user_account_id = $1
ORDER BY created_at DESC;
```

---

### 2. **POST** `/api/directions`

Создать новое направление.

#### Request Body:
```json
{
  "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
  "name": "Имплантация",
  "objective": "whatsapp",
  "daily_budget_cents": 5000,
  "target_cpl_cents": 200
}
```

#### Поля запроса:
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `userAccountId` | UUID | ✅ | ID пользователя |
| `name` | string | ✅ | Название (2-100 символов) |
| `objective` | enum | ✅ | `"whatsapp"` \| `"instagram_traffic"` \| `"site_leads"` |
| `daily_budget_cents` | integer | ✅ | Суточный бюджет в центах (≥1000, т.е. ≥$10) |
| `target_cpl_cents` | integer | ✅ | Целевой CPL в центах (≥50, т.е. ≥$0.50) |

#### Response 201:
```json
{
  "success": true,
  "data": {
    "direction": {
      "id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
      "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
      "name": "Имплантация",
      "objective": "whatsapp",
      "fb_campaign_id": null,
      "campaign_status": "PAUSED",
      "daily_budget_cents": 5000,
      "target_cpl_cents": 200,
      "is_active": true,
      "created_at": "2025-10-12T10:00:00Z",
      "updated_at": "2025-10-12T10:00:00Z"
    }
  }
}
```

#### Response 400 (Validation Error):
```json
{
  "success": false,
  "error": "Validation error",
  "details": {
    "field": "daily_budget_cents",
    "message": "Минимальный бюджет: $10 (1000 центов)"
  }
}
```

#### SQL запрос:
```sql
INSERT INTO account_directions (
    user_account_id, 
    name, 
    objective, 
    daily_budget_cents, 
    target_cpl_cents,
    is_active
) VALUES ($1, $2, $3, $4, $5, true)
RETURNING *;
```

#### Валидация:
- `name`: длина 2-100 символов
- `objective`: один из `['whatsapp', 'instagram_traffic', 'site_leads']`
- `daily_budget_cents`: ≥ 1000
- `target_cpl_cents`: ≥ 50
- Уникальность: `(user_account_id, name)` не должны повторяться

---

### 3. **PATCH** `/api/directions/:id`

Обновить направление.

#### URL Parameters:
| Параметр | Тип | Описание |
|----------|-----|----------|
| `id` | UUID | ID направления |

#### Request Body:
```json
{
  "name": "Имплантация Premium",
  "daily_budget_cents": 7000,
  "target_cpl_cents": 250,
  "is_active": false
}
```

#### Поля запроса (все опциональные):
| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Новое название (2-100 символов) |
| `daily_budget_cents` | integer | Новый бюджет (≥1000) |
| `target_cpl_cents` | integer | Новый CPL (≥50) |
| `is_active` | boolean | Активность направления |

**⚠️ ВАЖНО:** Поле `objective` **НЕ редактируется!**

#### Response 200:
```json
{
  "success": true,
  "data": {
    "direction": {
      "id": "d152dc91-da79-4d82-946c-9f4bfbe1f7cd",
      "user_account_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
      "name": "Имплантация Premium",
      "objective": "whatsapp",
      "daily_budget_cents": 7000,
      "target_cpl_cents": 250,
      "is_active": false,
      "updated_at": "2025-10-12T11:00:00Z"
    }
  }
}
```

#### Response 404:
```json
{
  "success": false,
  "error": "Direction not found"
}
```

#### SQL запрос:
```sql
UPDATE account_directions
SET 
    name = COALESCE($1, name),
    daily_budget_cents = COALESCE($2, daily_budget_cents),
    target_cpl_cents = COALESCE($3, target_cpl_cents),
    is_active = COALESCE($4, is_active),
    updated_at = NOW()
WHERE id = $5
RETURNING *;
```

---

### 4. **DELETE** `/api/directions/:id`

Удалить направление.

#### URL Parameters:
| Параметр | Тип | Описание |
|----------|-----|----------|
| `id` | UUID | ID направления |

#### Response 200:
```json
{
  "success": true
}
```

#### Response 404:
```json
{
  "success": false,
  "error": "Direction not found"
}
```

#### SQL запрос:
```sql
DELETE FROM account_directions
WHERE id = $1
RETURNING id;
```

---

## 🔐 Настройка Supabase

### Вариант 1: Отключить RLS (рекомендуется для этой таблицы)

```sql
ALTER TABLE account_directions DISABLE ROW LEVEL SECURITY;
```

Бэкенд сам проверяет права доступа, RLS не нужен.

### Вариант 2: Service Role Key

Используйте **service role key** в бэкенде:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Не anon key!
);
```

Service role key обходит RLS политики.

---

## 📋 Примеры кода

### Node.js + Express + Supabase:

```javascript
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/directions
app.get('/api/directions', async (req, res) => {
  const { userAccountId } = req.query;
  
  if (!userAccountId) {
    return res.status(400).json({ 
      success: false, 
      error: 'userAccountId is required' 
    });
  }
  
  const { data, error } = await supabase
    .from('account_directions')
    .select('*')
    .eq('user_account_id', userAccountId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ 
    success: true, 
    data: { directions: data } 
  });
});

// POST /api/directions
app.post('/api/directions', async (req, res) => {
  const { userAccountId, name, objective, daily_budget_cents, target_cpl_cents } = req.body;
  
  // Валидация
  if (!userAccountId || !name || !objective) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields' 
    });
  }
  
  if (daily_budget_cents < 1000) {
    return res.status(400).json({ 
      success: false, 
      error: 'Минимальный бюджет: $10 (1000 центов)' 
    });
  }
  
  const { data, error } = await supabase
    .from('account_directions')
    .insert({
      user_account_id: userAccountId,
      name,
      objective,
      daily_budget_cents,
      target_cpl_cents,
      is_active: true
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
    data: { direction: data } 
  });
});

// PATCH /api/directions/:id
app.patch('/api/directions/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  // Запрещаем изменение objective
  delete updates.objective;
  delete updates.userAccountId;
  
  const { data, error } = await supabase
    .from('account_directions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ 
        success: false, 
        error: 'Direction not found' 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ 
    success: true, 
    data: { direction: data } 
  });
});

// DELETE /api/directions/:id
app.delete('/api/directions/:id', async (req, res) => {
  const { id } = req.params;
  
  const { error } = await supabase
    .from('account_directions')
    .delete()
    .eq('id', id);
  
  if (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
  
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('API running on http://localhost:3000');
});
```

---

## 🧪 Тестирование

### cURL примеры:

```bash
# GET - получить направления
curl "http://localhost:3000/api/directions?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

# POST - создать направление
curl -X POST http://localhost:3000/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "name": "Тест",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200
  }'

# PATCH - обновить направление
curl -X PATCH http://localhost:3000/api/directions/d152dc91-da79-4d82-946c-9f4bfbe1f7cd \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Тест Обновлённый",
    "daily_budget_cents": 7000
  }'

# DELETE - удалить направление
curl -X DELETE http://localhost:3000/api/directions/d152dc91-da79-4d82-946c-9f4bfbe1f7cd
```

---

## ✅ Чеклист для бэкенд-разработчика

- [ ] Создать роуты `/api/directions` (GET, POST)
- [ ] Создать роут `/api/directions/:id` (PATCH, DELETE)
- [ ] Настроить Supabase клиент с service role key
- [ ] Отключить RLS для таблицы `account_directions`
- [ ] Добавить валидацию входных данных
- [ ] Обработать ошибки Supabase
- [ ] Протестировать все endpoints через Postman/curl
- [ ] Проверить CORS настройки (если фронтенд на другом порту)

---

**Готово!** После реализации этих endpoints фронтенд начнёт работать. 🚀

