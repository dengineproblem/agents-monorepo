# 🔐 Frontend - Безопасность и рекомендации

## ⚠️ КРИТИЧЕСКИЕ ПРОБЛЕМЫ (требуют немедленного исправления!)

### 1. ❌ Row Level Security (RLS) НЕ настроен в Supabase

**Текущая ситуация:**
- Почти все таблицы в Supabase имеют `anon` restricted доступ
- RLS политики НЕ заданы
- **ЛЮБОЙ пользователь может читать/изменять ЛЮБЫЕ данные!**

**Почему это опасно:**
```javascript
// С фронтенда ЛЮБОЙ может сделать:
const { data } = await supabase
  .from('user_accounts')
  .select('*')  // Получить ВСЕ аккаунты всех пользователей!
  
await supabase
  .from('user_creatives')
  .delete()
  .eq('id', 'ЧУЖОЙ-КРЕАТИВ-ID')  // Удалить чужой креатив!
```

---

## 🛡️ РЕШЕНИЕ: Настройка RLS политик

### Шаг 1: Включите RLS для всех таблиц

```sql
-- В Supabase SQL Editor выполните:

-- User Accounts (аккаунты пользователей)
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- Directions (направления)
ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_directions ENABLE ROW LEVEL SECURITY;

-- Creatives (креативы)
ALTER TABLE user_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_video_uploads ENABLE ROW LEVEL SECURITY;

-- Settings (настройки)
ALTER TABLE default_ad_settings ENABLE ROW LEVEL SECURITY;

-- Reports (отчёты)
ALTER TABLE brain_reports ENABLE ROW LEVEL SECURITY;

-- И т.д. для ВСЕХ таблиц с пользовательскими данными
```

### Шаг 2: Создайте RLS политики

#### Политика для `user_accounts`

```sql
-- Пользователь видит ТОЛЬКО свой аккаунт
CREATE POLICY "Users can view own account"
ON user_accounts
FOR SELECT
USING (auth.uid() = id);

-- Пользователь может обновлять ТОЛЬКО свой аккаунт
CREATE POLICY "Users can update own account"
ON user_accounts
FOR UPDATE
USING (auth.uid() = id);
```

#### Политика для `user_creatives`

```sql
-- Пользователь видит ТОЛЬКО свои креативы
CREATE POLICY "Users can view own creatives"
ON user_creatives
FOR SELECT
USING (auth.uid() = user_id);

-- Пользователь может создавать креативы
CREATE POLICY "Users can create own creatives"
ON user_creatives
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Пользователь может удалять ТОЛЬКО свои креативы
CREATE POLICY "Users can delete own creatives"
ON user_creatives
FOR DELETE
USING (auth.uid() = user_id);

-- Пользователь может обновлять ТОЛЬКО свои креативы
CREATE POLICY "Users can update own creatives"
ON user_creatives
FOR UPDATE
USING (auth.uid() = user_id);
```

#### Политика для `account_directions`

```sql
-- Пользователь видит ТОЛЬКО свои направления
CREATE POLICY "Users can view own directions"
ON account_directions
FOR SELECT
USING (auth.uid() = user_account_id);

-- Пользователь может создавать направления
CREATE POLICY "Users can create own directions"
ON account_directions
FOR INSERT
WITH CHECK (auth.uid() = user_account_id);

-- Пользователь может обновлять ТОЛЬКО свои направления
CREATE POLICY "Users can update own directions"
ON account_directions
FOR UPDATE
USING (auth.uid() = user_account_id);

-- Пользователь может удалять ТОЛЬКО свои направления
CREATE POLICY "Users can delete own directions"
ON account_directions
FOR DELETE
USING (auth.uid() = user_account_id);
```

#### Политика для `default_ad_settings`

```sql
-- Пользователь видит ТОЛЬКО свои настройки
CREATE POLICY "Users can view own settings"
ON default_ad_settings
FOR SELECT
USING (auth.uid() = user_account_id);

-- Пользователь может создавать/обновлять свои настройки
CREATE POLICY "Users can manage own settings"
ON default_ad_settings
FOR ALL
USING (auth.uid() = user_account_id)
WITH CHECK (auth.uid() = user_account_id);
```

### Шаг 3: Проверьте RLS политики

```sql
-- Проверьте, что RLS включен
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE '%user%';

-- Проверьте политики
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public';
```

---

## 🔐 Дополнительные меры безопасности

### 2. Backend Authorization (рекомендуется)

Даже с RLS нужна проверка на backend!

**В agent-service добавьте middleware:**

```typescript
// src/middleware/auth.ts
import { createClient } from '@supabase/supabase-js';

export async function authMiddleware(request, reply) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return reply.code(401).send({ error: 'Invalid token' });
  }
  
  // Добавляем user в request
  request.user = user;
}
```

**Использование в роутах:**

```typescript
// src/routes/creatives.ts
app.get('/api/user-creatives',
  { preHandler: authMiddleware },  // ← Проверка auth
  async (request, reply) => {
    const userId = request.user.id;  // ← Берём из токена!
    
    // НЕ доверяем userId из query параметров!
    const creatives = await getCreatives(userId);
    return creatives;
  }
);
```

### 3. Валидация данных

**Используйте Zod для валидации:**

```typescript
import { z } from 'zod';

const CreateDirectionSchema = z.object({
  name: z.string().min(1).max(100),
  daily_budget_cents: z.number().min(100).max(1000000),
  target_cpl_cents: z.number().min(10).max(100000),
  optimization_goal: z.enum(['LEAD', 'CONVERSATIONS', 'REACH']),
});

app.post('/api/directions',
  { preHandler: authMiddleware },
  async (request, reply) => {
    // Валидируем входные данные
    const validation = CreateDirectionSchema.safeParse(request.body);
    
    if (!validation.success) {
      return reply.code(400).send({ 
        error: 'Validation error',
        details: validation.error.issues 
      });
    }
    
    const direction = await createDirection(
      request.user.id,  // ← user_id из токена
      validation.data
    );
    
    return direction;
  }
);
```

### 4. Rate Limiting

**Добавьте ограничение запросов:**

```typescript
import rateLimit from '@fastify/rate-limit';

app.register(rateLimit, {
  max: 100,  // 100 запросов
  timeWindow: '1 minute',  // за минуту
});
```

### 5. CORS настройки

**Разрешайте запросы только с вашего домена:**

```typescript
import cors from '@fastify/cors';

app.register(cors, {
  origin: [
    'https://performanteaiagency.com',
    'http://localhost:8081',  // для dev
  ],
  credentials: true,
});
```

### 6. Защита API ключей

**НЕ храните API ключи в frontend коде!**

❌ **Плохо:**
```typescript
// src/config.ts
export const FACEBOOK_API_KEY = 'abc123...';  // Виден в коде!
```

✅ **Хорошо:**
```typescript
// Backend: src/config.ts
export const FACEBOOK_API_KEY = process.env.FACEBOOK_API_KEY;

// Frontend: делает запрос на backend
const response = await fetch('/api/facebook/campaigns');
```

---

## 🔍 Аудит безопасности

### Чек-лист проверки

- [ ] **RLS включен** для всех таблиц с пользовательскими данными
- [ ] **RLS политики** созданы для SELECT/INSERT/UPDATE/DELETE
- [ ] **Backend middleware** проверяет JWT токен
- [ ] **user_id берётся из токена**, а не из query/body
- [ ] **Валидация** всех входных данных (Zod)
- [ ] **Rate limiting** настроен
- [ ] **CORS** разрешает только нужные домены
- [ ] **API ключи** не хранятся в frontend
- [ ] **Sensitive data** не логируется
- [ ] **HTTPS** используется в production

### Тестирование безопасности

```bash
# 1. Попробуйте получить чужие данные
curl -H "Authorization: Bearer USER1_TOKEN" \
  https://performanteaiagency.com/api/user-creatives?user_id=USER2_ID

# Должно вернуть: только данные USER1, НЕ USER2!

# 2. Попробуйте без токена
curl https://performanteaiagency.com/api/user-creatives

# Должно вернуть: 401 Unauthorized

# 3. Попробуйте с невалидным токеном
curl -H "Authorization: Bearer fake-token" \
  https://performanteaiagency.com/api/user-creatives

# Должно вернуть: 401 Invalid token
```

---

## 📋 План действий (Priority)

### 🔥 Критично (сделать СРОЧНО!)

1. **Включите RLS** для всех таблиц
2. **Создайте RLS политики** (см. примеры выше)
3. **Добавьте auth middleware** на backend
4. **Проверьте**, что user_id берётся из токена, а не из параметров

### ⚠️ Важно (сделать на этой неделе)

5. **Добавьте валидацию** входных данных (Zod)
6. **Настройте Rate Limiting**
7. **Проверьте CORS** настройки
8. **Аудит API ключей** - убедитесь, что не в коде

### ✅ Желательно (когда будет время)

9. **Добавьте логирование** критических операций
10. **Настройте мониторинг** подозрительной активности
11. **Регулярный security audit**
12. **Penetration testing**

---

## 🔐 SQL скрипт для быстрой настройки RLS

Создайте файл `migrations/enable_rls_security.sql`:

```sql
-- ========================================
-- Включение RLS для всех таблиц
-- ========================================

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_video_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE default_ad_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_reports ENABLE ROW LEVEL SECURITY;

-- ========================================
-- RLS Политики для user_accounts
-- ========================================

CREATE POLICY "users_view_own_account"
ON user_accounts FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "users_update_own_account"
ON user_accounts FOR UPDATE
USING (auth.uid() = id);

-- ========================================
-- RLS Политики для user_creatives
-- ========================================

CREATE POLICY "users_view_own_creatives"
ON user_creatives FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "users_create_own_creatives"
ON user_creatives FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_creatives"
ON user_creatives FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_creatives"
ON user_creatives FOR DELETE
USING (auth.uid() = user_id);

-- ========================================
-- RLS Политики для account_directions
-- ========================================

CREATE POLICY "users_view_own_directions"
ON account_directions FOR SELECT
USING (auth.uid() = user_account_id);

CREATE POLICY "users_manage_own_directions"
ON account_directions FOR ALL
USING (auth.uid() = user_account_id)
WITH CHECK (auth.uid() = user_account_id);

-- ========================================
-- RLS Политики для default_ad_settings
-- ========================================

CREATE POLICY "users_view_own_settings"
ON default_ad_settings FOR SELECT
USING (auth.uid() = user_account_id);

CREATE POLICY "users_manage_own_settings"
ON default_ad_settings FOR ALL
USING (auth.uid() = user_account_id)
WITH CHECK (auth.uid() = user_account_id);

-- ========================================
-- RLS Политики для brain_reports
-- ========================================

CREATE POLICY "users_view_own_reports"
ON brain_reports FOR SELECT
USING (auth.uid() = user_account_id);

-- Добавьте политики для остальных таблиц по аналогии...
```

**Применение:**

```bash
# В Supabase Dashboard → SQL Editor
# Скопируйте и выполните скрипт выше
```

---

## 📞 Контакты

При обнаружении уязвимостей немедленно свяжитесь с командой безопасности!

---

**⚠️ ВНИМАНИЕ:** Эти меры безопасности КРИТИЧЕСКИ ВАЖНЫ для защиты данных пользователей. Внедрите их как можно скорее!

**Последнее обновление:** 17 октября 2025

