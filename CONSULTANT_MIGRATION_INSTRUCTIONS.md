# Инструкции по миграции архитектуры консультантов

## Что было сделано

✅ Создана миграция [migrations/178_consultant_multi_account_architecture.sql](migrations/178_consultant_multi_account_architecture.sql)
✅ Обновлён backend код:
  - [services/crm-backend/src/routes/consultantsManagement.ts](services/crm-backend/src/routes/consultantsManagement.ts)
  - [services/crm-backend/src/middleware/consultantAuth.ts](services/crm-backend/src/middleware/consultantAuth.ts)

---

## Шаги применения на продакшн

### 1. Применить миграцию

Миграция автоматически:
- Создаст таблицу `consultant_accounts`
- Удалит UNIQUE constraint на `user_account_id`
- Переименует `user_account_id` → `parent_user_account_id`
- Мигрирует данные существующего консультанта "Арман"
- Обновит функции и view

```bash
# На продакшн сервере
# Применяешь миграцию через Supabase SQL Editor или миграционный скрипт
```

### 2. Удалить дубликаты консультанта "Арман"

После миграции выполни:

```sql
-- Удалить деактивированный дубликат
DELETE FROM consultants
WHERE id = '060cd8c5-ef0a-4c35-9f2a-48b4cbaf7b6b';

-- Удалить старый дубликат
DELETE FROM consultants
WHERE id = '1fa07384-2fee-4500-9453-49626e91c553';
```

### 3. Проверить результат

```sql
-- Проверить консультантов с parent_user_account_id
SELECT
    c.id,
    c.name,
    c.phone,
    c.parent_user_account_id,
    ua.username as company_username,
    ca.username as consultant_login
FROM consultants c
LEFT JOIN user_accounts ua ON ua.id = c.parent_user_account_id
LEFT JOIN consultant_accounts ca ON ca.consultant_id = c.id
ORDER BY c.created_at DESC;
```

**Ожидаемый результат:**
- У консультанта "Арман" должен быть `parent_user_account_id` = твой админский ID (`0f559eb0-53fa-4b6a-a51b-5d3e15e5864b`)
- У него должна быть запись в `consultant_accounts` с `username = 77071231503`

### 4. Пересобрать и перезапустить backend

```bash
# На продакшн сервере
cd /path/to/agents-monorepo

# Пересобрать crm-backend
docker-compose build crm-backend

# Перезапустить
docker-compose restart crm-backend

# Проверить логи
docker logs -f agents-monorepo-crm-backend-1
```

---

## Проверка работоспособности

### 1. Проверить список консультантов

Зайди в CRM как админ (`performante`) и открой список консультантов. Должен появиться "Арман".

### 2. Попробовать создать нового консультанта

Создай тестового консультанта с `createAccount=true`. Он должен:
- Появиться в списке сразу
- Получить WhatsApp сообщение с логином/паролем
- Иметь запись в `consultant_accounts`

### 3. Попробовать войти как консультант

Попробуй войти под логином/паролем консультанта:
- Логин: `77071231503`
- Пароль: `7707`

Должен быть редирект на `/c/:consultantId` (его персональную страницу).

---

## Откат (если что-то пошло не так)

Если нужно откатить миграцию:

```sql
-- 1. Удалить таблицу consultant_accounts
DROP TABLE IF EXISTS consultant_accounts CASCADE;

-- 2. Переименовать обратно parent_user_account_id → user_account_id
ALTER TABLE consultants
RENAME COLUMN parent_user_account_id TO user_account_id;

-- 3. Восстановить UNIQUE constraint
ALTER TABLE consultants
ADD CONSTRAINT unique_consultant_user_account UNIQUE (user_account_id);
```

Затем откати изменения в коде через git:

```bash
git checkout HEAD -- services/crm-backend/src/routes/consultantsManagement.ts
git checkout HEAD -- services/crm-backend/src/middleware/consultantAuth.ts
```

---

## FAQ

### Почему консультант "Арман" не виден в списке?

**До миграции:**
- Консультант имел `user_account_id` = его собственный ID (`b435509f-...`)
- Список фильтровался по `user_account_id` = твой админский ID
- Поэтому не проходил фильтр

**После миграции:**
- Консультант имеет `parent_user_account_id` = твой админский ID
- Список фильтруется по `parent_user_account_id`
- Теперь виден!

### Что с WhatsApp сообщением?

WhatsApp сообщение, скорее всего, **было отправлено** на номер `+77071231503` с данными:
- Логин: `77071231503`
- Пароль: `7707`

Проверь логи Evolution API на проде.

### Можно ли создать нескольких консультантов с одним parent_user_account_id?

**Да!** Это и есть правильная архитектура. UNIQUE constraint удалён, теперь много консультантов могут принадлежать одной компании.

### Как работает авторизация консультанта?

1. Консультант входит через `/login` с логином/паролем
2. Middleware проверяет `consultant_accounts` (не `user_accounts`!)
3. Получает `consultant_id` и загружает данные консультанта
4. Редирект на `/c/:consultantId`

---

## Контакты

Если возникнут проблемы, пиши сюда.
