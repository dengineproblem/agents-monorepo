# Справочник платформы Performante — для OpenClaw

## 1. Обзор платформы

**Performante AI Agency** — SaaS-платформа для автоматизации маркетинга и продаж малого-среднего бизнеса в Казахстане и СНГ.

**Что делает:**
- Автоматическое управление рекламой в Facebook/Instagram/TikTok (AI-оптимизация бюджетов, скоринг креативов, A/B тесты)
- CRM для WhatsApp лидов (воронка, консультанты, запись на консультации)
- AI-чатбот для автоматического ответа в WhatsApp (квалификация лидов, запись на консультацию)
- Генерация рекламных креативов (изображения, тексты, карусели)
- Мониторинг конкурентов через Meta Ads Library
- Аналитика: ROI, CPL, воронка продаж

**Для кого:** владельцы бизнеса, маркетологи, агентства — кому нужен AI-таргетолог + AI-менеджер по продажам.

**Продукты:**
- AI-таргетолог: 49,000 тенге/мес — автоматическое ведение рекламы
- Цифровой менеджер: AI-бот для обработки WhatsApp лидов
- Полное ведение: от 350,000 тенге/мес — маркетолог + AI

### Архитектура

Docker Compose монорепо с микросервисами, единая БД (Supabase/PostgreSQL).

```
Интернет (HTTPS)
    ↓
Docker Nginx (:80/:443)
    ├─ app.performanteaiagency.com → frontend:80 (Production React)
    ├─ performanteaiagency.com → frontend-appreview:80 (App Review)
    ├─ n8n.performanteaiagency.com → n8n:5678 (Workflows)
    └─ */api/* → agent-service:8082 (Backend API)
         ├─ /api/crm/* → crm-backend:8084
         ├─ /api/chatbot/* → chatbot-service:8083
         └─ /api/analyzer/* → creative-analyzer:7081
```

**Сервисы и порты:**

| Сервис | Порт | Назначение |
|--------|------|-----------|
| agent-service | 8082 | Основной бэкенд, вебхуки, API для фронтенда |
| chatbot-service | 8083 | WhatsApp AI бот, кампании рассылок |
| crm-backend | 8084 | CRM, консультанты, расписание, звонки |
| agent-brain | 7080 | AI-мозг: скоринг рекламы, Health Score, оптимизация |
| creative-generation-service | 7082 | Генерация креативов (Gemini, GPT) |
| creative-analyzer | 7081 | Анализ тестов креативов |
| Evolution API | 8080 | WhatsApp Business API |

**Авторизация для API вызовов:**
- Заголовок: `x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d` (OpenClaw admin user)
- Все вызовы через localhost (сервисы в одной Docker сети)

**Важно о маршрутизации:**
- Nginx снимает `/api` перед маршрутизацией к сервисам
- Внутри Docker сети вызываем БЕЗ `/api`: `http://agent-service:8082/leads`
- Снаружи (через nginx): `https://app.performanteaiagency.com/api/leads`
- Для CRM: nginx снимает `/api/crm`, backend получает `/dialogs/stats`
- Для chatbot: nginx снимает `/api/chatbot`, backend получает `/chatbot/status`

---

## 2. Сервисы — детальное описание

### 2.1 agent-service (порт 8082) — Основной бэкенд

Центральный API-сервер платформы. Обрабатывает все запросы от фронтенда, принимает вебхуки от Facebook/TikTok/Evolution/AmoCRM, управляет лидами, кампаниями, креативами.

**Базовый URL:** `http://agent-service:8082` (из Docker) или `http://localhost:8082` (с хоста)

#### Аутентификация

```bash
POST /auth/login
Content-Type: application/json
{"username": "...", "password": "..."}
# Ответ: { token, user }
```

#### Лиды

```bash
# Получить список лидов
GET /leads?userAccountId={UUID}&accountId={UUID}&limit=50&offset=0
-H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d"

# Создать лид (из Tilda вебхука)
POST /leads
{"userAccountId": "UUID", "accountId": "UUID", "name": "Имя", "phone": "+77001234567", "utm_source": "facebook", "ad_id": "123456"}

# Получить конкретный лид
GET /leads/{id}?userAccountId={UUID}
```

#### Действия с рекламой (dispatch)

```bash
# Выполнить действия (пауза, бюджет, запуск)
POST /agent/actions
Content-Type: application/json
{
  "account": "act_xxx",
  "actions": [
    {"type": "updateBudget", "adSetId": "123", "dailyBudget": 2000},
    {"type": "pauseAdSet", "adSetId": "456"},
    {"type": "enableAdSet", "adSetId": "789"}
  ],
  "idempotencyKey": "unique-key",
  "source": "openclaw"
}
```

#### Видео и креативы

```bash
# Загрузить и обработать видео
POST /process-video
multipart/form-data: video, userAccountId, title, directionId

# Загрузить и обработать изображение
POST /process-image
multipart/form-data: image, userAccountId, title

# Перетранскрибировать видео
POST /re-transcribe
{"creativeId": "UUID"}
```

#### Направления (Directions)

```bash
# Список направлений
GET /directions?userAccountId={UUID}

# Создать направление
POST /directions
{"userAccountId": "UUID", "name": "Алматы WhatsApp", "objective": "whatsapp", "daily_budget_cents": 5000, "target_cpl_cents": 300}

# Обновить направление
PUT /directions/{id}
{"daily_budget_cents": 7000, "is_active": true}
```

#### Facebook интеграция

```bash
# OAuth token exchange
POST /facebook/oauth/token
{"code": "...", "redirectUri": "..."}

# Сохранить выбор аккаунта
POST /facebook/save-selection
{"userAccountId": "UUID", "adAccountId": "act_xxx", "pageId": "xxx", "instagramId": "xxx"}

# Проверить credentials
POST /facebook/validate
{"userAccountId": "UUID"}
```

#### TikTok интеграция

```bash
# OAuth callback
POST /tiktok/oauth/callback
{"code": "...", "userAccountId": "UUID"}

# Получить instant pages
GET /tiktok/instant-pages?userAccountId={UUID}&advertiser_id={id}
```

#### AmoCRM интеграция

```bash
# Получить воронки
GET /amocrm/pipelines?userAccountId={UUID}

# Синхронизировать лиды
POST /amocrm/sync-leads
{"userAccountId": "UUID", "accountId": "UUID"}

# Статистика квалификации
GET /amocrm/qualification-stats?userAccountId={UUID}
```

#### Конкуренты

```bash
# Список конкурентов
GET /competitors?userAccountId={UUID}&accountId={UUID}

# Добавить конкурента
POST /competitors
{"userAccountId": "UUID", "accountId": "UUID", "fbPageUrl": "https://facebook.com/page"}

# Обновить креативы конкурента
POST /competitors/{competitorId}/refresh

# ТОП-10 креативов
GET /competitors/{competitorId}/creatives?userAccountId={UUID}

# Извлечь текст из креатива (OCR/транскрипция)
POST /competitors/extract-text
{"creativeId": "UUID"}
```

#### Аналитика

```bash
# Отправить события (батч)
POST /analytics/events
{"events": [...], "userAccountId": "UUID"}

# Статистика пользователей (admin)
GET /analytics/users

# CAPI статистика
GET /analytics/capi-stats?userAccountId={UUID}
```

#### WhatsApp номера

```bash
# Список номеров
GET /whatsapp-numbers?userAccountId={UUID}

# Добавить номер
POST /whatsapp-numbers
{"userAccountId": "UUID", "phone_number": "+77001234567", "label": "Алматы"}

# Сбросить подключение
POST /whatsapp-numbers/{id}/reset-connection
```

#### Уведомления

```bash
# Список уведомлений
GET /notifications?userAccountId={UUID}

# Непрочитанные
GET /notifications/unread-count?userAccountId={UUID}

# Прочитать все
POST /notifications/mark-all-read
{"userAccountId": "UUID"}
```

#### Brain Proposals (предложения AI)

```bash
# Ожидающие предложения
GET /brain-proposals/pending?userAccountId={UUID}

# Одобрить предложение
POST /brain-proposals/{id}/approve

# Отклонить
POST /brain-proposals/{id}/reject
```

#### Admin роуты (требуют is_tech_admin=true)

```bash
# Список пользователей
GET /admin/users

# Поиск пользователей
GET /admin/users/search?q=performante

# Информация о пользователе
GET /admin/users/{userId}

# Обновить пользователя
PUT /admin/users/{userId}
{"is_active": true, "onboarding_stage": "active"}

# Ошибки
GET /admin/errors
GET /admin/errors/unresolved-count
POST /admin/errors/{id}/resolve

# Чат с пользователями
GET /admin/chats/{userId}
POST /admin/chats/{userId}
{"message": "Текст"}
```

#### Campaign Builder

```bash
# Маршруты с префиксом /campaign-builder
POST /campaign-builder/launch
{
  "userAccountId": "UUID",
  "accountId": "UUID",
  "directionId": "UUID",
  "creativeIds": ["UUID1", "UUID2"],
  "dailyBudget": 5000
}
```

#### Диалоги (те же что в CRM, но через agent-service)

```bash
POST /dialogs/analyze
{"instanceName": "...", "userAccountId": "UUID"}

GET /dialogs/analysis?userAccountId={UUID}&interestLevel=hot
GET /dialogs/stats?userAccountId={UUID}
GET /dialogs/export-csv?userAccountId={UUID}
```

---

### 2.2 agent-brain (порт 7080) — AI-мозг оптимизации рекламы

AI-движок для анализа и оптимизации рекламных кампаний. Считает Health Score, определяет ad-eater'ов, принимает решения по бюджетам.

**Базовый URL:** `http://agent-brain:7080` (из Docker)

**ВАЖНО:** agent-brain использует свой префикс `/api/` — это НЕ nginx, а встроенный в сервис.

#### Основные endpoints

```bash
# Запустить оптимизацию Facebook рекламы для пользователя
POST /api/brain/run
{"userAccountId": "UUID"}

# Запустить оптимизацию TikTok
POST /api/brain/run-tiktok
{"userAccountId": "UUID"}

# Принять решение (decision engine)
POST /api/brain/decide
{"userAccountId": "UUID", "data": {...}}

# Тест скоринга (без действий)
POST /api/brain/test-scoring
{"userAccountId": "UUID"}

# Тест Health Score + Scoring merged
POST /api/brain/test-merger
{"userAccountId": "UUID"}

# Сохранить метрики в БД
POST /api/brain/test-save-metrics
{"userAccountId": "UUID"}

# Health check
GET /api/brain/llm-ping
```

#### Крон-задачи

```bash
# Проверить расписание пользователей
GET /api/brain/cron/check-schedule

# Запустить батчевый скоринг
POST /api/brain/cron/run-batch

# Отчёт о батче
GET /api/brain/cron/batch-report

# Обновить курсы валют
POST /api/brain/cron/update-currency
```

#### Анализ креативов

```bash
# Проанализировать тест креатива
POST /api/analyzer/analyze-creative
{"creativeTestId": "UUID"}
```

#### Контекст и лимиты

```bash
# Получить контекст пользователя (аккаунты, настройки)
GET /api/context?userAccountId={UUID}

# Проверить лимиты
GET /api/limits/check?telegramId={id}

# Записать использование
POST /api/limits/track
{"telegramId": "...", "tokens": 1500, "cost": 0.03}
```

#### Онбординг

```bash
# Создать пользователя
POST /api/onboarding/create-user
{"username": "...", "email": "...", "phone": "..."}

# Регенерировать промпты
POST /api/onboarding/regenerate-prompts
{"userAccountId": "UUID"}
```

---

### 2.3 chatbot-service (порт 8083) — AI WhatsApp бот

Управляет AI-ботами в WhatsApp: обрабатывает входящие сообщения, отвечает через GPT/Claude, ведёт follow-up, запускает кампании рассылок.

**Базовый URL:** `http://chatbot-service:8083` (из Docker)

#### Управление ботом

```bash
# Поставить бота на паузу (оператор берёт разговор)
POST /chatbot/pause
{"leadId": "UUID", "instanceName": "..."}

# Вернуть бота
POST /chatbot/resume
{"leadId": "UUID", "instanceName": "..."}

# Оператор перехватывает разговор
POST /chatbot/take-over
{"leadId": "UUID", "instanceName": "..."}

# Вернуть управление боту
POST /chatbot/return-to-bot
{"leadId": "UUID", "instanceName": "..."}

# Отправить follow-up сообщение
POST /chatbot/send-follow-up
{"leadId": "UUID", "instanceName": "...", "message": "Текст"}

# Статус бота для лида
GET /chatbot/status/{leadId}
```

#### Конфигурация бота

```bash
# Получить конфигурацию
GET /chatbot/configuration/{userAccountId}

# Обновить конфигурацию (промпт, модель, расписание)
PUT /chatbot/configuration/{configId}
{
  "system_prompt": "Новый промпт...",
  "model": "gpt-4o",
  "temperature": 0.24,
  "schedule_enabled": true,
  "schedule_hours_start": 9,
  "schedule_hours_end": 18
}

# Загрузить документ для RAG
POST /chatbot/documents/upload
multipart/form-data: file, userAccountId, configId

# Регенерировать промпт из документов
POST /chatbot/regenerate-prompt
{"configId": "UUID"}
```

#### Кампании рассылок

```bash
# Сгенерировать очередь сообщений
POST /campaign/generate-queue
{"userAccountId": "UUID", "instanceName": "...", "strategy": "reactivation"}

# Очистить очередь
POST /campaign/clear-queue
{"userAccountId": "UUID"}

# Очередь на сегодня
GET /campaign/today-queue?userAccountId={UUID}

# Статистика кампании
GET /campaign/stats?userAccountId={UUID}

# Превью очереди
GET /campaign/preview-queue?userAccountId={UUID}

# Статус очереди
GET /campaign/queue-status?userAccountId={UUID}
```

#### Аналитика кампаний

```bash
GET /campaign/analytics/overview?userAccountId={UUID}
GET /campaign/analytics/by-strategy?userAccountId={UUID}
GET /campaign/analytics/by-temperature?userAccountId={UUID}
GET /campaign/analytics/temperature-dynamics?userAccountId={UUID}
GET /campaign/analytics/by-stage?userAccountId={UUID}
```

#### Реактивация

```bash
# Статус реактивации
GET /chatbot/reactivation/status?userAccountId={UUID}

# Запустить реактивацию
POST /chatbot/reactivation/start
{"userAccountId": "UUID", "instanceName": "...", "prompt": "..."}

# Очередь реактивации
GET /chatbot/reactivation/queue?userAccountId={UUID}

# Отменить
DELETE /chatbot/reactivation/cancel?userAccountId={UUID}
```

#### CAPI (Conversions API)

```bash
# Переотправить CAPI события
POST /capi/resend
{"userAccountId": "UUID"}

# Отправить CRM событие в CAPI
POST /capi/crm-event
{"leadId": "UUID", "eventName": "Lead", "data": {...}}

# Отправить interest-level событие
POST /capi/interest-event
{"leadId": "UUID", "level": "hot"}
```

#### Обработка сообщений (внутренний)

```bash
# Обработать сообщение (вызывается agent-service при получении WhatsApp)
POST /process-message
{"instanceName": "...", "remoteJid": "77001234567@s.whatsapp.net", "message": "Текст", "pushName": "Имя"}
```

---

### 2.4 crm-backend (порт 8084) — CRM система

Управление консультантами, лидами, записями на консультации, расписанием, звонками. Отдельная система для работы отдела продаж.

**Базовый URL:** `http://crm-backend:8084` (из Docker)

#### Консультанты

```bash
# Список консультантов (admin)
GET /admin/consultant-management?userAccountId={UUID}
-H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d"

# Добавить консультанта
POST /admin/consultant-management
{"userAccountId": "UUID", "name": "Маша", "email": "masha@test.com", "specialization": "Медицина"}
```

#### Дашборд консультанта

```bash
# Дашборд (требует авторизацию консультанта)
GET /consultant/dashboard
-H "Authorization: Bearer {token}"

# Лиды консультанта
GET /consultant/leads
-H "Authorization: Bearer {token}"

# Обновить заметки по лиду
PATCH /consultant/leads/{leadId}/notes
{"notes": "Перезвонить завтра"}

# Цели (targets)
GET /consultant/targets

# Консультации
GET /consultant/consultations

# Расписание
GET /consultant/schedule
PUT /consultant/schedule
{"schedules": [{"day_of_week": 1, "start_time": "09:00", "end_time": "18:00", "is_active": true}]}
```

#### Задачи консультанта

```bash
GET /consultant/tasks
POST /consultant/tasks
{"title": "Перезвонить клиенту", "due_date": "2026-02-21"}
PUT /consultant/tasks/{taskId}
{"status": "completed"}
DELETE /consultant/tasks/{taskId}
```

#### Записи звонков

```bash
# Загрузить запись
POST /consultant/call-recordings/upload
multipart/form-data: audio, consultantId, leadId, title

# Список записей
GET /consultant/call-recordings?consultantId={UUID}

# Ожидающие анализа (для OpenClaw крона)
GET /admin/call-recordings/pending-analysis
-H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d"

# Сохранить анализ
PATCH /admin/call-recordings/{id}/analysis
{"consultation_summary": {...}, "consultant_review": {...}}
```

#### Диалоги и чаты WhatsApp

```bash
# Список чатов
GET /chats?instanceName={name}&userAccountId={UUID}

# Сообщения чата
GET /chats/{remoteJid}/messages?instanceName={name}

# Отправить сообщение
POST /chats/{remoteJid}/send
{"instanceName": "...", "message": "Текст"}

# Переключить бота
PATCH /chats/{remoteJid}/toggle-bot
{"instanceName": "...", "enabled": true}
```

#### Настройки кампаний

```bash
GET /campaign-settings/{userId}
PUT /campaign-settings/{userId}
{"daily_limit": 50, "work_hours_start": 9, "work_hours_end": 18}
```

#### Публичное бронирование

```bash
# Конфигурация виджета бронирования
GET /public/booking/{userAccountId}/config

# Доступные слоты
GET /public/booking/{userAccountId}/slots?date=2026-02-21

# Создать бронирование
POST /public/booking
{"userAccountId": "UUID", "consultantId": "UUID", "date": "2026-02-21", "startTime": "10:00", "clientPhone": "+77001234567"}
```

#### AI Bot конфигурации

```bash
# Список ботов
GET /ai-bot-configurations?userAccountId={UUID}

# Создать бота
POST /ai-bot-configurations
{"userAccountId": "UUID", "name": "WhatsApp бот", "system_prompt": "..."}

# Обновить бота
PUT /ai-bot-configurations/{id}
{"system_prompt": "Новый промпт", "temperature": 0.3, "model": "gpt-4o"}
```

#### Подписки и биллинг

```bash
# Доступные продукты
GET /subscription/products

# История продаж
GET /subscription/sales?userAccountId={UUID}

# Активные подписки (admin)
GET /admin/subscriptions/active-users
```

---

### 2.5 creative-generation-service (порт 7082) — Генерация креативов

Сервис для AI-генерации рекламных креативов: изображения (Gemini), тексты (GPT-5), карусели.

**Базовый URL:** `http://creative-generation-service:7082` (из Docker)

#### Генерация текстов

```bash
# Генерация оффера
POST /generate-offer
{"userAccountId": "UUID", "niche": "Стоматология", "service": "Имплантация"}

# Генерация буллетов
POST /generate-bullets
{"userAccountId": "UUID", "niche": "Стоматология", "service": "Виниры"}

# Генерация CTA
POST /generate-cta
{"userAccountId": "UUID", "text": "Основной текст рекламы"}
```

#### Текстовые креативы

```bash
# Генерация полного текстового креатива
POST /generate-text-creative
{
  "userAccountId": "UUID",
  "text_type": "storytelling",  # storytelling | direct_offer | expert_video | telegram_post | threads_post | reference
  "niche": "Стоматология",
  "service": "Имплантация",
  "prompt": "Дополнительные вводные"  # для reference — исходный текст конкурента
}

# Редактирование сгенерированного текста
POST /edit-text-creative
{"creativeId": "UUID", "instruction": "Сделай короче, добавь цену"}
```

#### Генерация изображений

```bash
# Генерация рекламного изображения
POST /generate-creative
{"userAccountId": "UUID", "prompt": "Описание", "style": "modern", "size": "1080x1080"}

# Апскейл до 4K
POST /upscale-to-4k
{"imageUrl": "https://..."}
```

#### Карусели

```bash
# Генерация текстов для карусели
POST /generate-carousel-texts
{"userAccountId": "UUID", "niche": "...", "slides": 5}

# Генерация карусели (изображения)
POST /generate-carousel
{"userAccountId": "UUID", "texts": [...], "style": "..."}

# Регенерация одного слайда
POST /regenerate-carousel-card
{"carouselId": "UUID", "cardIndex": 2, "instruction": "Другой стиль"}
```

#### Галерея и история

```bash
# Галерея изображений
GET /gallery/creatives?userAccountId={UUID}

# Галерея текстов
GET /gallery/texts?userAccountId={UUID}

# История генераций
GET /history/creatives?userAccountId={UUID}
GET /history/texts?userAccountId={UUID}

# Сохранить черновик
POST /drafts/save
{"userAccountId": "UUID", "type": "text", "content": "..."}
```

---

## 3. Бизнес-логика и алгоритмы

### 3.1 Управление рекламой — полный pipeline

```
Facebook Ads Manager
    ↓ (API: get adsets, get insights)
Scoring Agent (scoring.js) — собирает метрики
    ↓
Health Score Computation — оценка -100..+100 каждого адсета
    ↓
Brain Mini LLM — принимает решения (GPT/Claude)
    ↓
Proposals: updateBudget, pauseAdSet, createAdSet
    ↓
Action Dispatcher (POST /agent/actions)
    ↓
Facebook API — выполнение действий
```

#### Health Score (HS ∈ [-100; +100])

Формула по компонентам:

**1. CPL Gap (вес 45%)**
- Сравнивает фактический CPL с target_cpl_cents направления
- +45 если CPL на 30% дешевле target
- -45 если CPL на 30% дороже target
- Линейная интерполяция между

**2. Тренды (вес 15%)**
- 3d vs 7d: улучшается или ухудшается?
- 7d vs 30d: долгосрочный тренд

**3. Диагностика (штрафы, до -30)**
- CTR < 1%: штраф -8
- CPM > медиана +30%: штраф -12
- Frequency > 2 за 30 дней: штраф -10

**4. Volume Confidence (множитель 0.6-1.0)**
- < 1000 impressions → confidence 0.6
- 1000-5000 → линейно до 1.0
- > 5000 → confidence 1.0

**5. Today Compensation**
- Если CPL сегодня ≤ 0.5× вчера → полная компенсация (плохой вчерашний HS обнуляется)
- ≤ 0.7× → 60% компенсация
- ≤ 0.9× → бонус +5

#### Классы Health Score

| Класс | Диапазон | Действие |
|-------|----------|----------|
| VERY_GOOD | ≥ +25 | Масштабировать: увеличить бюджет +10..+30% |
| GOOD | +5..+24 | Держать: без изменений или +5..+10% |
| NEUTRAL | -5..+4 | Наблюдать: не менять |
| SLIGHTLY_BAD | -25..-6 | Снижать: уменьшить бюджет -20..-50% |
| BAD | ≤ -25 | Пауза или резкое снижение |

#### Правила бюджетов

| Параметр | Значение |
|----------|----------|
| Макс. увеличение за шаг | +30% |
| Макс. снижение за шаг | -50% |
| Минимальный бюджет адсета | $3 (300 cents) |
| Максимальный бюджет адсета | $100 (10000 cents) |
| Новый адсет: минимум | $10 (1000 cents) |
| Новый адсет: максимум | $20 (2000 cents) |

#### Веса таймфреймов

| Период | Вес |
|--------|-----|
| yesterday | 50% |
| last_3d | 25% |
| last_7d | 15% |
| last_30d | 10% |

#### Ad-Eater Detection (поиск "пожирателей бюджета")

Адсет считается ad-eater если:
- Потратил ≥ $3 И ≥ 300 impressions
- CPL > 3× target → **критический** ad-eater
- Занимает > 50% бюджета кампании без конверсий → немедленная пауза

#### Ограничения по времени

- **Нельзя создавать новые адсеты после 18:00 Almaty (UTC+5)** — не хватит времени на оптимизацию Facebook алгоритмом
- Тестовые кампании (префикс "ТЕСТ |") — Brain не трогает, они управляются отдельно

### 3.2 Campaign Builder — создание кампаний

#### Классификация креативов

| Класс | Условие | Приоритет |
|-------|---------|-----------|
| Strong | CTR > 1.2% ИЛИ CPL < target | Высший |
| Medium | Средние метрики | Средний |
| New | Нет истории (< 1000 impressions) | Средний |
| Weak | Ниже среднего | Низший |

#### Формула распределения бюджета

```
Бюджет направления → количество адсетов:
$10-19  → 1 адсет
$20-29  → 2 адсета
$30-39  → 3 адсета
$40+    → floor(budget / 10) адсетов

КРИТИЧНО: сумма бюджетов адсетов = бюджет направления
Пример: $50 → 3 адсета = $17 + $17 + $16
```

#### Workflow создания кампании (createCampaignWithCreative.ts)

1. Получить креативы из БД по ID
2. Определить objective → маппинг к Facebook objective (OUTCOME_ENGAGEMENT, OUTCOME_SALES, etc.)
3. Выбрать fb_creative_id для каждого креатива (есть разные ID под разные objectives)
4. Создать Campaign через FB API
5. Создать AdSet с таргетингом и бюджетом
6. Создать Ads с выбранными креативами
7. Сохранить маппинг в `ad_creative_mapping`

#### Тестирование креативов (creativeTest.ts)

1. Проверить нет ли уже теста для этого креатива
2. Создать кампанию "ТЕСТ | Ad: {id} | {date}"
3. Создать AdSet + Ad с тестовым бюджетом ($20)
4. Создать Facebook Auto Rule: остановить после 1000 impressions
5. Сохранить в `creative_tests`
6. Когда завершится → Creative Analyzer оценит результаты

### 3.3 Воронка лидов и CRM

#### 7 этапов воронки

```
new_lead → not_qualified → qualified → consultation_booked → consultation_completed → deal_closed
                                                                                     → deal_lost
```

#### Скоринг лидов (0-100)

**Базовый score по этапу:**

| Этап | Score |
|------|-------|
| new_lead | 5 |
| not_qualified | 15 |
| qualified | 30 |
| consultation_booked | 40 |
| consultation_completed | 55 |
| deal_closed | 75 |
| deal_lost | 0 |

**Модификаторы:**

| Фактор | Модификатор |
|--------|-------------|
| Медицина (ниша) | +15 |
| Инфобизнес | +10 |
| Владелец бизнеса | +10 |
| Бюджет указан | +10 |
| Таргетолог/SMM | -30 |

**Interest Level:**

| Уровень | Score | Описание |
|---------|-------|----------|
| HOT | 75-100 | Записан на консультацию или готов записаться |
| WARM | 40-74 | Есть интерес, но не готов к действию |
| COLD | 0-39 | Слабый интерес или нецелевая ниша |

#### Распределение лидов по консультантам

- Round-robin среди консультантов из `consultation_settings.consultant_ids`
- **Bot-scoped**: каждый бот имеет свой список консультантов
- Фильтрация: `is_active = true` AND `accepts_new_leads = true`
- Если у бота нет интеграции → `assigned_consultant_id = NULL`

### 3.4 Мультиаккаунтность

```
user_accounts (пользователь/tenant)
    │
    └─ ad_accounts (рекламные аккаунты)
           │
           ├─ id: UUID (внутренний, используется как account_id в FK)
           ├─ fb_ad_account_id: TEXT (Facebook ID, формат act_xxx)
           │
           └─ Связанные данные (по account_id):
               leads, purchases, sales, user_competitors,
               whatsapp_instances, creative_metrics_history,
               creative_analysis, generated_creatives
```

- `tenant_id = user_accounts.id`
- `account_id = ad_accounts.id` (UUID)
- `account_id` nullable: NULL для legacy данных (до мультиаккаунтности)
- Один user может иметь до 5 ad_accounts

### 3.5 Система конкурентов

- Конкуренты добавляются по Facebook Page URL
- Автоматический сбор креативов из Meta Ads Library (раз в неделю)
- Скоринг каждого креатива (0-100):
  - Активная реклама: +40
  - Длительность показа (30+ дней): +30
  - Facebook + Instagram: +15
  - Видео формат: +10
  - > 3 вариантов: +5
- ТОП-10 лучших с бейджем "Новый"
- OCR для изображений (Gemini), транскрипция видео (Whisper)
- "Референс" — AI адаптирует текст конкурента под твоего клиента

---

## 4. Схема БД — основные таблицы

### user_accounts — Пользователи (tenant)
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| username | VARCHAR | Логин |
| email | VARCHAR | Email |
| role | ENUM | admin, consultant, manager |
| is_active | BOOLEAN | |
| is_tech_admin | BOOLEAN | Техадмин (для admin routes) |
| onboarding_stage | VARCHAR(30) | registered, fb_pending, fb_connected, direction_created, creative_created, ads_launched, first_report, roi_configured, active, inactive |
| access_token | TEXT | Facebook access token |
| fb_page_id | TEXT | Facebook Page ID |
| fb_instagram_id | TEXT | Instagram ID |
| tiktok_access_token | TEXT | TikTok token |

### ad_accounts — Рекламные аккаунты
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | Внутренний ID (используется как account_id) |
| user_account_id | UUID FK → user_accounts | Владелец |
| name | TEXT | Название аккаунта |
| is_active | BOOLEAN | |
| fb_ad_account_id | TEXT | Facebook ID (act_xxx) |
| fb_page_id | TEXT | Facebook Page |
| fb_access_token | TEXT | Facebook token |
| tiktok_account_id | TEXT | TikTok ID |
| tiktok_access_token | TEXT | TikTok token |
| amocrm_subdomain | TEXT | AmoCRM домен |
| amocrm_access_token | TEXT | AmoCRM token |
| tarif | VARCHAR(50) | Тариф (ai_target) |
| tarif_expires | DATE | Дата окончания |
| connection_status | TEXT | pending, connected, error |
| custom_audiences | JSONB | Кастомные аудитории |

### account_directions — Направления рекламы
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| name | TEXT | "Алматы WhatsApp" |
| objective | TEXT | whatsapp, instagram_traffic, site_leads |
| fb_campaign_id | TEXT | ID кампании Facebook |
| campaign_status | TEXT | ACTIVE, PAUSED, ARCHIVED, DELETED |
| daily_budget_cents | INTEGER | Дневной бюджет в центах (мин 1000 = $10) |
| target_cpl_cents | INTEGER | Целевой CPL в центах (мин 50) |
| is_active | BOOLEAN | |
| whatsapp_phone_number_id | UUID FK → whatsapp_phone_numbers | Номер для WhatsApp objective |

### leads — Лиды
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| account_id | UUID FK → ad_accounts | Nullable (мультиаккаунт) |
| name | TEXT | Имя лида |
| phone | TEXT | Телефон |
| email | TEXT | Email |
| ad_id | TEXT | Facebook Ad ID (источник) |
| utm_source, utm_medium, utm_campaign | TEXT | UTM метки |
| source_id | TEXT | ID объявления |

### user_creatives — Креативы пользователя
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_id | UUID FK → auth.users | |
| title | TEXT | Название |
| status | TEXT | processing, ready, failed |
| fb_video_id | TEXT | Facebook Video ID |
| fb_creative_id_whatsapp | TEXT | FB Creative ID для WhatsApp |
| fb_creative_id_instagram_traffic | TEXT | FB Creative ID для Instagram |
| fb_creative_id_site_leads | TEXT | FB Creative ID для Site Leads |
| direction_id | UUID FK → account_directions | Привязка к направлению |

### creative_metrics_history — История метрик
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| account_id | UUID FK → ad_accounts | Nullable |
| date | DATE | Дата метрик |
| ad_id | TEXT | ID объявления |
| adset_id | TEXT | ID адсета |
| campaign_id | TEXT | ID кампании |
| impressions | INTEGER | Показы |
| clicks | INTEGER | Клики |
| leads | INTEGER | Конверсии |
| spend | DECIMAL | Расход |
| ctr | DECIMAL | Click-through rate |
| cpm | DECIMAL | Cost per mille |
| cpl | DECIMAL | Cost per lead |
| frequency | DECIMAL | Частота показа |

### creative_tests — Тесты креативов
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_creative_id | UUID FK → user_creatives | Тестируемый креатив |
| user_id | UUID | Пользователь |
| account_id | UUID FK → ad_accounts | |
| campaign_id, adset_id, ad_id | TEXT | Facebook IDs |
| status | TEXT | pending, running, completed, failed, cancelled |
| test_budget_cents | INTEGER | Бюджет теста (2000 = $20) |
| test_impressions_limit | INTEGER | Лимит показов (1000) |
| impressions, clicks, leads | INTEGER | Результаты |
| spend_cents | INTEGER | Потрачено |
| ctr, cpl | DECIMAL | Метрики |
| llm_score | INTEGER | AI оценка |
| llm_verdict | TEXT | excellent, good, average, poor |

### dialog_analysis — Анализ WhatsApp диалогов
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| instance_name | TEXT | Имя WhatsApp инстанса |
| user_account_id | UUID FK → user_accounts | |
| contact_phone | TEXT | Телефон лида |
| contact_name | TEXT | Имя лида |
| interest_level | TEXT | hot, warm, cold |
| score | INTEGER | 0-100 |
| funnel_stage | TEXT | Этап воронки |
| assigned_consultant_id | UUID FK → consultants | Назначенный консультант |
| autopilot_enabled | BOOLEAN | Бот включён |
| business_type | TEXT | Тип бизнеса |
| objection | TEXT | Возражение |
| next_message | TEXT | Рекомендуемое следующее сообщение |
| manual_notes | TEXT | Заметки |
| messages | JSONB | История сообщений |

### ai_bot_configurations — Конфигурация AI ботов
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| name | TEXT | Имя бота |
| is_active | BOOLEAN | |
| system_prompt | TEXT | Системный промпт |
| model | TEXT | gpt-4o, claude-3.5 |
| temperature | NUMERIC | 0.24 по умолчанию |
| history_token_limit | INTEGER | Лимит токенов истории (8000) |
| message_buffer_seconds | INTEGER | Буфер сообщений (7 сек) |
| schedule_enabled | BOOLEAN | Расписание включено |
| schedule_hours_start | INTEGER | Начало работы (9) |
| schedule_hours_end | INTEGER | Конец работы (18) |
| timezone | TEXT | Europe/Moscow |
| voice_recognition_enabled | BOOLEAN | Распознавание голоса |
| operator_pause_enabled | BOOLEAN | Оператор может паузить |

### consultants — Консультанты
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| name | VARCHAR(255) | Имя |
| email | VARCHAR(255) | Email (unique) |
| phone | VARCHAR(50) | Телефон |
| specialization | VARCHAR(255) | Специализация |
| is_active | BOOLEAN | |

### consultant_call_recordings — Записи звонков
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| consultant_id | UUID FK → consultants | |
| lead_id | UUID FK → dialog_analysis | |
| file_url | TEXT | URL файла |
| duration_seconds | INTEGER | Длительность |
| transcription | TEXT | Транскрипция (Whisper) |
| transcription_status | VARCHAR(20) | pending, completed, failed |
| analysis | JSONB | Результат анализа OpenClaw |
| analysis_status | VARCHAR(20) | pending, completed |

### competitors — Конкуренты
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| fb_page_id | TEXT UNIQUE | Facebook Page ID |
| fb_page_url | TEXT | URL страницы |
| name | TEXT | Название |
| status | TEXT | active, pending, error |
| last_crawled_at | TIMESTAMPTZ | Последний сбор |
| next_crawl_at | TIMESTAMPTZ | Следующий сбор |
| creatives_count | INTEGER | Кол-во креативов |

### competitor_creatives — Креативы конкурентов
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| competitor_id | UUID FK → competitors | |
| fb_ad_archive_id | TEXT UNIQUE | ID из Ads Library |
| media_type | TEXT | video, image, carousel |
| media_urls | JSONB | URLs медиафайлов |
| body_text | TEXT | Текст объявления |
| headline | TEXT | Заголовок |
| is_active | BOOLEAN | Активна ли реклама |
| first_shown_date | DATE | Дата первого показа |

### whatsapp_phone_numbers — WhatsApp номера
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| phone_number | TEXT | +77001234567 |
| label | TEXT | "Алматы", "Астана" |
| is_active | BOOLEAN | |
| is_default | BOOLEAN | Номер по умолчанию |

### whatsapp_instances — WhatsApp инстансы (Evolution API)
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| account_id | UUID FK → ad_accounts | |
| ai_bot_id | UUID FK → ai_bot_configurations | Привязанный AI бот |
| instance_name | VARCHAR | Имя инстанса в Evolution |

### default_ad_settings — Настройки рекламы по умолчанию
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_id | UUID FK → user_accounts | |
| campaign_goal | TEXT | whatsapp, instagram_traffic, site_leads |
| cities | TEXT[] | Массив Facebook city IDs |
| age_min | INTEGER | Мин. возраст (18) |
| age_max | INTEGER | Макс. возраст (65) |
| gender | TEXT | all, male, female |
| pixel_id | TEXT | Facebook Pixel ID |
| description | TEXT | Описание для объявления |

### notifications — Уведомления пользователей
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_account_id | UUID FK → user_accounts | |
| type | VARCHAR(50) | fb_approved, fb_rejected, stage_changed |
| title | VARCHAR(255) | Заголовок |
| message | TEXT | Текст |
| is_read | BOOLEAN | Прочитано |
| telegram_sent | BOOLEAN | Отправлено в Telegram |
| metadata | JSONB | Дополнительные данные |

---

## 5. Инструкция для создания скиллов

### 5.1 Формат SKILL.md

Каждый скилл — файл `skills/{skill-name}/SKILL.md` в workspace.

**Структура:**

```markdown
---
name: skill-name
description: Краткое описание
requires:
  env:
    - AGENT_SERVICE_URL
---

# Название скилла

Описание: что делает, когда использовать.

---

## READ инструменты

### toolName
Описание.

\`\`\`bash
curl -s http://agent-service:8082/endpoint \
  -H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d"
\`\`\`

**Параметры:**
- `param1` (required) — описание

**Ответ:**
\`\`\`json
{"field": "value"}
\`\`\`

---

## WRITE инструменты

### actionName
Описание.

**ВАЖНО**: Запроси подтверждение перед выполнением!

\`\`\`bash
curl -s -X POST http://agent-service:8082/endpoint \
  -H "x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
\`\`\`
```

### 5.2 Конвенции

- Язык: русский
- Все curl вызовы через localhost (Docker сеть)
- Авторизация: `x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d`
- WRITE операции: подтверждение по умолчанию (настраиваемо)
- Формат ответов для Telegram: `*bold*`, эмодзи (📊 📈 💰 ⚠️ ✅ ❌), компактные карточки

### 5.3 Список скиллов для создания

| # | Скилл | Описание | Приоритет |
|---|-------|----------|-----------|
| 1 | **morning-briefing** | Ежедневная сводка: лиды, реклама, продажи, проблемы | 🔴 Высокий |
| 2 | **ads-dashboard** | Метрики, CPL, ROI, Health Score | 🔴 Высокий |
| 3 | **ads-optimization** | Пауза/запуск, бюджеты, ad-eater detection | 🔴 Высокий |
| 4 | **campaign-builder** | Создание кампаний, адсетов, тесты креативов | 🔴 Высокий |
| 5 | **crm-leads** | Лиды, воронка, распределение, статусы | 🔴 Высокий |
| 6 | **alerting** | Мониторинг: горячий лид без ответа, ad-eater, ошибки | 🔴 Высокий |
| 7 | **crm-consultants** | KPI консультантов, расписание, задачи, звонки | 🟡 Средний |
| 8 | **chatbot-management** | Промпты ботов, вкл/выкл, кампании рассылок | 🟡 Средний |
| 9 | **creative-generation** | Генерация текстов, изображений, карусели | 🟡 Средний |
| 10 | **competitor-intelligence** | Мониторинг конкурентов, ТОП креативы | 🟡 Средний |
| 11 | **analytics-reporting** | Отчёты за период, ROI, воронка конверсий | 🟡 Средний |
| 12 | **integrations** | AmoCRM/Bitrix24, CAPI, вебхуки | 🟢 Низкий |

### 5.4 Примеры сценариев использования

**"Как дела с рекламой?"** → ads-dashboard
```
📊 Реклама за сегодня:
• Потрачено: 45,000 ₸
• Лидов: 23
• CPL: 1,957 ₸ (target: 2,500 ₸) ✅
• Health Score: +18 (GOOD)

⚠️ 2 ad-eater'а обнаружены:
• AdSet "Астана 25-45" — CPL 8,500 ₸ (3.4x target)
• AdSet "Женщины IG" — 15,000 ₸ потрачено, 0 лидов
```

**"Поставь на паузу всё что дороже 500 тенге за лид"** → ads-optimization
```
⏸ Ставлю на паузу 3 адсета:
1. "Алматы 25-35" — CPL 680 ₸
2. "Астана все" — CPL 1,200 ₸
3. "Караганда" — CPL 950 ₸

✅ Готово. Сэкономлено ~15,000 ₸/день.
```

**"Утренний отчёт"** → morning-briefing
```
🌅 Доброе утро! Отчёт за вчера:

📊 Реклама:
• Расход: 85,000 ₸ | Лидов: 42 | CPL: 2,024 ₸
• Health Score: +12 (средний)

👥 CRM:
• Новых лидов: 42 | Горячих: 8
• Консультаций: 5 (3 состоялись, 2 отмена)
• Продаж: 1 (49,000 ₸)

⚠️ Проблемы:
• 3 горячих лида без ответа > 4 часов
• Консультант Маша: 0 из 3 консультаций завершены
• Ad-eater в направлении "Астана" — CPL 7,500 ₸
```

**"Запусти новую кампанию на Алмату с бюджетом 50к"** → campaign-builder
```
🚀 Создаю кампанию:
• Направление: Алматы WhatsApp
• Бюджет: 50,000 ₸/день
• Адсеты: 3 (по 16,700 ₸)
• Креативы: лучшие 3 по CTR

Выбранные креативы:
1. "Стоматология_видео_3" — CTR 2.1%, CPL 1,800 ₸
2. "Имплантация_сторис" — CTR 1.8%, CPL 2,100 ₸
3. "Новый_2024" — без истории (тест)

Запускаю?
```

**"Как работает консультант Маша?"** → crm-consultants
```
👩 Консультант: Маша Иванова

📊 KPI за неделю:
• Лидов обработано: 15
• Консультаций проведено: 8
• Продаж: 2 (98,000 ₸)
• Конверсия лид→консультация: 53%
• Конверсия консультация→продажа: 25%

📞 Последние звонки (анализ):
• Клиент "Стоматология Алмату" — оценка 7/10, warm
• Клиент "Фитнес-клуб" — оценка 5/10, cold (слабое закрытие)

💡 Рекомендации:
• Усилить работу с возражениями (средняя оценка 5.2/10)
• Чаще назначать конкретную дату следующего шага
```

### 5.5 Порядок создания скиллов

1. **morning-briefing** — самый полезный сразу, покажет все возможности
2. **ads-dashboard** — базовая аналитика, READ-only
3. **crm-leads** — управление лидами
4. **ads-optimization** — автоматизация рекламы
5. **alerting** — проактивный мониторинг
6. **campaign-builder** — создание кампаний
7. Остальные по приоритету

**Для каждого скилла:**
1. Изучи соответствующие API endpoints из секции 2
2. Изучи бизнес-логику из секции 3
3. Посмотри код в ~/project/ для деталей
4. Напиши SKILL.md по формату из 5.1
5. Обсуди с пользователем через Telegram
6. Исправь по фидбеку
7. Переходи к следующему
