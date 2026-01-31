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
│       │   └── consultantDashboard.ts     # Consultant API endpoints
│       └── lib/
│           └── supabase.ts                # Supabase клиент с настройками
│
└── crm-frontend/
    └── src/
        ├── components/consultant/
        │   ├── CalendarTab.tsx            # Календарь со слотами
        │   ├── LeadsTab.tsx               # Управление лидами
        │   ├── ScheduleTab.tsx            # Настройка расписания
        │   ├── ServicesTab.tsx            # Выбор услуг
        │   └── ProfileTab.tsx             # Редактирование профиля
        ├── pages/
        │   └── ConsultantPage.tsx         # Главная страница
        ├── services/
        │   ├── consultantApi.ts           # API методы
        │   └── consultationService.ts     # Сервисы консультаций
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
  "user_account_id": "uuid"
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
4. **services** - Услуги
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

### ServicesTab

Выбор и настройка услуг.

**Файл**: `src/components/consultant/ServicesTab.tsx`

**Функционал**:
- Список всех доступных услуг
- Включение/выключение услуг (Switch)
- Кастомная цена для консультанта
- Кастомная длительность
- Показ дефолтных значений

**Особенности**:
- Сохраняются только активные услуги
- Отображение разницы с дефолтными значениями
- Автообновление после сохранения

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

### 4. Услуги

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

### 5. Профиль

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

**Версия документа**: 1.0.0
**Дата обновления**: 2026-01-31
**Автор**: AI Assistant (Claude Sonnet 4.5)
