# Креативы

Папка для хранения креативов по аккаунтам с поддержкой кэширования Facebook Creative ID.

## Структура

```
creatives/
├── README.md           ← Этот файл
├── {account_name}/     ← Папка для каждого аккаунта
│   ├── index.md        ← Реестр креативов
│   ├── video_1.mp4     ← Файлы креативов
│   ├── image_1.jpg
│   └── ...
```

## Формат index.md

### Основная таблица креативов

```markdown
| creative_name | Файл | Формат | Направление | Статус |
|---------------|------|--------|-------------|--------|
| восстановим 7000 | восстановим 7000.MP4 | video | Имплантация | готов |
```

### Таблица Facebook Video ID

```markdown
| creative_name | video_id | upload_date |
|---------------|----------|-------------|
| восстановим 7000 | 635947262936533 | 2026-01-20 |
```

### Таблица Facebook Creative ID по типам кампаний

```markdown
| creative_name | campaign_type | creative_id | message | cta | settings | created |
|---------------|---------------|-------------|---------|-----|----------|---------|
| восстановим 7000 | WhatsApp | 1222074622687120 | Напишите нам... | WHATSAPP_MESSAGE | phone:77477700007 | 2026-01-20 |
| восстановим 7000 | LeadForm | - | Узнайте больше... | SIGN_UP | form_id:XXX | - |
```

## Типы кампаний (campaign_type)

| Тип | Описание | Обязательные settings |
|-----|----------|----------------------|
| **WhatsApp** | Click-to-WhatsApp | phone, client_question |
| **LeadForm** | Lead generation с формой | form_id |
| **Website** | Трафик на сайт | link_url |
| **Instagram** | Instagram engagement | instagram_actor_id |

## Как использовать

### Алгоритм создания креатива

```
1. ИЩЕМ video_id в таблице "Facebook Video ID"
   │
   ├─ НАЙДЕН → используем существующий video_id
   │           (НЕ загружаем файл повторно!)
   │
   └─ НЕ НАЙДЕН → загружаем файл через upload_video()
                  → сохраняем video_id в таблицу

2. ИЩЕМ creative_id в таблице "Facebook Creative ID"
   с нужными настройками (campaign_type, message, settings)
   │
   ├─ НАЙДЕН → используем существующий creative_id
   │           (НЕ создаём креатив повторно!)
   │
   └─ НЕ НАЙДЕН → создаём креатив через create_video_creative()
                  → сохраняем creative_id с настройками в таблицу
```

### Пример 1: Креатив уже существует

```
Задача: WhatsApp креатив "восстановим 7000" с phone:77477700007

1. Смотрим таблицу Video ID → video_id: 635947262936533 ✓
2. Смотрим таблицу Creative ID:
   - creative_name="восстановим 7000"
   - campaign_type="WhatsApp"
   - settings содержит phone:77477700007
   → Находим creative_id: 1222074622687120 ✓
3. Используем creative_id напрямую в create_ad()
4. Ничего не загружаем и не создаём!
```

### Пример 2: Тот же файл, другая цель

```
Задача: LeadForm креатив "восстановим 7000" с form_id:123456

1. Смотрим таблицу Video ID → video_id: 635947262936533 ✓
   (файл уже загружен, НЕ загружаем повторно!)
2. Смотрим таблицу Creative ID:
   - creative_name="восстановим 7000"
   - campaign_type="LeadForm"
   → НЕ найден
3. Создаём новый креатив:
   create_video_creative(video_id=635947262936533, ...)
4. Сохраняем новый creative_id в таблицу
```

### Пример 3: Новый файл

```
Задача: WhatsApp креатив "новое видео"

1. Смотрим таблицу Video ID → НЕ найден
2. Загружаем файл: upload_video() → video_id: 999888777
3. Сохраняем video_id в таблицу Video ID
4. Создаём креатив: create_video_creative() → creative_id: 111222333
5. Сохраняем creative_id в таблицу Creative ID
```

### Когда нужен НОВЫЙ creative_id

- Другой `campaign_type` (WhatsApp → LeadForm)
- Другой `message` текст
- Другой `cta` (call-to-action)
- Другие `settings` (phone, form_id, link_url)

## Важно

- `creative_name` должен быть уникальным в рамках аккаунта
- **`video_id` — универсальный**, один на файл, НЕ зависит от типа кампании
  - Один video_id можно использовать для WhatsApp, LeadForm, Website и т.д.
  - Загружаем файл ОДИН раз, используем video_id многократно
- `creative_id` — отдельный для каждой комбинации настроек
- При обновлении message/cta нужен НОВЫЙ creative_id
- Старые creative_id не удаляются (могут использоваться в существующих ads)
