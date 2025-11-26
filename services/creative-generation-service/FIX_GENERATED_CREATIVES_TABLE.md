# Исправление таблицы generated_creatives

## Проблема
Ошибка при создании записи:
```
null value in column "id" violates not-null constraint
```

## Решение

### Вариант 1: Применить миграцию (если еще не применена)

Выполните миграцию `032_create_generated_creatives.sql` через Supabase Dashboard:

1. Откройте Supabase Dashboard → SQL Editor
2. Выполните файл `migrations/032_create_generated_creatives.sql`

### Вариант 2: Исправить существующую таблицу

Если таблица уже существует, но без DEFAULT, выполните:

```sql
-- Проверьте текущую структуру
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'generated_creatives' AND column_name = 'id';

-- Если DEFAULT отсутствует, добавьте его:
ALTER TABLE generated_creatives
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Если нужно, пересоздайте таблицу
DROP TABLE IF EXISTS generated_creatives CASCADE;

-- Затем выполните миграцию 032_create_generated_creatives.sql
```

### Вариант 3: Добавить RLS Policy для Service Role

Если используете Service Key, добавьте политику:

```sql
-- Разрешить service role bypass RLS
CREATE POLICY "Service role can manage all creatives"
    ON generated_creatives
    FOR ALL
    USING (true)
    WITH CHECK (true);
```

Или лучше - используйте `ignorePolicyFor` в коде.

### Вариант 4: Обновить код (самый простой)

В `src/db/supabase.ts` убедитесь что используется `service` клиент:

```typescript
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});
```

Service Key автоматически bypass'ит RLS, так что проблема скорее всего в отсутствующем DEFAULT на колонке `id`.

## Проверка

После исправления проверьте:

```bash
curl -X POST http://localhost:8085/generate-creative \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "offer": "Тест",
    "bullets": "• Тест",
    "profits": "Тест",
    "cta": "Тест"
  }'
```

Должно вернуть:
```json
{
  "success": true,
  "creative_id": "uuid-here",
  "image_url": "https://...",
  "generations_remaining": 255
}
```


