# Импорт креативов из Facebook Ads

Документация по функции импорта топ-креативов из рекламного кабинета Facebook с автоматической транскрибацией и маппингом на направления.

## Обзор

Функция позволяет:
1. **Получить превью** всех креативов с минимум 5 лидами за последние 90 дней
2. **Сгруппировать** дубликаты по `video_id` (одно видео = одна группа)
3. **Вручную объединить** группы если это идентичные видео с разными ID
4. **Привязать к направлениям** (бизнес-ниши пользователя)
5. **Импортировать** — скачать видео, транскрибировать, сохранить в базу

## Архитектура

### Backend
- **Файл**: `services/agent-service/src/routes/creativeAnalysis.ts`
- **Endpoints**:
  - `GET /analyze-top-creatives/preview` — получить список креативов
  - `POST /analyze-top-creatives/import` — импортировать выбранные
  - `GET /analyze-top-creatives/status` — проверить статус импорта

### Frontend
- **Компонент**: `services/frontend/src/components/CreativeAnalysisModal.tsx`
- **API**: `services/frontend/src/services/creativesApi.ts`

## Детали реализации

### 1. Preview (GET /analyze-top-creatives/preview)

**Параметры:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `user_id` | UUID | ID пользователя из `user_accounts` |
| `account_id` | UUID? | ID рекламного аккаунта (для multi-account режима) |

**Логика:**
1. Получаем credentials из БД (access_token, ad_account_id)
2. Запрашиваем все ads за 90 дней с creative info
3. Batch-запросом получаем insights (spend, leads) для каждого ad
4. Группируем по `video_id` (или `creative_id` для изображений)
5. Фильтруем: минимум 5 лидов
6. Сортируем по CPL (лучшие сверху)
7. Помечаем уже импортированные

**Группировка:**
```
video:12345 → [ad_1, ad_2, ad_3]  // Дубликаты одного видео
creative:67890 → [ad_4]            // Изображение
```

**Ответ:**
```json
{
  "success": true,
  "creatives": [
    {
      "ad_id": "23842614006130185",
      "ad_name": "Креатив (+2 ads)",
      "creative_id": "23842613887840185",
      "video_id": "1234567890",
      "thumbnail_url": "https://...",
      "spend": 150.50,
      "leads": 25,
      "cpl": 6.02,
      "cpl_cents": 602,
      "is_video": true,
      "preview_url": "https://adsmanager.facebook.com/...",
      "already_imported": false
    }
  ],
  "total_found": 15,
  "already_imported": 3
}
```

### 2. Import (POST /analyze-top-creatives/import)

**Тело запроса:**
```json
{
  "user_id": "uuid",
  "account_id": "uuid",
  "ad_ids": ["23842614006130185", "23842614006130186"],
  "direction_mappings": [
    {"ad_id": "23842614006130185", "direction_id": "uuid-direction-1"},
    {"ad_id": "23842614006130186", "direction_id": null}
  ]
}
```

**ВАЖНО:** Отправляем только primary `ad_id` для каждой группы!
- 1 группа = 1 видео = 1 скачивание
- Merged группы НЕ отправляются отдельно

**Процесс для каждого креатива:**
1. Проверка: не импортирован ли уже
2. Скачивание видео:
   - Сначала пробуем FB API (source URL)
   - Если нет — fallback через `yt-dlp`
3. Транскрибация через Whisper
4. Извлечение thumbnail из видео
5. Загрузка thumbnail в Supabase Storage
6. Сохранение в `user_creatives`
7. Сохранение транскрипта в `creative_transcripts`
8. Удаление временного видео файла

**Ответ:**
```json
{
  "success": true,
  "imported": 5,
  "results": [
    {"ad_id": "...", "ad_name": "...", "success": true, "creative_id": "uuid"},
    {"ad_id": "...", "ad_name": "...", "success": false, "error": "Already imported"}
  ],
  "message": "Импортировано 5 из 6 креативов"
}
```

## Скачивание видео

### Метод 1: Facebook API (source URL)
```
GET https://graph.facebook.com/v20.0/{video_id}?fields=source
```
- Требует разрешения на чтение видео
- Не всегда доступен (зависит от permissions токена)

### Метод 2: yt-dlp (fallback)
```bash
yt-dlp -f "best[ext=mp4]/best" -o "/var/tmp/video.mp4" "https://www.facebook.com/watch/?v={video_id}"
```

**Retry логика:**
- 3 попытки (`YTDLP_RETRY_ATTEMPTS`)
- 2 секунды между попытками (`YTDLP_RETRY_DELAY`)
- Таймаут: 5 минут (`VIDEO_DOWNLOAD_TIMEOUT`)

**Проверки:**
1. Наличие `yt-dlp` в системе (`which yt-dlp`)
2. Файл существует после скачивания
3. Размер файла > 0

## Константы

```typescript
const MIN_LEADS = 5;              // Минимум лидов для попадания в список
const MAX_IMPORT_LIMIT = 500;     // Макс. креативов за раз
const DATE_PRESET = 'last_90d';   // Период для анализа
const FB_API_TIMEOUT = 60000;     // 60 сек таймаут FB API
const VIDEO_DOWNLOAD_TIMEOUT = 300000;  // 5 мин на скачивание
const YTDLP_RETRY_ATTEMPTS = 3;   // Попытки yt-dlp
const YTDLP_RETRY_DELAY = 2000;   // Пауза между попытками
const EXEC_MAX_BUFFER = 10485760; // 10MB буфер для exec
```

## База данных

### user_creatives
| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | PK |
| user_id | UUID | FK → user_accounts |
| account_id | UUID? | FK → ad_accounts (multi-account) |
| direction_id | UUID? | FK → directions |
| title | TEXT | Название креатива |
| status | TEXT | 'ready' |
| source | TEXT | 'imported_analysis' |
| fb_ad_id | TEXT | ID рекламы в Facebook |
| fb_video_id | TEXT | ID видео в Facebook |
| imported_cpl_cents | INT | CPL в центах на момент импорта |
| imported_leads | INT | Лиды на момент импорта |
| thumbnail_url | TEXT | URL превью |
| media_type | TEXT | 'video' |

### creative_transcripts
| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | PK |
| creative_id | UUID | FK → user_creatives |
| lang | TEXT | 'ru' |
| source | TEXT | 'whisper' |
| text | TEXT | Текст транскрипции |
| duration_sec | INT | Длительность видео |
| status | TEXT | 'ready' |

## UI Flow

### Шаги в модальном окне:

1. **loading** — загрузка превью с FB
2. **preview** — выбор креативов + merge групп
3. **mapping** — привязка к направлениям
4. **importing** — процесс импорта
5. **results** — итоги

### Merge групп (ручное объединение)

Если пользователь видит что два креатива — это одно и то же видео (но с разными video_id):

1. Отмечает оба чекбоксом "Объединить"
2. Нажимает "Объединить выбранные"
3. Статистика суммируется (spend + leads)
4. CPL пересчитывается
5. При импорте скачивается только одно видео

```typescript
// State для merged групп
const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
const [mergedGroups, setMergedGroups] = useState<Map<string, Set<string>>>(new Map());
```

## Логирование

Каждый этап логируется с контекстом:

```json
{
  "videoId": "1234567890",
  "stage": "download_start",
  "videoPath": "/var/tmp/import_uuid.mp4"
}
```

**Stages:**
- `download_start` — начало процесса
- `fb_api_check` — проверка FB API
- `download_complete` — видео скачано
- `download_failed` — все методы не сработали
- `transcription_complete` — транскрибация завершена

**yt-dlp логи:**
- Путь к бинарнику
- Номер попытки
- stdout/stderr
- Размер файла
- Время скачивания

## Зависимости

### Docker (agent-service)
```dockerfile
RUN apt-get install -y ffmpeg python3 python3-pip \
    && pip3 install yt-dlp
```

### npm
- `@ffmpeg-installer/ffmpeg` — для транскрибации
- `openai` — Whisper API

## Troubleshooting

### Ошибка "yt-dlp binary not found"
```bash
docker exec agent-service-1 which yt-dlp
# Должно вернуть: /usr/local/bin/yt-dlp
```

### Ошибка "Failed to get video source URL"
- Проверить permissions токена
- Fallback на yt-dlp должен сработать

### Пустой файл после скачивания
- Видео может быть удалено из FB
- Проверить логи stderr от yt-dlp

### Timeout при скачивании
- Увеличить `VIDEO_DOWNLOAD_TIMEOUT`
- Проверить сетевое соединение контейнера

## Пример использования API

### curl: Preview
```bash
curl "http://localhost:8082/analyze-top-creatives/preview?user_id=UUID&account_id=UUID"
```

### curl: Import
```bash
curl -X POST "http://localhost:8082/analyze-top-creatives/import" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "uuid",
    "account_id": "uuid",
    "ad_ids": ["ad_id_1"],
    "direction_mappings": [
      {"ad_id": "ad_id_1", "direction_id": "direction_uuid"}
    ]
  }'
```

## Связанные файлы

- [creativeAnalysis.ts](../services/agent-service/src/routes/creativeAnalysis.ts) — backend
- [CreativeAnalysisModal.tsx](../services/frontend/src/components/CreativeAnalysisModal.tsx) — UI
- [creativesApi.ts](../services/frontend/src/services/creativesApi.ts) — frontend API
- [useDirections.ts](../services/frontend/src/hooks/useDirections.ts) — хук для направлений
- [transcription.ts](../services/agent-service/src/lib/transcription.ts) — транскрибация
