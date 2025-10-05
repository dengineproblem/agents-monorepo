# Agents Monorepo

Монорепозиторий для агентских сервисов автоматизации Facebook Ads.

## Сервисы

### 🧠 agent-brain
Сервис для оценки эффективности рекламных кампаний (scoring).

**Запуск:**
```bash
docker compose up -d --build agent-brain
```

### 🎬 agent-service
Основной сервис для работы с Facebook Ads и обработки видео креативов.

**Функциональность:**
- Управление рекламными кампаниями (pause/resume/duplicate)
- **Обработка видео и создание креативов:**
  - Прием видео через webhook
  - Транскрибация аудио (OpenAI Whisper)
  - Загрузка в Facebook
  - Автоматическое создание 3 типов креативов:
    - WhatsApp (Click to WhatsApp)
    - Instagram Traffic
    - Website Leads

**Запуск:**
```bash
docker compose up -d --build agent-service
```

## Быстрый старт

### 1. Клонируйте репозиторий
```bash
git clone <repo-url>
cd agents-monorepo
```

### 2. Настройте окружение
Создайте `.env.agent` в корне проекта (см. `env.brain.example`).

### 3. Примените миграции БД
```bash
# В Supabase Dashboard выполните:
migrations/001_scoring_agent_tables.sql
migrations/002_video_creatives_tables.sql
```

### 4. Запустите сервисы
```bash
docker compose up -d --build
```

### 5. Проверьте работу
```bash
# agent-brain
curl http://localhost:8081/health

# agent-service
curl http://localhost:8080/health
```

## Документация

- **Обработка видео:** [VIDEO_PROCESSING_API.md](./VIDEO_PROCESSING_API.md) - Полная документация API
- **Быстрый старт видео:** [VIDEO_QUICK_START.md](./VIDEO_QUICK_START.md) - Краткий гайд
- **Тестирование создания кампаний:** [TEST_CREATE_CAMPAIGN.md](./TEST_CREATE_CAMPAIGN.md)
- **Scoring агент:** [SCORING_QUICK_START.md](./SCORING_QUICK_START.md)

## Тестирование

### Тест обработки видео
```bash
export PAGE_ACCESS_TOKEN='ваш_токен'
./test-video-upload.sh ./path/to/video.mp4
```

### Тест создания кампаний
```bash
./test-create-campaign.sh
```

## Требования

- Docker & Docker Compose
- Node.js 20+ (для локальной разработки)
- FFmpeg (для обработки видео)
- PostgreSQL (Supabase)
- OpenAI API ключ (для транскрибации)
- Facebook API токены

## Структура проекта

```
agents-monorepo/
├── services/
│   ├── agent-brain/         # Scoring сервис
│   └── agent-service/       # Основной сервис
├── migrations/              # SQL миграции
├── test-*.sh               # Тестовые скрипты
└── *.md                    # Документация
```

## Переменные окружения

Основные переменные в `.env.agent`:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Facebook
FB_API_VERSION=v20.0
FB_APP_SECRET=...

# Supabase
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE=...

# Ports
PORT=8080  # agent-service
PORT=8081  # agent-brain
```

## Разработка

### agent-service
```bash
cd services/agent-service
npm install
npm run dev
```

### agent-brain
```bash
cd services/agent-brain
npm install
npm run dev
```

## Лицензия

Private
