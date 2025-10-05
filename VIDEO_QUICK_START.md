# Быстрый старт: Сервис обработки видео

## 🚀 Краткая установка

### 1. Установите зависимости

```bash
cd services/agent-service
npm install
```

### 2. Настройте переменные окружения

Создайте файл `.env.agent` в корне проекта:

```bash
# OpenAI для транскрипции
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

### 3. Установите FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install -y ffmpeg
```

### 4. Примените миграцию БД

Выполните SQL из файла `migrations/002_video_creatives_tables.sql` в вашей Supabase консоли.

### 5. Запустите сервис

**Разработка:**
```bash
npm run dev
```

**Production (Docker):**
```bash
docker-compose up --build agent-service
```

## 📝 Быстрый тест

### Тест с помощью cURL

```bash
curl -X POST http://localhost:8080/process-video \
  -F "video=@./test-video.mp4" \
  -F "user_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "ad_account_id=act_123456789" \
  -F "page_id=987654321" \
  -F "instagram_id=17841400000000000" \
  -F "instagram_username=mycompany" \
  -F "page_access_token=EAAxxxxxxxxxxxxx" \
  -F "title=Test Video" \
  -F "description=Тестовое описание креатива" \
  -F "language=ru" \
  -F "site_url=https://example.com"
```

### Проверка health endpoint

```bash
curl http://localhost:8080/health
# Ответ: {"ok":true}
```

## 📊 Что происходит после загрузки?

1. ✅ Видео сохраняется временно
2. 🎵 Извлекается аудио (FFmpeg)
3. 📝 Транскрибируется через OpenAI Whisper
4. 💾 Создается запись в `user_creatives`
5. ⬆️ Видео загружается в Facebook
6. 🎨 Создаются 3 креатива:
   - WhatsApp (CTWA)
   - Instagram Traffic
   - Website Leads
7. 💾 Сохраняется транскрипция
8. ✅ Возвращается ответ с ID всех креативов

## 🔍 Просмотр данных

### Проверка созданных креативов

```sql
-- В Supabase SQL Editor
SELECT * FROM user_creatives 
WHERE user_id = '123e4567-e89b-12d3-a456-426614174000'
ORDER BY created_at DESC;
```

### Проверка транскрипций

```sql
SELECT ct.*, uc.title
FROM creative_transcripts ct
JOIN user_creatives uc ON ct.creative_id = uc.id
WHERE uc.user_id = '123e4567-e89b-12d3-a456-426614174000'
ORDER BY ct.created_at DESC;
```

## 🐛 Решение проблем

### FFmpeg не найден
```
Error: spawn ffmpeg ENOENT
```
➡️ Установите FFmpeg (см. шаг 3)

### Ошибка OpenAI
```
Error: Invalid API key
```
➡️ Проверьте `OPENAI_API_KEY` в `.env.agent`

### Ошибка Facebook
```
facebook_error: { code: 190 }
```
➡️ Проверьте `page_access_token` (срок действия не истек?)

### Файл слишком большой
```
PayloadTooLargeError
```
➡️ Лимит: 500 MB. Уменьшите размер видео

## 📖 Подробная документация

См. [VIDEO_PROCESSING_API.md](./VIDEO_PROCESSING_API.md) для:
- Полного описания API
- Примеров кода
- Структуры БД
- Обработки ошибок
- Настройки безопасности

## 🎯 Следующие шаги

1. Интегрируйте эндпоинт в ваш фронтенд
2. Настройте обработку ошибок
3. Добавьте прогресс-бар для длинных видео
4. Настройте webhook уведомления после обработки
5. Добавьте очередь для обработки множественных видео
