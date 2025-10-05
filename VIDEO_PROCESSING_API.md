# API обработки видео и создания креативов

## Обзор

Этот сервис принимает видео файлы через webhook, обрабатывает их и автоматически создает Facebook Ad креативы для трех целей:
1. **WhatsApp** (Click to WhatsApp) - переписка в WhatsApp
2. **Instagram Traffic** - переход на профиль Instagram
3. **Website Leads** - переход на сайт с лид-формой

## Функциональность

### Процесс обработки видео:

1. Принимает видео файл через POST запрос
2. Извлекает аудио из видео с помощью FFmpeg
3. Транскрибирует аудио через OpenAI Whisper
4. Сохраняет запись креатива в базу данных
5. Загружает видео в Facebook Ad Account
6. Создает три типа креативов параллельно
7. Сохраняет транскрипцию в базу данных
8. Возвращает все ID и результаты обработки

## Endpoints

### POST /process-video

Обрабатывает видео и создает креативы для Facebook Ads.

#### Параметры запроса (multipart/form-data)

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `video` | File | ✅ | Видео файл (до 500 MB) |
| `user_id` | UUID | ✅ | ID пользователя |
| `ad_account_id` | String | ✅ | ID рекламного аккаунта Facebook (формат: `act_XXXXXXXX`) |
| `page_id` | String | ✅ | ID Facebook страницы |
| `instagram_id` | String | ✅ | ID Instagram аккаунта |
| `instagram_username` | String | ❌ | Username Instagram (для ссылки в креативе) |
| `page_access_token` | String | ✅ | Access token для Facebook API |
| `title` | String | ❌ | Название креатива (по умолчанию: "Untitled Creative") |
| `description` | String | ✅ | Описание/текст для креативов |
| `language` | String | ❌ | Язык транскрипции (по умолчанию: "ru") |
| `client_question` | String | ❌ | Вопрос клиента для WhatsApp welcome message |
| `site_url` | URL | ❌ | URL сайта для Website Leads креатива |
| `utm` | String | ❌ | UTM метки для Website Leads креатива |

#### Пример запроса (cURL)

```bash
curl -X POST http://localhost:8080/process-video \
  -F "video=@/path/to/video.mp4" \
  -F "user_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "ad_account_id=act_123456789" \
  -F "page_id=987654321" \
  -F "instagram_id=17841400000000000" \
  -F "instagram_username=mycompany" \
  -F "page_access_token=EAAxxxxxxxxxxxxx" \
  -F "title=Промо видео Q4 2025" \
  -F "description=Узнайте больше о нашем новом продукте!" \
  -F "language=ru" \
  -F "client_question=Хочу узнать подробности о продукте" \
  -F "site_url=https://example.com/landing" \
  -F "utm=utm_source=facebook&utm_medium=video&utm_campaign=q4_promo"
```

#### Пример запроса (JavaScript/Fetch)

```javascript
const formData = new FormData();
formData.append('video', videoFile); // File object
formData.append('user_id', '123e4567-e89b-12d3-a456-426614174000');
formData.append('ad_account_id', 'act_123456789');
formData.append('page_id', '987654321');
formData.append('instagram_id', '17841400000000000');
formData.append('instagram_username', 'mycompany');
formData.append('page_access_token', 'EAAxxxxxxxxxxxxx');
formData.append('title', 'Промо видео Q4 2025');
formData.append('description', 'Узнайте больше о нашем новом продукте!');
formData.append('language', 'ru');
formData.append('client_question', 'Хочу узнать подробности о продукте');
formData.append('site_url', 'https://example.com/landing');
formData.append('utm', 'utm_source=facebook&utm_medium=video&utm_campaign=q4_promo');

const response = await fetch('http://localhost:8080/process-video', {
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
  "message": "Video processed and creatives created successfully",
  "data": {
    "creative_id": "123e4567-e89b-12d3-a456-426614174000",
    "fb_video_id": "987654321098765",
    "fb_creative_id_whatsapp": "23850123456789012",
    "fb_creative_id_instagram_traffic": "23850123456789013",
    "fb_creative_id_site_leads": "23850123456789014",
    "transcription": {
      "text": "Привет! В этом видео я расскажу о нашем новом продукте...",
      "language": "ru",
      "source": "whisper",
      "duration_sec": 45
    }
  }
}
```

#### Ошибки

##### 400 Bad Request - Отсутствует видео файл
```json
{
  "success": false,
  "error": "Video file is required"
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
    "path": "act_123456789/advideos",
    "type": "OAuthException",
    "code": 190,
    "error_subcode": 463,
    "fbtrace_id": "AZXq..."
  }
}
```

## Структура базы данных

### Таблица `user_creatives`

Хранит информацию о загруженных и обработанных видео креативах.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `user_id` | UUID | ID пользователя |
| `title` | TEXT | Название креатива |
| `status` | TEXT | Статус: `processing`, `ready`, `failed` |
| `fb_video_id` | TEXT | ID видео в Facebook |
| `fb_creative_id_whatsapp` | TEXT | ID WhatsApp креатива |
| `fb_creative_id_instagram_traffic` | TEXT | ID Instagram креатива |
| `fb_creative_id_site_leads` | TEXT | ID Website Leads креатива |
| `created_at` | TIMESTAMPTZ | Дата создания |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

### Таблица `creative_transcripts`

Хранит транскрипции видео креативов.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `creative_id` | UUID | FK на `user_creatives` |
| `lang` | TEXT | Язык транскрипции |
| `source` | TEXT | Источник: `whisper`, `manual`, `auto` |
| `text` | TEXT | Текст транскрипции |
| `confidence` | NUMERIC | Уровень уверенности (0-1) |
| `duration_sec` | INTEGER | Длительность в секундах |
| `status` | TEXT | Статус: `processing`, `ready`, `failed` |
| `created_at` | TIMESTAMPTZ | Дата создания |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

## Переменные окружения

Добавьте следующие переменные в `.env.agent`:

```bash
# OpenAI API для транскрипции
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Facebook API
FB_API_VERSION=v20.0
FB_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server
PORT=8080
```

## Установка и запуск

### 1. Установите зависимости

```bash
cd services/agent-service
npm install
```

### 2. Установите FFmpeg

FFmpeg необходим для извлечения аудио из видео.

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Docker (уже включен в Dockerfile):**
```dockerfile
RUN apt-get update && apt-get install -y ffmpeg
```

### 3. Примените миграцию базы данных

```bash
# Через Supabase CLI
supabase db push migrations/002_video_creatives_tables.sql

# Или выполните SQL напрямую в Supabase Dashboard
```

### 4. Запустите сервис

**Разработка:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## Dockerfile

Обновите `services/agent-service/Dockerfile` для установки FFmpeg:

```dockerfile
FROM node:20-alpine

# Установка FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/server.js"]
```

## Лимиты и ограничения

- **Максимальный размер видео:** 500 MB
- **Поддерживаемые форматы:** MP4, MOV, AVI, MKV (все, что поддерживает FFmpeg)
- **Максимальная длительность аудио для Whisper:** 25 MB после конвертации в WAV
- **Rate limits Facebook API:** Зависят от вашего рекламного аккаунта

## Обработка ошибок

Сервис автоматически:
- Удаляет временные файлы (видео и аудио) после обработки
- Логирует все этапы обработки
- Возвращает детальную информацию об ошибках Facebook API
- Обрабатывает ошибки валидации через Zod

## Безопасность

- Таблицы защищены Row Level Security (RLS)
- Пользователи видят только свои креативы
- Service role имеет полный доступ для обработки
- Access tokens не сохраняются в базе данных

## Мониторинг

Проверьте логи для отслеживания процесса обработки:

```bash
# В Docker
docker logs agent-service -f

# Локально
# Логи выводятся в stdout через Fastify logger
```

## Производительность

- Транскрипция выполняется асинхронно
- Три креатива создаются параллельно через `Promise.all()`
- Временные файлы удаляются сразу после использования
- Использование streaming для работы с большими файлами

## Troubleshooting

### FFmpeg не найден
```
Error: spawn ffmpeg ENOENT
```
**Решение:** Установите FFmpeg (см. раздел "Установка и запуск")

### Ошибка OpenAI API
```
Error: Invalid API key
```
**Решение:** Проверьте `OPENAI_API_KEY` в `.env.agent`

### Ошибка Facebook API
```
facebook_error: { code: 190, type: 'OAuthException' }
```
**Решение:** Проверьте срок действия `page_access_token`, он должен быть не истекшим

### Файл слишком большой
```
PayloadTooLargeError
```
**Решение:** Уменьшите размер видео или увеличьте лимит в коде

## Поддержка

Если у вас возникли вопросы или проблемы, создайте issue в репозитории.
