# Database Design - Generated Creatives

## Проблема

Изначально была попытка использовать `user_creatives` для хранения сгенерированных изображений, но это **неправильно**, потому что:

### Таблица `user_creatives` - это для Facebook креативов

```sql
-- Пример записи из user_creatives:
{
  "id": "016823c7-ce01-4c51-b6d2-4639e261fd67",
  "user_id": "6cedc53c-9fe5-40e0-bbb9-8cc72f88b8cc",
  "title": "сторител 2_2.mp4",
  "fb_video_id": "1366048361828262",                    // ← FB ID!
  "fb_creative_id_whatsapp": "741593121533691",         // ← FB ID!
  "fb_creative_id_instagram_traffic": "1361678902173893", // ← FB ID!
  "status": "ready",
  "media_type": "video"
}
```

**Назначение:** Креативы **уже опубликованные** на Facebook с FB идентификаторами.

## Решение

Создать отдельную таблицу `generated_creatives` для **промежуточного хранения** AI-сгенерированных креативов.

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    ЖИЗНЕННЫЙ ЦИКЛ КРЕАТИВА                   │
└─────────────────────────────────────────────────────────────┘

1️⃣ ГЕНЕРАЦИЯ (Creative Generation Service)
   ↓
   Gemini 3 Pro генерирует:
   - Тексты: offer, bullets, profits, cta
   - Изображение: 1080x1920 с наложенным текстом
   ↓
   Сохраняется в:
   ┌────────────────────────────────────────┐
   │     generated_creatives                │
   ├────────────────────────────────────────┤
   │ id: uuid                               │
   │ offer: "Автоматизируйте бизнес"       │
   │ bullets: "• Буллет 1\n• Буллет 2"     │
   │ profits: "Экономьте 50%"               │
   │ cta: "Получить консультацию"           │
   │ image_url: "https://...png"            │
   │ status: 'generated' ← ВАЖНО!           │
   └────────────────────────────────────────┘

2️⃣ ПУБЛИКАЦИЯ (Facebook Upload Service)
   ↓
   Берем креатив из generated_creatives
   ↓
   Загружаем на Facebook
   ↓
   Получаем FB IDs
   ↓
   Создаем запись в:
   ┌────────────────────────────────────────┐
   │        user_creatives                  │
   ├────────────────────────────────────────┤
   │ id: uuid                               │
   │ title: "Автоматизируйте..."            │
   │ fb_creative_id_whatsapp: "123"         │
   │ fb_creative_id_instagram: "456"        │
   │ media_type: "image"                    │
   │ status: 'ready' ← FB готов!            │
   └────────────────────────────────────────┘
   ↓
   Обновляем generated_creatives:
   status: 'generated' → 'uploaded_to_fb'
```

## Таблица: generated_creatives

### Поля

```sql
CREATE TABLE generated_creatives (
    -- Идентификаторы
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id),
    direction_id UUID REFERENCES directions(id),  -- Опционально
    
    -- Сгенерированный контент
    offer TEXT NOT NULL,           -- Заголовок креатива
    bullets TEXT NOT NULL,         -- Буллеты (обычно 3 штуки)
    profits TEXT NOT NULL,         -- Выгода для клиента
    cta TEXT NOT NULL,             -- Call-to-action текст
    image_url TEXT NOT NULL,       -- URL изображения в Supabase Storage
    
    -- Статус
    status TEXT DEFAULT 'generated' CHECK (
        status IN ('generated', 'uploaded_to_fb', 'archived')
    ),
    
    -- Временные метки
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Статусы

| Статус | Описание |
|--------|----------|
| `generated` | Только что сгенерирован, еще не опубликован |
| `uploaded_to_fb` | Опубликован на Facebook (есть запись в user_creatives) |
| `archived` | Удален пользователем (мягкое удаление) |

### Индексы

```sql
-- Быстрый поиск креативов пользователя
CREATE INDEX idx_generated_creatives_user_id 
    ON generated_creatives(user_id);

-- Быстрый поиск по направлению (кампании)
CREATE INDEX idx_generated_creatives_direction_id 
    ON generated_creatives(direction_id) 
    WHERE direction_id IS NOT NULL;

-- Быстрая сортировка по дате
CREATE INDEX idx_generated_creatives_created_at 
    ON generated_creatives(created_at DESC);

-- Быстрая фильтрация по статусу
CREATE INDEX idx_generated_creatives_status 
    ON generated_creatives(status);

-- Комбинированный индекс для частых запросов
CREATE INDEX idx_generated_creatives_user_status 
    ON generated_creatives(user_id, status);
```

### RLS (Row Level Security)

```sql
-- Пользователи видят только свои креативы
CREATE POLICY "Users can view their own generated creatives"
    ON generated_creatives FOR SELECT
    USING (auth.uid() = user_id);

-- Пользователи могут создавать только для себя
CREATE POLICY "Users can insert their own generated creatives"
    ON generated_creatives FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- И так далее для UPDATE, DELETE
```

## Связь с другими таблицами

```
generated_creatives
    ├─ user_id → user_accounts.id
    │     ↓
    │  Пользователь, который сгенерировал креатив
    │
    └─ direction_id → directions.id (nullable)
          ↓
       Опциональная связь с кампанией/направлением
```

## Примеры запросов

### 1. Получить все сгенерированные креативы пользователя

```sql
SELECT * FROM generated_creatives
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC;
```

### 2. Получить только неопубликованные креативы

```sql
SELECT * FROM generated_creatives
WHERE user_id = 'user-uuid'
  AND status = 'generated'
ORDER BY created_at DESC;
```

### 3. Получить креативы по направлению

```sql
SELECT * FROM generated_creatives
WHERE user_id = 'user-uuid'
  AND direction_id = 'direction-uuid'
ORDER BY created_at DESC;
```

### 4. Создать новый креатив (через сервис)

```typescript
const { data, error } = await supabase
  .from('generated_creatives')
  .insert({
    user_id: 'user-uuid',
    direction_id: 'direction-uuid',
    offer: 'Заголовок',
    bullets: '• Буллет 1\n• Буллет 2\n• Буллет 3',
    profits: 'Выгода',
    cta: 'Призыв к действию',
    image_url: 'https://...supabase.co/storage/.../image.png',
    status: 'generated'
  })
  .select()
  .single();
```

### 5. Обновить статус после публикации на FB

```typescript
const { error } = await supabase
  .from('generated_creatives')
  .update({ status: 'uploaded_to_fb' })
  .eq('id', 'creative-uuid');
```

## Миграция данных

Если уже есть креативы в старом формате, можно мигрировать:

```sql
-- Пример миграции (если нужно)
INSERT INTO generated_creatives (
    user_id,
    offer,
    bullets,
    profits,
    cta,
    image_url,
    status,
    created_at
)
SELECT 
    user_id,
    'Imported creative' as offer,
    '' as bullets,
    '' as profits,
    '' as cta,
    old_image_url as image_url,
    'generated' as status,
    created_at
FROM old_table
WHERE ...;
```

## Размер и производительность

### Оценка размера

Один креатив:
- Тексты: ~500 bytes
- UUID: 36 bytes × 3 = 108 bytes
- URL: ~200 bytes
- Метаданные: ~100 bytes

**Итого:** ~900 bytes на креатив

**1000 креативов** = ~0.9 MB (ничтожно мало)

### Производительность

С правильными индексами:
- Запрос креативов пользователя: < 1ms
- Фильтрация по статусу: < 1ms
- Сортировка по дате: < 1ms

## Backup и восстановление

### Backup

```bash
# Backup только таблицы
pg_dump $DATABASE_URL -t generated_creatives > backup.sql

# Или через Supabase Dashboard
```

### Восстановление

```bash
# Restore
psql $DATABASE_URL < backup.sql
```

## Часто задаваемые вопросы

### Q: Почему не хранить всё в user_creatives?

**A:** Потому что `user_creatives` - это для **опубликованных** креативов с FB IDs. Смешивание создаст путаницу:
- Нужны nullable FB поля (плохо для целостности)
- Сложная логика различения "сгенерирован" vs "опубликован"
- Разные use-cases требуют разной структуры

### Q: Можно ли удалить генерацию после публикации?

**A:** Да, есть два подхода:
1. **Soft delete:** `status = 'archived'` (рекомендуется)
2. **Hard delete:** `DELETE FROM generated_creatives`

### Q: Сколько хранить старые генерации?

**A:** Рекомендуется:
- Опубликованные (`uploaded_to_fb`): хранить вечно
- Неопубликованные (`generated`): удалять через 30 дней
- Архивированные (`archived`): удалять через 7 дней

Можно настроить cron job:
```sql
DELETE FROM generated_creatives
WHERE status = 'generated'
  AND created_at < NOW() - INTERVAL '30 days';
```

## См. также

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Общая архитектура сервиса
- `migrations/032_create_generated_creatives.sql` - SQL миграция


