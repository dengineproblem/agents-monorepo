# Архитектура Creative Generation Service

## Обзор

Сервис генерирует рекламные креативы (тексты + изображения) через Gemini 3 Pro Image Preview API.

## База данных

### Таблица `generated_creatives`

**Назначение:** Хранит AI-сгенерированные креативы **до** загрузки на Facebook.

```sql
CREATE TABLE generated_creatives (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    direction_id UUID,          -- Опционально: связь с кампанией
    
    -- Сгенерированные тексты
    offer TEXT NOT NULL,        -- Заголовок
    bullets TEXT NOT NULL,      -- Буллеты (3 штуки)
    profits TEXT NOT NULL,      -- Выгода
    cta TEXT NOT NULL,          -- Call-to-action
    
    -- Сгенерированное изображение
    image_url TEXT NOT NULL,    -- URL в Supabase Storage
    
    -- Метаданные
    status TEXT DEFAULT 'generated',  -- generated | uploaded_to_fb | archived
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

### Таблица `user_creatives` (НЕ используется этим сервисом)

**Назначение:** Хранит креативы **после** загрузки на Facebook с FB ID.

```sql
CREATE TABLE user_creatives (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    title TEXT,
    
    -- Facebook IDs
    fb_video_id TEXT,
    fb_creative_id_whatsapp TEXT,
    fb_creative_id_instagram_traffic TEXT,
    fb_creative_id_site_leads TEXT,
    fb_image_hash TEXT,
    
    -- Метаданные
    status TEXT,
    media_type TEXT,
    created_at TIMESTAMPTZ
);
```

## Жизненный цикл креатива

```
1. Пользователь генерирует тексты
   ├─ POST /generate-offer
   ├─ POST /generate-bullets
   ├─ POST /generate-profits
   └─ POST /generate-cta
   
2. Пользователь генерирует финальное изображение
   └─ POST /generate-creative
      ├─ Gemini 3 Pro генерирует изображение 1080x1920 с текстом
      ├─ Загрузка в Supabase Storage (bucket: public)
      ├─ Создание записи в generated_creatives (status: 'generated')
      └─ Возврат image_url пользователю

3. [Будущее] Пользователь публикует на Facebook
   └─ Другой сервис:
      ├─ Берет креатив из generated_creatives
      ├─ Загружает на Facebook
      ├─ Получает FB IDs
      ├─ Создает запись в user_creatives с FB IDs
      └─ Обновляет generated_creatives.status = 'uploaded_to_fb'
```

## Разделение ответственности

### Creative Generation Service (этот сервис)
- ✅ Генерация текстов через Gemini Pro
- ✅ Генерация изображений через Gemini 3 Pro Image Preview
- ✅ Загрузка в Supabase Storage
- ✅ Создание записей в `generated_creatives`
- ✅ Управление лимитами генераций

### Facebook Upload Service (будущий/существующий)
- ⬜ Загрузка креативов на Facebook
- ⬜ Получение FB IDs
- ⬜ Создание записей в `user_creatives`

## Storage структура

```
Supabase Storage:
└── public/
    └── creatives/
        └── {user_id}/
            ├── {timestamp}_abc123.png
            ├── {timestamp}_def456.png
            └── ...
```

## API Endpoints

### Генерация текстов
```
POST /generate-offer
POST /generate-bullets
POST /generate-profits
POST /generate-cta

Request:
{
  "user_id": "uuid",
  "prompt": "текст промпта",
  "existing_offer": "...",     // опционально
  "existing_bullets": "...",   // опционально
  "existing_benefits": "...",  // опционально
  "existing_cta": "..."        // опционально
}

Response:
{
  "success": true,
  "offer": "Сгенерированный текст"  // или bullets/profits/cta
}
```

### Генерация финального креатива
```
POST /generate-creative

Request:
{
  "user_id": "uuid",
  "offer": "Заголовок",
  "bullets": "• Буллет 1\n• Буллет 2\n• Буллет 3",
  "profits": "Выгода",
  "cta": "Призыв к действию",
  "direction_id": "uuid"  // опционально
}

Response:
{
  "success": true,
  "creative_id": "uuid",  // ID в generated_creatives
  "image_url": "https://...supabase.co/storage/.../image.png",
  "generations_remaining": 9
}
```

## Безопасность

### RLS (Row Level Security)
Все операции с `generated_creatives` защищены RLS политиками:
- Пользователи видят только свои креативы
- Пользователи могут изменять только свои креативы
- Backend сервис использует `service_key` (обходит RLS)

### CORS
Настроен для доступа с фронтенда:
```typescript
CORS_ORIGIN=http://localhost:5173  // dev
CORS_ORIGIN=https://yourdomain.com  // prod
```

## Масштабирование

### Горизонтальное
Сервис stateless - можно запустить несколько инстансов:
```
PM2: pm2 start ecosystem.config.js -i 4
Docker: docker-compose scale creative-generation=4
```

### Вертикальное
Gemini API операции memory-intensive:
- Минимум: 512MB RAM
- Рекомендуется: 1GB RAM
- CPU: 1 core достаточно

## Мониторинг

### Метрики для отслеживания
1. Количество генераций в день
2. Среднее время генерации (текст: 2-5s, изображение: 15-45s)
3. Процент успешных генераций
4. Использование квоты Gemini API
5. Размер Supabase Storage

### Логи
```bash
# Development
npm run dev  # stdout

# Production (PM2)
pm2 logs creative-generation-service

# Docker
docker logs -f creative-generation-service
```

## Ограничения

### Gemini API
- 60 запросов в минуту (бесплатный план)
- 1500 запросов в день (бесплатный план)

### Размер изображения
- Фиксированный: 1080x1920 пикселей
- Формат: PNG
- Размер файла: ~500KB - 2MB

### База данных
- `user_accounts.creative_generations_available` - лимит генераций
- Уменьшается на 1 при каждой генерации изображения
- Пополняется через систему тарифов

## Зависимости

### Production
```json
{
  "@google/generative-ai": "^0.21.0",
  "@supabase/supabase-js": "^2.45.0",
  "fastify": "^4.28.0",
  "@fastify/cors": "^9.0.1",
  "dotenv": "^16.4.5"
}
```

### Development
```json
{
  "typescript": "^5.4.5",
  "ts-node-dev": "^2.0.0",
  "@types/node": "^20.14.0"
}
```

## Переменные окружения

```bash
# Обязательные
GEMINI_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_SERVICE_KEY=your_key

# Опциональные
PORT=8085
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGIN=*
```

## См. также

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Инструкции по развертыванию
- [TESTING.md](./TESTING.md) - Руководство по тестированию
- [SETUP_GOOGLE_AI.md](./SETUP_GOOGLE_AI.md) - Настройка Google AI API
- [../MIGRATION_SUMMARY.md](../../MIGRATION_SUMMARY.md) - Сравнение с n8n

