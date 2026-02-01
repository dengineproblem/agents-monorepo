# Система консультантов CRM

Полная документация по разделу персональных страниц консультантов.

## Содержание

- [Обзор](#обзор)
- [Архитектура](#архитектура)
- [Backend API](#backend-api)
- [Frontend компоненты](#frontend-компоненты)
- [Авторизация и роли](#авторизация-и-роли)
- [Функциональность по разделам](#функциональность-по-разделам)
- [Типы данных](#типы-данных)
- [Примеры использования](#примеры-использования)

---

## Обзор

Система консультантов предоставляет персональные страницы для консультантов с полным функционалом управления:
- Календарь консультаций с временными слотами
- Управление лидами и переписка
- Настройка расписания работы
- Выбор и настройка услуг
- Редактирование профиля

### URL структура
```
/c/:consultantId - Персональная страница консультанта
```

Пример: `/c/4d71d287-582b-446e-9ee0-be4a6dee5144`

### Особенности
- ✅ Без sidebar (отдельный layout)
- ✅ Доступ только для консультанта и админов
- ✅ Полная изоляция данных между консультантами
- ✅ Real-time обновление данных
- ✅ Адаптивный дизайн
- ✅ Управление распределением лидов (админ может отключить консультанта от автоматического распределения)

---

## Архитектура

### Технологический стек

#### Backend
- **Framework**: Fastify + TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Custom middleware с проверкой ролей
- **Port**: 8084

#### Frontend
- **Framework**: React + TypeScript
- **Routing**: React Router v6
- **UI**: shadcn/ui + TailwindCSS
- **State**: React Hooks (useState, useEffect)
- **Port**: 3002

### Структура файлов

```
services/
├── crm-backend/
│   └── src/
│       ├── middleware/
│       │   └── consultantAuth.ts          # Auth middleware
│       ├── routes/
│       │   ├── consultantDashboard.ts     # Consultant API endpoints
│       │   └── consultantSales.ts         # Sales API endpoints
│       └── lib/
│           └── supabase.ts                # Supabase клиент с настройками
│
└── crm-frontend/
    └── src/
        ├── components/consultant/
        │   ├── CalendarTab.tsx            # Календарь со слотами
        │   ├── LeadsTab.tsx               # Управление лидами
        │   ├── ScheduleTab.tsx            # Настройка расписания
        │   ├── SalesTab.tsx               # Управление продажами
        │   └── ProfileTab.tsx             # Редактирование профиля
        ├── pages/
        │   └── ConsultantPage.tsx         # Главная страница
        ├── services/
        │   ├── consultantApi.ts           # API методы
        │   ├── consultationService.ts     # Сервисы консультаций
        │   └── salesApi.ts                # API методы продаж
        ├── types/
        │   └── sales.ts                   # Типы для продаж
        └── contexts/
            └── AuthContext.tsx            # Контекст авторизации
```

---

## Backend API

### Base URL
```
http://localhost:8084
```

### Аутентификация
Все запросы требуют заголовок:
```
x-user-id: <user_account_id>
```

### Endpoints

#### Dashboard

**GET /consultant/dashboard**

Получить статистику консультанта.

Query параметры:
- `consultantId` (опционально, только для админов)

Response:
```json
{
  "consultant_id": "uuid",
  "total_leads": 25,
  "hot_leads": 10,
  "warm_leads": 8,
  "cold_leads": 7,
  "booked_leads": 12,
  "total_consultations": 45,
  "scheduled": 5,
  "confirmed": 3,
  "completed": 35,
  "cancelled": 2,
  "no_show": 0,
  "total_revenue": 125000,
  "completion_rate": 77.8
}
```

#### Лиды

**GET /consultant/leads**

Получить список лидов консультанта.

Query параметры:
- `consultantId` - ID консультанта (опционально, только для админов)
- `status` - статус лида
- `interest_level` - hot/warm/cold
- `is_booked` - true/false
- `limit` - лимит записей
- `offset` - смещение

Response:
```json
{
  "leads": [
    {
      "id": "uuid",
      "contact_phone": "+79991234567",
      "contact_name": "Иван Иванов",
      "interest_level": "hot",
      "funnel_stage": "consultation_booked",
      "last_message": "2026-01-31T10:00:00Z",
      "assigned_consultant_id": "uuid"
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

#### Консультации

**GET /consultant/consultations**

Получить консультации консультанта.

Query параметры:
- `date` - дата (YYYY-MM-DD)
- `status` - scheduled/confirmed/completed/cancelled/no_show
- `from_date` - начало периода
- `to_date` - конец периода

Response:
```json
[
  {
    "id": "uuid",
    "consultant_id": "uuid",
    "date": "2026-01-31",
    "start_time": "14:00",
    "end_time": "14:30",
    "status": "scheduled",
    "service_name": "Онлайн-консультация",
    "price": 3000,
    "lead": {
      "contact_name": "Иван Иванов",
      "contact_phone": "+79991234567",
      "interest_level": "hot"
    }
  }
]
```

#### Расписание

**GET /consultant/schedule**

Получить расписание работы консультанта.

Query параметры:
- `consultantId` (опционально, только для админов)

Response:
```json
[
  {
    "id": "uuid",
    "consultant_id": "uuid",
    "day_of_week": 1,
    "start_time": "09:00",
    "end_time": "18:00",
    "is_active": true
  }
]
```

**PUT /consultant/schedule**

Обновить расписание.

Request:
```json
{
  "schedules": [
    {
      "day_of_week": 1,
      "start_time": "09:00",
      "end_time": "18:00",
      "is_active": true
    }
  ]
}
```

#### Услуги

**GET /consultant/services**

Получить список услуг консультанта.

Query параметры:
- `consultantId` (опционально, только для админов)

Response:
```json
[
  {
    "id": "uuid",
    "name": "Онлайн-консультация",
    "description": "Консультация по видеосвязи",
    "price": 3000,
    "duration_minutes": 30,
    "is_active": true,
    "is_provided": true,
    "consultant_service": {
      "custom_price": 3500,
      "custom_duration": 45,
      "is_active": true
    }
  }
]
```

**PUT /consultant/services**

Обновить список услуг консультанта.

Request:
```json
{
  "services": [
    {
      "service_id": "uuid",
      "custom_price": 3500,
      "custom_duration": 45,
      "is_active": true
    }
  ],
  "consultantId": "uuid"
}
```

#### Профиль

**GET /consultant/profile**

Получить профиль консультанта.

Query параметры:
- `consultantId` (опционально, только для админов)

Response:
```json
{
  "id": "uuid",
  "name": "Анатолий",
  "phone": "+77058151655",
  "email": "business@example.com",
  "specialization": "Маркетинг и реклама",
  "user_account_id": "uuid",
  "is_active": true,
  "accepts_new_leads": true
}
```

**PUT /consultant/profile**

Обновить профиль.

Request:
```json
{
  "name": "Анатолий",
  "phone": "+77058151655",
  "email": "business@example.com",
  "specialization": "Маркетинг и реклама"
}
```

#### Смена пароля

**PUT /consultant/change-password**

Изменить пароль консультанта.

Request:
```json
{
  "current_password": "1234",
  "new_password": "newpass123"
}
```

Response:
```json
{
  "success": true,
  "message": "Пароль успешно изменен"
}
```

#### Управление приёмом лидов (Admin)

**PUT /admin/consultants/:consultantId/accepts-new-leads**

Включить/отключить консультанта от автоматического распределения новых лидов (только для админов).

Request:
```json
{
  "acceptsNewLeads": false
}
```

Response:
```json
{
  "success": true,
  "consultant": {
    "id": "uuid",
    "name": "Анатолий",
    "is_active": true,
    "accepts_new_leads": false
  },
  "message": "Консультант Анатолий отключён от распределения новых лидов"
}
```

**Важно**:
- Флаг `accepts_new_leads` управляет только автоматическим распределением новых лидов
- Расписание и слоты консультанта остаются активными
- Уже назначенные лиды остаются за консультантом
- Консультант может продолжать работать с текущими лидами

#### Журнал звонков

**POST /consultant/call-log**

Добавить запись о звонке.

Request:
```json
{
  "lead_id": "uuid",
  "result": "answered",
  "notes": "Договорились о встрече",
  "next_follow_up": "2026-02-01T14:00:00Z"
}
```

**GET /consultant/call-logs/:leadId**

Получить историю звонков по лиду.

Response:
```json
[
  {
    "id": "uuid",
    "consultant_id": "uuid",
    "lead_id": "uuid",
    "called_at": "2026-01-31T10:00:00Z",
    "result": "answered",
    "notes": "Договорились о встрече",
    "next_follow_up": "2026-02-01T14:00:00Z"
  }
]
```

#### Сообщения

**POST /consultant/send-message**

Отправить сообщение лиду.

Request:
```json
{
  "leadId": "uuid",
  "message": "Здравствуйте! Когда вам удобно встретиться?"
}
```

Response:
```json
{
  "success": true,
  "messageId": "uuid"
}
```

**GET /consultant/messages/:leadId**

Получить переписку с лидом.

Response:
```json
{
  "leadId": "uuid",
  "contactName": "Иван Иванов",
  "contactPhone": "+79991234567",
  "messages": [
    {
      "text": "Здравствуйте!",
      "timestamp": "2026-01-31T10:00:00Z",
      "from_me": false,
      "is_system": false
    },
    {
      "text": "Добрый день!",
      "timestamp": "2026-01-31T10:01:00Z",
      "from_me": true,
      "is_system": false
    }
  ]
}
```

#### Продажи

**GET /consultant/sales**

Получить продажи консультанта.

Query параметры:
- `consultantId` - ID консультанта (обязательно)
- `date_from` - начало периода (YYYY-MM-DD)
- `date_to` - конец периода (YYYY-MM-DD)
- `search` - поиск по имени/телефону клиента
- `product_name` - фильтр по названию продукта
- `limit` - лимит записей (по умолчанию 50)
- `offset` - смещение

Response:
```json
{
  "sales": [
    {
      "id": "uuid",
      "consultant_id": "uuid",
      "lead_id": "uuid",
      "client_name": "Иван Иванов",
      "client_phone": "+79991234567",
      "amount": 150000,
      "currency": "KZT",
      "product_name": "Консультация",
      "sale_date": "2026-01-30",
      "comment": "Оплата наличными",
      "created_at": "2026-01-30T14:30:00Z",
      "updated_at": "2026-01-30T14:30:00Z"
    }
  ],
  "total": 25
}
```

**POST /consultant/sales**

Создать новую продажу.

Query параметры:
- `consultantId` - ID консультанта (обязательно)

Request:
```json
{
  "lead_id": "uuid",
  "amount": 150000,
  "product_name": "Консультация",
  "sale_date": "2026-01-30",
  "comment": "Оплата наличными"
}
```

Response:
```json
{
  "id": "uuid",
  "consultant_id": "uuid",
  "lead_id": "uuid",
  "client_name": "Иван Иванов",
  "client_phone": "+79991234567",
  "amount": 150000,
  "currency": "KZT",
  "product_name": "Консультация",
  "sale_date": "2026-01-30",
  "comment": "Оплата наличными",
  "created_at": "2026-01-30T14:30:00Z",
  "updated_at": "2026-01-30T14:30:00Z"
}
```

**PUT /consultant/sales/:saleId**

Обновить продажу.

Query параметры:
- `consultantId` - ID консультанта (обязательно)

Request:
```json
{
  "amount": 175000,
  "product_name": "Консультация Премиум",
  "sale_date": "2026-01-30",
  "comment": "Доплата за расширенную консультацию"
}
```

**DELETE /consultant/sales/:saleId**

Удалить продажу.

Query параметры:
- `consultantId` - ID консультанта (обязательно)

**GET /consultant/sales/stats**

Получить статистику продаж и прогресс к плану.

Query параметры:
- `consultantId` - ID консультанта (обязательно)
- `month` - месяц (1-12, опционально)
- `year` - год (опционально)

Response:
```json
{
  "total_sales": 12,
  "total_amount": 1500000,
  "plan_amount": 2000000,
  "progress_percent": 75.0,
  "sales_count": 12,
  "current_month_amount": 1500000
}
```

**GET /consultant/sales/chart**

Получить данные для графика продаж.

Query параметры:
- `consultantId` - ID консультанта (обязательно)
- `period` - период (week/month, по умолчанию month)
- `date_from` - начало периода
- `date_to` - конец периода

Response:
```json
[
  {
    "date": "2026-01-01",
    "amount": 450000,
    "count": 3
  },
  {
    "date": "2026-01-02",
    "amount": 300000,
    "count": 2
  }
]
```

**PUT /admin/consultants/:consultantId/sales-plan** (Admin)

Установить месячный план продаж для консультанта.

Request:
```json
{
  "month": 2,
  "year": 2026,
  "plan_amount": 2000000
}
```

Response:
```json
{
  "id": "uuid",
  "consultant_id": "uuid",
  "period_year": 2026,
  "period_month": 2,
  "plan_amount": 2000000,
  "currency": "KZT",
  "created_at": "2026-02-01T10:00:00Z",
  "updated_at": "2026-02-01T10:00:00Z"
}
```

**GET /admin/sales/all** (Admin)

Получить все продажи всех консультантов.

Query параметры:
- `consultant_id` - фильтр по консультанту
- `date_from` - начало периода
- `date_to` - конец периода
- `limit` - лимит записей
- `offset` - смещение

Response:
```json
[
  {
    "id": "uuid",
    "consultant_id": "uuid",
    "client_name": "Иван Иванов",
    "amount": 150000,
    "product_name": "Консультация",
    "sale_date": "2026-01-30",
    "consultants": {
      "id": "uuid",
      "name": "Анатолий"
    }
  }
]
```

---

## Frontend компоненты

### ConsultantPage

Главная страница консультанта с табами.

**Файл**: `src/pages/ConsultantPage.tsx`

**Props**: Нет (использует useParams для consultantId)

**Состояние**:
- `stats` - статистика дашборда
- `loading` - индикатор загрузки
- `activeTab` - активная вкладка

**Вкладки**:
1. **calendar** - Календарь (по умолчанию)
2. **leads** - Лиды
3. **schedule** - Расписание
4. **sales** - Продажи
5. **profile** - Профиль

**Особенности**:
- Автоматический редирект для консультантов на свою страницу
- Доступ админов к любым страницам консультантов
- Показ статистических карточек вверху страницы

### CalendarTab

Календарь консультаций с временными слотами.

**Файл**: `src/components/consultant/CalendarTab.tsx`

**Функционал**:
- Сетка временных слотов (30 минут)
- Фильтрация по рабочим часам
- Отображение консультаций
- Блокированные слоты (перерывы)
- Создание консультаций
- Модальное окно деталей
- Управление статусами

**Состояние**:
- `selectedDate` - выбранная дата
- `consultations` - список консультаций
- `schedules` - расписание работы
- `blockedSlots` - заблокированные слоты
- `services` - список услуг

**Цветовая кодировка статусов**:
- 🔵 Запланирована (scheduled) - `bg-blue-500`
- 🟢 Подтверждена (confirmed) - `bg-green-500`
- ⚫ Завершена (completed) - `bg-gray-500`
- 🔴 Отменена (cancelled) - `bg-red-500`
- 🟠 Не явился (no_show) - `bg-orange-500`

### LeadsTab

Управление лидами и переписка.

**Файл**: `src/components/consultant/LeadsTab.tsx`

**Функционал**:
- Список лидов с фильтрами
- Поиск по имени/телефону
- Фильтр по статусу записи
- Фильтр по уровню интереса
- Модальное окно переписки
- Отправка сообщений
- Журнал звонков

**Фильтры**:
- `is_booked`: all / false / true
- `interest_level`: all / hot / warm / cold
- `search`: текстовый поиск

**Бейджи интереса**:
- 🔴 Горячий (hot) - `bg-red-500`
- 🟡 Теплый (warm) - `bg-yellow-500`
- 🔵 Холодный (cold) - `bg-blue-500`

### ScheduleTab

Настройка расписания работы.

**Файл**: `src/components/consultant/ScheduleTab.tsx`

**Функционал**:
- Настройка рабочих дней (0-6, понедельник-воскресенье)
- Время начала и окончания работы
- Включение/выключение дней
- Сохранение всего расписания разом

**Дни недели**:
```typescript
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
```

### SalesTab

Управление продажами и отслеживание прогресса к плану.

**Файл**: `src/components/consultant/SalesTab.tsx`

**Функционал**:
- Статистические карточки (продажи, сумма, план)
- График динамики продаж (по дням/неделям)
- Таблица продаж с фильтрами
- Добавление продажи из лида
- Редактирование и удаление продаж
- Поиск по клиенту и продукту

**Фильтры**:
- Период (неделя/месяц/произвольный)
- Поиск по имени/телефону клиента
- Фильтр по названию продукта

**Статистика**:
- Количество продаж за месяц
- Сумма продаж за месяц
- План продаж на месяц
- Прогресс к плану (%)

**График**:
- Библиотека: recharts
- Данные: сумма и количество продаж по дням
- Периоды: неделя/месяц

### ProfileTab

Редактирование профиля и смена пароля.

**Файл**: `src/components/consultant/ProfileTab.tsx`

**Функционал**:
- Редактирование основной информации:
  - Имя
  - Телефон
  - Email
  - Специализация
- Смена пароля:
  - Текущий пароль
  - Новый пароль (минимум 4 символа)
  - Подтверждение пароля

**Валидация**:
- Проверка совпадения паролей
- Минимальная длина пароля
- Обязательность текущего пароля

---

## Авторизация и роли

### Типы ролей

```typescript
type UserRole = 'admin' | 'consultant' | 'manager';
```

### Middleware

**consultantAuthMiddleware**

Базовая проверка авторизации для всех consultant endpoints.

```typescript
// Добавляет в request:
request.userAccountId: string
request.userRole: UserRole
request.consultant?: {
  id: string
  name: string
  user_account_id: string
}
```

**consultantOnlyMiddleware**

Дополнительная проверка, что пользователь - консультант.

```typescript
// Админы имеют доступ ко всему
if (request.userRole === 'admin') return;

// Консультанты только к своим данным
if (!request.consultant) {
  return reply.status(403).send({ error: 'Consultant only' });
}
```

### Правила доступа

| Роль | Доступ к /c/:consultantId | Доступ к данным других консультантов |
|------|---------------------------|--------------------------------------|
| admin | ✅ Все страницы | ✅ Да, через query параметр consultantId |
| consultant | ✅ Только своя страница | ❌ Нет |
| manager | ❌ Нет доступа | ❌ Нет |

### AuthContext

**Файл**: `src/contexts/AuthContext.tsx`

```typescript
interface User {
  id: string;
  username: string;
  role: 'admin' | 'consultant' | 'manager';
  is_tech_admin: boolean;
  consultantId?: string; // для consultant роли
  consultantName?: string;
}

const AuthContext = {
  user: User | null,
  loading: boolean,
  isAuthenticated: boolean,
  isConsultant: boolean,
  isAdmin: boolean,
  login: (username: string, password: string) => Promise<void>,
  logout: () => void
}
```

---

## Функциональность по разделам

### 1. Календарь

#### Временные слоты

Интервалы 30 минут с 00:00 до 23:30:

```typescript
const timeSlots: string[] = [];
for (let hour = 0; hour < 24; hour++) {
  timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
  timeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
}
```

#### Фильтрация по рабочим часам

```typescript
const isSlotOutsideWorkingHours = (timeSlot: string): boolean => {
  const dayOfWeek = selectedDate.getDay();
  const schedule = schedules.find(
    s => s.day_of_week === dayOfWeek && s.is_active
  );

  if (!schedule) return true;

  const slotMinutes = parseInt(timeSlot.split(':')[0]) * 60 +
                      parseInt(timeSlot.split(':')[1]);
  const startMinutes = parseInt(schedule.start_time.split(':')[0]) * 60 +
                       parseInt(schedule.start_time.split(':')[1]);
  const endMinutes = parseInt(schedule.end_time.split(':')[0]) * 60 +
                     parseInt(schedule.end_time.split(':')[1]);

  return slotMinutes < startMinutes || slotMinutes >= endMinutes;
};
```

#### Блокированные слоты (перерывы)

**Создание блокировки**:
```typescript
await consultationService.createBlockedSlot({
  consultant_id: consultantId,
  date: '2026-01-31',
  start_time: '12:00',
  end_time: '12:30',
  reason: 'Обед'
});
```

**Типы перерывов**:
- Перерыв
- Обед
- Личные дела
- Встреча

**Удаление блокировки**:
```typescript
await consultationService.deleteBlockedSlot(blockedSlotId);
```

### 2. Лиды

#### Статусы записи

- **Не записан** - нет консультаций со статусом scheduled/confirmed
- **Записан** - есть активные консультации

#### Уровни интереса

- **hot** (Горячий) - высокий интерес, готов к консультации
- **warm** (Теплый) - средний интерес, нужен прогрев
- **cold** (Холодный) - низкий интерес, долгий цикл

#### Переписка

Полная история сообщений с ботом и консультантом:

```typescript
const messages = await consultantApi.getMessages(leadId);

// Отправка сообщения
await consultantApi.sendMessage(leadId, 'Здравствуйте!');

// Автоматически устанавливается assigned_to_human = true
```

#### Журнал звонков

**Результаты звонков**:
- `answered` - Ответил
- `no_answer` - Не взял трубку
- `busy` - Занято
- `scheduled` - Записал на консультацию

**Создание записи**:
```typescript
await consultantApi.createCallLog({
  lead_id: leadId,
  result: 'answered',
  notes: 'Договорились о встрече в понедельник',
  next_follow_up: '2026-02-03T14:00:00Z'
});
```

### 3. Расписание

#### Структура

Расписание на каждый день недели (0-6):

```typescript
interface WorkingSchedule {
  id?: string;
  consultant_id: string;
  day_of_week: number; // 0-6 (Вс-Сб)
  start_time: string;   // HH:MM
  end_time: string;     // HH:MM
  is_active: boolean;
}
```

#### Пример

```json
[
  {
    "day_of_week": 1,
    "start_time": "09:00",
    "end_time": "18:00",
    "is_active": true
  },
  {
    "day_of_week": 2,
    "start_time": "09:00",
    "end_time": "18:00",
    "is_active": true
  },
  {
    "day_of_week": 0,
    "start_time": "10:00",
    "end_time": "14:00",
    "is_active": false
  }
]
```

### 4. Продажи

#### Обзор

Система продаж позволяет консультантам отслеживать свои продажи и прогресс к месячному плану. Продажи хранятся в таблице `purchases` с полем `consultant_id` для связи с консультантом.

#### Структура продажи

```typescript
interface Sale {
  id: string;
  consultant_id: string;
  lead_id: string;
  client_name: string;
  client_phone: string;
  amount: number;
  currency: string; // "KZT"
  product_name: string;
  sale_date: string; // YYYY-MM-DD
  comment?: string;
  created_at: string;
  updated_at: string;
}
```

#### План продаж

Админы могут устанавливать месячные планы для консультантов:

```typescript
interface SalesPlan {
  id: string;
  consultant_id: string;
  period_year: number; // 2020-2100
  period_month: number; // 1-12
  plan_amount: number; // в KZT
  currency: string; // "KZT"
}
```

**Таблица**: `sales_plans`

**Unique constraint**: `(consultant_id, period_year, period_month)`

#### Статистика

Система автоматически рассчитывает:
- Количество продаж за месяц
- Сумму продаж за месяц
- Прогресс к плану (%)
- Данные для графика (по дням)

**View**: `consultant_sales_stats`

#### Добавление продажи

Продажу можно добавить:
1. Через общую кнопку "Добавить продажу"
2. Из раздела лидов (кнопка у каждого лида)

**Обязательные поля**:
- Lead ID (автоматически при создании из лида)
- Сумма (KZT)
- Название продукта/услуги
- Дата продажи

**Автозаполнение**:
- Имя клиента (из лида)
- Телефон клиента (из лида)
- Consultant ID (из сессии)

#### Редактирование и удаление

- Консультант может редактировать только свои продажи
- Консультант может удалять только свои продажи
- Админы видят все продажи всех консультантов

#### График продаж

**Периоды**:
- Неделя - последние 7 дней
- Месяц - последние 30 дней
- Произвольный - выбор дат

**Данные**:
- Сумма продаж по дням
- Количество продаж по дням

**Библиотека**: recharts

#### Фильтры

- Период (date_from, date_to)
- Поиск по имени/телефону клиента
- Фильтр по названию продукта
- Пагинация (limit, offset)

#### Обратная совместимость

Поле `consultant_id` в таблице `purchases` nullable:
- Продажи от консультантов: `consultant_id = UUID`
- Продажи из рекламы/AmoCRM: `consultant_id = NULL`
- Существующая ROI аналитика продолжает работать

### 5. Услуги

#### Структура

```typescript
interface Service {
  id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  is_active: boolean;
  is_provided: boolean; // консультант предоставляет эту услугу
  consultant_service?: {
    custom_price?: number;
    custom_duration?: number;
    is_active: boolean;
  };
}
```

#### Кастомизация

Консультант может:
- Включить/выключить услугу
- Установить свою цену
- Установить свою длительность

**Приоритет значений**:
```typescript
const finalPrice = service.consultant_service?.custom_price ||
                   service.price ||
                   0;

const finalDuration = service.consultant_service?.custom_duration ||
                      service.duration_minutes ||
                      30;
```

### 6. Профиль

#### Редактируемые поля

- **name** - ФИО консультанта
- **phone** - Телефон для связи
- **email** - Email
- **specialization** - Специализация/направление

#### Смена пароля

**Требования**:
- Минимум 4 символа
- Требуется текущий пароль
- Новый пароль должен совпадать с подтверждением

**После смены**:
- Пользователь должен войти заново
- Старые сессии остаются активными (stateless auth)

---

## Типы данных

### Основные интерфейсы

```typescript
// Dashboard статистика
interface DashboardStats {
  consultant_id: string;
  total_leads: number;
  hot_leads: number;
  warm_leads: number;
  cold_leads: number;
  booked_leads: number;
  total_consultations: number;
  scheduled: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
  total_revenue: number;
  completion_rate: number;
}

// Консультант
interface Consultant {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  specialization?: string;
  user_account_id?: string;
  is_active: boolean;
  accepts_new_leads: boolean; // Принимает ли новых лидов (автораспределение)
  created_at: string;
  updated_at: string;
}

// Лид
interface Lead {
  id: string;
  contact_phone: string;
  contact_name?: string;
  interest_level?: string;
  funnel_stage?: string;
  last_message?: string;
  assigned_consultant_id?: string;
}

// Консультация
interface Consultation {
  id: string;
  consultant_id: string;
  dialog_analysis_id?: string;
  date: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  service_name?: string;
  price?: number;
  consultant?: {
    name: string;
    phone: string;
  };
  lead?: {
    contact_name: string;
    contact_phone: string;
    interest_level: string;
  };
}

// Расписание
interface WorkingSchedule {
  id?: string;
  consultant_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

// Услуга
interface Service {
  id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  is_active: boolean;
  is_provided: boolean;
  consultant_service?: {
    custom_price?: number;
    custom_duration?: number;
    is_active: boolean;
  };
}

// Заблокированный слот
interface BlockedSlot {
  id: string;
  consultant_id: string;
  date: string;
  start_time: string;
  end_time: string;
  reason: string;
  created_at: string;
}

// Журнал звонков
interface CallLog {
  id: string;
  consultant_id: string;
  lead_id: string;
  called_at: string;
  result: 'answered' | 'no_answer' | 'busy' | 'scheduled';
  notes?: string;
  next_follow_up?: string;
}

// Продажа
interface Sale {
  id: string;
  consultant_id: string;
  lead_id: string;
  client_name: string;
  client_phone: string;
  amount: number;
  currency: string;
  product_name: string;
  sale_date: string; // YYYY-MM-DD
  comment?: string;
  created_at: string;
  updated_at: string;
}

// План продаж
interface SalesPlan {
  id: string;
  consultant_id: string;
  period_year: number;
  period_month: number;
  plan_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

// Статистика продаж
interface SalesStats {
  total_sales: number;
  total_amount: number;
  plan_amount: number;
  progress_percent: number;
  sales_count: number;
  current_month_amount: number;
}

// Точка данных графика продаж
interface ChartDataPoint {
  date: string;
  amount: number;
  count: number;
}
```

---

## Примеры использования

### 1. Создание консультации вручную

```typescript
// Frontend: CalendarTab.tsx
const handleCreateConsultation = async () => {
  await consultationService.createConsultation({
    consultant_id: consultantId,
    service_id: selectedServiceId,
    client_phone: '+79991234567',
    client_name: 'Иван Иванов',
    date: '2026-02-01',
    start_time: '14:00',
    end_time: '14:30',
    status: 'scheduled',
    consultation_type: 'general',
    notes: 'Первичная консультация',
    price: 3000
  });

  toast({ title: 'Консультация создана' });
  await loadData();
};
```

### 2. Отправка сообщения лиду

```typescript
// Frontend: LeadsTab.tsx
const handleSendMessage = async () => {
  if (!selectedLead || !newMessage.trim()) return;

  await consultantApi.sendMessage(selectedLead.id, newMessage);

  toast({ title: 'Сообщение отправлено' });

  // Перезагрузить сообщения
  await loadMessages(selectedLead.id);
  setNewMessage('');
};
```

### 3. Обновление расписания

```typescript
// Frontend: ScheduleTab.tsx
const handleSave = async () => {
  const schedulesToSave = schedules.map(s => ({
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    is_active: s.is_active
  }));

  await consultantApi.updateSchedule(schedulesToSave);

  toast({ title: 'Расписание сохранено' });
  await loadSchedule();
};
```

### 4. Создание блокировки слота

```typescript
// Frontend: CalendarTab.tsx
const handleCreateBlockedSlot = async () => {
  const dateStr = selectedDate.toISOString().split('T')[0];
  const endTime = calculateEndTime(slotTime);

  await consultationService.createBlockedSlot({
    consultant_id: consultantId,
    date: dateStr,
    start_time: slotTime,
    end_time: endTime,
    reason: 'Обед'
  });

  toast({ title: 'Слот заблокирован' });
  await loadData();
};
```

### 5. Изменение статуса консультации

```typescript
// Frontend: CalendarTab.tsx
const handleUpdateStatus = async (id: string, status: string) => {
  await consultationService.updateConsultation(id, {
    status: status as any
  });

  toast({ title: 'Статус обновлён' });
  await loadData();
};
```

### 6. Добавление записи о звонке

```typescript
// Frontend: LeadsTab.tsx
const handleCreateCallLog = async () => {
  await consultantApi.createCallLog({
    lead_id: selectedLead.id,
    result: callResult,
    notes: callNotes,
    next_follow_up: nextFollowUpDate
  });

  toast({ title: 'Звонок записан' });
  await loadCallLogs(selectedLead.id);
};
```

### 7. Обновление профиля

```typescript
// Frontend: ProfileTab.tsx
const handleSaveProfile = async () => {
  await consultantApi.updateProfile({
    name: profile.name,
    phone: profile.phone,
    email: profile.email,
    specialization: profile.specialization
  });

  toast({ title: 'Профиль обновлен' });
};
```

### 8. Смена пароля

```typescript
// Frontend: ProfileTab.tsx
const handleChangePassword = async () => {
  if (passwords.new !== passwords.confirm) {
    toast({
      title: 'Ошибка',
      description: 'Пароли не совпадают',
      variant: 'destructive'
    });
    return;
  }

  await consultantApi.changePassword(
    passwords.current,
    passwords.new
  );

  toast({ title: 'Пароль изменен' });
  setPasswords({ current: '', new: '', confirm: '' });
};
```

### 9. Создание продажи

```typescript
// Frontend: SalesTab.tsx
const handleCreateSale = async () => {
  await salesApi.createSale({
    lead_id: selectedLead.id,
    amount: 150000,
    product_name: 'Консультация',
    sale_date: '2026-01-30',
    comment: 'Оплата наличными'
  });

  toast({ title: 'Продажа создана' });
  await loadSales();
};
```

### 10. Получение статистики продаж

```typescript
// Frontend: SalesTab.tsx
const loadStats = async () => {
  const stats = await salesApi.getStats(currentMonth, currentYear);

  setStats({
    totalSales: stats.total_sales,
    totalAmount: stats.total_amount,
    planAmount: stats.plan_amount,
    progressPercent: stats.progress_percent
  });
};
```

### 11. Установка плана продаж (Admin)

```typescript
// Frontend: ConsultantsPage.tsx
const handleSetSalesPlan = async () => {
  await salesApi.setSalesPlan(consultantId, {
    month: 2,
    year: 2026,
    plan_amount: 2000000
  });

  toast({ title: 'План установлен' });
  await loadConsultants();
};
```

### 12. Добавление продажи из лида

```typescript
// Frontend: LeadsTab.tsx
const handleAddSaleForLead = async (lead: Lead) => {
  await salesApi.createSale({
    lead_id: lead.id,
    amount: servicePrice,
    product_name: selectedService.name,
    sale_date: new Date().toISOString().split('T')[0],
    comment: ''
  });

  toast({ title: 'Продажа добавлена к лиду' });
  await loadLeads();
};
```

---

## Troubleshooting

### Проблема: Ошибка "TypeError: fetch failed"

**Симптомы**: Запросы к Supabase падают с timeout

**Решение**:
Обновлен Supabase клиент с настройками timeout и keep-alive:

```typescript
// services/crm-backend/src/lib/supabase.ts
import { Agent } from 'undici';

const agent = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 600000,
  connect: { timeout: 30000 }
});

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      dispatcher: agent
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchWithTimeout as unknown as typeof fetch }
});
```

### Проблема: Данные профиля не загружаются

**Симптомы**: Поля телефон, email, специализация пустые

**Решение**:
1. Добавлен GET endpoint `/consultant/profile`
2. Добавлен метод `consultantApi.getProfile()`
3. Добавлен useEffect в ProfileTab для загрузки данных

### Проблема: Select.Item validation error

**Симптомы**: "A <Select.Item /> must have a value prop that is not an empty string"

**Решение**: Изменить пустые значения на 'all':
```typescript
// Было
<SelectItem value="">Все</SelectItem>

// Стало
<SelectItem value="all">Все</SelectItem>

// И в фильтрах
const [filters, setFilters] = useState({
  is_booked: 'all',
  interest_level: 'all'
});
```

### Проблема: Админ видит всех лидов при просмотре страницы консультанта

**Симптомы**: При открытии `/c/:consultantId` админ видит всех лидов из БД, а не только лидов конкретного консультанта

**Причина**: Backend endpoint `GET /consultant/leads` не фильтровал лидов по `consultantId` для админов

**Решение**:
1. **Frontend**: Передавать `consultantId` из URL в запрос `getLeads()`
   ```typescript
   // LeadsTab.tsx
   const { consultantId } = useParams<{ consultantId: string }>();

   const loadLeads = async () => {
     const params: any = {};
     if (consultantId) params.consultantId = consultantId;

     const data = await consultantApi.getLeads(params);
   };
   ```

2. **Backend**: Использовать `consultantId` из query параметров для фильтрации
   ```typescript
   // consultantDashboard.ts
   const { consultantId: queryConsultantId } = request.query;
   const targetConsultantId = isAdmin && queryConsultantId
     ? queryConsultantId
     : request.consultant?.id;

   if (targetConsultantId) {
     query = query.eq('assigned_consultant_id', targetConsultantId);
   }
   ```

**Файлы**:
- `services/crm-frontend/src/components/consultant/LeadsTab.tsx`
- `services/crm-frontend/src/services/consultantApi.ts`
- `services/crm-backend/src/routes/consultantDashboard.ts`

### Проблема: Чатбот не учитывает assigned_consultant_id при показе слотов

**Симптомы**:
- Чатбот показывает слоты ВСЕХ консультантов вместо только назначенного
- Лид может записаться к любому консультанту, даже если назначен другому
- В логах отсутствует информация о назначенном консультанте

**Причина**:
1. **Баг №1**: В `aiBotEngine.ts` при вызове `handleConsultationTool()` не передавалось поле `assigned_consultant_id`
2. **Баг №2**: В `consultations.ts` endpoint `book-from-bot` не проверял соответствие консультанта

**Решение**:

1. **Передача assigned_consultant_id в consultation tools** (3 места в aiBotEngine.ts):
   ```typescript
   // services/chatbot-service/src/lib/aiBotEngine.ts

   // generateAIResponse (строки 1400-1410)
   const leadInfo = {
     id: lead.id,
     contact_phone: lead.contact_phone,
     contact_name: lead.contact_name,
     assigned_consultant_id: lead.assigned_consultant_id ?? undefined
   };

   log.debug({
     leadId: maskUuid(lead.id),
     hasAssignedConsultant: !!lead.assigned_consultant_id,
     assignedConsultantId: lead.assigned_consultant_id ? maskUuid(lead.assigned_consultant_id) : null,
     functionName
   }, '[generateAIResponse] Processing consultation tool with lead assignment');
   ```

2. **Валидация в book-from-bot** (consultations.ts):
   ```typescript
   // services/crm-backend/src/routes/consultations.ts (после строки 845)

   if (clientInfo.assignedConsultantId) {
     if (clientInfo.assignedConsultantId !== consultantId) {
       app.log.warn({
         dialog_analysis_id: body.dialog_analysis_id,
         assigned_consultant_id: clientInfo.assignedConsultantId.substring(0, 8) + '...',
         requested_consultant_id: consultantId.substring(0, 8) + '...',
         consultant_name: consultant?.name || 'Unknown'
       }, '[book-from-bot] Consultant mismatch: lead assigned to different consultant');

       return reply.status(403).send({
         error: 'Consultant mismatch',
         message: 'Этот клиент закреплён за другим консультантом. Пожалуйста, выберите консультацию заново.',
         code: 'CONSULTANT_MISMATCH'
       });
     }

     app.log.info({
       dialog_analysis_id: body.dialog_analysis_id,
       consultant_id: consultantId.substring(0, 8) + '...',
       consultant_name: consultant?.name || 'Unknown',
       date: body.date,
       start_time: body.start_time
     }, '[book-from-bot] Consultant validation passed - booking consultation');
   }
   ```

3. **Обновление интерфейсов TypeScript**:
   ```typescript
   // Добавлено поле assigned_consultant_id в интерфейсы LeadInfo:
   // - services/chatbot-service/src/lib/aiBotEngine.ts:197
   // - services/chatbot-service/src/lib/botControlTools.ts:33
   // - services/chatbot-service/src/lib/leadManagementTools.ts:59

   export interface LeadInfo {
     // ... другие поля
     assigned_consultant_id?: string;
   }
   ```

4. **Расширение getClientInfo**:
   ```typescript
   // services/crm-backend/src/lib/dialogSummarizer.ts

   export async function getClientInfo(dialogAnalysisId: string): Promise<{
     name: string | null;
     phone: string | null;
     chatId: string | null;
     instanceName: string | null;
     userAccountId: string | null;
     assignedConsultantId: string | null;  // ← ДОБАВЛЕНО
   }> {
     const { data, error } = await supabase
       .from('dialog_analysis')
       .select('contact_name, contact_phone, instance_name, user_account_id, assigned_consultant_id')
       .eq('id', dialogAnalysisId)
       .single();

     return {
       // ... другие поля
       assignedConsultantId: data.assigned_consultant_id || null
     };
   }
   ```

**Результат**:
- ✅ Лид видит слоты ТОЛЬКО своего назначенного консультанта
- ✅ Невозможно записать лида к чужому консультанту (403 ошибка)
- ✅ Подробное логирование с маскированными UUID
- ✅ Backward compatibility - старые лиды без `assigned_consultant_id` работают (показываются все консультанты)

**Улучшения безопасности**:
- Используется `??` вместо `||` для корректной обработки пустых строк
- UUID маскируются в логах (первые 8 символов + '...')
- Полные UUID не раскрываются в ответах ошибок

**Файлы**:
- `services/chatbot-service/src/lib/aiBotEngine.ts` - передача assigned_consultant_id + логирование
- `services/chatbot-service/src/lib/botControlTools.ts` - обновлён интерфейс LeadInfo
- `services/chatbot-service/src/lib/leadManagementTools.ts` - обновлён интерфейс LeadInfo
- `services/crm-backend/src/lib/dialogSummarizer.ts` - расширен getClientInfo
- `services/crm-backend/src/routes/consultations.ts` - валидация + логирование

**Дата исправления**: 2026-02-01

### Проблема: Legacy консультанты не могут редактировать расписание и профиль (403 ошибка)

**Симптомы**:
- Консультант успешно логинится, но не может редактировать расписание
- При попытке сохранить расписание возвращается ошибка 403 "Consultant only"
- Аналогичная ошибка при редактировании профиля, услуг и других данных
- Проблема возникает только у консультантов, которые логинятся через `user_accounts` (legacy flow)

**Причина**:
Middleware `consultantAuthMiddleware` не поддерживал legacy консультантов (авторизация через `user_accounts` с role='consultant'). В системе существует 2 способа авторизации консультантов:

1. **Новый flow** (через `consultant_accounts`):
   - `user.id` = `consultant_accounts.id`
   - Middleware находит в `consultant_accounts` → устанавливает `request.consultant`
   - ✅ Работает

2. **Legacy flow** (через `user_accounts` с role='consultant'):
   - `user.id` = `user_accounts.id`
   - Middleware находит в `user_accounts` → выходит БЕЗ установки `request.consultant`
   - ❌ НЕ работает

В endpoint'ах (например, `PUT /consultant/schedule`) проверка `if (!consultantId)` возвращает 403, так как `request.consultant` не установлен.

**Решение**:
Обновлён middleware для поддержки legacy flow:

```typescript
// services/crm-backend/src/middleware/consultantAuth.ts (строки 33-60)

// Сначала проверяем user_accounts (для админов И legacy консультантов)
const { data: userAccount, error: userError } = await supabase
  .from('user_accounts')
  .select('id, username, role, is_tech_admin')
  .eq('id', userAccountId)
  .maybeSingle();

if (userAccount) {
  // Если это legacy консультант (role='consultant' в user_accounts)
  if (userAccount.role === 'consultant') {
    request.userRole = 'consultant';

    // Получаем данные консультанта через parent_user_account_id
    const { data: consultant, error: fetchConsultantError } = await supabase
      .from('consultants')
      .select('id, name, parent_user_account_id')
      .eq('parent_user_account_id', userAccount.id)
      .eq('is_active', true)
      .single();

    if (fetchConsultantError || !consultant) {
      return reply.status(403).send({
        error: 'Consultant profile not found or inactive',
        details: 'Профиль консультанта не найден или неактивен'
      });
    }

    request.consultant = consultant;
    return;
  }

  // Если это админ или manager
  request.userRole = userAccount.is_tech_admin
    ? 'admin'
    : (userAccount.role as 'admin' | 'manager' || 'admin');
  return;
}
```

**Обратная совместимость**:
- ✅ Новый flow (consultant_accounts) - работает как раньше
- ✅ Legacy flow (user_accounts с role='consultant') - теперь поддерживается
- ✅ Админы и менеджеры - без изменений

**Проверка**:
```sql
-- Найти legacy консультантов
SELECT ua.id, ua.username, ua.role, c.id as consultant_id, c.name
FROM user_accounts ua
JOIN consultants c ON c.parent_user_account_id = ua.id
WHERE ua.role = 'consultant';
```

**Тест**:
1. Залогиниться как legacy консультант
2. Открыть вкладку "Расписание"
3. Изменить рабочие часы и сохранить
4. ✅ Расписание должно сохраниться без ошибки 403

**Результат**:
- ✅ Legacy консультанты могут редактировать своё расписание
- ✅ Legacy консультанты могут редактировать профиль, услуги, пароль
- ✅ Legacy консультанты могут создавать консультации, отправлять сообщения, управлять продажами
- ✅ Оба flow авторизации работают параллельно

**Файлы**:
- `services/crm-backend/src/middleware/consultantAuth.ts` - добавлена поддержка legacy flow

**Дата исправления**: 2026-02-01

---

## Конфигурация

### Backend ENV переменные

```env
# Supabase
SUPABASE_URL=https://ikywuvtavpnjlrjtalqi.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>

# Server
PORT=8084
NODE_ENV=production
```

### Frontend ENV переменные

```env
# Backend URL
VITE_CRM_BACKEND_URL=http://localhost:8084

# Environment
VITE_ENV=development
```

### Docker

**Backend**: `services/crm-backend/Dockerfile`
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
CMD ["npm", "start"]
```

**Frontend**: `services/crm-frontend/Dockerfile`
```dockerfile
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

---

## Развертывание

### Локальное развертывание

```bash
# Запуск backend
cd services/crm-backend
npm install
npm run dev

# Запуск frontend
cd services/crm-frontend
npm install
npm run dev
```

### Docker развертывание

```bash
# Сборка
docker-compose build crm-backend crm-frontend

# Запуск
docker-compose up -d crm-backend crm-frontend

# Логи
docker logs -f agents-monorepo-crm-backend-1
docker logs -f agents-monorepo-crm-frontend-1
```

### Проверка работоспособности

```bash
# Backend health check
curl http://localhost:8084/health

# Frontend
curl http://localhost:3002

# Test consultant profile endpoint
curl -H "x-user-id: <user_id>" \
  "http://localhost:8084/consultant/profile?consultantId=<consultant_id>"
```

---

## Дополнительная информация

### Связанные документы
- [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) - Общая инфраструктура
- [FRONTEND_API_CONVENTIONS.md](../FRONTEND_API_CONVENTIONS.md) - API конвенции

### База данных

**Таблицы**:
- `user_accounts` - Аккаунты пользователей (с ролями)
- `consultants` - Профили консультантов
- `consultations` - Консультации
- `consultation_services` - Услуги
- `consultant_services` - Связь консультантов и услуг
- `working_schedules` - Расписание работы
- `blocked_slots` - Заблокированные слоты
- `dialog_analysis` - Лиды/диалоги
- `consultant_call_logs` - Журнал звонков
- `purchases` - Продажи (с полем `consultant_id`)
- `sales_plans` - Планы продаж консультантов

**Views**:
- `consultant_sales_stats` - Статистика продаж с прогрессом к плану

### Система продаж консультантов

**Миграции**:
- `174_consultant_sales.sql` - Основная миграция системы продаж
- `176_revert_to_purchase_date.sql` - Исправление индексов и view

#### Изменения в БД

**1. Таблица purchases**:
```sql
ALTER TABLE purchases
ADD COLUMN consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL;
```

- Поле nullable для обратной совместимости
- Продажи из рекламы: `consultant_id = NULL`
- Продажи консультантов: `consultant_id = UUID`

**2. Таблица sales_plans**:
```sql
CREATE TABLE sales_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL CHECK (period_year >= 2020 AND period_year <= 2100),
  period_month INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
  plan_amount NUMERIC(12, 2) NOT NULL CHECK (plan_amount >= 0),
  currency VARCHAR(3) DEFAULT 'KZT',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(consultant_id, period_year, period_month)
);
```

**3. View consultant_sales_stats**:
- Агрегирует продажи консультанта
- Рассчитывает прогресс к плану
- Фильтрует по текущему месяцу

**4. Индексы**:
- `idx_purchases_consultant` - быстрый поиск по консультанту
- `idx_purchases_consultant_date` - поиск по дате и консультанту
- `idx_sales_plans_consultant` - планы консультанта
- `idx_sales_plans_period` - планы по периоду

### Управление распределением лидов

**Миграция**: `173e_consultant_accepts_new_leads.sql`

Система позволяет админам управлять участием консультанта в автоматическом распределении новых лидов:

#### Поле accepts_new_leads

- **Тип**: `BOOLEAN DEFAULT true`
- **Назначение**: Определяет участие консультанта в round-robin распределении новых лидов
- **Важно**: Не влияет на расписание и слоты консультанта

#### Логика распределения

SQL функция `assign_lead_to_consultant` выбирает консультантов по условию:
```sql
WHERE is_active = true
  AND accepts_new_leads = true
  AND user_account_id = p_user_account_id
```

#### UI управления (Админ панель)

В разделе "Консультанты" каждая карточка содержит:
- **Индикатор статуса**:
  - 🟢 "Принимает лидов" (зелёная иконка UserPlus)
  - 🟠 "Не принимает лидов" (оранжевая иконка UserMinus)
- **Switch переключатель**: Для быстрого включения/отключения

#### Примеры использования

```typescript
// Отключить консультанта от распределения
await consultationService.updateConsultantAcceptsNewLeads(consultantId, false);

// Включить обратно
await consultationService.updateConsultantAcceptsNewLeads(consultantId, true);
```

### Система уведомлений консультантам

**Миграция**: Функции в `services/crm-backend/src/lib/consultantNotifications.ts`

Система автоматически отправляет WhatsApp уведомления консультантам о важных событиях.

#### Типы уведомлений

**1. Уведомление о новой консультации** (`notifyConsultantAboutNewConsultation`)

Отправляется автоматически при создании консультации через бота (endpoint `book-from-bot`).

**Формат сообщения**:
```
🔔 Новая консультация!

Клиент: Иван Иванов
Телефон: +77058151655
Дата: 02 февраля 2026 в 10:30
Услуга: Онлайн-консультация

Подробности в личном кабинете: https://crm.example.com/c/{consultant_id}
```

**Логика отправки**:
1. Получение информации о консультации из БД
2. Проверка наличия телефона консультанта
3. Получение WhatsApp instance:
   - Сначала из `dialog_analysis.instance_name` (если есть `dialog_analysis_id`)
   - Fallback: первый активный `whatsapp_instances` по `user_account_id`
4. Форматирование и отправка сообщения

**Код**:
```typescript
// В consultations.ts после создания консультации
notifyConsultantAboutNewConsultation(consultation.id).catch(err => {
  app.log.error({ error: err.message }, 'Failed to send consultant notification');
});
```

**2. Напоминание о консультации** (`sendConsultationReminder`)

Отправляется за N минут до начала консультации (планируется через cron).

**Формат сообщения**:
```
⏰ Напоминание о консультации через 60 минут!

Клиент: Иван Иванов
Услуга: Онлайн-консультация
Начало: 10:30

Подготовьтесь к встрече 😊
```

**3. Уведомление о новом лиде** (`notifyConsultantAboutNewLead`)

Отправляется при переназначении лида на консультанта.

#### Архитектура получения WhatsApp instance

**Функция**: `getInstanceName(userAccountId, dialogAnalysisId?)`

**Приоритет**:
1. **Из dialog_analysis** - если есть `dialog_analysis_id`, берем `instance_name` оттуда
2. **Fallback на whatsapp_instances** - первый connected instance по `user_account_id`

**SQL запросы**:
```typescript
// Вариант 1: из dialog_analysis
SELECT instance_name
FROM dialog_analysis
WHERE id = dialog_analysis_id;

// Вариант 2: из whatsapp_instances
SELECT instance_name
FROM whatsapp_instances
WHERE user_account_id = consultant.parent_user_account_id
  AND status = 'connected'
LIMIT 1;
```

#### Обработка ошибок

**Молчаливое игнорирование**: Ошибки уведомлений НЕ блокируют создание консультации.

```typescript
try {
  await notifyConsultantAboutNewConsultation(consultationId);
} catch (error) {
  // Ошибка логируется но не пробрасывается наверх
  process.stderr.write(`[CONSULTANT_NOTIFICATION] EXCEPTION: ${error}\n`);
}
```

**Причины пропуска уведомления**:
- Нет телефона у консультанта
- Нет доступного WhatsApp instance
- Консультация не найдена в БД
- Ошибка отправки через Evolution API

#### Логирование

Детальное логирование через `process.stderr.write` с префиксом `[CONSULTANT_NOTIFICATION]`:

```
[CONSULTANT_NOTIFICATION] START: consultationId=uuid
[CONSULTANT_NOTIFICATION] Consultation loaded
[CONSULTANT_NOTIFICATION] Consultant phone: +77071231503
[CONSULTANT_NOTIFICATION] Instance name: instance_0f559eb0_1761736509038
[CONSULTANT_NOTIFICATION] Sending WhatsApp message...
[CONSULTANT_NOTIFICATION] SUCCESS: Notification sent to Арман (+77071231503)
```

**Команда для просмотра логов**:
```bash
docker-compose logs -f crm-backend | grep "CONSULTANT_NOTIFICATION"
```

#### Исправленные баги

**Проблема 1**: Неправильное поле `user_account_id` вместо `parent_user_account_id`
- **Симптом**: Ошибка "column user_accounts.user_account_id does not exist"
- **Исправление**: Изменено на `consultant.parent_user_account_id`

**Проблема 2**: Попытка получить несуществующее поле `instance_name` из `user_accounts`
- **Симптом**: Ошибка "column user_accounts.instance_name does not exist"
- **Исправление**: Создана функция `getInstanceName` для получения instance из правильных таблиц

**Проблема 3**: Попытка получить несуществующее поле `evolution_instance` из `user_accounts`
- **Симптом**: Ошибка "column user_accounts.evolution_instance does not exist"
- **Исправление**: Использование `getInstanceName` вместо прямого запроса к user_accounts

**Проблема 4**: Неправильный SQL join с `dialog_analysis`
- **Симптом**: Ошибка "Could not find a relationship between 'consultations' and 'dialog_analysis'"
- **Исправление**: Использование полей `client_name` и `client_phone` напрямую из таблицы `consultations`

**Файлы**:
- `services/crm-backend/src/lib/consultantNotifications.ts` - Реализация уведомлений
- `services/crm-backend/src/routes/consultations.ts` - Вызов функций уведомлений

**Дата исправления**: 2026-02-01

### Планы развития

1. **Телефония** - Интеграция SIP для звонков из интерфейса
2. **Аналитика** - Графики по конверсии и доходу
3. **Экспорт** - Выгрузка данных в Excel
4. **Уведомления** - Push уведомления о новых лидах
5. **Мобильное приложение** - Native mobile app

---

## Поддержка

Для вопросов и предложений:
- GitHub Issues: https://github.com/anthropics/agents-monorepo/issues
- Email: support@example.com

---

**Версия документа**: 1.3.0
**Дата обновления**: 2026-02-01
**Автор**: AI Assistant (Claude Sonnet 4.5)

**История изменений**:
- v1.3.0 (2026-02-01) - Добавлена система WhatsApp уведомлений консультантам о новых консультациях
- v1.2.0 (2026-02-01) - Исправлена работа чатбота с распределёнными лидами (assigned_consultant_id)
- v1.1.1 (2026-02-01) - Исправлена фильтрация лидов при просмотре админом страницы консультанта
- v1.1.0 (2026-02-01) - Добавлена система продаж консультантов
- v1.0.0 (2026-01-31) - Первая версия документации
