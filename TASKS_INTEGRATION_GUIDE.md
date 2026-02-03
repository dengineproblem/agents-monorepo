# Инструкция по завершению интеграции задач

## Статус реализации

### ✅ Завершено:
1. Database миграция (`015_add_consultant_tasks.sql`)
2. Backend API routes (`consultantTasks.ts`)
3. Backend dashboard update (`consultantDashboard.ts`)
4. Backend registration (`server.ts`)
5. Frontend типы (`types/task.ts`)
6. Frontend API (`consultantApi.ts`)
7. Frontend TasksTab (`TasksTab.tsx`)

### 🔄 Осталось доделать:

## 1. ConsultantPage.tsx - Dashboard карточка и таб

**Файл:** `services/crm-frontend/src/pages/ConsultantPage.tsx`

### Шаг 1: Добавить импорты (в начало файла)

```typescript
import { TasksTab } from '@/components/consultant/TasksTab';
import { CheckSquare } from 'lucide-react';
```

### Шаг 2: Добавить 5-ю карточку статистики (после 4-й карточки)

Найти секцию с карточками статистики (grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4) и добавить:

```tsx
{/* Карточка 5: Активные задачи */}
<Card>
  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
    <CardTitle className="text-sm font-medium">Активные задачи</CardTitle>
    <CheckSquare className="h-4 w-4 text-muted-foreground" />
  </CardHeader>
  <CardContent>
    <div className="text-2xl font-bold">{stats.tasks_total || 0}</div>
    <div className="flex gap-4 mt-2 text-xs">
      <span className="text-red-600">
        Просрочено: {stats.tasks_overdue || 0}
      </span>
      <span className="text-blue-600">
        Сегодня: {stats.tasks_today || 0}
      </span>
    </div>
  </CardContent>
</Card>
```

### Шаг 3: Добавить таб "Задачи"

В TabsList (после таба "sales"):

```tsx
<TabsTrigger value="tasks">
  <CheckSquare className="h-4 w-4 mr-2" />
  Задачи
</TabsTrigger>
```

В Tabs content (после TabsContent для profile):

```tsx
<TabsContent value="tasks" className="space-y-4">
  <TasksTab />
</TabsContent>
```

---

## 2. LeadsTab.tsx - Секция задач в модальном окне лида

**Файл:** `services/crm-frontend/src/components/consultant/LeadsTab.tsx`

### Что добавить:

В модальном окне просмотра лида (Dialog с деталями лида), перед закрывающим `</DialogContent>`, добавить секцию задач.

**Код для вставки:**

```tsx
{/* Секция задач по лиду */}
<div className="mt-4 border-t pt-4">
  <div className="flex items-center justify-between mb-3">
    <h3 className="font-semibold flex items-center gap-2">
      <CheckSquare className="h-4 w-4" />
      Задачи по лиду
    </h3>
    <Button
      size="sm"
      onClick={() => {
        // TODO: Открыть модалку создания задачи с предзаполненным lead_id
        // Можно использовать TasksTab компонент или создать отдельную модалку
        toast({
          title: 'Функция в разработке',
          description: 'Создание задачи из лида будет доступно в следующей версии',
        });
      }}
    >
      <Plus className="h-4 w-4 mr-1" />
      Поставить задачу
    </Button>
  </div>

  <div className="text-sm text-muted-foreground">
    <p>Интеграция задач в LeadsTab будет доступна в следующей версии</p>
    <p className="text-xs mt-1">
      Пока создавайте задачи во вкладке "Задачи" с выбором лида
    </p>
  </div>
</div>
```

**Примечание:** Полная интеграция требует:
1. Загрузку задач по лиду при открытии модалки
2. Отображение списка задач
3. Чекбоксы для быстрого выполнения
4. Модалку создания задачи с предзаполненным `lead_id`

---

## 3. CalendarTab.tsx - Card с задачами на дату

**Файл:** `services/crm-frontend/src/components/consultant/CalendarTab.tsx`

### Что добавить:

Под основной сеткой консультаций (после Calendar Card), перед закрывающим тегом, добавить Card с задачами.

**Код для вставки:**

```tsx
{/* Задачи на выбранную дату */}
<Card className="mt-4">
  <CardHeader>
    <div className="flex items-center justify-between">
      <CardTitle className="flex items-center gap-2">
        <CheckSquare className="h-5 w-5" />
        Задачи на {selectedDate.toLocaleDateString('ru-RU')}
      </CardTitle>
      <Button
        size="sm"
        onClick={() => {
          // TODO: Открыть модалку создания задачи с предзаполненной датой
          toast({
            title: 'Функция в разработке',
            description: 'Создание задачи из календаря будет доступно в следующей версии',
          });
        }}
      >
        <Plus className="h-4 w-4 mr-1" />
        Добавить задачу
      </Button>
    </div>
  </CardHeader>
  <CardContent>
    <div className="text-sm text-muted-foreground">
      <p>Интеграция задач в CalendarTab будет доступна в следующей версии</p>
      <p className="text-xs mt-1">
        Пока создавайте задачи во вкладке "Задачи" с выбором даты
      </p>
    </div>
  </CardContent>
</Card>
```

**Примечание:** Полная интеграция требует:
1. Загрузку задач на выбранную дату при смене даты
2. Отображение списка задач
3. Чекбоксы для быстрого выполнения
4. Модалку создания задачи с предзаполненной `due_date`

---

## Применение миграции

### Важно! Перед запуском приложения:

1. Открыть Supabase Dashboard → SQL Editor
2. Скопировать содержимое файла `services/crm-backend/migrations/015_add_consultant_tasks.sql`
3. Вставить и выполнить SQL
4. Проверить, что таблица `consultant_tasks` создана

**Или через CLI (если есть локальная Supabase):**

```bash
psql -h localhost -U postgres -d postgres -f services/crm-backend/migrations/015_add_consultant_tasks.sql
```

---

## Тестирование

### 1. Запуск бэкенда:

```bash
cd services/crm-backend
npm run dev
```

### 2. Запуск фронтенда:

```bash
cd services/crm-frontend
npm run dev
```

### 3. Проверить endpoints:

```bash
# Получить задачи
curl -H "x-user-id: <consultant_user_id>" \
  "http://localhost:8084/consultant/tasks"

# Создать задачу
curl -X POST -H "x-user-id: <consultant_user_id>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Тестовая задача","due_date":"2026-02-05"}' \
  "http://localhost:8084/consultant/tasks"
```

### 4. Проверить UI:

1. Залогиниться как консультант
2. Открыть `/c/:consultantId`
3. ✅ Видна 5-я карточка "Активные задачи" в dashboard
4. ✅ Есть вкладка "Задачи"
5. Перейти на вкладку "Задачи"
6. ✅ Создать задачу через кнопку "+ Новая задача"
7. ✅ Отметить задачу выполненной через чекбокс → модалка результата
8. ✅ Фильтрация по статусу, дате, лиду
9. ✅ Поиск по названию

---

## Дополнительные улучшения (опционально)

### Полная интеграция в LeadsTab:

Добавить состояние и функции:

```typescript
const [leadTasks, setLeadTasks] = useState<Task[]>([]);

useEffect(() => {
  if (selectedLead) {
    loadLeadTasks(selectedLead.id);
  }
}, [selectedLead]);

const loadLeadTasks = async (leadId: string) => {
  try {
    const { tasks } = await consultantApi.getTasks({ lead_id: leadId });
    setLeadTasks(tasks);
  } catch (error: any) {
    console.error('Failed to load lead tasks:', error);
  }
};

const handleQuickCompleteTask = async (task: Task) => {
  // Логика быстрого выполнения
};
```

### Полная интеграция в CalendarTab:

Добавить состояние и функции:

```typescript
const [tasksForDate, setTasksForDate] = useState<Task[]>([]);

useEffect(() => {
  loadTasksForDate();
}, [selectedDate, consultantId]);

const loadTasksForDate = async () => {
  if (!consultantId) return;
  try {
    const dateStr = selectedDate.toISOString().split('T')[0];
    const { tasks } = await consultantApi.getTasks({
      consultantId,
      due_date_from: dateStr,
      due_date_to: dateStr
    });
    setTasksForDate(tasks);
  } catch (error: any) {
    console.error('Failed to load tasks for date:', error);
  }
};
```

---

## Возможные проблемы

### 1. TypeScript ошибки с импортами Task

**Решение:** Убедиться, что импорт правильный:

```typescript
import type { Task } from '@/types/task';
```

### 2. Backend 404 на /consultant/tasks

**Проверить:**
- Миграция применена?
- `consultantTasksRoutes` зарегистрирован в `server.ts`?
- Backend перезапущен после изменений?

### 3. Frontend не отображает карточку задач

**Проверить:**
- `TasksTab` импортирован в `ConsultantPage.tsx`?
- Добавлен `TabsTrigger` и `TabsContent`?
- Frontend перезапущен?

### 4. Статистика задач не отображается в dashboard

**Проверить:**
- `consultantDashboard.ts` обновлен?
- Интерфейс `DashboardStats` включает `tasks_total`, `tasks_overdue`, `tasks_today`?

---

## Итоговый чеклист

- [ ] Миграция применена в Supabase
- [ ] Backend перезапущен
- [ ] Frontend перезапущен
- [ ] ConsultantPage.tsx обновлен (карточка + таб)
- [ ] Вкладка "Задачи" работает
- [ ] Можно создать задачу
- [ ] Можно отметить выполненной
- [ ] Фильтры работают
- [ ] Просроченные задачи выделяются красным
- [ ] Badge "Назначена админом" показывается

---

**Автор:** AI Assistant (Claude Sonnet 4.5)
**Дата:** 2026-02-02
**Статус:** Основная реализация завершена, интеграции в LeadsTab/CalendarTab - базовые (можно улучшить)
