# Итоги: Сервис обработки видео и создания креативов

## 📋 Что было реализовано

### 1. Backend сервис (TypeScript/Fastify)

#### Создано 3 новых модуля:

**a) Facebook адаптер (`src/adapters/facebook.ts`)**
- `uploadVideo()` - загрузка видео в Facebook Ad Account
- `createWhatsAppCreative()` - создание WhatsApp CTWA креатива
- `createInstagramCreative()` - создание Instagram Traffic креатива  
- `createWebsiteLeadsCreative()` - создание Site Leads креатива

**b) Сервис транскрибации (`src/lib/transcription.ts`)**
- `extractAudioFromVideo()` - извлечение аудио через FFmpeg
- `transcribeAudio()` - транскрибация через OpenAI Whisper
- `processVideoTranscription()` - полный pipeline обработки

**c) Роут обработки видео (`src/routes/video.ts`)**
- `POST /process-video` - основной endpoint
- Валидация через Zod
- Multipart file upload
- Обработка ошибок
- Автоматическая очистка временных файлов

### 2. База данных

**Миграция (`migrations/002_video_creatives_tables.sql`)**
- Таблица `user_creatives` - хранение креативов
- Таблица `creative_transcripts` - хранение транскрипций
- RLS политики безопасности
- Автоматические триггеры updated_at
- Индексы для оптимизации

### 3. Инфраструктура

**Обновлен Dockerfile**
- Установка FFmpeg в Alpine образ
- Готов для production деплоя

**Обновлен package.json**
- `@fastify/multipart` - загрузка файлов
- `openai` - транскрибация
- `fluent-ffmpeg` - обработка видео
- `form-data` - отправка в Facebook

### 4. Документация

Создано 5 файлов документации:

1. **VIDEO_PROCESSING_API.md** - Полная документация API
   - Описание endpoints
   - Параметры запросов
   - Примеры использования
   - Структура БД
   - Troubleshooting

2. **VIDEO_QUICK_START.md** - Быстрый старт
   - Пошаговая установка
   - Настройка окружения
   - Быстрый тест
   - Решение проблем

3. **VIDEO_FRONTEND_INTEGRATION.md** - Интеграция с фронтендом
   - React/Next.js компонент
   - Vanilla JavaScript пример
   - Best practices
   - Обработка прогресса

4. **test-video-upload.sh** - Тестовый скрипт
   - Автоматическое тестирование API
   - Проверка health endpoint
   - Цветной вывод результатов

5. **README.md** - Обновлен главный README
   - Описание сервисов
   - Быстрый старт
   - Ссылки на документацию

## 🔄 Рабочий процесс (Workflow)

```
1. Фронтенд → POST /process-video (видео + метаданные)
           ↓
2. Сохранение видео во временный файл
           ↓
3. Извлечение аудио (FFmpeg)
           ↓
4. Транскрибация (OpenAI Whisper)
           ↓
5. Создание записи в user_creatives (status: processing)
           ↓
6. Загрузка видео в Facebook → получение video_id
           ↓
7. Параллельное создание 3 креативов:
   - WhatsApp CTWA
   - Instagram Traffic  
   - Website Leads
           ↓
8. Сохранение транскрипции в creative_transcripts
           ↓
9. Обновление записи креатива (status: ready, все ID)
           ↓
10. Возврат ответа с ID и транскрипцией
           ↓
11. Удаление временных файлов
```

## 📊 Структура данных

### Входные данные (POST /process-video)

```typescript
{
  video: File,                    // Видео файл (до 500 MB)
  user_id: UUID,                  // ID пользователя
  ad_account_id: string,          // act_XXXXXXXX
  page_id: string,                // Facebook Page ID
  instagram_id: string,           // Instagram Business Account ID
  instagram_username?: string,    // Instagram username
  page_access_token: string,      // Facebook API токен
  title?: string,                 // Название креатива
  description: string,            // Текст для креативов
  language?: string,              // Язык (по умолчанию 'ru')
  client_question?: string,       // Вопрос для WhatsApp
  site_url?: string,              // URL сайта
  utm?: string                    // UTM метки
}
```

### Выходные данные

```typescript
{
  success: true,
  message: "Video processed and creatives created successfully",
  data: {
    creative_id: UUID,                           // ID в БД
    fb_video_id: string,                        // Facebook video ID
    fb_creative_id_whatsapp: string,            // WhatsApp creative ID
    fb_creative_id_instagram_traffic: string,   // Instagram creative ID
    fb_creative_id_site_leads: string | null,   // Site Leads creative ID
    transcription: {
      text: string,                             // Транскрипция
      language: string,                         // Язык
      source: "whisper",                        // Источник
      duration_sec: number | null               // Длительность
    }
  }
}
```

## 🔐 Безопасность

- ✅ Row Level Security (RLS) на таблицах
- ✅ Пользователи видят только свои креативы
- ✅ Service role для обработки
- ✅ Валидация входных данных через Zod
- ✅ Автоматическая очистка временных файлов
- ✅ Appsecret proof для Facebook API

## 🚀 Возможности масштабирования

### Текущая реализация (синхронная)
- Простая и понятная
- Подходит для малого трафика
- Быстрая обработка коротких видео

### Будущие улучшения (рекомендации)

1. **Асинхронная обработка через очередь**
   ```
   Frontend → API (быстрый ответ с job_id)
                ↓
           Queue (Redis/Bull)
                ↓
           Worker (обработка видео)
                ↓
           Webhook/WebSocket (уведомление клиента)
   ```

2. **Chunked upload для больших файлов**
   - Разбивка файла на части
   - Возобновляемая загрузка
   - Лучший UX для медленных соединений

3. **CDN для хранения видео**
   - S3/GCS для постоянного хранения
   - CloudFront/Cloud CDN для раздачи
   - Уменьшение нагрузки на сервер

4. **Кэширование транскрипций**
   - Redis для частых запросов
   - Дедупликация похожих видео

5. **Мониторинг и метрики**
   - Prometheus для метрик
   - Grafana для визуализации
   - Sentry для ошибок

## 📈 Производительность

### Оптимизации реализованные:

- ✅ Параллельное создание креативов (`Promise.all`)
- ✅ Streaming для работы с файлами
- ✅ Автоматическое удаление временных файлов
- ✅ Оптимизированная конвертация аудио (16kHz mono)

### Ожидаемое время обработки:

- **Короткое видео (30 сек):** ~10-15 сек
- **Среднее видео (2 мин):** ~30-45 сек  
- **Длинное видео (5 мин):** ~60-90 сек

*Время зависит от размера файла, скорости интернета, нагрузки Facebook API и OpenAI API*

## 🧪 Тестирование

### Автоматическое тестирование

```bash
# Установка токена
export PAGE_ACCESS_TOKEN='ваш_токен'

# Запуск теста
./test-video-upload.sh ./test-video.mp4
```

### Ручное тестирование

```bash
curl -X POST http://localhost:8080/process-video \
  -F "video=@./video.mp4" \
  -F "user_id=..." \
  -F "ad_account_id=..." \
  # ... остальные параметры
```

## 💰 Стоимость использования

### OpenAI Whisper API
- $0.006 / минута аудио
- Пример: видео 2 мин = $0.012

### Facebook API
- Бесплатно для создания креативов
- Rate limits зависят от аккаунта

### Инфраструктура
- Compute: зависит от провайдера
- Storage: временные файлы удаляются
- Bandwidth: ~размер видео × 2 (загрузка + выгрузка)

## 📝 Чеклист для production

- [ ] Настроить переменные окружения
- [ ] Применить миграции БД
- [ ] Установить FFmpeg в Docker
- [ ] Настроить CORS если нужно
- [ ] Настроить лимиты размера файлов
- [ ] Настроить мониторинг и логирование
- [ ] Настроить backup БД
- [ ] Протестировать на реальных данных
- [ ] Настроить CI/CD pipeline
- [ ] Документировать процесс деплоя

## 🎯 Следующие шаги

1. **Интеграция с фронтендом**
   - Использовать примеры из VIDEO_FRONTEND_INTEGRATION.md
   - Добавить UI компонент загрузки

2. **Тестирование**
   - Протестировать с реальными Facebook аккаунтами
   - Проверить разные форматы видео
   - Нагрузочное тестирование

3. **Мониторинг**
   - Настроить алерты на ошибки
   - Отслеживать время обработки
   - Мониторить использование API квот

4. **Оптимизация**
   - Добавить очередь для async обработки
   - Внедрить chunk upload
   - Настроить CDN

5. **Документация**
   - Создать видео-туториал
   - Написать API reference в Postman
   - Добавить Swagger/OpenAPI спецификацию

## 🤝 Поддержка

Если возникли вопросы:
1. Проверьте документацию
2. Запустите тестовый скрипт
3. Проверьте логи сервиса
4. Создайте issue в репозитории

---

**Дата создания:** 5 октября 2025  
**Версия:** 1.0.0  
**Статус:** ✅ Ready for testing
