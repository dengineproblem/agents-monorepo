# API обработки изображений и создания креативов

## Обзор

Этот сервис принимает изображения через webhook, обрабатывает их и автоматически создает Facebook Ad креативы для трех целей:
1. **WhatsApp** (Click to WhatsApp) - переписка в WhatsApp
2. **Instagram Traffic** - переход на профиль Instagram
3. **Website Leads** - переход на сайт с лид-формой

## Отличия от видео

| Параметр | Видео | Изображение |
|----------|-------|-------------|
| Размер файла | До 500 MB | До 10 MB |
| Транскрибация | ✅ OpenAI Whisper | ❌ Не требуется |
| Facebook API | `/advideos` | `/adimages` |
| Идентификатор | `fb_video_id` | `fb_image_hash` |
| Обработка | FFmpeg + потоковая | Прямая загрузка |

## Функциональность

### Процесс обработки изображения:

1. Принимает изображение через POST запрос
2. Сохраняет запись креатива в базу данных
3. Загружает изображение в Facebook Ad Account → получает `image_hash`
4. Создает три типа креативов параллельно
5. Обновляет запись креатива со всеми ID
6. Возвращает все ID и результаты обработки

## Endpoints

### POST /process-image

Обрабатывает изображение и создает креативы для Facebook Ads.

#### Параметры запроса (multipart/form-data)

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `file` | File | ✅ | Изображение (до 10 MB) |
| `user_id` | UUID | ✅ | ID пользователя |
| `title` | String | ❌ | Название креатива (по умолчанию: "Untitled Image Creative") |
| `description` | String | ✅ | Описание/текст для креативов |
| `client_question` | String | ❌ | Вопрос клиента для WhatsApp welcome message |
| `site_url` | URL | ❌ | URL сайта для Website Leads креатива |
| `utm` | String | ❌ | UTM метки для Website Leads креатива |
| `direction_id` | UUID | ⚠️ | ID направления бизнеса (опционально для legacy, но РЕКОМЕНДУЕТСЯ) |

#### Пример запроса (cURL)

```bash
curl -X POST http://localhost:8082/process-image \
  -F "file=@/path/to/image.jpg" \
  -F "user_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "direction_id=456e7890-e89b-12d3-a456-426614174000" \
  -F "title=Промо акция Q4 2025" \
  -F "description=Скидка 30% на все услуги!" \
  -F "client_question=Хочу узнать подробности об акции" \
  -F "site_url=https://example.com/promo" \
  -F "utm=utm_source=facebook&utm_medium=image&utm_campaign=q4_promo"
```

#### Пример запроса (JavaScript/Fetch)

```javascript
const formData = new FormData();
formData.append('file', imageFile); // File object
formData.append('user_id', '123e4567-e89b-12d3-a456-426614174000');
formData.append('direction_id', '456e7890-e89b-12d3-a456-426614174000');
formData.append('title', 'Промо акция Q4 2025');
formData.append('description', 'Скидка 30% на все услуги!');
formData.append('client_question', 'Хочу узнать подробности об акции');
formData.append('site_url', 'https://example.com/promo');
formData.append('utm', 'utm_source=facebook&utm_medium=image&utm_campaign=q4_promo');

const response = await fetch('http://localhost:8082/process-image', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

#### Успешный ответ (200 OK)

```json
{
  "success": true,
  "message": "Image processed and creatives created successfully",
  "data": {
    "creative_id": "123e4567-e89b-12d3-a456-426614174000",
    "fb_image_hash": "a3f5b8c2d1e9f8a7b6c5d4e3f2a1b0c9",
    "fb_creative_id_whatsapp": "23850123456789012",
    "fb_creative_id_instagram_traffic": "23850123456789013",
    "fb_creative_id_site_leads": "23850123456789014",
    "media_type": "image",
    "direction_id": "456e7890-e89b-12d3-a456-426614174000"
  }
}
```

#### Ошибки

##### 400 Bad Request - Отсутствует изображение

```json
{
  "success": false,
  "error": "Image file is required"
}
```

##### 400 Bad Request - Ошибка валидации

```json
{
  "success": false,
  "error": "Validation error",
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "path": ["user_id"],
      "message": "Required"
    }
  ]
}
```

##### 500 Internal Server Error - Ошибка Facebook API

```json
{
  "success": false,
  "error": "Invalid OAuth access token",
  "facebook_error": {
    "status": 400,
    "method": "POST",
    "path": "act_123456789/adimages",
    "type": "OAuthException",
    "code": 190,
    "error_subcode": 463,
    "fbtrace_id": "AZXq..."
  }
}
```

## Структура базы данных

### Таблица `user_creatives`

Хранит информацию о загруженных и обработанных креативах (видео и изображения).

**Новые поля для изображений:**

| Поле | Тип | Описание |
|------|-----|----------|
| `media_type` | TEXT | Тип медиа: `video` или `image` |
| `fb_image_hash` | TEXT | Hash изображения в Facebook (только для `media_type='image'`) |

**Примечание:** Для видео используется `fb_video_id`, для изображений - `fb_image_hash`.

## Интеграция с Directions (Направлениями)

### Ключевая архитектура

```
1. Direction создается → автоматически создается Campaign в Facebook
2. Креатив (видео/изображение) → связывается с Direction через direction_id
3. Brain Agent / Campaign Builder:
   - Используют action Direction.CreateAdSetWithCreatives
   - Создают AdSet + Ads в существующей Campaign из Direction
   - Различают video/image креативы автоматически
```

### Новый Action: `Direction.CreateAdSetWithCreatives`

**Назначение:** Создание AdSet с креативами в существующей Campaign из Direction.

**Параметры:**

```typescript
{
  type: "Direction.CreateAdSetWithCreatives",
  params: {
    direction_id: string,            // UUID направления
    user_creative_ids: string[],     // Массив UUID креативов (от 1 до 5)
    daily_budget_cents?: number,     // Опционально - переопределяет бюджет Direction
    adset_name?: string,             // Опционально - название AdSet
    auto_activate?: boolean          // true = ACTIVE, false = PAUSED (по умолчанию)
  }
}
```

**Пример использования:**

```javascript
const action = {
  type: "Direction.CreateAdSetWithCreatives",
  params: {
    direction_id: "456e7890-e89b-12d3-a456-426614174000",
    user_creative_ids: [
      "111e1111-e89b-12d3-a456-426614174000",
      "222e2222-e89b-12d3-a456-426614174000"
    ],
    daily_budget_cents: 2000, // $20/день
    auto_activate: false      // Создать в паузе
  }
};

// Отправка через /api/agent/actions
const envelope = {
  idempotencyKey: "unique-key-123",
  account: {
    userAccountId: "user-uuid"
  },
  actions: [action],
  source: "brain_agent"
};

const response = await fetch('http://localhost:8082/api/agent/actions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(envelope)
});
```

**Что происходит внутри:**

1. Получает Direction из БД
2. Берет `fb_campaign_id` из Direction
3. Получает креативы и проверяет их media_type
4. Для каждого креатива определяет правильный `fb_creative_id_*` по objective Direction
5. Создает AdSet в существующей Campaign
6. Создает Ad для каждого креатива
7. Возвращает все ID

**Ответ:**

```json
{
  "success": true,
  "direction_id": "456e7890-e89b-12d3-a456-426614174000",
  "direction_name": "Имплантация",
  "campaign_id": "120210123456789",
  "adset_id": "120210123456790",
  "ads": [
    {
      "ad_id": "120210123456791",
      "user_creative_id": "111e1111-e89b-12d3-a456-426614174000",
      "fb_creative_id": "23850123456789012",
      "media_type": "image"
    },
    {
      "ad_id": "120210123456792",
      "user_creative_id": "222e2222-e89b-12d3-a456-426614174000",
      "fb_creative_id": "23850123456789013",
      "media_type": "video"
    }
  ],
  "ads_count": 2,
  "objective": "whatsapp",
  "message": "AdSet created in direction \"Имплантация\" with 2 ad(s) (status: PAUSED)"
}
```

## Brain Agent интеграция

### Автоматическое распознавание типа медиа

Brain Agent теперь видит поле `media_type` в креативах и автоматически:
- Для `media_type='video'` использует `fb_creative_id_whatsapp` (или другой по objective)
- Для `media_type='image'` использует тот же `fb_creative_id_whatsapp` (или другой по objective)

**Нет необходимости** в разных actions для видео/изображений — workflow сам определяет тип!

### Пример из SYSTEM_PROMPT для Brain Agent

```javascript
// Brain Agent LLM получает данные креативов:
{
  creatives: [
    {
      id: "uuid-1",
      title: "Акция на имплантацию",
      media_type: "image",  // ← Видит что это изображение
      direction_id: "dir-uuid",
      fb_creative_id_whatsapp: "23850...",
      status: "ready"
    },
    {
      id: "uuid-2",
      title: "Видео о клинике",
      media_type: "video",  // ← Видит что это видео
      direction_id: "dir-uuid",
      fb_creative_id_whatsapp: "23851...",
      status: "ready"
    }
  ],
  directions: [
    {
      id: "dir-uuid",
      name: "Имплантация",
      objective: "whatsapp",
      fb_campaign_id: "120210...",
      daily_budget_cents: 5000
    }
  ]
}

// LLM генерирует action:
{
  type: "Direction.CreateAdSetWithCreatives",
  params: {
    direction_id: "dir-uuid",
    user_creative_ids: ["uuid-1", "uuid-2"], // Микс видео + изображения!
    auto_activate: false
  }
}
```

## Переменные окружения

Используются те же переменные что и для видео:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Facebook API
FB_API_VERSION=v20.0
FB_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Server
PORT=8082
```

## Установка и запуск

### 1. Применить миграцию БД

```bash
# В Supabase Dashboard или через CLI
```

Файл миграции: `migrations/011_add_image_support_to_creatives.sql`

### 2. Пересобрать сервис

```bash
cd services/agent-service
npm run build
npm run dev
```

### 3. Или через Docker

```bash
docker-compose build --no-cache agent-service
docker-compose up -d agent-service
```

## Лимиты и ограничения

- **Максимальный размер изображения:** 10 MB
- **Поддерживаемые форматы:** JPG, JPEG, PNG, WEBP (все, что поддерживает Facebook)
- **Рекомендуемые размеры:** 1200×628 px для фидов
- **Rate limits Facebook API:** Зависят от вашего рекламного аккаунта

## Обработка ошибок

Сервис автоматически:
- Удаляет временные файлы после обработки
- Логирует все этапы обработки
- Возвращает детальную информацию об ошибках Facebook API
- Обрабатывает ошибки валидации через Zod
- Обновляет статус креатива на `failed` при ошибке

## Мониторинг

Проверьте логи для отслеживания процесса обработки:

```bash
# В Docker
docker logs agents-monorepo-agent-service-1 -f | grep "process-image"

# Локально
# Логи выводятся в stdout через Fastify logger
```

## Troubleshooting

### Ошибка Facebook API "Invalid image"

```
facebook_error: { code: 100, type: 'FacebookApiException' }
```

**Решение:** 
- Проверьте формат изображения (должен быть JPG/PNG)
- Убедитесь что размер < 10 MB
- Проверьте что изображение не повреждено

### Ошибка "Direction not found"

```
Error: Direction not found: xxx
```

**Решение:**
- Убедитесь что `direction_id` существует
- Проверьте что Direction принадлежит этому пользователю
- Убедитесь что у Direction есть `fb_campaign_id`

### Ошибка "Creative does not have fb_creative_id for whatsapp"

**Решение:**
- Креатив не имеет нужного fb_creative_id для указанного objective
- Возможно креатив был создан без `site_url` (для site_leads)
- Проверьте статус креатива (`status='ready'`)

## Сравнение с n8n workflow

### Ваш текущий n8n workflow:

```
1. Webhook → 2. Save to disk → 3. Read from disk → 4. Upload to FB
→ 5. Process data → 6. Create Creative → 7. Create Campaign
→ 8. Create AdSet → 9. Create Ad → 10. Telegram notification
```

### Новая архитектура:

```
1. POST /process-image (загрузка + 3 креатива) → сохранение в БД
2. Креатив связывается с Direction
3. Brain Agent / Campaign Builder:
   - Использует action Direction.CreateAdSetWithCreatives
   - Создает AdSet + Ads в существующей Campaign
```

**Преимущества новой архитектуры:**
- ✅ Разделение ответственности (загрузка ≠ запуск кампании)
- ✅ Переиспользование креативов
- ✅ Автоматическое управление через Brain Agent
- ✅ Поддержка Directions (направлений бизнеса)
- ✅ Единая система для видео и изображений

## Frontend интеграция

См. `VIDEO_FRONTEND_INTEGRATION.md` — логика идентична, только:
- Endpoint: `/process-image` вместо `/process-video`
- Без транскрипции в ответе
- Меньший размер файла (10 MB vs 500 MB)

## Поддержка

Если у вас возникли вопросы или проблемы, создайте issue в репозитории.

---

**Дата создания:** 14 октября 2025  
**Версия:** 1.0.0  
**Статус:** ✅ Ready for testing

