# Админ-панель — Полная документация

> Создано: 2024-12-08
> Статус: Готово к деплою (требуется применить миграции)

## Обзор

Полностью изолированная админ-панель с собственным layout, sidebar и header. Админ НЕ видит пользовательский интерфейс — это отдельное приложение внутри основного.

**Доступ:** `/admin` (требуется `is_tech_admin=true` в user_accounts)

---

## Архитектура

```
/admin                    → AdminLayout (sidebar + header + Outlet)
  ├── /admin              → AdminDashboard (index)
  ├── /admin/chats        → AdminChats
  ├── /admin/chats/:userId → AdminChats (с выбранным юзером)
  ├── /admin/users        → AdminUsers
  ├── /admin/onboarding   → AdminOnboarding (существующий kanban)
  ├── /admin/ads          → AdminAds
  ├── /admin/leads        → AdminLeads
  ├── /admin/errors       → AdminErrors
  ├── /admin/settings     → AdminSettings
  └── /admin/analytics    → AdminAnalytics (существующий)
```

---

## 1. Дашборд (`/admin`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminDashboard.tsx`
- Backend: `services/agent-service/src/routes/adminStats.ts`

**API:**
- `GET /admin/stats` — общая статистика
- `GET /admin/stats/recent-users` — последние регистрации
- `GET /admin/stats/recent-errors` — последние ошибки
- `GET /admin/stats/top-users` — топ по тратам

**Виджеты:**
| Виджет | Описание |
|--------|----------|
| Всего пользователей | Общее число + новые за 7 дней |
| Активные кампании | Кампании со статусом ACTIVE |
| Лиды за 7 дней | Количество новых лидов |
| Нерешённые ошибки | Ошибки с is_resolved=false |
| Последние регистрации | 5 последних юзеров |
| Последние ошибки | 5 последних ошибок |
| Топ по тратам | 5 юзеров с максимальным spend |

---

## 2. Чаты (`/admin/chats`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminChats.tsx`
- Backend: `services/agent-service/src/routes/adminChat.ts` (существующий)

**API:**
- `GET /admin/chats` — список юзеров с последним сообщением
- `GET /admin/chats/:userId` — история сообщений
- `POST /admin/chats/:userId` — отправить сообщение
- `WebSocket ws://server/admin/chats/ws` — real-time обновления

**Функционал:**
- WhatsApp-style интерфейс (список слева, чат справа)
- Аватары с инициалами
- Поиск по юзерам
- Бейдж непрочитанных сообщений
- Real-time через WebSocket
- Переход по URL `/admin/chats/:userId`

**WebSocket события:**
```typescript
// Входящее сообщение
{ type: 'new_message', userId: string, message: {...} }

// Отправка сообщения
{ type: 'send_message', userId: string, message: string }
```

---

## 3. Пользователи (`/admin/users`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminUsers.tsx`
- Backend: `services/agent-service/src/routes/adminUsers.ts`

**API:**
- `GET /admin/users?search=&status=&page=&limit=` — список с фильтрами
- `GET /admin/users/:id` — детали юзера
- `GET /admin/users/search?q=` — поиск для Command Palette

**Фильтры:**
| Фильтр | Значения |
|--------|----------|
| Статус | all, active (есть кампании), inactive |
| Поиск | По username, email, телефону |

**Колонки таблицы:**
- Пользователь (аватар + username + email)
- Телеграм
- Статус FB (подключён/нет)
- Кампании (количество)
- Потрачено (total spend)
- Дата регистрации
- Действия (чат, impersonate)

**Действия:**
- 💬 Перейти в чат
- 👤 Impersonate (войти под юзером)

---

## 4. Онбординг (`/admin/onboarding`)

**Файлы:**
- Frontend: `services/frontend/src/pages/AdminOnboarding.tsx` (существующий)
- Backend: `services/agent-service/src/routes/onboarding.ts` (существующий)

**Функционал:**
- Kanban-доска со стадиями онбординга
- Drag & drop между стадиями
- Теги для юзеров
- Заметки

*(Этот раздел уже существовал, просто интегрирован в новый layout)*

---

## 5. Реклама (`/admin/ads`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminAds.tsx`
- Backend: `services/agent-service/src/routes/adminAds.ts`

**API:**
- `GET /admin/ads/cpl-analysis?period=7d` — CPL анализ
- `GET /admin/ads/campaigns?period=7d` — список кампаний
- `GET /admin/ads/creatives?period=7d` — список креативов

**Вкладки:**

### 5.1 CPL Анализ
| Метрика | Описание |
|---------|----------|
| Плановый CPL | Из настроек юзера (target_cpl) |
| Фактический CPL | spend / leads |
| Отклонение | ((actual - planned) / planned) * 100% |
| Статус | 🟢 в норме (≤10%), 🟡 выше (10-30%), 🔴 критично (>30%) |

### 5.2 Кампании
Таблица всех кампаний с метриками: spend, impressions, clicks, leads, CPL

### 5.3 Креативы
Таблица креативов с превью и метриками

**Периоды:** 7 дней (default), 14 дней, 30 дней, Всё время

---

## 6. Лиды (`/admin/leads`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminLeads.tsx`
- Backend: `services/agent-service/src/routes/adminLeads.ts`

**API:**
- `GET /admin/leads?search=&status=&period=&page=&limit=` — список лидов
- `GET /admin/leads/stats?period=` — статистика по лидам

**Фильтры:**
| Фильтр | Значения |
|--------|----------|
| Статус | all, new, qualified, converted, lost |
| Период | 7d, 14d, 30d, all |
| Поиск | По имени, телефону, email |

**Статистика:**
- Всего лидов за период
- Новые
- Квалифицированные
- Конвертированные
- Потерянные

---

## 7. Ошибки (`/admin/errors`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminErrors.tsx`
- Backend: `services/agent-service/src/routes/adminErrors.ts`
- Миграция: `migrations/085_error_logs.sql`

**API:**
- `GET /admin/errors?type=&severity=&resolved=&page=&limit=` — список ошибок
- `GET /admin/errors/:id` — детали ошибки
- `POST /admin/errors/:id/generate-explanation` — сгенерировать LLM объяснение
- `PATCH /admin/errors/:id/resolve` — пометить как решённую

**Таблица error_logs:**
```sql
CREATE TABLE error_logs (
  id UUID PRIMARY KEY,
  user_account_id UUID,           -- Связь с юзером (nullable)

  -- Контекст ошибки
  error_type VARCHAR(50),         -- 'api', 'facebook', 'cron', 'frontend'
  error_code VARCHAR(100),        -- Код ошибки (например '190' для FB)
  raw_error TEXT,                 -- Сырой текст ошибки
  stack_trace TEXT,               -- Stack trace

  -- Контекст действия
  action VARCHAR(100),            -- 'create_campaign', 'fetch_metrics'
  endpoint VARCHAR(200),          -- URL эндпоинта
  request_data JSONB,             -- Тело запроса

  -- LLM расшифровка
  llm_explanation TEXT,           -- Человекочитаемое объяснение
  llm_solution TEXT,              -- Рекомендуемое решение
  severity VARCHAR(20),           -- 'critical', 'warning', 'info'

  -- Статус
  is_resolved BOOLEAN,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,

  created_at TIMESTAMPTZ
);
```

**LLM интеграция (GPT-4o-mini):**
```typescript
// Промпт для генерации объяснения
const prompt = `Ты — технический эксперт. Объясни ошибку простым языком.

Тип: ${error.error_type}
Код: ${error.error_code}
Ошибка: ${error.raw_error}
Действие: ${error.action}

Ответь в формате JSON:
{
  "explanation": "Что произошло простыми словами",
  "solution": "Как это исправить",
  "severity": "critical|warning|info"
}`;
```

**Типы ошибок:**
| Тип | Описание | Цвет |
|-----|----------|------|
| api | Ошибки REST API | синий |
| facebook | Facebook Marketing API | синий |
| cron | CRON задачи | фиолетовый |
| frontend | Клиентские ошибки | зелёный |

**Критичность:**
| Severity | Описание | Цвет |
|----------|----------|------|
| critical | Требует немедленного внимания | красный |
| warning | Важно, но не срочно | жёлтый |
| info | Информационное | серый |

---

## 8. Настройки (`/admin/settings`)

**Файлы:**
- Frontend: `services/frontend/src/pages/admin/AdminSettings.tsx`
- Backend: `services/agent-service/src/routes/adminSettings.ts`

**API:**
- `GET /admin/settings` — текущие настройки
- `PUT /admin/settings` — обновить настройки
- `GET /admin/cron/status` — статус CRON задач

**Настройки уведомлений:**
```typescript
{
  notifications: {
    messages_enabled: boolean,      // Уведомления о сообщениях
    registrations_enabled: boolean, // Уведомления о регистрациях
    system_enabled: boolean,        // Системные уведомления
    errors_enabled: boolean,        // Уведомления об ошибках
    daily_limit: number,            // Лимит в день
    weekly_limit: number,           // Лимит в неделю
    cooldown_minutes: number,       // Минимальный интервал
  }
}
```

**CRON задачи (отображение статуса):**
| Задача | Интервал |
|--------|----------|
| Creative Test Checker | каждые 5 минут |
| WhatsApp Monitor | каждые 5 минут |
| Competitor Crawler | раз в неделю |
| User Scoring | ежедневно в 03:00 |
| Engagement Notifications | ежедневно в 10:00 (Алматы) |

---

## 9. Аналитика (`/admin/analytics`)

**Файлы:**
- Frontend: `services/frontend/src/pages/AdminAnalytics.tsx` (существующий)
- Backend: `services/agent-service/src/routes/analytics.ts` (существующий)

*(Этот раздел уже существовал, просто интегрирован в новый layout)*

---

## Компоненты Layout

### AdminLayout
**Файл:** `services/frontend/src/components/admin/AdminLayout.tsx`

```tsx
<div className="flex h-screen">
  <AdminSidebar />
  <div className="flex-1 flex flex-col">
    <AdminHeader />
    <main className="flex-1 overflow-auto p-6">
      <Outlet />
    </main>
  </div>
</div>
```

### AdminSidebar
**Файл:** `services/frontend/src/components/admin/AdminSidebar.tsx`

**Пункты меню:**
| Иконка | Название | Путь | Бейдж |
|--------|----------|------|-------|
| LayoutDashboard | Дашборд | /admin | — |
| MessageSquare | Чаты | /admin/chats | Непрочитанные |
| Users | Пользователи | /admin/users | — |
| UserCheck | Онбординг | /admin/onboarding | — |
| BarChart3 | Реклама | /admin/ads | — |
| Target | Лиды | /admin/leads | — |
| AlertTriangle | Ошибки | /admin/errors | Нерешённые |
| Settings | Настройки | /admin/settings | — |
| LineChart | Аналитика | /admin/analytics | — |

### AdminHeader
**Файл:** `services/frontend/src/components/admin/AdminHeader.tsx`

**Элементы:**
- Логотип + "Admin Panel"
- Глобальный поиск (Cmd+K)
- Бейдж чатов (непрочитанные)
- Бейдж ошибок (нерешённые)
- Дропдаун уведомлений
- Дропдаун профиля

### AdminNotifications
**Файл:** `services/frontend/src/components/admin/AdminNotifications.tsx`

**Вкладки:**
| Вкладка | Тип | Описание |
|---------|-----|----------|
| Все | all | Все уведомления |
| Сообщения | message | От пользователей |
| Регистрации | registration | Новые юзеры |
| Система | system | Системные |

### AdminCommandPalette
**Файл:** `services/frontend/src/components/admin/AdminCommandPalette.tsx`

**Функционал:**
- Открывается по Cmd+K (или клику на поиск)
- Поиск по страницам админки
- Поиск по пользователям (API)
- Быстрая навигация

---

## Система уведомлений

**Миграция:** `migrations/086_admin_notifications.sql`

**Таблица admin_notifications:**
```sql
CREATE TABLE admin_notifications (
  id UUID PRIMARY KEY,
  type VARCHAR(50),        -- 'message', 'registration', 'system', 'error'
  title VARCHAR(200),
  message TEXT,
  metadata JSONB,          -- { userId, messageId, errorId, link }
  is_read BOOLEAN,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

**Автоматические триггеры:**

1. **trigger_notify_admin_on_user_message**
   - Срабатывает: INSERT в admin_user_chats
   - Условие: direction = 'from_user'
   - Создаёт: уведомление типа 'message'

2. **trigger_notify_admin_on_registration**
   - Срабатывает: INSERT в user_accounts
   - Создаёт: уведомление типа 'registration'

---

## Защита роутов

**Файл:** `services/frontend/src/components/AdminRoute.tsx`

```typescript
export const isUserAdmin = (): boolean => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  return user.is_tech_admin === true;
};

const AdminRoute = ({ children }) => {
  if (!isUserAdmin()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};
```

---

## Backend роуты

**Файл:** `services/agent-service/src/server.ts`

```typescript
// Админские роуты
app.register(adminChatRoutes);        // /admin/chats
app.register(adminStatsRoutes);       // /admin/stats
app.register(adminUsersRoutes);       // /admin/users
app.register(adminAdsRoutes);         // /admin/ads
app.register(adminLeadsRoutes);       // /admin/leads
app.register(adminErrorsRoutes);      // /admin/errors
app.register(adminNotificationsRoutes); // /admin/notifications
app.register(adminSettingsRoutes);    // /admin/settings
```

---

## Миграции (требуется применить)

### 085_error_logs.sql
- Таблица `error_logs` для логирования ошибок
- Индексы для быстрого поиска
- Поддержка LLM расшифровки

### 086_admin_notifications.sql
- Таблица `admin_notifications`
- Триггер на новые сообщения
- Триггер на новые регистрации

**Применение:**
```bash
# В Supabase SQL Editor выполнить:
# 1. Содержимое migrations/085_error_logs.sql
# 2. Содержимое migrations/086_admin_notifications.sql
```

---

## Чеклист деплоя

- [ ] Применить миграцию 085_error_logs.sql
- [ ] Применить миграцию 086_admin_notifications.sql
- [ ] Пересобрать agent-service: `docker-compose build agent-service`
- [ ] Пересобрать frontend: `docker-compose build frontend`
- [ ] Перезапустить: `docker-compose up -d`
- [ ] Проверить доступ: `/admin` под юзером с `is_tech_admin=true`

---

## Файловая структура

```
services/frontend/src/
├── components/admin/
│   ├── index.ts                    # Экспорт компонентов
│   ├── AdminLayout.tsx             # Главный layout
│   ├── AdminSidebar.tsx            # Боковое меню
│   ├── AdminHeader.tsx             # Шапка
│   ├── AdminNotifications.tsx      # Дропдаун уведомлений
│   └── AdminCommandPalette.tsx     # Глобальный поиск
├── pages/admin/
│   ├── index.ts                    # Экспорт страниц
│   ├── AdminDashboard.tsx          # Дашборд
│   ├── AdminChats.tsx              # Чаты
│   ├── AdminUsers.tsx              # Пользователи
│   ├── AdminAds.tsx                # Реклама
│   ├── AdminLeads.tsx              # Лиды
│   ├── AdminErrors.tsx             # Ошибки
│   └── AdminSettings.tsx           # Настройки
└── App.tsx                         # Роутинг

services/agent-service/src/routes/
├── adminChat.ts                    # (существующий)
├── adminStats.ts                   # Статистика дашборда
├── adminUsers.ts                   # Пользователи
├── adminAds.ts                     # Реклама и CPL
├── adminLeads.ts                   # Лиды
├── adminErrors.ts                  # Ошибки + LLM
├── adminNotifications.ts           # Уведомления
└── adminSettings.ts                # Настройки

migrations/
├── 085_error_logs.sql              # Таблица ошибок
└── 086_admin_notifications.sql     # Таблица уведомлений
```
