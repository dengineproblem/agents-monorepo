# WhatsApp CRM Frontend

Отдельный фронтенд для CRM системы управления WhatsApp лидами.

## Структура проекта

```
crm-frontend/
├── src/
│   ├── components/       # React компоненты
│   │   ├── ui/          # shadcn/ui компоненты (нужно добавить)
│   │   ├── whatsapp-crm/  # CRM компоненты (нужно перенести)
│   │   ├── dialogs/     # Компоненты диалогов (нужно перенести)
│   │   └── chatbot/     # Компоненты чатбота (нужно создать)
│   ├── pages/           # Страницы приложения (нужно создать)
│   ├── services/        # API сервисы ✅
│   ├── lib/             # Утилиты ✅
│   └── types/           # TypeScript типы (нужно добавить)
├── package.json         # ✅ Создан
├── tsconfig.json        # ✅ Создан
├── vite.config.ts       # ✅ Создан (proxy настроен)
├── Dockerfile           # ✅ Создан
└── nginx.conf           # ✅ Создан
```

## ✅ Что уже сделано

### Инфраструктура
- ✅ Базовая структура проекта
- ✅ package.json с необходимыми зависимостями
- ✅ TypeScript конфигурация
- ✅ Vite конфигурация с proxy для /api/crm и /api/chatbot
- ✅ Tailwind CSS + shadcn/ui конфигурация
- ✅ Docker контейнер с nginx
- ✅ nginx.conf для production

### Backend
- ✅ crm-backend создан (порт 8084)
- ✅ Перенесены routes/dialogs.ts
- ✅ Перенесён scripts/analyzeDialogs.ts
- ✅ Перенесены lib/evolutionDb.ts, supabase.ts, logger.ts
- ✅ Fastify сервер настроен

### API сервисы
- ✅ src/services/dialogAnalysisService.ts - API для работы с лидами
- ✅ src/services/chatbotApi.ts - API для работы с чатботом

### Docker & Nginx
- ✅ Добавлено в docker-compose.yml:
  - crm-backend (8084)
  - crm-frontend (3003)
- ✅ nginx-production.conf обновлён:
  - /crm/ → crm-frontend
  - /api/crm/ → crm-backend
  - /api/chatbot/ → chatbot-service

### Frontend basics
- ✅ index.html
- ✅ src/main.tsx
- ✅ src/App.tsx с routing и sidebar
- ✅ src/index.css с Tailwind
- ✅ src/lib/utils.ts

## 🔨 Что нужно сделать

### 1. Перенести UI компоненты из services/frontend

Скопировать shadcn/ui компоненты из `services/frontend/src/components/ui/`:
- Button
- Card
- Badge
- Tabs
- Dialog
- DropdownMenu
- Input
- Select
- Textarea
- Popover
- ScrollArea
- Separator
- Switch
- Toast
- Tooltip

### 2. Перенести WhatsApp CRM компоненты

Из `services/frontend/src/components/whatsapp-crm/`:
- `KanbanBoard.tsx` - главная Kanban доска
- `KanbanColumn.tsx` - колонка воронки с Drag & Drop
- `LeadCard.tsx` - карточка лида
- `AddLeadModal.tsx` - модальное окно добавления
- `BotControls.tsx` - управление ботом

Из `services/frontend/src/components/dialogs/`:
- `DialogDetailModal.tsx` - детали лида
- `DialogFilters.tsx` - фильтры

### 3. Создать страницу WhatsAppCRM

Файл: `src/pages/WhatsAppCRM.tsx`

Должна содержать:
- Импорт KanbanBoard
- Фильтры
- Статистику (hot/warm/cold)
- Кнопку "Analyze Dialogs"

### 4. Создать компоненты чатбота

#### 4.1 BotStatsDashboard (src/components/chatbot/BotStatsDashboard.tsx)
- 4 карточки статистики
- График активности
- API: `chatbotApi.getStats(userId)`

#### 4.2 PromptEditor (src/components/chatbot/PromptEditor.tsx)
- Textarea для промпта
- Кнопка "Регенерировать из документов"
- Кнопка "Сохранить"
- API: `chatbotApi.getConfiguration()`, `chatbotApi.updateConfiguration()`

#### 4.3 DocumentUploader (src/components/chatbot/DocumentUploader.tsx)
- Drag-n-drop зона
- Список загруженных документов
- Кнопка удаления
- API: `chatbotApi.uploadDocument()`, `chatbotApi.deleteDocument()`

#### 4.4 TriggersManager (src/components/chatbot/TriggersManager.tsx)
- Таблица триггеров
- Модальное окно редактирования
- API: `chatbotApi.getTriggers()`, `chatbotApi.createTrigger()`, etc.

### 5. Создать страницы

#### 5.1 ChatbotSettings (src/pages/ChatbotSettings.tsx)
```tsx
<Tabs>
  <TabsContent value="prompt"><PromptEditor /></TabsContent>
  <TabsContent value="documents"><DocumentUploader /></TabsContent>
  <TabsContent value="triggers"><TriggersManager /></TabsContent>
</Tabs>
```

#### 5.2 ReactivationCampaigns (src/pages/ReactivationCampaigns.tsx)
```tsx
- CampaignStats (статистика кампании)
- ReactivationQueue (топ-300 лидов)
- CampaignControls (управление)
```

### 6. Добавить TypeScript типы

Создать `src/types/dialogAnalysis.ts`:
```typescript
export type FunnelStage = 'new_lead' | 'not_qualified' | 'qualified' | 
  'consultation_booked' | 'consultation_completed' | 'deal_closed' | 'deal_lost';

export type InterestLevel = 'hot' | 'warm' | 'cold';

export interface DialogAnalysisLead {
  // ... типы из dialogAnalysisService
}
```

### 7. Обновить навигацию в App.tsx

```tsx
<Sidebar />
<Routes>
  <Route path="/" element={<WhatsAppCRM />} />
  <Route path="/chatbot" element={<ChatbotSettings />} />
  <Route path="/reactivation" element={<ReactivationCampaigns />} />
</Routes>
```

### 8. Создать Sidebar компонент

Файл: `src/components/Sidebar.tsx`

С иконками из lucide-react:
- MessageSquare (CRM)
- Bot (Настройки бота)
- Send (Рассылки)

## 🚀 Запуск

### Development

```bash
cd services/crm-frontend
npm install
npm run dev
# Откроется на http://localhost:5174
```

### Production (Docker)

```bash
# В корне проекта
docker-compose build crm-backend crm-frontend
docker-compose up -d crm-backend crm-frontend
docker-compose restart nginx
```

Доступно на:
- https://app.performanteaiagency.com/crm/
- API: https://app.performanteaiagency.com/api/crm/

## 🔧 Переменные окружения

Frontend (`services/crm-frontend/.env`):
```bash
VITE_CRM_BACKEND_URL=/api/crm
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-key
```

Backend (`.env.crm` в корне проекта):
```bash
PORT=8084
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_NAME=evolution
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_PASSWORD=
OPENAI_API_KEY=
```

## 📝 API Endpoints

### CRM Backend (порт 8084)
- `POST /dialogs/analyze` - запустить анализ диалогов
- `GET /dialogs/analysis` - получить лиды
- `GET /dialogs/stats` - статистика
- `GET /dialogs/export-csv` - экспорт в CSV
- `POST /dialogs/leads` - создать лид вручную
- `PATCH /dialogs/leads/:id` - обновить лид
- `DELETE /dialogs/analysis/:id` - удалить лид

### Chatbot Service (порт 8083)
- `GET /stats` - статистика бота
- `GET /configuration/:userId` - конфигурация
- `PUT /configuration/:configId` - обновить конфигурацию
- `POST /documents/upload` - загрузить документ
- `DELETE /documents/:fileId` - удалить документ
- `POST /regenerate-prompt` - регенерировать промпт
- `GET /triggers` - список триггеров
- `POST /triggers` - создать триггер
- `PUT /triggers/:id` - обновить триггер
- `DELETE /triggers/:id` - удалить триггер
- `GET /reactivation/status` - статус рассылки
- `GET /reactivation/queue` - очередь рассылки
- `POST /reactivation/start` - запустить рассылку
- `DELETE /reactivation/cancel` - отменить рассылку

## 🐛 Troubleshooting

### Проблема: компоненты не импортируются
Убедитесь что путь в `tsconfig.json`:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

### Проблема: API не работает
Проверьте proxy в `vite.config.ts`:
```typescript
proxy: {
  '/api/crm': { target: 'http://localhost:8084', ... },
  '/api/chatbot': { target: 'http://localhost:8083', ... }
}
```

### Проблема: Docker не собирается
Проверьте что все зависимости в `package.json` корректны:
```bash
npm install
npm run build
```

## 📚 Дополнительные ресурсы

- [React DnD](https://react-dnd.github.io/react-dnd/) - для Kanban Drag & Drop
- [shadcn/ui](https://ui.shadcn.com/) - UI компоненты
- [Recharts](https://recharts.org/) - графики статистики
- [Lucide Icons](https://lucide.dev/) - иконки






