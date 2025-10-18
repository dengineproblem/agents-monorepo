# 🎨 Frontend - Система управления рекламными кампаниями

## 📋 Обзор

Web-приложение для автоматизированного управления рекламными кампаниями в Facebook Ads и TikTok Ads.

**URL Production:** https://performanteaiagency.com

---

## 🛠 Технологии

- **Фреймворк:** Vite + React 18 + TypeScript
- **UI библиотека:** shadcn/ui (Radix UI + Tailwind CSS)
- **Стейт менеджмент:** React Query (@tanstack/react-query)
- **База данных:** Supabase (PostgreSQL + Auth)
- **Стилизация:** Tailwind CSS
- **Формы:** React Hook Form + Zod
- **Графики:** Recharts
- **Drag & Drop:** @dnd-kit

---

## 🚀 Быстрый старт

### Локальная разработка

```bash
cd services/frontend

# Установка зависимостей
npm install

# Запуск dev сервера
npm run dev

# Сборка для продакшн
npm run build

# Preview продакшн билда
npm run preview
```

**Dev сервер:** http://localhost:8081

### Docker (Production)

```bash
# В корне монорепо
docker compose up -d frontend

# Пересборка
docker compose build --no-cache frontend
docker compose up -d frontend
```

**Production URL:** https://performanteaiagency.com

---

## 📁 Структура проекта

```
services/frontend/
├── src/
│   ├── components/          # React компоненты
│   │   ├── ui/             # shadcn/ui компоненты (кнопки, формы и т.д.)
│   │   ├── dashboard/      # Компоненты дашборда
│   │   ├── profile/        # Компоненты профиля (Directions)
│   │   └── sales/          # Компоненты продаж
│   │
│   ├── pages/              # Страницы приложения
│   │   ├── Dashboard.tsx       # Главная страница - метрики
│   │   ├── Creatives.tsx       # Управление креативами
│   │   ├── Profile.tsx         # Профиль + Directions
│   │   ├── AdSettings.tsx      # Настройки объявлений
│   │   ├── CreativeGeneration.tsx  # Генерация картинок AI
│   │   ├── CampaignDetail.tsx  # Детали кампании
│   │   ├── ROIAnalytics.tsx    # Аналитика ROI
│   │   ├── Login.tsx           # Вход
│   │   ├── Signup.tsx          # Регистрация
│   │   └── Consultations.tsx   # (не используется)
│   │
│   ├── services/           # API клиенты
│   │   ├── creativesApi.ts         # Креативы API
│   │   ├── directionsApi.ts        # Directions API
│   │   ├── facebookApi.ts          # Facebook Ads API
│   │   ├── tiktokApi.ts            # TikTok Ads API
│   │   ├── defaultSettingsApi.ts   # Настройки по умолчанию
│   │   ├── creativeAnalyticsApi.ts # Аналитика креативов
│   │   ├── manualLaunchApi.ts      # Ручной запуск кампаний
│   │   └── plansApi.ts             # Планы и метрики
│   │
│   ├── hooks/              # React хуки
│   │   ├── useDirections.ts        # Работа с Directions
│   │   ├── useUserCreatives.ts     # Креативы пользователя
│   │   ├── useVideoUpload.ts       # Загрузка видео
│   │   └── useTelegramWebApp.ts    # Telegram WebApp (если используется)
│   │
│   ├── config/             # Конфигурация
│   │   ├── api.ts          # API URLs
│   │   └── features.ts     # Feature flags
│   │
│   ├── integrations/       # Внешние сервисы
│   │   └── supabase/       # Supabase клиент
│   │
│   └── types/              # TypeScript типы
│       ├── direction.ts
│       ├── report.ts
│       └── consultation.ts
│
├── public/                 # Статические файлы
├── Dockerfile             # Docker образ
├── nginx.conf             # Nginx конфигурация (для SPA)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

---

## 🌐 Основные страницы

### 📊 Dashboard (`/`)
**Назначение:** Главная страница с общей статистикой

**Функции:**
- Показывает метрики рекламных кампаний
- Графики эффективности (CPL, CTR, Spend)
- Сводка по активным кампаниям
- Быстрые действия

**API:**
- `GET /api/campaigns` - список кампаний
- `GET /api/metrics` - метрики
- `GET /api/reports` - отчёты

---

### 🎨 Creatives (`/creatives`)
**Назначение:** Управление креативами (видео/изображения)

**Функции:**
- Загрузка множественных креативов
- Просмотр библиотеки креативов
- Редактирование метаданных
- Удаление креативов
- Привязка к направлениям (Directions)

**API:**
- `GET /api/user-creatives` - список креативов
- `POST /api/video` - загрузка видео
- `POST /api/image` - загрузка изображения
- `DELETE /api/creatives/:id` - удаление

**Поддерживаемые форматы:**
- Видео: MP4, MOV (до 500MB)
- Изображения: JPG, PNG

---

### 👤 Profile (`/profile`)
**Назначение:** Настройки аккаунта и управление Directions

**Функции:**
- Подключение аккаунтов Facebook/TikTok
- Настройка токенов доступа
- **Управление Directions** (направления рекламы)
- Просмотр тарифа
- Настройки уведомлений

**Directions (Направления):**
- Создание направлений (например: "Лиды", "Продажи", "Подписки")
- Установка бюджетов для каждого направления
- Установка целевого CPL
- Выбор оптимизации (LEADS, CONVERSATIONS, etc.)

**API:**
- `GET /api/directions` - список направлений
- `POST /api/directions` - создание направления
- `PUT /api/directions/:id` - обновление
- `DELETE /api/directions/:id` - удаление

---

### ⚙️ Ad Settings (`/ad-settings`)
**Назначение:** Настройки объявлений по умолчанию

**Функции:**
- Установка целевых метрик (CPL, CPA)
- Настройка таргетинга по умолчанию
- Выбор типа оптимизации
- Установка дневных бюджетов

**API:**
- `GET /api/default-settings` - текущие настройки
- `POST /api/default-settings` - сохранение настроек

---

### 🎭 Creative Generation (`/creative-generation`)
**Назначение:** Генерация изображений креативов через AI

**Функции:**
- Генерация изображений по текстовому промпту
- Выбор стиля изображения
- Сохранение в библиотеку креативов
- История генераций

**API:**
- `POST /api/creative-generation` - генерация
- `GET /api/creative-generation/history` - история

⚠️ **Требует интеграции с AI сервисом** (OpenAI DALL-E, Midjourney API, и т.д.)

---

### 📈 Campaign Detail (`/campaign/:id`)
**Назначение:** Детальная информация о кампании

**Функции:**
- Метрики кампании
- Разбивка по ad sets
- Разбивка по ads
- История изменений
- Управление кампанией (пауза/запуск)

**API:**
- `GET /api/campaigns/:id` - детали кампании
- `GET /api/campaigns/:id/adsets` - ad sets
- `GET /api/campaigns/:id/ads` - объявления

---

### 💰 ROI Analytics (`/roi-analytics`)
**Назначение:** Аналитика рентабельности

**Функции:**
- Расчёт ROI по кампаниям
- Сравнение эффективности
- Графики трендов
- Экспорт отчётов

**API:**
- `GET /api/analytics/roi` - данные ROI
- `GET /api/analytics/trends` - тренды

---

### 🔐 Login/Signup (`/login`, `/signup`)
**Назначение:** Аутентификация

**Метод:** Supabase Auth
- Email + Password
- Сброс пароля
- Email verification

⚠️ **Проблема безопасности:** см. [FRONTEND_SECURITY.md](./FRONTEND_SECURITY.md)

---

### ~~🗓️ Consultations~~ (не используется)
Страница для консультаций с клиентами. **Функционал не завершён, не отображается в интерфейсе.**

---

## 🔌 API Конфигурация

### Переменные окружения

Используются переменные с префиксом `VITE_`:

```env
# API URLs
VITE_API_BASE_URL=/api                    # Backend API (через nginx proxy)
VITE_ANALYTICS_API_BASE_URL=/api          # Analytics API

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Конфигурация API (`src/config/api.ts`)

```typescript
export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL || 
  'https://agents.performanteaiagency.com';

export const ANALYTICS_API_BASE_URL = 
  import.meta.env.VITE_ANALYTICS_API_BASE_URL || 
  'https://agents.performanteaiagency.com';
```

**Production:**
- Frontend: `https://performanteaiagency.com`
- API: `https://performanteaiagency.com/api/*` (проксируется на agent-service:8082)
- Analytics: `https://agents.performanteaiagency.com/api/analyzer/*`

---

## 🔄 Взаимодействие с Backend

### API Endpoints используемые Frontend

```
POST   /api/video                    # Загрузка видео
POST   /api/image                    # Загрузка изображения
GET    /api/user-creatives           # Список креативов
DELETE /api/creatives/:id            # Удаление креатива

GET    /api/directions               # Directions (направления)
POST   /api/directions               # Создание Direction
PUT    /api/directions/:id           # Обновление Direction
DELETE /api/directions/:id           # Удаление Direction

GET    /api/default-settings         # Настройки по умолчанию
POST   /api/default-settings         # Сохранение настроек

GET    /api/campaigns                # Список кампаний
GET    /api/campaigns/:id            # Детали кампании
POST   /api/campaign-builder/manual-launch  # Запуск кампании

GET    /api/creative-analytics       # Аналитика креативов
POST   /api/creative-test/start      # Запуск креатив-теста

GET    /api/plans                    # Планы и метрики
```

**Документация Backend API:** [BACKEND_API.md](../../PROJECT_OVERVIEW_RU.md)

---

## 🎨 UI Компоненты

Используется **shadcn/ui** - коллекция переиспользуемых компонентов на базе Radix UI.

### Основные компоненты (`src/components/ui/`)

```
button.tsx         # Кнопки
card.tsx           # Карточки
dialog.tsx         # Модальные окна
form.tsx           # Формы
input.tsx          # Поля ввода
select.tsx         # Выпадающие списки
table.tsx          # Таблицы
tabs.tsx           # Вкладки
toast.tsx          # Уведомления
chart.tsx          # Графики (Recharts)
```

**Добавление нового компонента:**

```bash
npx shadcn-ui@latest add <component-name>
```

Пример:
```bash
npx shadcn-ui@latest add calendar
```

---

## 📊 State Management

Используется **React Query** для работы с серверным состоянием.

### Пример хука

```typescript
// hooks/useDirections.ts
import { useQuery, useMutation } from '@tanstack/react-query';
import { getDirections, createDirection } from '@/services/directionsApi';

export function useDirections(userId: string) {
  return useQuery({
    queryKey: ['directions', userId],
    queryFn: () => getDirections(userId),
  });
}

export function useCreateDirection() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createDirection,
    onSuccess: () => {
      queryClient.invalidateQueries(['directions']);
    },
  });
}
```

---

## 🔧 Разработка

### Добавление новой страницы

1. Создайте компонент в `src/pages/`:
```tsx
// src/pages/NewPage.tsx
export default function NewPage() {
  return <div>New Page</div>;
}
```

2. Добавьте роут в `src/App.tsx` (или роутер)

3. Добавьте ссылку в навигацию (`components/Sidebar.tsx` или `components/Header.tsx`)

### Добавление нового API эндпоинта

1. Создайте функцию в соответствующем файле `services/*.ts`:
```typescript
// src/services/myApi.ts
import { API_BASE_URL } from '@/config/api';

export async function getMyData(id: string) {
  const response = await fetch(`${API_BASE_URL}/my-endpoint/${id}`);
  return response.json();
}
```

2. Создайте хук в `hooks/`:
```typescript
// src/hooks/useMyData.ts
import { useQuery } from '@tanstack/react-query';
import { getMyData } from '@/services/myApi';

export function useMyData(id: string) {
  return useQuery({
    queryKey: ['myData', id],
    queryFn: () => getMyData(id),
  });
}
```

3. Используйте в компоненте:
```tsx
import { useMyData } from '@/hooks/useMyData';

function MyComponent() {
  const { data, isLoading } = useMyData('123');
  
  if (isLoading) return <div>Loading...</div>;
  return <div>{data.name}</div>;
}
```

---

## 🐛 Отладка

### Dev Tools

```bash
# Открыть в браузере
npm run dev

# Открыть DevTools (F12)
# Network - проверить API запросы
# Console - проверить логи
# React DevTools - инспектировать компоненты
```

### Логирование API

В `src/config/api.ts` логи выводятся в dev режиме:

```typescript
if (import.meta.env.DEV) {
  console.log('[API Config] Base URL:', API_BASE_URL);
}
```

### Проверка билда

```bash
# Соберите production
npm run build

# Проверьте preview
npm run preview

# Откройте http://localhost:4173
```

---

## 🚀 Деплой

### Production (Docker)

Деплой через Docker Compose (см. [QUICK_DOMAIN_DEPLOY.md](../../QUICK_DOMAIN_DEPLOY.md)):

```bash
# На сервере
cd /root/agents-monorepo
git pull origin main
docker compose build --no-cache frontend
docker compose up -d frontend
```

### Проверка деплоя

```bash
# Проверьте контейнер
docker compose ps frontend
docker compose logs frontend --tail 50

# Проверьте в браузере
curl https://performanteaiagency.com
```

---

## ⚠️ Проблемы безопасности

**КРИТИЧНО! См. [FRONTEND_SECURITY.md](./FRONTEND_SECURITY.md)**

- ❌ RLS политики не настроены в Supabase
- ❌ Все таблицы доступны с фронтенда
- ❌ Аутентификация происходит только на клиенте
- ✅ Нужно настроить Row Level Security (RLS) в Supabase
- ✅ Нужно добавить middleware проверку на backend

---

## 📚 Дополнительная документация

- [FRONTEND_SECURITY.md](./FRONTEND_SECURITY.md) - Безопасность и RLS
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - Архитектура приложения
- [../../PROJECT_OVERVIEW_RU.md](../../PROJECT_OVERVIEW_RU.md) - Обзор Backend
- [../../QUICK_DOMAIN_DEPLOY.md](../../QUICK_DOMAIN_DEPLOY.md) - Деплой

---

## 🤝 Contributing

При добавлении новых фич:

1. Следуйте структуре проекта
2. Используйте TypeScript типы
3. Покрывайте API хуками (React Query)
4. Используйте shadcn/ui компоненты
5. Следуйте Tailwind CSS конвенциям
6. Добавляйте документацию для новых API

---

## 📞 Контакты

**Production URL:** https://performanteaiagency.com

**Backend API:** https://performanteaiagency.com/api  
**Analytics API:** https://agents.performanteaiagency.com/api/analyzer

---

**Последнее обновление:** 17 октября 2025

