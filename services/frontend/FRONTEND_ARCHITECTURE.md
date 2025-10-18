# 🏗️ Frontend - Архитектура приложения

## 📊 Общая архитектура системы

```
┌─────────────────────────────────────────────────────────────┐
│                     ПОЛЬЗОВАТЕЛЬ                             │
│                    (Браузер / Mobile)                        │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                  NGINX (Reverse Proxy)                       │
│                  performanteaiagency.com                     │
│                                                              │
│  /            →  Frontend (Vite + React)                    │
│  /api/*       →  Backend (agent-service:8082)               │
└────────┬──────────────────────────────────┬─────────────────┘
         │                                   │
         ↓                                   ↓
┌────────────────────┐            ┌──────────────────────────┐
│   FRONTEND         │            │   BACKEND                │
│   (Docker nginx)   │            │   (Node.js + Fastify)    │
│   Port 80          │            │   Port 8082              │
│                    │            │                          │
│   • Vite          │            │   • agent-service        │
│   • React 18       │            │   • agent-brain          │
│   • TypeScript     │            │   • creative-analyzer    │
│   • shadcn/ui      │            │                          │
│   • React Query    │            └──────────┬───────────────┘
│   • Tailwind       │                       │
└────────┬───────────┘                       │
         │                                   │
         │                                   ↓
         │                         ┌─────────────────────┐
         │                         │   SUPABASE          │
         │                         │   (PostgreSQL)      │
         │                         │                     │
         └────────────────────────→│   • Auth            │
                                   │   • Database        │
                                   │   • Storage         │
                                   └─────────────────────┘
```

---

## 🔄 Поток данных

### 1. Аутентификация

```
Пользователь вводит email/password
           ↓
Frontend → Supabase Auth
           ↓
Supabase возвращает JWT токен
           ↓
Frontend сохраняет токен (localStorage)
           ↓
Все API запросы включают:
Authorization: Bearer <JWT_TOKEN>
```

### 2. Загрузка данных (Creatives)

```
Frontend                Backend                 Supabase
   │                       │                       │
   │──GET /api/user-creatives──→                  │
   │   + JWT token          │                      │
   │                        │                      │
   │                        │──Verify JWT─────────→│
   │                        │                      │
   │                        │←────user_id──────────│
   │                        │                      │
   │                        │──Query creatives────→│
   │                        │   WHERE user_id = ?  │
   │                        │                      │
   │                        │←────results──────────│
   │                        │                      │
   │←──JSON response────────│                      │
   │                        │                      │
   │──React Query cache─────│                      │
   │──Re-render component───│                      │
```

### 3. Создание Direction

```
User заполняет форму "Создать направление"
           ↓
Frontend валидирует (React Hook Form + Zod)
           ↓
POST /api/directions + JWT token
  {
    name: "Лиды",
    daily_budget_cents: 10000,
    target_cpl_cents: 500,
    ...
  }
           ↓
Backend проверяет JWT → user_id
           ↓
Backend валидирует данные (Zod)
           ↓
Backend вставляет в Supabase:
  INSERT INTO account_directions
  (user_account_id, name, daily_budget_cents, ...)
  VALUES (user_id, ...)
           ↓
Supabase проверяет RLS политику
           ↓
Успешно → возврат данных
           ↓
Frontend: React Query invalidates cache
           ↓
Frontend: автообновление списка Directions
```

---

## 🧩 Архитектура Frontend

### Слои приложения

```
┌───────────────────────────────────────────┐
│         ПРЕЗЕНТАЦИОННЫЙ СЛОЙ              │
│   (Pages - Dashboard, Creatives, etc.)    │
└─────────────────┬─────────────────────────┘
                  │
┌─────────────────┴─────────────────────────┐
│           КОМПОНЕНТНЫЙ СЛОЙ                │
│   (UI Components - Button, Card, etc.)     │
└─────────────────┬─────────────────────────┘
                  │
┌─────────────────┴─────────────────────────┐
│           ЛОГИЧЕСКИЙ СЛОЙ                  │
│   (Hooks - useDirections, useCreatives)    │
└─────────────────┬─────────────────────────┘
                  │
┌─────────────────┴─────────────────────────┐
│             СЛОЙ ДАННЫХ                    │
│   (Services - API clients)                 │
└─────────────────┬─────────────────────────┘
                  │
┌─────────────────┴─────────────────────────┐
│          КОНФИГУРАЦИЯ                      │
│   (config/api.ts, config/features.ts)      │
└───────────────────────────────────────────┘
```

### Пример потока в приложении

#### Сценарий: Пользователь открывает страницу Creatives

```typescript
// 1. ПРЕЗЕНТАЦИОННЫЙ СЛОЙ
// src/pages/Creatives.tsx
function CreativesPage() {
  const { data, isLoading } = useUserCreatives();  // ← Хук
  
  if (isLoading) return <Spinner />;
  
  return (
    <div>
      <h1>Мои Креативы</h1>
      <CreativesList creatives={data} />  // ← Компонент
    </div>
  );
}

// 2. ЛОГИЧЕСКИЙ СЛОЙ
// src/hooks/useUserCreatives.ts
function useUserCreatives() {
  return useQuery({
    queryKey: ['creatives'],
    queryFn: getUserCreatives,  // ← Функция из service
  });
}

// 3. СЛОЙ ДАННЫХ
// src/services/creativesApi.ts
async function getUserCreatives() {
  const response = await fetch(
    `${API_BASE_URL}/user-creatives`,  // ← Конфигурация
    {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    }
  );
  return response.json();
}

// 4. КОНФИГУРАЦИЯ
// src/config/api.ts
export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL || 
  '/api';
```

---

## 🔐 Аутентификация и авторизация

### Поток аутентификации

```typescript
// 1. Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123',
});

// data.session.access_token - JWT токен

// 2. Сохранение токена (автоматически в Supabase)
// Supabase SDK сохраняет в localStorage:
// supabase.auth.session

// 3. Использование токена в запросах
const token = (await supabase.auth.getSession()).data.session?.access_token;

fetch('/api/user-creatives', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// 4. Backend проверяет токен
// См. FRONTEND_SECURITY.md
```

### Защищенные роуты

```typescript
// src/App.tsx
import { useAuth } from './hooks/useAuth';

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return <Spinner />;
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  return children;
}

// Использование
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  } />
</Routes>
```

---

## 📦 State Management

### React Query для серверного состояния

```typescript
// Кеширование
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 минут
      cacheTime: 10 * 60 * 1000,  // 10 минут
      refetchOnWindowFocus: false,
    },
  },
});

// Инвалидация кеша после мутации
const mutation = useMutation({
  mutationFn: createDirection,
  onSuccess: () => {
    queryClient.invalidateQueries(['directions']);  // ← Обновление
  },
});
```

### React Context для глобального состояния

```typescript
// src/context/AppContext.tsx
const AppContext = createContext({
  user: null,
  theme: 'light',
  setTheme: () => {},
});

// Использование
const { user, theme } = useContext(AppContext);
```

---

## 🎨 UI Architecture (shadcn/ui)

### Система компонентов

```
Атомарные компоненты (src/components/ui/)
  ├─ Button
  ├─ Input
  ├─ Card
  └─ ...
         ↓
Составные компоненты (src/components/)
  ├─ CreativeCard (Card + Button + Image)
  ├─ DirectionForm (Form + Input + Select)
  └─ ...
         ↓
Контейнеры (src/pages/)
  ├─ Creatives (CreativeCard[])
  ├─ Profile (DirectionForm + DirectionsList)
  └─ ...
```

### Пример композиции

```typescript
// Атомарный компонент
<Button variant="primary" size="lg">
  Создать
</Button>

// Составной компонент
<DirectionCard>
  <Card>
    <CardHeader>
      <CardTitle>{direction.name}</CardTitle>
    </CardHeader>
    <CardContent>
      <p>Бюджет: ${direction.daily_budget_cents / 100}</p>
    </CardContent>
    <CardFooter>
      <Button onClick={handleEdit}>Редактировать</Button>
      <Button variant="destructive" onClick={handleDelete}>
        Удалить
      </Button>
    </CardFooter>
  </Card>
</DirectionCard>
```

---

## 🚀 Build Process

### Development

```bash
npm run dev
   ↓
Vite Dev Server (HMR)
   ↓
http://localhost:8081
```

### Production

```bash
npm run build
   ↓
Vite build (Rollup)
   ↓
dist/
  ├─ index.html
  ├─ assets/
  │   ├─ index-abc123.js  (минифицированный)
  │   └─ index-xyz789.css
  └─ ...
   ↓
Docker Multi-Stage Build
   ↓
Stage 1: Node (сборка)
Stage 2: Nginx Alpine (сервер)
   ↓
Docker Image: agents-monorepo-frontend
   ↓
Docker Container на порту 80
   ↓
Nginx проксирует на https://performanteaiagency.com
```

---

## 📡 API Communication

### Структура API запроса

```typescript
// 1. Клиент (src/services/creativesApi.ts)
export async function getUserCreatives(): Promise<Creative[]> {
  const supabase = createClient();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  
  const response = await fetch(`${API_BASE_URL}/user-creatives`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  
  return response.json();
}

// 2. Backend обрабатывает (agent-service)
app.get('/user-creatives',
  { preHandler: authMiddleware },  // Проверка JWT
  async (request, reply) => {
    const userId = request.user.id;  // Из токена
    
    const creatives = await supabase
      .from('user_creatives')
      .select('*')
      .eq('user_id', userId);
    
    return creatives;
  }
);
```

### Error Handling

```typescript
// src/services/api-client.ts
class ApiClient {
  async fetch(url: string, options?: RequestInit) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        if (response.status === 401) {
          // Токен истёк - редирект на login
          window.location.href = '/login';
          throw new Error('Unauthorized');
        }
        
        if (response.status === 403) {
          throw new Error('Forbidden');
        }
        
        throw new Error(`HTTP ${response.status}`);
      }
      
      return response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
}
```

---

## 🗂️ Файловая структура (детально)

```
services/frontend/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn/ui компоненты
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   └── ...
│   │   │
│   │   ├── dashboard/            # Компоненты Dashboard
│   │   │   └── DashboardHero.tsx
│   │   │
│   │   ├── profile/              # Компоненты Profile
│   │   │   ├── DirectionsCard.tsx
│   │   │   ├── CreateDirectionDialog.tsx
│   │   │   └── EditDirectionDialog.tsx
│   │   │
│   │   ├── CampaignList.tsx      # Список кампаний
│   │   ├── VideoUpload.tsx       # Загрузка видео
│   │   └── ...
│   │
│   ├── pages/                    # Страницы (роуты)
│   │   ├── Dashboard.tsx         # /
│   │   ├── Creatives.tsx         # /creatives
│   │   ├── Profile.tsx           # /profile
│   │   └── ...
│   │
│   ├── services/                 # API клиенты
│   │   ├── creativesApi.ts
│   │   ├── directionsApi.ts
│   │   └── ...
│   │
│   ├── hooks/                    # React hooks
│   │   ├── useDirections.ts
│   │   ├── useAuth.ts
│   │   └── ...
│   │
│   ├── types/                    # TypeScript типы
│   │   ├── direction.ts
│   │   ├── creative.ts
│   │   └── ...
│   │
│   ├── config/                   # Конфигурация
│   │   ├── api.ts               # API URLs
│   │   └── features.ts          # Feature flags
│   │
│   ├── integrations/            # Внешние сервисы
│   │   └── supabase/
│   │       ├── client.ts        # Supabase клиент
│   │       └── types.ts         # Типы из БД
│   │
│   ├── utils/                   # Утилиты
│   │   └── formatters.ts
│   │
│   ├── App.tsx                  # Главный компонент
│   ├── main.tsx                 # Entry point
│   └── index.css                # Глобальные стили
│
├── public/                      # Статика
│   ├── logo.svg
│   └── favicon.ico
│
├── Dockerfile                   # Docker образ
├── nginx.conf                   # Nginx для SPA
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
│
└── FRONTEND_README.md          # Эта документация
```

---

## 🔄 Жизненный цикл компонента

```
User открывает /creatives
         ↓
React Router → <Creatives />
         ↓
useUserCreatives() hook
         ↓
React Query проверяет cache
         ↓
Нет в cache → fetch API
         ↓
getUserCreatives() → /api/user-creatives
         ↓
Backend возвращает данные
         ↓
React Query кеширует
         ↓
Component re-render с данными
         ↓
Отображение списка креативов
```

---

## 🎯 Производительность

### Оптимизации

1. **Code Splitting**
```typescript
// Lazy loading страниц
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Creatives = lazy(() => import('./pages/Creatives'));

<Suspense fallback={<Spinner />}>
  <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/creatives" element={<Creatives />} />
  </Routes>
</Suspense>
```

2. **React Query Caching**
```typescript
// Данные кешируются на 5 минут
const { data } = useQuery({
  queryKey: ['creatives'],
  queryFn: getUserCreatives,
  staleTime: 5 * 60 * 1000,
});
```

3. **Vite Production Build**
- Минификация
- Tree-shaking
- Chunk splitting
- Asset optimization

---

## 📚 Дополнительные ресурсы

- [FRONTEND_README.md](./FRONTEND_README.md) - Основная документация
- [FRONTEND_SECURITY.md](./FRONTEND_SECURITY.md) - Безопасность
- [PROJECT_OVERVIEW_RU.md](../../PROJECT_OVERVIEW_RU.md) - Backend архитектура

---

**Последнее обновление:** 17 октября 2025

