# 📅 СИСТЕМА КОНСУЛЬТАЦИЙ CRM

> **Цель:** Полная система управления консультациями с календарём, индивидуальными расписаниями консультантов и автоматическими WhatsApp уведомлениями клиентам.

---

## 📋 ОГЛАВЛЕНИЕ

1. [Архитектура системы](#архитектура-системы)
2. [База данных](#база-данных)
3. [Консультанты и расписания](#консультанты-и-расписания)
4. [Консультации](#консультации)
5. [Система уведомлений](#система-уведомлений)
6. [API Endpoints](#api-endpoints)
7. [Frontend компоненты](#frontend-компоненты)
8. [Cron Jobs](#cron-jobs)
9. [Конфигурация](#конфигурация)
10. [Troubleshooting](#troubleshooting)

---

## 🏗️ АРХИТЕКТУРА СИСТЕМЫ

### Схема работы:

```
┌─────────────────────────────────────────────────────────────┐
│                     ПОЛЬЗОВАТЕЛЬ                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  CRM FRONTEND (React)                                        │
│  ├─ Consultations.tsx (календарь)                            │
│  ├─ ConsultantScheduleManager.tsx (расписания)               │
│  └─ NotificationSettings.tsx (настройки уведомлений)         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS API
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  CRM BACKEND (Fastify)                                       │
│  ├─ routes/consultations.ts (CRUD консультаций)              │
│  ├─ routes/consultationNotifications.ts (настройки)          │
│  ├─ lib/consultationNotifications.ts (логика отправки)       │
│  ├─ lib/evolutionApi.ts (WhatsApp интеграция)                │
│  └─ cron/notificationCron.ts (фоновая обработка)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────────┐         ┌──────────────────┐
│  SUPABASE        │         │  EVOLUTION API   │
│  (PostgreSQL)    │         │  (WhatsApp)      │
│                  │         │                  │
│  Tables:         │         │  Отправка:       │
│  - consultants   │         │  - Подтверждения │
│  - consultant_   │         │  - Напоминания   │
│    schedules     │         │  - Кастомные     │
│  - consultations │         │                  │
│  - consultation_ │         │                  │
│    notifications │         │                  │
└──────────────────┘         └──────────────────┘
```

### Ключевые компоненты:

| Компонент | Путь | Описание |
|-----------|------|----------|
| Консультации API | `crm-backend/src/routes/consultations.ts` | CRUD операции консультаций |
| Уведомления API | `crm-backend/src/routes/consultationNotifications.ts` | Настройки и шаблоны |
| Логика уведомлений | `crm-backend/src/lib/consultationNotifications.ts` | Отправка и планирование |
| WhatsApp | `crm-backend/src/lib/evolutionApi.ts` | Интеграция с Evolution API |
| Cron | `crm-backend/src/cron/notificationCron.ts` | Фоновые задачи |
| Frontend | `crm-frontend/src/pages/Consultations.tsx` | Календарь консультаций |

---

## 💾 БАЗА ДАННЫХ

### Миграции

Миграции в директории `services/crm-backend/migrations/`:

| Файл | Описание |
|------|----------|
| `008_add_consultations.sql` | Базовые таблицы консультаций |
| `009_add_consultant_schedules.sql` | Индивидуальные расписания |
| `010_consultation_slots_all_day.sql` | Круглосуточные слоты (00:00-24:00) |
| `011_add_consultation_notifications.sql` | Система уведомлений |

### Таблицы

#### `consultants` - Консультанты

```sql
CREATE TABLE consultants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    specialization VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    color VARCHAR(7) DEFAULT '#3B82F6',  -- Цвет в календаре
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `consultant_schedules` - Индивидуальные расписания

```sql
CREATE TABLE consultant_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    -- 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_working BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(consultant_id, day_of_week)
);
```

#### `consultations` - Записи на консультации

```sql
CREATE TABLE consultations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
    consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,
    dialog_analysis_id UUID REFERENCES dialog_analysis(id) ON DELETE SET NULL,

    client_name VARCHAR(255),
    client_phone VARCHAR(50) NOT NULL,

    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,

    status VARCHAR(50) DEFAULT 'scheduled',  -- scheduled, completed, cancelled, no_show
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `consultation_notification_settings` - Настройки уведомлений

```sql
CREATE TABLE consultation_notification_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE UNIQUE,

    -- Подтверждение записи
    confirmation_enabled BOOLEAN DEFAULT true,
    confirmation_template TEXT DEFAULT 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!',

    -- Напоминание за 24 часа
    reminder_24h_enabled BOOLEAN DEFAULT true,
    reminder_24h_template TEXT DEFAULT 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!',

    -- Напоминание за 1 час
    reminder_1h_enabled BOOLEAN DEFAULT true,
    reminder_1h_template TEXT DEFAULT 'Через час у вас консультация в {{time}}. До скорой встречи!',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `consultation_notification_templates` - Кастомные шаблоны

```sql
CREATE TABLE consultation_notification_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,              -- "За 3 дня до визита"
    minutes_before INTEGER NOT NULL,         -- 4320 = 3 дня
    template TEXT NOT NULL,                  -- Текст с переменными
    is_enabled BOOLEAN DEFAULT true,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `consultation_notifications` - История уведомлений

```sql
CREATE TABLE consultation_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,

    notification_type VARCHAR(50) NOT NULL,  -- confirmation, reminder_24h, reminder_1h, custom
    template_id UUID REFERENCES consultation_notification_templates(id) ON DELETE SET NULL,

    message_text TEXT NOT NULL,              -- Финальный текст
    instance_name VARCHAR(255),              -- WhatsApp инстанс
    phone VARCHAR(50) NOT NULL,

    status VARCHAR(50) DEFAULT 'pending',    -- pending, sent, failed, skipped
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,           -- Количество попыток

    scheduled_at TIMESTAMP WITH TIME ZONE,   -- Когда должно быть отправлено
    sent_at TIMESTAMP WITH TIME ZONE,        -- Когда реально отправлено

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 👨‍💼 КОНСУЛЬТАНТЫ И РАСПИСАНИЯ

### Создание консультанта

```bash
# POST /consultants
curl -X POST http://localhost:8084/consultants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Иван Петров",
    "specialization": "Психолог",
    "phone": "+79001234567",
    "email": "ivan@example.com",
    "color": "#3B82F6",
    "user_account_id": "uuid-here"
  }'
```

### Настройка расписания

Каждый консультант имеет индивидуальное расписание работы:

```bash
# POST /consultants/:id/schedules
curl -X POST http://localhost:8084/consultants/{id}/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "schedules": [
      { "day_of_week": 1, "start_time": "09:00", "end_time": "18:00", "is_working": true },
      { "day_of_week": 2, "start_time": "09:00", "end_time": "18:00", "is_working": true },
      { "day_of_week": 3, "start_time": "09:00", "end_time": "18:00", "is_working": true },
      { "day_of_week": 4, "start_time": "09:00", "end_time": "18:00", "is_working": true },
      { "day_of_week": 5, "start_time": "09:00", "end_time": "17:00", "is_working": true },
      { "day_of_week": 6, "start_time": "10:00", "end_time": "14:00", "is_working": true },
      { "day_of_week": 0, "start_time": "00:00", "end_time": "00:00", "is_working": false }
    ]
  }'
```

### Получение доступных слотов

```bash
# GET /consultations/available-slots?date=2024-01-15&consultant_id=uuid
curl "http://localhost:8084/consultations/available-slots?date=2024-01-15&consultant_id={id}"
```

**Ответ:**
```json
{
  "slots": [
    { "start_time": "09:00", "end_time": "09:30" },
    { "start_time": "09:30", "end_time": "10:00" },
    { "start_time": "10:00", "end_time": "10:30" }
  ]
}
```

Слоты генерируются с интервалом **30 минут** на основе:
- Расписания работы консультанта на этот день недели
- Уже забронированных консультаций

---

## 📆 КОНСУЛЬТАЦИИ

### Создание консультации

```bash
# POST /consultations
curl -X POST http://localhost:8084/consultations \
  -H "Content-Type: application/json" \
  -d '{
    "consultant_id": "uuid",
    "user_account_id": "uuid",
    "dialog_analysis_id": "uuid",  // Опционально - для привязки к диалогу
    "client_name": "Мария Иванова",
    "client_phone": "+79001234567",
    "date": "2024-01-15",
    "start_time": "10:00",
    "end_time": "10:30",
    "notes": "Первичная консультация"
  }'
```

При создании автоматически:
1. Отправляется **подтверждение** в WhatsApp (если включено)
2. Планируются **напоминания** за 24 часа и за 1 час (если включены)
3. Планируются **кастомные напоминания** (если настроены)

### Статусы консультации

| Статус | Описание |
|--------|----------|
| `scheduled` | Запланирована |
| `completed` | Проведена |
| `cancelled` | Отменена (уведомления отменяются) |
| `no_show` | Клиент не пришёл |

### Отмена консультации

```bash
# PUT /consultations/:id
curl -X PUT http://localhost:8084/consultations/{id} \
  -H "Content-Type: application/json" \
  -d '{ "status": "cancelled" }'
```

При отмене все **pending** уведомления автоматически помечаются как `skipped`.

---

## 📲 СИСТЕМА УВЕДОМЛЕНИЙ

### Типы уведомлений

| Тип | Время отправки | Описание |
|-----|----------------|----------|
| `confirmation` | Сразу при создании | Подтверждение записи |
| `reminder_24h` | За 24 часа | Напоминание за сутки |
| `reminder_1h` | За 1 час | Напоминание за час |
| `custom` | Настраиваемое | Кастомные шаблоны |

### Статусы уведомлений

| Статус | Описание |
|--------|----------|
| `pending` | Ожидает отправки |
| `sent` | Успешно отправлено |
| `failed` | Ошибка отправки |
| `skipped` | Пропущено (отключено в настройках или консультация отменена) |

### Шаблонные переменные

| Переменная | Описание | Пример |
|------------|----------|--------|
| `{{client_name}}` | Имя клиента | Мария |
| `{{date}}` | Дата в русском формате | 15 января |
| `{{time}}` | Время начала | 10:00 |
| `{{consultant_name}}` | Имя консультанта | Иван Петров |

### Условные секции

Синтаксис: `{{#variable}}текст{{/variable}}`

Текст показывается только если переменная не пустая:

```
Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}!
```

Результат:
- Если `client_name = "Мария"`: "Здравствуйте, Мария!"
- Если `client_name` пустое: "Здравствуйте!"

### Логика отправки

```
┌─────────────────┐
│  Создание       │
│  консультации   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Валидация      │──→ Invalid → Skip
│  телефона       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Получение      │──→ Нет инстанса → Fail
│  WhatsApp       │
│  инстанса       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Отправка       │──→ Ошибка → Retry (до 3 раз)
│  подтверждения  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Планирование   │
│  напоминаний    │
│  (pending)      │
└─────────────────┘
         │
         │ Cron (каждую минуту)
         ▼
┌─────────────────┐
│  Обработка      │
│  pending        │
│  уведомлений    │
└─────────────────┘
```

### Выбор WhatsApp инстанса

Приоритет:
1. Инстанс из `dialog_analysis.instance_name` (если консультация создана из диалога)
2. Первый активный (`status = 'connected'`) инстанс пользователя

---

## 🔌 API ENDPOINTS

### Консультации

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/consultations` | Список консультаций с фильтрами |
| GET | `/consultations/:id` | Получить консультацию |
| POST | `/consultations` | Создать консультацию |
| PUT | `/consultations/:id` | Обновить консультацию |
| DELETE | `/consultations/:id` | Удалить консультацию |
| GET | `/consultations/available-slots` | Доступные слоты |

### Консультанты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/consultants` | Список консультантов |
| GET | `/consultants/:id` | Получить консультанта |
| POST | `/consultants` | Создать консультанта |
| PUT | `/consultants/:id` | Обновить консультанта |
| DELETE | `/consultants/:id` | Удалить консультанта |
| GET | `/consultants/:id/schedules` | Расписание консультанта |
| POST | `/consultants/:id/schedules` | Установить расписание |

### Настройки уведомлений

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/consultation-notifications/settings` | Получить настройки |
| PUT | `/consultation-notifications/settings` | Обновить настройки |
| GET | `/consultation-notifications/templates` | Список кастомных шаблонов |
| POST | `/consultation-notifications/templates` | Создать шаблон |
| PUT | `/consultation-notifications/templates/:id` | Обновить шаблон |
| DELETE | `/consultation-notifications/templates/:id` | Удалить шаблон |
| GET | `/consultation-notifications/history/:consultationId` | История уведомлений |

---

## 🎨 FRONTEND КОМПОНЕНТЫ

### Consultations.tsx

Основной компонент календаря:

```tsx
import { Consultations } from '@/pages/Consultations';

// Используется на странице /consultations
```

**Функции:**
- Просмотр консультаций (день/неделя/месяц)
- Создание консультаций через модальное окно
- Редактирование и отмена консультаций
- Цветовая маркировка по консультантам
- Фильтрация по консультанту и статусу

### ConsultantScheduleManager.tsx

Управление расписанием консультанта:

```tsx
import { ConsultantScheduleManager } from '@/components/ConsultantScheduleManager';

<ConsultantScheduleManager
  consultant={selectedConsultant}
  onClose={() => setIsOpen(false)}
/>
```

### NotificationSettings.tsx

Настройки уведомлений:

```tsx
import { NotificationSettings } from '@/components/NotificationSettings';

<NotificationSettings
  userAccountId={userAccountId}
  isOpen={isSettingsOpen}
  onClose={() => setIsSettingsOpen(false)}
/>
```

**Функции:**
- Включение/отключение стандартных уведомлений
- Редактирование шаблонов
- Управление кастомными напоминаниями
- Предпросмотр переменных

---

## ⏰ CRON JOBS

### Запуск

Cron jobs запускаются автоматически при старте `crm-backend`:

```typescript
// server.ts
import { startNotificationCron } from './cron/notificationCron.js';

startNotificationCron();
```

### Задачи

| Задача | Интервал | Описание |
|--------|----------|----------|
| Processing | 1 минута | Обработка pending уведомлений |
| Retry | 5 минут | Повторные попытки для failed |
| Stats | 10 минут | Логирование статистики |

### Логи

```
[NotificationCron] Processing completed {processed: 5, sent: 4, failed: 1}
[NotificationCron] Notifications queued for retry {count: 3}
[NotificationCron] Notification statistics {pending: 10, sent: 150, failed: 5, skipped: 2}
```

---

## ⚙️ КОНФИГУРАЦИЯ

### Переменные окружения

```bash
# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=your-api-key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-key
```

### Константы (consultationNotifications.ts)

```typescript
// Московский часовой пояс (UTC+3)
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

// Максимум попыток для failed уведомлений
const MAX_RETRY_ATTEMPTS = 3;

// Минимальное время до консультации для планирования
const MIN_SCHEDULE_AHEAD_MS = 5 * 60 * 1000;  // 5 минут
```

### Интервалы слотов

```typescript
// routes/consultations.ts
const SLOT_INTERVAL_MINUTES = 30;  // Интервал слотов в минутах
```

---

## 🆘 TROUBLESHOOTING

### Проблема: Уведомления не отправляются

**Проверки:**

1. Проверить cron job:
```bash
docker logs crm-backend | grep NotificationCron
```

2. Проверить статус уведомлений в БД:
```sql
SELECT status, COUNT(*)
FROM consultation_notifications
GROUP BY status;
```

3. Проверить WhatsApp инстанс:
```sql
SELECT instance_name, status
FROM whatsapp_instances
WHERE user_account_id = 'uuid';
```

4. Проверить логи Evolution API:
```bash
docker logs evolution-api | grep error
```

### Проблема: Напоминания не планируются

**Проверки:**

1. Время консультации не в прошлом?
2. `user_account_id` задан у консультации?
3. Телефон клиента валидный (минимум 10 цифр)?

### Проблема: Неправильный часовой пояс

Система использует московское время (UTC+3). Даты/время в БД хранятся в московском формате.

### Проблема: Двойные уведомления

Cron использует `LIMIT 50` и проверяет `status = 'pending'` перед обработкой. При обновлении статуса происходит мгновенно после обработки.

### Логи для диагностики

```bash
# Все логи уведомлений
docker logs crm-backend | grep "Notification"

# Логи Evolution API
docker logs crm-backend | grep "EvolutionAPI"

# Ошибки
docker logs crm-backend | grep error
```

---

## 📊 МОНИТОРИНГ

### Статистика уведомлений

```sql
-- Статистика за последние 24 часа
SELECT
    notification_type,
    status,
    COUNT(*) as count
FROM consultation_notifications
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY notification_type, status
ORDER BY notification_type, status;
```

### Success Rate

```sql
-- Процент успешных отправок
SELECT
    ROUND(
        (COUNT(*) FILTER (WHERE status = 'sent')::numeric /
         COUNT(*) FILTER (WHERE status IN ('sent', 'failed'))::numeric) * 100,
        1
    ) as success_rate
FROM consultation_notifications
WHERE created_at > NOW() - INTERVAL '7 days';
```

### Pending уведомления

```sql
-- Застрявшие в pending больше часа
SELECT cn.*, c.client_name, c.date, c.start_time
FROM consultation_notifications cn
JOIN consultations c ON cn.consultation_id = c.id
WHERE cn.status = 'pending'
  AND cn.scheduled_at < NOW() - INTERVAL '1 hour';
```

---

## 🔄 ЖИЗНЕННЫЙ ЦИКЛ КОНСУЛЬТАЦИИ

```
                    ┌─────────────┐
                    │  Создание   │
                    │ консультации│
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────────┐ ┌──────────┐ ┌──────────────┐
    │ Подтверждение│ │Reminder  │ │  Reminder    │
    │    (сразу)   │ │  24h     │ │    1h        │
    │              │ │(pending) │ │  (pending)   │
    └──────────────┘ └────┬─────┘ └──────┬───────┘
                          │              │
                          ▼              ▼
                     ┌────────────────────────┐
                     │    Cron обработка      │
                     │   (каждую минуту)      │
                     └────────────┬───────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
          ┌──────────┐     ┌──────────┐     ┌──────────┐
          │   Sent   │     │  Failed  │     │ Skipped  │
          │(успешно) │     │ (ошибка) │     │(отменено)│
          └──────────┘     └────┬─────┘     └──────────┘
                                │
                                ▼ (retry < 3)
                          ┌──────────┐
                          │ Pending  │
                          │ (повтор) │
                          └──────────┘
```

---

## ✅ ЧЕКЛИСТ НАСТРОЙКИ

- [ ] Миграции применены (008-011)
- [ ] Evolution API настроен и запущен
- [ ] WhatsApp инстанс подключен (status = 'connected')
- [ ] user_account_id настроен для консультантов и консультаций
- [ ] Cron job запущен (`startNotificationCron()` в server.ts)
- [ ] Настройки уведомлений проверены в UI
- [ ] Тестовая консультация создана и уведомление получено

---

**Система готова к использованию! 🎉**
