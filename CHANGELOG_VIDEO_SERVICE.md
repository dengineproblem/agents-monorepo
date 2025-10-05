# Changelog: Video Processing Service

## [1.0.0] - 2025-10-05

### ✨ Добавлено

#### Backend (agent-service)

- **Новый эндпоинт `POST /process-video`** для обработки видео и создания креативов
- **Facebook адаптер** с методами:
  - `uploadVideo()` - загрузка видео в Facebook Ad Account
  - `createWhatsAppCreative()` - создание WhatsApp CTWA креатива
  - `createInstagramCreative()` - создание Instagram Traffic креатива
  - `createWebsiteLeadsCreative()` - создание Site Leads креатива
  
- **Сервис транскрибации** (`src/lib/transcription.ts`):
  - Извлечение аудио из видео через FFmpeg
  - Транскрибация аудио через OpenAI Whisper API
  - Автоматическая очистка временных файлов

- **Multipart file upload** с поддержкой до 500 MB
- **Валидация входных данных** через Zod
- **Обработка ошибок** с детальной информацией

#### База данных

- **Миграция `002_video_creatives_tables.sql`**:
  - Таблица `user_creatives` - хранение информации о креативах
  - Таблица `creative_transcripts` - хранение транскрипций
  - RLS политики для безопасности
  - Автоматические триггеры `updated_at`
  - Индексы для оптимизации запросов

#### Инфраструктура

- **Обновлен Dockerfile** с установкой FFmpeg
- **Добавлены зависимости**:
  - `@fastify/multipart` ^8.3.0 - загрузка файлов
  - `openai` ^4.67.3 - транскрибация
  - `fluent-ffmpeg` ^2.1.3 - обработка видео
  - `form-data` ^4.0.0 - отправка в Facebook
  - `@types/fluent-ffmpeg` ^2.1.27

#### Документация

- **VIDEO_PROCESSING_API.md** - полная документация API
- **VIDEO_QUICK_START.md** - быстрый старт и установка
- **VIDEO_FRONTEND_INTEGRATION.md** - примеры интеграции с фронтендом
- **VIDEO_SERVICE_SUMMARY.md** - итоговое описание сервиса
- **test-video-upload.sh** - тестовый скрипт для проверки API
- **Обновлен README.md** - добавлено описание нового функционала

### 🔧 Изменено

- Расширен Facebook адаптер (`src/adapters/facebook.ts`)
- Обновлен сервер для регистрации нового роута (`src/server.ts`)
- Исправлены типы в `src/routes/actions.ts` для совместимости

### 🚀 Возможности

**Полный pipeline обработки видео:**
1. Прием видео через webhook
2. Извлечение и транскрибация аудио
3. Загрузка видео в Facebook
4. Параллельное создание 3 типов креативов:
   - WhatsApp Click-to-WhatsApp
   - Instagram Profile Traffic
   - Website Lead Generation
5. Сохранение всех данных в БД
6. Возврат ID всех созданных ресурсов

### 📊 Технические детали

**Производительность:**
- Параллельное создание креативов через `Promise.all()`
- Оптимизированная конвертация аудио (16kHz mono WAV)
- Автоматическая очистка временных файлов

**Безопасность:**
- Row Level Security (RLS) на таблицах
- Валидация всех входных данных
- Appsecret proof для Facebook API
- Изоляция данных пользователей

**Масштабируемость:**
- Streaming обработка файлов
- Готовность к асинхронной очереди
- Поддержка больших файлов (до 500 MB)

### 📝 Примеры использования

**cURL:**
```bash
curl -X POST http://localhost:8080/process-video \
  -F "video=@video.mp4" \
  -F "user_id=..." \
  -F "ad_account_id=act_..." \
  -F "page_access_token=..." \
  # ... остальные параметры
```

**JavaScript/Fetch:**
```javascript
const formData = new FormData();
formData.append('video', videoFile);
// ... добавить остальные поля

const response = await fetch('/process-video', {
  method: 'POST',
  body: formData
});
```

### 🧪 Тестирование

```bash
# Установить токен
export PAGE_ACCESS_TOKEN='ваш_токен'

# Запустить тест
./test-video-upload.sh ./test-video.mp4
```

### 📦 Зависимости

**Production:**
- Node.js 20+
- FFmpeg (для обработки видео)
- PostgreSQL (Supabase)
- OpenAI API ключ
- Facebook API токены

### 🔗 Связанные документы

- [VIDEO_PROCESSING_API.md](./VIDEO_PROCESSING_API.md) - API Reference
- [VIDEO_QUICK_START.md](./VIDEO_QUICK_START.md) - Quick Start Guide  
- [VIDEO_FRONTEND_INTEGRATION.md](./VIDEO_FRONTEND_INTEGRATION.md) - Frontend Examples
- [VIDEO_SERVICE_SUMMARY.md](./VIDEO_SERVICE_SUMMARY.md) - Service Overview

### 📌 Migration Notes

**Для обновления существующей установки:**

1. Установить новые зависимости:
   ```bash
   cd services/agent-service
   npm install
   ```

2. Применить миграцию БД:
   ```sql
   -- Выполнить в Supabase
   migrations/002_video_creatives_tables.sql
   ```

3. Добавить переменные окружения:
   ```bash
   OPENAI_API_KEY=sk-...
   ```

4. Пересобрать Docker образ (если используется):
   ```bash
   docker-compose up -d --build agent-service
   ```

### 🐛 Известные ограничения

- Максимальный размер видео: 500 MB
- Синхронная обработка (для больших нагрузок рекомендуется очередь)
- Whisper API лимит: 25 MB после конвертации в WAV

### 🎯 Roadmap

**Будущие улучшения:**
- [ ] Асинхронная обработка через очередь (Redis/Bull)
- [ ] Chunked upload для файлов > 100 MB
- [ ] Webhooks для уведомлений о завершении
- [ ] Поддержка batch обработки
- [ ] Dashboard для мониторинга
- [ ] Автоматическая генерация субтитров
- [ ] Поддержка других платформ (TikTok, YouTube)

---

**Автор:** AI Assistant  
**Дата:** 5 октября 2025  
**Версия:** 1.0.0  
**Статус:** ✅ Production Ready
