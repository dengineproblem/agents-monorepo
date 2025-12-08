# 📊 USER ANALYTICS SYSTEM

> Система аналитики пользователей для отслеживания активности, вовлечённости и бизнес-событий.

**Статус:** ✅ Активна (с 8 декабря 2025)

---

## 📋 ОГЛАВЛЕНИЕ

1. [Обзор системы](#обзор-системы)
2. [Архитектура](#архитектура)
3. [Frontend: Сбор событий](#frontend-сбор-событий)
4. [Backend: API эндпоинты](#backend-api-эндпоинты)
5. [База данных](#база-данных)
6. [Cron: Расчёт скоринга](#cron-расчёт-скоринга)
7. [Admin UI](#admin-ui)
8. [Бизнес-события](#бизнес-события)
9. [Мониторинг и отладка](#мониторинг-и-отладка)
10. [Система онбординга](#система-онбординга)

---

## 🔍 ОБЗОР СИСТЕМЫ

### Что отслеживается:

- **Page Views** — просмотры страниц с названиями
- **Clicks** — клики по элементам (через `data-track-click`)
- **Sessions** — сессии пользователей (начало, длительность, количество страниц)
- **Business Events** — бизнес-события (запуск креативов, получение лидов)
- **Engagement Score** — скоринг вовлечённости (0-100)

### Ключевые метрики:

| Метрика | Описание |
|---------|----------|
| `total_events` | Общее количество событий пользователя |
| `total_sessions` | Количество сессий |
| `total_pages_viewed` | Всего просмотренных страниц |
| `avg_session_duration` | Средняя длительность сессии (секунды) |
| `engagement_score` | Скоринг вовлечённости (0-100) |
| `last_active_at` | Время последней активности |

---

## 🏛️ АРХИТЕКТУРА

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ usePageTracking │  │  useTrackClick  │  │    analytics    │  │
│  │     (hook)      │  │     (hook)      │  │  (lib/service)  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                ▼                                 │
│                    ┌───────────────────────┐                     │
│                    │   Event Queue (batch) │                     │
│                    │  flush every 5s or 20 │                     │
│                    └───────────┬───────────┘                     │
└────────────────────────────────┼────────────────────────────────┘
                                 │ POST /analytics/events
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   routes/analytics.ts                        ││
│  │  POST /analytics/events    - приём событий                   ││
│  │  GET  /analytics/users     - список пользователей            ││
│  │  GET  /analytics/realtime  - активные сессии                 ││
│  │  GET  /analytics/summary   - общая статистика                ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   lib/eventLogger.ts                         ││
│  │  logEvent()         - логирование события                    ││
│  │  logBusinessEvent() - логирование бизнес-события             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   user_events   │  │  user_sessions  │  │ user_engagement │  │
│  │                 │  │                 │  │    _scores      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ Daily at 03:00
┌─────────────────────────────────────────────────────────────────┐
│                    CRON: userScoringCron.ts                      │
│              Расчёт engagement_score для всех users              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🖥️ FRONTEND: СБОР СОБЫТИЙ

### Файлы:

| Файл | Назначение |
|------|------------|
| `lib/analytics.ts` | Основной сервис аналитики |
| `hooks/usePageTracking.ts` | Автоматический трекинг page views |
| `hooks/useTrackClick.ts` | Хук для отслеживания кликов |

### lib/analytics.ts

```typescript
// Инициализация (автоматически при импорте)
import { analytics } from '@/lib/analytics';

// Ручное логирование события
analytics.trackEvent('button_click', { buttonId: 'submit' });

// Page view (обычно через usePageTracking)
analytics.trackPageView('/dashboard', 'Dashboard');

// Начало сессии
analytics.trackSessionStart();
```

**Конфигурация батчинга:**
- `BATCH_INTERVAL = 5000` — отправка каждые 5 секунд
- `BATCH_SIZE = 20` — или при накоплении 20 событий

### usePageTracking (hook)

Автоматически отслеживает page views при навигации.

```typescript
// App.tsx
import { usePageTracking } from './hooks/usePageTracking';

const AppRoutes = () => {
  usePageTracking(); // Автоматический трекинг
  return <Routes>...</Routes>;
};
```

**Маппинг путей:**
```typescript
const PAGE_TITLES = {
  '/': 'Dashboard',
  '/profile': 'Profile',
  '/creatives': 'Creative Generation',
  '/admin/analytics': 'Admin Analytics',
  // ... и т.д.
};
```

### useTrackClick (hook)

```typescript
import { useTrackClick } from '@/hooks/useTrackClick';

const MyComponent = () => {
  const trackClick = useTrackClick();

  return (
    <button
      onClick={() => trackClick('launch_button', { mode: 'manual' })}
    >
      Запустить
    </button>
  );
};
```

---

## 🔌 BACKEND: API ЭНДПОИНТЫ

### Файл: `routes/analytics.ts`

### POST /analytics/events

Приём батча событий с фронтенда.

**Request:**
```json
{
  "events": [
    {
      "user_account_id": "uuid",
      "event_type": "page_view",
      "event_data": { "path": "/dashboard", "title": "Dashboard" },
      "session_id": "session-uuid",
      "timestamp": "2025-12-08T12:00:00Z"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "processed": 5
}
```

### GET /analytics/users

Список пользователей с метриками для админ-панели.

**Query params:**
- `limit` — количество (по умолчанию 100)
- `offset` — смещение
- `sort` — поле сортировки (engagement_score, last_active_at, total_events)
- `order` — направление (asc, desc)

**Response:**
```json
{
  "users": [
    {
      "user_account_id": "uuid",
      "username": "user1",
      "email": "user@example.com",
      "total_events": 150,
      "total_sessions": 12,
      "total_pages_viewed": 89,
      "avg_session_duration": 420,
      "engagement_score": 75,
      "last_active_at": "2025-12-08T12:00:00Z"
    }
  ],
  "total": 50
}
```

### GET /analytics/realtime

Активные сессии за последние 15 минут.

**Response:**
```json
{
  "active_sessions": [
    {
      "user_account_id": "uuid",
      "username": "user1",
      "session_id": "session-uuid",
      "started_at": "2025-12-08T11:50:00Z",
      "pages_viewed": 5,
      "last_page": "/creatives"
    }
  ],
  "total_active": 3
}
```

### GET /analytics/summary

Общая статистика для дашборда.

**Query params:**
- `period` — период (today, week, month, all)

**Response:**
```json
{
  "total_users": 50,
  "active_users_today": 12,
  "total_events": 5000,
  "total_sessions": 200,
  "avg_engagement_score": 65,
  "top_pages": [
    { "path": "/dashboard", "views": 500 },
    { "path": "/creatives", "views": 300 }
  ]
}
```

---

## 🗄️ БАЗА ДАННЫХ

### Миграция: `078_user_analytics.sql`

### Таблица: user_events

```sql
CREATE TABLE user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  session_id UUID,
  account_id UUID REFERENCES ad_accounts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_user_events_user ON user_events(user_account_id);
CREATE INDEX idx_user_events_type ON user_events(event_type);
CREATE INDEX idx_user_events_session ON user_events(session_id);
CREATE INDEX idx_user_events_created ON user_events(created_at);
```

**Типы событий:**
- `page_view` — просмотр страницы
- `click` — клик по элементу
- `session_start` — начало сессии
- `session_end` — конец сессии
- `lead_received` — получен лид
- `creative_launched` — запущен креатив

### Таблица: user_sessions

```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  session_id UUID NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  pages_viewed INTEGER DEFAULT 0,
  events_count INTEGER DEFAULT 0,
  last_page TEXT,
  user_agent TEXT,
  ip_address TEXT,
  account_id UUID REFERENCES ad_accounts(id)
);

-- Индексы
CREATE INDEX idx_user_sessions_user ON user_sessions(user_account_id);
CREATE INDEX idx_user_sessions_started ON user_sessions(started_at);
```

### Таблица: user_engagement_scores

```sql
CREATE TABLE user_engagement_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) UNIQUE,
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  total_events INTEGER DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  total_pages_viewed INTEGER DEFAULT 0,
  avg_session_duration INTEGER DEFAULT 0,
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  factors JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_engagement_scores_score ON user_engagement_scores(score DESC);
```

---

## ⏰ CRON: РАСЧЁТ СКОРИНГА

### Файл: `cron/userScoringCron.ts`

**Расписание:** Ежедневно в 03:00 UTC

### Формула расчёта engagement_score:

```typescript
// Веса факторов
const WEIGHTS = {
  recency: 0.25,      // Недавняя активность
  frequency: 0.25,    // Частота визитов
  duration: 0.20,     // Длительность сессий
  depth: 0.15,        // Глубина просмотра (страниц за сессию)
  actions: 0.15       // Бизнес-действия (креативы, лиды)
};

// Расчёт каждого фактора (0-100)
const recencyScore = calculateRecency(lastActiveAt);  // Дней с последней активности
const frequencyScore = calculateFrequency(sessionsLast30Days);
const durationScore = calculateDuration(avgSessionDuration);
const depthScore = calculateDepth(avgPagesPerSession);
const actionsScore = calculateActions(businessEventsCount);

// Итоговый скор
const engagementScore = Math.round(
  recencyScore * WEIGHTS.recency +
  frequencyScore * WEIGHTS.frequency +
  durationScore * WEIGHTS.duration +
  depthScore * WEIGHTS.depth +
  actionsScore * WEIGHTS.actions
);
```

### Логирование:

```bash
# Проверить работу cron
docker logs agents-monorepo-agent-service-1 | grep "User scoring"
```

---

## 🖼️ ADMIN UI

### Страница: `/admin/analytics`

### Файл: `pages/AdminAnalytics.tsx`

### Секции:

1. **Summary Cards** — общая статистика
   - Всего пользователей
   - Активных сегодня
   - Средний engagement score
   - Всего событий

2. **Real-time** — активные сессии (обновляется каждые 30 сек)
   - Пользователь
   - Текущая страница
   - Время сессии
   - Просмотрено страниц

3. **Users Table** — таблица пользователей
   - Username
   - Email
   - Events / Sessions / Pages
   - Avg Duration
   - Engagement Score (прогресс-бар)
   - Last Active

### Доступ:

Страница доступна всем авторизованным пользователям по адресу `/admin/analytics`.

---

## 📈 БИЗНЕС-СОБЫТИЯ

### Файл: `lib/eventLogger.ts`

### Использование:

```typescript
import { eventLogger } from '../lib/eventLogger.js';

// Логирование бизнес-события
await eventLogger.logBusinessEvent(
  userAccountId,
  'creative_launched',
  {
    directionId: direction.id,
    directionName: direction.name,
    adsCount: ads.length,
    mode: 'manual'
  },
  accountId  // опционально, для мультиаккаунтности
);
```

### Интегрированные события:

| Событие | Где вызывается | Данные |
|---------|----------------|--------|
| `creative_launched` | campaignBuilder.ts | directionId, mode, adsCount |
| `lead_received` | leads.ts | leadId, source, phone |

### Добавление нового события:

1. Вызвать `eventLogger.logBusinessEvent()` в нужном месте
2. Событие автоматически сохранится в `user_events`
3. Учтётся в расчёте engagement_score (фактор `actions`)

---

## 🔧 МОНИТОРИНГ И ОТЛАДКА

### Проверка событий в БД:

```sql
-- Последние 10 событий пользователя
SELECT * FROM user_events
WHERE user_account_id = 'uuid'
ORDER BY created_at DESC
LIMIT 10;

-- Статистика по типам событий за сегодня
SELECT event_type, COUNT(*)
FROM user_events
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY event_type;

-- Активные сессии (последние 15 минут)
SELECT * FROM user_sessions
WHERE started_at > NOW() - INTERVAL '15 minutes'
AND ended_at IS NULL;
```

### Логи backend:

```bash
# Все запросы к analytics API
docker logs agents-monorepo-agent-service-1 | grep "/analytics"

# Ошибки при сохранении событий
docker logs agents-monorepo-agent-service-1 | grep -i "event.*error"
```

### Проверка frontend:

В консоли браузера:
```javascript
// Проверить очередь событий
localStorage.getItem('analytics_queue');

// Проверить session_id
sessionStorage.getItem('analytics_session_id');
```

---

## 🎯 СИСТЕМА ОНБОРДИНГА

> Система отслеживания прогресса пользователей через этапы онбординга и теги активности.

### Цель

Снижение оттока пользователей за счёт:
- Отслеживания прогресса каждого пользователя
- Автоматического обновления этапов при действиях
- Уведомлений (in-app + Telegram)
- Визуального Kanban-дашборда для админов

### Миграция: `080_onboarding_system.sql`

### Этапы онбординга (onboarding_stage)

| Этап | Описание | Условие перехода |
|------|----------|------------------|
| `registered` | Только зарегистрировался | Создание аккаунта |
| `fb_pending` | Ожидание подключения FB | Инициировал OAuth |
| `fb_connected` | Facebook подключен | Успешный OAuth callback |
| `direction_created` | Создано направление | POST /directions |
| `creative_created` | Создан креатив | POST /creatives или генерация |
| `ads_launched` | Запущена реклама | Первый запуск рекламы |
| `first_report` | Получен первый отчёт | Первый отчёт от Facebook |
| `roi_configured` | Настроена ROI аналитика | Настройка tracking |
| `active` | Активный пользователь | Регулярное использование |
| `inactive` | Неактивен | Отсутствие активности >30 дней |

**Логика переходов:** Этапы могут только прогрессировать вперёд (нельзя откатиться с `ads_launched` на `creative_created`), кроме `active`/`inactive`.

### Теги онбординга (onboarding_tags)

Дополнительные метки о действиях пользователя:

| Тег | Описание | Условие добавления |
|-----|----------|-------------------|
| `tiktok_connected` | Подключил TikTok | OAuth TikTok |
| `generated_image` | Генерировал изображение | POST /generate/image |
| `generated_carousel` | Генерировал карусель | POST /generate/carousel |
| `generated_text` | Генерировал текст | POST /generate/text |
| `added_competitors` | Добавил конкурентов | POST /competitors |
| `added_audience` | Добавил аудиторию | POST /audiences |
| `used_creative_test` | Запускал быстрый тест | POST /creative-test |
| `used_llm_analysis` | Использовал LLM анализ | Анализ креатива через AI |

### Схема БД

```sql
-- Поля в user_accounts:
ALTER TABLE user_accounts ADD COLUMN
  onboarding_stage TEXT DEFAULT 'registered',
  onboarding_tags JSONB DEFAULT '[]',
  is_tech_admin BOOLEAN DEFAULT FALSE;

-- История изменений этапов:
CREATE TABLE onboarding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  stage_from TEXT,
  stage_to TEXT NOT NULL,
  changed_by UUID REFERENCES user_accounts(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- In-app уведомления:
CREATE TABLE user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  telegram_sent BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Токены импрессонации:
CREATE TABLE impersonation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES user_accounts(id),
  target_user_id UUID NOT NULL REFERENCES user_accounts(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Backend: lib/onboardingHelper.ts

Автоматическое обновление этапов и тегов:

```typescript
import {
  onDirectionCreated,
  onCreativeCreated,
  onAdsLaunched,
  onCreativeGenerated,
  onCreativeTestLaunched,
  onLLMAnalysisUsed
} from '../lib/onboardingHelper.js';

// При создании направления
await onDirectionCreated(userId);

// При генерации креатива
await onCreativeGenerated(userId, 'image'); // или 'carousel', 'text'

// При запуске быстрого теста
await onCreativeTestLaunched(userId);

// При LLM анализе креатива
await onLLMAnalysisUsed(userId);
```

### Backend: routes/notifications.ts

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/notifications` | Список уведомлений (limit, offset, unreadOnly) |
| GET | `/notifications/unread-count` | Количество непрочитанных |
| PATCH | `/notifications/:id/read` | Отметить как прочитанное |
| POST | `/notifications/mark-all-read` | Прочитать все |
| DELETE | `/notifications/:id` | Удалить уведомление |

**Заголовок:** `x-user-id` — UUID пользователя

### Backend: routes/onboarding.ts

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/onboarding/users` | Kanban-данные по этапам |
| PATCH | `/onboarding/users/:id/stage` | Изменить этап (админ) |
| GET | `/onboarding/users/:id/history` | История изменений этапа |

### Backend: routes/impersonation.ts

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/impersonation/start` | Создать токен (2 часа) |
| POST | `/impersonation/end` | Завершить сессию |
| GET | `/impersonation/validate` | Проверить токен |

**Логика:**
- Только пользователи с `is_tech_admin = true` могут имперсонировать
- Токен действует 2 часа
- При имперсонации видны все данные целевого пользователя

### Frontend: NotificationBell.tsx

Компонент колокольчика в Header:
- Badge с количеством непрочитанных (9+)
- Popover со списком уведомлений
- Polling каждые 30 секунд
- Действия: прочитать, удалить, прочитать все

### Frontend: AdminOnboarding.tsx

Страница `/admin/onboarding` — Kanban-доска:
- Колонки по этапам
- Карточки пользователей с тегами
- Drag-and-drop для перемещения между этапами
- Фильтрация по этапам
- История изменений каждого пользователя

### Интеграция в существующий код

**routes/creativeTest.ts:**
```typescript
// После успешного запуска теста
onCreativeTestLaunched(user_id).catch(err => {
  app.log.warn({ err, userId: user_id }, 'Failed to add onboarding tag');
});
```

**agent-brain/analyzerService.js:**
```javascript
// После сохранения LLM анализа в БД
// Автоматически добавляет тег 'used_llm_analysis'
```

---

## 📝 ИСТОРИЯ ИЗМЕНЕНИЙ

**8 декабря 2025:**
- ✅ Создана система аналитики пользователей
- ✅ Миграция 078_user_analytics.sql
- ✅ Frontend: analytics.ts, usePageTracking, useTrackClick
- ✅ Backend: routes/analytics.ts, lib/eventLogger.ts
- ✅ Cron: userScoringCron.ts (ежедневный расчёт скоринга)
- ✅ Admin UI: страница /admin/analytics
- ✅ Интеграция бизнес-событий: creative_launched, lead_received
- ✅ **Система онбординга:** этапы, теги, уведомления
- ✅ Миграция 080_onboarding_system.sql
- ✅ Backend: routes/onboarding.ts, notifications.ts, impersonation.ts
- ✅ Backend: lib/onboardingHelper.ts (автообновление этапов)
- ✅ Frontend: NotificationBell.tsx, AdminOnboarding.tsx
- ✅ Интеграция: onCreativeTestLaunched, onLLMAnalysisUsed

---

## 🔗 СВЯЗАННЫЕ ДОКУМЕНТЫ

- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — общая инфраструктура
- [MULTI_ACCOUNT_GUIDE.md](./MULTI_ACCOUNT_GUIDE.md) — мультиаккаунтность (account_id в событиях)
