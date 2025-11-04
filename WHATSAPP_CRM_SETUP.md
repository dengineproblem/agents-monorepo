# WhatsApp CRM - Инструкции по настройке

**Дата создания:** 2025-11-03  
**Статус:** Phase 1 Complete  
**Приоритет:** High

## Оглавление

- [Что реализовано](#что-реализовано)
- [Требования](#требования)
- [Установка](#установка)
- [База данных](#база-данных)
- [Запуск](#запуск)
- [Использование](#использование)
- [API Reference](#api-reference)

---

## Что реализовано

### ✅ Phase 1: Kanban Board + Clean UI (ЗАВЕРШЕНО)

**Frontend компоненты:**
- `CRMHeader.tsx` - минималистичный header без sidebar
- `KanbanBoard.tsx` - главный Kanban компонент
- `KanbanColumn.tsx` - колонка воронки продаж с drag & drop
- `LeadCard.tsx` - компактная карточка лида для Kanban
- `AddLeadModal.tsx` - форма добавления нового лида

**Backend API endpoints:**
- `POST /api/dialogs/leads` - создание лида вручную
- `PATCH /api/dialogs/leads/:id` - обновление лида
- `DELETE /api/dialogs/analysis/:id` - удаление лида

**Функциональность:**
- ✅ Kanban Board с 7 колонками воронки продаж
- ✅ Drag & Drop перемещение лидов между этапами
- ✅ Цветовая индикация по interest_level (hot/warm/cold)
- ✅ Автообновление статуса при перетаскивании
- ✅ Добавление лидов вручную
- ✅ Удаление лидов
- ✅ Фильтры (сворачиваемые)
- ✅ Статистика по лидам в header
- ✅ Детальная информация в модальном окне

---

## Требования

### Backend
- Node.js 18+
- PostgreSQL (Supabase)
- Evolution API (для WhatsApp сообщений)

### Frontend
- Node.js 18+
- React 18+
- TypeScript
- Установленные библиотеки: `react-dnd`, `react-dnd-html5-backend`

---

## Установка

### 1. Установить зависимости

```bash
# Backend
cd services/agent-service
npm install

# Frontend
cd services/frontend
npm install react-dnd react-dnd-html5-backend
```

### 2. Настроить переменные окружения

**Backend:** `services/agent-service/.env`
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
EVOLUTION_DB_HOST=localhost
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_NAME=evolution
EVOLUTION_DB_USER=postgres
EVOLUTION_DB_PASSWORD=your-password
```

**Frontend:** `services/frontend/.env`
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3000
```

---

## База данных

### Применить миграции в Supabase

Выполните SQL миграции в следующем порядке:

#### 1. Основная таблица (если не существует)
```bash
# Файл: services/frontend/supabase/dialog_analysis_table.sql
```

#### 2. Добавить поле is_medical
```bash
# Файл: services/frontend/supabase/add_is_medical_field.sql
```

#### 3. Добавить CRM поля
```bash
# Файл: services/frontend/supabase/add_crm_fields.sql
```

**Или выполните через Supabase Dashboard:**

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Скопируйте содержимое файлов миграций
4. Выполните каждую миграцию по очереди

**Проверка:**
```sql
-- Проверить структуру таблицы
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'dialog_analysis';

-- Должны быть поля:
-- funnel_stage, qualification_complete, notes, ad_budget, 
-- instagram_url, is_medical, и все остальные...
```

---

## Запуск

### Development режим

**1. Запустить Backend:**
```bash
cd services/agent-service
npm run dev
# Запустится на http://localhost:3000
```

**2. Запустить Frontend:**
```bash
cd services/frontend
npm run dev
# Запустится на http://localhost:5173
```

**3. Открыть WhatsApp CRM:**
```
http://localhost:5173/whatsapp-analysis
```

### Production режим

```bash
# Backend
cd services/agent-service
npm run build
npm start

# Frontend
cd services/frontend
npm run build
npm run preview
```

---

## Использование

### 1. Анализ диалогов

Сначала запустите анализ WhatsApp диалогов:

```bash
curl -X POST http://localhost:3000/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "your-instance-name",
    "userAccountId": "user-uuid",
    "minIncoming": 3,
    "maxDialogs": 50
  }'
```

### 2. Работа с Kanban Board

**Перетаскивание лидов:**
1. Откройте `/whatsapp-analysis`
2. Захватите карточку лида
3. Перетащите в нужную колонку
4. Статус автоматически обновится в БД

**Добавление лида вручную:**
1. Нажмите "+ Новый лид"
2. Заполните форму:
   - Телефон (обязательно)
   - Имя контакта
   - Тип бизнеса
   - Медицинская ниша (checkbox)
   - Этап воронки
   - Заметки
3. Нажмите "Добавить лида"

**Удаление лида:**
1. Наведите на карточку
2. Нажмите иконку корзины 🗑️
3. Подтвердите удаление

**Просмотр деталей:**
1. Кликните на карточку лида
2. Откроется модальное окно с полной информацией

**Фильтрация:**
1. Нажмите "Фильтры" в header
2. Выберите интерес, этап, минимальный score
3. Kanban board автоматически обновится

---

## API Reference

### 1. Создать лида

**Endpoint:** `POST /api/dialogs/leads`

**Body:**
```json
{
  "phone": "+77001234567",
  "contactName": "Иван Петров",
  "businessType": "Клиника",
  "isMedical": true,
  "funnelStage": "new_lead",
  "userAccountId": "uuid",
  "instanceName": "my-instance",
  "notes": "Заметка"
}
```

**Response:**
```json
{
  "success": true,
  "lead": { /* DialogAnalysis object */ }
}
```

### 2. Обновить лида

**Endpoint:** `PATCH /api/dialogs/leads/:id`

**Body:**
```json
{
  "userAccountId": "uuid",
  "funnelStage": "qualified",
  "contactName": "Иван Петров",
  "notes": "Обновленная заметка"
}
```

**Response:**
```json
{
  "success": true,
  "lead": { /* Updated DialogAnalysis object */ }
}
```

### 3. Удалить лида

**Endpoint:** `DELETE /api/dialogs/analysis/:id?userAccountId=uuid`

**Response:**
```json
{
  "success": true
}
```

### 4. Получить лидов

**Endpoint:** `GET /api/dialogs/analysis?userAccountId=uuid&funnelStage=qualified`

**Query params:**
- `userAccountId` (required)
- `instanceName` (optional)
- `interestLevel` (optional): hot | warm | cold
- `minScore` (optional): 0-100
- `funnelStage` (optional)
- `qualificationComplete` (optional): boolean

**Response:**
```json
{
  "success": true,
  "results": [ /* Array of DialogAnalysis */ ],
  "count": 42
}
```

---

## Структура компонентов

```
services/frontend/src/
├── pages/
│   └── WhatsAppAnalysis.tsx          # Главная страница CRM
├── components/
│   ├── whatsapp-crm/                 # CRM компоненты
│   │   ├── CRMHeader.tsx             # Header без sidebar
│   │   ├── KanbanBoard.tsx           # Kanban board
│   │   ├── KanbanColumn.tsx          # Колонка воронки
│   │   ├── LeadCard.tsx              # Карточка лида
│   │   └── AddLeadModal.tsx          # Форма добавления
│   └── dialogs/                      # Переиспользуемые компоненты
│       ├── DialogDetailModal.tsx     # Детали лида
│       └── DialogFilters.tsx         # Фильтры
├── services/
│   └── dialogAnalysisService.ts      # API клиент
└── types/
    └── dialogAnalysis.ts             # TypeScript типы
```

---

## Этапы воронки (Funnel Stages)

1. **new_lead** - Новый лид
2. **not_qualified** - Не квалифицирован
3. **qualified** - Квалифицирован
4. **consultation_booked** - Консультация назначена
5. **consultation_completed** - Консультация прошла
6. **deal_closed** - Сделка закрыта ✓
7. **deal_lost** - Сделка потеряна

---

## Следующие фазы

### Phase 2: CRUD операции (частично готово)
- ✅ Создание лидов
- ✅ Обновление лидов
- ✅ Удаление лидов
- ⏳ Редактирование лида (форма)

### Phase 3: История сообщений
- ⏳ Интеграция с Evolution API для чтения сообщений
- ⏳ Timeline компонент
- ⏳ Быстрые действия (копировать номер, открыть в WhatsApp)

### Phase 4: Отправка сообщений
- ⏳ Endpoint для отправки через Evolution API
- ⏳ Compose Message компонент
- ⏳ Шаблоны сообщений

---

## Troubleshooting

### Не работает drag & drop
- Проверьте, что установлены `react-dnd` и `react-dnd-html5-backend`
- Убедитесь, что `DndProvider` обернут вокруг компонента

### Ошибка "Instance not found"
- Проверьте, что у пользователя есть WhatsApp инстанс в `whatsapp_instances`
- Проверьте `instance_name` в запросе

### Лиды не отображаются
- Проверьте, что выполнены все SQL миграции
- Проверьте консоль браузера на ошибки
- Проверьте, что в БД есть записи для текущего `user_account_id`

### Backend ошибки
- Проверьте логи: `tail -f services/agent-service/logs/app.log`
- Проверьте подключение к Supabase
- Проверьте формат данных в запросах

---

## Дополнительные ресурсы

- [WHATSAPP_CRM_ROADMAP.md](./WHATSAPP_CRM_ROADMAP.md) - полный roadmap
- [DIALOG_ANALYSIS_IMPLEMENTATION.md](./DIALOG_ANALYSIS_IMPLEMENTATION.md) - детали анализа
- [Evolution API Docs](https://doc.evolution-api.com/) - документация WhatsApp API

---

**Документ обновлен:** 2025-11-03  
**Автор:** AI Assistant  
**Версия:** 1.0.0

