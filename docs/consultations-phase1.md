# Консультации — Фаза 1: Услуги, Онлайн-запись, Аналитика

Документация по реализации улучшений системы консультаций, вдохновлённых Alteg.io API.

## Содержание

1. [Обзор](#обзор)
2. [Услуги консультаций](#услуги-консультаций)
3. [Публичный виджет онлайн-записи](#публичный-виджет-онлайн-записи)
4. [Расширенная статистика](#расширенная-статистика)
5. [API Reference](#api-reference)
6. [База данных](#база-данных)
7. [Безопасность](#безопасность)

---

## Обзор

Фаза 1 включает три основных компонента:

| Компонент | Описание |
|-----------|----------|
| **Услуги** | Каталог услуг с ценами, длительностью и цветовой маркировкой |
| **Онлайн-запись** | Публичный виджет для самостоятельной записи клиентов |
| **Аналитика** | Расширенная статистика с выручкой, конверсиями и разбивкой по измерениям |

---

## Услуги консультаций

### Описание

Услуги позволяют:
- Определить типы консультаций с ценами и длительностью
- Назначить услуги конкретным консультантам (с кастомными ценами)
- Автоматически рассчитывать время окончания при записи
- Отслеживать выручку по услугам

### Структура услуги

```typescript
interface ConsultationService {
  id: string;
  user_account_id: string;
  name: string;                    // Название услуги
  description?: string;            // Описание (до 500 символов)
  duration_minutes: number;        // Длительность (15-480 минут)
  price: number;                   // Цена (0-1,000,000)
  currency: string;                // Валюта (RUB)
  color: string;                   // Цвет для UI (#RRGGBB)
  is_active: boolean;              // Активна ли услуга
  sort_order: number;              // Порядок сортировки
}
```

### Назначение услуг консультантам

Консультанты могут иметь:
- **Все услуги** — если нет специфических назначений
- **Определённые услуги** — с возможностью кастомной цены/длительности

```typescript
interface ConsultantService {
  consultant_id: string;
  service_id: string;
  custom_price?: number;           // Кастомная цена (опционально)
  custom_duration?: number;        // Кастомная длительность (опционально)
  is_active: boolean;
}
```

### UI компонент

Компонент `ServiceSettings` (`/components/ServiceSettings.tsx`):
- Создание/редактирование/удаление услуг
- Выбор цвета через color picker
- Сортировка drag-and-drop

---

## Публичный виджет онлайн-записи

### Описание

Публичный виджет позволяет клиентам самостоятельно записываться на консультации без авторизации.

**URL виджета:** `/book/:userAccountId`

### Шаги записи

1. **Выбор услуги** — отображаются все активные услуги с ценами
2. **Выбор консультанта** — фильтрация по выбранной услуге
3. **Выбор даты и времени** — недельный календарь с доступными слотами
4. **Ввод контактов** — имя и телефон клиента
5. **Подтверждение** — сообщение об успешной записи

### Ограничения

| Параметр | Значение |
|----------|----------|
| Минимальное время до записи | 2 часа |
| Максимум дней вперёд | 60 дней |
| Формат телефона | +7 (XXX) XXX-XX-XX, 8XXXXXXXXXX |

### Уведомления

После успешной записи автоматически:
- Отправляется подтверждение (SMS/WhatsApp)
- Планируются напоминания (24ч, 1ч до консультации)

---

## Расширенная статистика

### Описание

Дашборд аналитики с ключевыми метриками консультаций.

### Периоды

- `week` — последние 7 дней
- `month` — последние 30 дней (по умолчанию)
- `quarter` — последние 3 месяца
- `year` — последние 12 месяцев

### Метрики

#### Сводка
```typescript
summary: {
  total: number;           // Всего записей
  completed: number;       // Завершённых
  cancelled: number;       // Отменённых
  no_show: number;         // Неявок
  sales_closed: number;    // Закрытых продаж
  total_revenue: number;   // Общая выручка
}
```

#### Конверсии
```typescript
rates: {
  completion_rate: number;        // % завершённых
  sales_conversion_rate: number;  // % продаж от завершённых
  no_show_rate: number;           // % неявок
  cancellation_rate: number;      // % отмен
}
```

#### Разбивки
- **По консультантам** — выручка, кол-во, конверсия каждого
- **По услугам** — популярность и выручка услуг
- **По дням недели** — распределение записей (Пн-Вс)
- **По часам** — популярные часы (8:00-20:00)
- **По источникам** — ручная запись, онлайн, бот

### UI компонент

Компонент `ExtendedStats` (`/components/ExtendedStats.tsx`):
- Карточки с ключевыми метриками
- Графики распределения по дням/часам
- Таблицы по консультантам и услугам
- Переключатель периода

---

## API Reference

### Услуги (Consultation Services)

#### GET /consultation-services
Получить список услуг.

**Query параметры:**
- `user_account_id` (required) — UUID аккаунта
- `include_inactive` — включить неактивные (default: false)

**Response:** `ConsultationService[]`

#### POST /consultation-services
Создать услугу.

**Body:**
```json
{
  "user_account_id": "uuid",
  "name": "Первичная консультация",
  "duration_minutes": 60,
  "price": 5000,
  "color": "#3B82F6"
}
```

#### PATCH /consultation-services/:id
Обновить услугу.

#### DELETE /consultation-services/:id
Деактивировать услугу (soft delete). Добавьте `?hard=true` для полного удаления.

---

### Назначения услуг (Consultant Services)

#### GET /consultant-services/:consultantId
Получить услуги консультанта.

#### POST /consultant-services
Назначить услугу консультанту.

```json
{
  "consultant_id": "uuid",
  "service_id": "uuid",
  "custom_price": 4500
}
```

#### PUT /consultant-services/bulk/:consultantId
Массовое обновление (замена всех назначений).

```json
{
  "service_ids": ["uuid1", "uuid2"]
}
```

---

### Публичная запись (Public Booking)

#### GET /public/booking/:userAccountId/config
Конфигурация виджета (консультанты, услуги, настройки).

#### GET /public/booking/:userAccountId/slots
Доступные слоты.

**Query параметры:**
- `consultant_id` — фильтр по консультанту
- `service_id` — для расчёта длительности
- `date` — конкретная дата
- `days_ahead` — дней вперёд (default: 14, max: 30)
- `timezone` — таймзона (default: Europe/Moscow)

#### POST /public/booking
Создать запись.

```json
{
  "user_account_id": "uuid",
  "consultant_id": "uuid",
  "service_id": "uuid",
  "client_name": "Иван Петров",
  "client_phone": "+7 999 123-45-67",
  "date": "2024-01-15",
  "start_time": "14:00",
  "notes": "Первичная консультация"
}
```

**Response:**
```json
{
  "success": true,
  "consultation_id": "uuid",
  "message": "Вы успешно записаны на 15 января в 14:00...",
  "details": {
    "date": "2024-01-15",
    "time": "14:00",
    "consultant": "Анна Смирнова",
    "service": "Первичная консультация",
    "duration_minutes": 60
  }
}
```

---

### Расширенная статистика

#### GET /consultations/stats/extended
Получить расширенную статистику.

**Query параметры:**
- `period` — week | month | quarter | year (default: month)
- `user_account_id` — фильтр по аккаунту

**Response:**
```json
{
  "period": { "start": "2024-01-01", "end": "2024-01-31" },
  "summary": { "total": 150, "completed": 120, "total_revenue": 450000, ... },
  "rates": { "completion_rate": 80, "sales_conversion_rate": 25, ... },
  "by_consultant": [...],
  "by_service": [...],
  "by_day_of_week": [10, 25, 30, 28, 32, 15, 10],
  "by_hour": [0, 0, ..., 5, 12, 18, 22, 15, ...],
  "by_source": { "online_booking": 80, "bot": 50, "general": 20 }
}
```

---

## База данных

### Миграция

Файл: `migrations/135_consultation_services.sql`

### Новые таблицы

#### consultation_services
```sql
CREATE TABLE consultation_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_account_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 60,
  price NUMERIC(10,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'RUB',
  color VARCHAR(7) DEFAULT '#3B82F6',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### consultant_services
```sql
CREATE TABLE consultant_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE,
  service_id UUID REFERENCES consultation_services(id) ON DELETE CASCADE,
  custom_price NUMERIC(10,2),
  custom_duration INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(consultant_id, service_id)
);
```

### Изменения в consultations
```sql
ALTER TABLE consultations
  ADD COLUMN service_id UUID REFERENCES consultation_services(id),
  ADD COLUMN price NUMERIC(10,2);
```

---

## Безопасность

### Валидация входных данных

| Поле | Валидация |
|------|-----------|
| UUID | Формат `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| Телефон | 10-15 цифр, нормализация в +7 |
| Имя | 2-100 символов, санитизация XSS |
| Цена | 0 - 1,000,000 |
| Длительность | 15 - 480 минут |
| Дата | Формат YYYY-MM-DD, +2ч..+60 дней |

### Санитизация XSS

```typescript
const sanitizeString = (str: string): string => {
  return str
    .replace(/[<>]/g, '')           // Убрать angle brackets
    .replace(/javascript:/gi, '')    // Убрать javascript: protocol
    .replace(/on\w+=/gi, '')        // Убрать event handlers
    .trim();
};
```

### Rate Limiting

Рекомендуемые лимиты (настроить на уровне nginx/proxy):

| Endpoint | Лимит |
|----------|-------|
| POST /public/booking | 5 req/min per IP |
| GET /public/booking/*/slots | 30 req/min per IP |
| GET /public/booking/*/config | 60 req/min per IP |

### Логирование

Все запросы логируются с:
- `requestId` — уникальный ID для трейсинга
- `durationMs` — время выполнения
- Контекст операции (userAccountId, consultantId, etc.)

Формат логов:
```
info: Consultation created successfully {"requestId":"pub_1704067200_abc123","consultationId":"...","durationMs":145}
warn: Invalid phone number format {"requestId":"pub_1704067200_def456","phone":"123"}
error: Failed to create consultation {"requestId":"pub_1704067200_ghi789","error":"...","code":"23505"}
```

---

## Файлы реализации

### Backend
- `services/crm-backend/src/routes/consultationServices.ts` — CRUD услуг
- `services/crm-backend/src/routes/publicBooking.ts` — публичный API записи
- `services/crm-backend/src/routes/consultations.ts` — stats/extended endpoint

### Frontend
- `services/crm-frontend/src/components/ServiceSettings.tsx` — управление услугами
- `services/crm-frontend/src/components/ExtendedStats.tsx` — дашборд аналитики
- `services/crm-frontend/src/pages/PublicBooking.tsx` — виджет онлайн-записи
- `services/crm-frontend/src/types/consultation.ts` — типы TypeScript
- `services/crm-frontend/src/services/consultationService.ts` — API клиент

### Миграции
- `migrations/135_consultation_services.sql`

---

## Дальнейшие улучшения (Фаза 2+)

- [ ] Групповые консультации
- [ ] Программа лояльности
- [ ] Интеграция с платёжными системами
- [ ] Email-уведомления
- [ ] Встраиваемый iframe виджет
- [ ] Кастомизация брендинга виджета
