# 🤖 ВВОДНОЕ СООБЩЕНИЕ ДЛЯ AI АГЕНТА: WhatsApp CRM & Chatbot

**Дата**: 2025-11-10  
**Статус**: Локальная разработка завершена, готово к дальнейшей работе  

---

## 👋 ДОБРО ПОЖАЛОВАТЬ!

Ты работаешь над проектом **WhatsApp CRM & Chatbot** - системой управления лидами из WhatsApp с AI-анализом диалогов и автоматизацией.

---

## 📋 ЧТО УЖЕ СДЕЛАНО

### ✅ Backend (CRM)
- ✅ Сервис `crm-backend` запущен и работает на порту **8084**
- ✅ Интеграция с Evolution PostgreSQL (источник WhatsApp сообщений)
- ✅ Интеграция с Supabase (хранение результатов анализа)
- ✅ AI-анализ диалогов через OpenAI GPT-4-mini
- ✅ Lead scoring (0-100) и квалификация (hot/warm/cold)
- ✅ REST API для фронтенда (8 endpoints)

### ✅ Frontend (CRM)
- ✅ Сервис `crm-frontend` запущен локально на порту **5174** (Vite dev)
- ✅ React + TypeScript + Vite + shadcn/ui
- ✅ Kanban CRM с Drag & Drop (7 этапов воронки)
- ✅ Фильтрация лидов, экспорт CSV
- ✅ Настройки чатбота (промпт, документы, триггеры)
- ✅ Страница Reactivation Campaigns

### ✅ Chatbot Service
- ✅ Сервис `chatbot-service` на порту **8083**
- ✅ Автоматизация WhatsApp диалогов
- ✅ Триггеры и реактивация холодных лидов
- ✅ Background worker для cron jobs

### ✅ Инфраструктура
- ✅ Обновлена документация `INFRASTRUCTURE.md`
- ✅ Обновлена документация `FRONTEND_API_CONVENTIONS.md`
- ✅ Добавлены Nginx конфигурации для `/api/crm/` и `/api/chatbot/`
- ✅ Настроен Vite proxy для локальной разработки
- ✅ Разграничены порты для локальной разработки и production

### ✅ Тестирование
- ✅ Главная страница CRM протестирована с реальными данными (1000+ лидов)
- ✅ Страница Chatbot Settings протестирована (все 3 вкладки)
- ✅ Frontend перезапущен после сбоя связи

### ✅ Git
- ✅ Все изменения закоммичены (170 файлов, 11763+ строк)
- ✅ Запушено в main ветку (коммит `d975a27`)

---

## 📚 ОБЯЗАТЕЛЬНЫЕ ДОКУМЕНТЫ К ПРОЧТЕНИЮ

### 🏗️ Инфраструктура и архитектура

1. **@INFRASTRUCTURE.md** ⭐️ **КРИТИЧЕСКИ ВАЖНО**
   - Полная документация по инфраструктуре всего проекта
   - Раздел "📱 WHATSAPP CRM & CHATBOT" (строки 170-328)
   - Таблица портов, Docker контейнеры, Nginx routing
   - Система скоринга лидов
   - API endpoints для CRM и Chatbot

2. **@FRONTEND_API_CONVENTIONS.md** ⭐️ **КРИТИЧЕСКИ ВАЖНО**
   - Правила работы с API (избегание дублирования `/api/api/`)
   - Раздел "📱 CRM & CHATBOT API" (строки 530-834)
   - Vite proxy конфигурация
   - Nginx routing для production
   - Backend route registration
   - Полная картина: Frontend → Nginx → Backend

3. **@AI_CRM_MVP_ARCHITECTURE.md**
   - Архитектура AI CRM системы
   - Компоненты и их взаимодействие
   - Data flow

4. **@QUICK_START_CHATBOT.md**
   - Быстрый старт для работы с чатботом
   - Основные команды и endpoints

### 📖 История разработки CRM

5. **@WHATSAPP_CRM_ROADMAP.md**
   - Roadmap развития CRM системы
   - Запланированные фичи

6. **@WHATSAPP_CRM_QUICK_START.md**
   - Быстрый старт для работы с WhatsApp CRM
   - Основные операции

7. **@CHATBOT_MVP_COMPLETE.md**
   - Завершение MVP чатбота
   - Реализованный функционал

8. **@CHATBOT_SERVICE_SEPARATION_COMPLETE.md**
   - Отделение chatbot service от основного проекта
   - Архитектурные решения

---

## 🗂️ СТРУКТУРА ПРОЕКТА

```
agents-monorepo/
├── services/
│   ├── crm-backend/              # Backend для анализа диалогов
│   │   ├── src/
│   │   │   ├── routes/           # API endpoints
│   │   │   ├── lib/              # Supabase, Evolution DB, OpenAI
│   │   │   └── server.ts         # Fastify сервер
│   │   ├── .env                  # ⚠️ Credentials (не в git)
│   │   └── package.json
│   │
│   ├── crm-frontend/             # Frontend CRM + Chatbot UI
│   │   ├── src/
│   │   │   ├── pages/            # WhatsAppCRM, ChatbotSettings, Campaigns
│   │   │   ├── components/       # UI компоненты (shadcn/ui)
│   │   │   ├── services/         # API сервисы
│   │   │   └── types/            # TypeScript типы
│   │   ├── .env                  # ⚠️ API URLs (не в git)
│   │   ├── vite.config.ts        # ⚠️ Proxy конфигурация
│   │   └── package.json
│   │
│   └── chatbot-service/          # Автоматизация чатбота
│       ├── src/
│       │   ├── routes/           # API endpoints
│       │   ├── lib/              # Supabase, OpenAI
│       │   ├── server.ts         # Fastify сервер
│       │   └── worker.ts         # Background worker
│       └── package.json
│
├── INFRASTRUCTURE.md              # ⭐️ Главная документация
├── FRONTEND_API_CONVENTIONS.md    # ⭐️ API правила
└── nginx-production.conf          # Nginx конфигурация
```

---

## 🔑 CREDENTIALS И ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ

### `services/crm-backend/.env`

```bash
# Evolution DB (PostgreSQL)
EVOLUTION_DB_HOST=localhost
EVOLUTION_DB_PORT=5433
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_PASSWORD=your-password-here
EVOLUTION_DB_NAME=evolution

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here

# OpenAI
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE

# Server
PORT=8084
NODE_ENV=development
```

### `services/crm-frontend/.env`

```bash
VITE_CRM_BACKEND_URL=http://localhost:8084
VITE_CHATBOT_API_URL=http://localhost:8083
```

**⚠️ ВАЖНО:** Эти файлы НЕ в git! Они уже созданы локально.

---

## 🚀 КАК ЗАПУСТИТЬ ЛОКАЛЬНО

### 1. CRM Backend

```bash
cd services/crm-backend
npm install
npm run dev
# Порт: 8084
```

### 2. CRM Frontend

```bash
cd services/crm-frontend
npm install
npm run dev
# Порт: 5174
# URL: http://localhost:5174/
```

### 3. Chatbot Service (опционально)

```bash
cd services/chatbot-service
npm install
npm run dev
# Порт: 8083
```

---

## 🎯 ТЕСТОВЫЕ ДАННЫЕ

**Тестовый пользователь:**
- `userAccountId`: `0f559eb0-53fa-4b6a-a51b-5d3e15e5864b`
- В базе: **1000 проанализированных лидов**

**Статистика:**
- 🔥 Горячие: 100
- 🟠 Теплые: 467
- 🔵 Холодные: 433

---

## 📊 API ENDPOINTS

### CRM Backend (`/api/crm/*`)

- `GET /dialogs/analysis` - получить проанализированные лиды
- `GET /dialogs/stats` - статистика (hot/warm/cold)
- `POST /dialogs/analyze` - запустить AI анализ
- `POST /dialogs/leads` - создать лид вручную
- `PATCH /dialogs/leads/:id` - обновить лид
- `DELETE /dialogs/analysis/:id` - удалить лид
- `GET /dialogs/export-csv` - экспорт в CSV

### Chatbot Service (`/api/chatbot/*`)

- `GET /stats` - статистика бота
- `GET /configuration/:userId` - получить конфигурацию
- `PUT /configuration/:configId` - обновить конфигурацию
- `POST /documents/upload` - загрузить документ
- `GET /triggers` - список триггеров
- `POST /reactivation/start` - запустить рассылку

**Подробнее**: См. `INFRASTRUCTURE.md` (строки 215-265)

---

## 🔧 ВАЖНЫЕ ТЕХНИЧЕСКИЕ ДЕТАЛИ

### 1. API Routing

**Локальная разработка** (Vite proxy):
```typescript
// vite.config.ts
proxy: {
  '/api/crm': {
    target: 'http://localhost:8084',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/crm/, ''),
  }
}
```

**Production** (Nginx):
```nginx
location /api/crm/ {
    rewrite ^/api/crm/(.*)$ /$1 break;
    proxy_pass http://crm-backend:8084;
}
```

### 2. Frontend API Service

```typescript
// ✅ ПРАВИЛЬНО
const CRM_API_BASE = '/api/crm';
fetch(`${CRM_API_BASE}/dialogs/stats`);
// → /api/crm/dialogs/stats

// ❌ НЕПРАВИЛЬНО
fetch(`${CRM_API_BASE}/api/dialogs/stats`);
// → /api/crm/api/dialogs/stats (дублирование!)
```

### 3. Backend Route Registration

```typescript
// ✅ ПРАВИЛЬНО - БЕЗ prefix
app.register(dialogsRoutes);  // Роуты: /dialogs/*

// ❌ НЕПРАВИЛЬНО
app.register(dialogsRoutes, { prefix: '/api/crm' });
```

**Подробнее**: См. `FRONTEND_API_CONVENTIONS.md` (строки 530-834)

---

## ⚠️ ИЗВЕСТНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ

### Проблема 1: Дублирование `/api/api/`

**Причина**: API сервис добавляет `/api/` к пути, хотя он уже есть в `API_BASE_URL`

**Решение**: Всегда использовать базовый путь без дополнительного `/api/`

```typescript
// ✅ fetch(`${CRM_API_BASE}/dialogs/stats`)
// ❌ fetch(`${CRM_API_BASE}/api/dialogs/stats`)
```

### Проблема 2: Frontend не подключается к backend

**Причина**: Vite proxy не настроен или backend не запущен

**Решение**:
1. Проверить что backend запущен: `curl http://localhost:8084/dialogs/stats?userAccountId=...`
2. Проверить `vite.config.ts` - должны быть proxy для `/api/crm` и `/api/chatbot`
3. Перезапустить Vite: `npm run dev`

### Проблема 3: ES module errors в backend

**Причина**: `ts-node-dev` не поддерживает ES modules хорошо

**Решение**: Используется `tsx` для development
```json
// package.json
"dev": "tsx watch src/server.ts"
```

### Проблема 4: Environment variables не загружаются

**Причина**: `dotenv.config()` вызывается после импорта модулей

**Решение**: `dotenv.config()` добавлен в начало файлов `src/lib/supabase.ts` и `src/lib/evolutionDb.ts`

---

## 📝 ЧТО МОЖЕТ ПОТРЕБОВАТЬСЯ ДАЛЕЕ

### Возможные задачи:

1. **Продолжить тестирование UI**
   - [ ] Страница Reactivation Campaigns
   - [ ] Общие аспекты (навигация, респонсивность)

2. **Deploy в production**
   - [ ] Обновить docker-compose.yml
   - [ ] Пересобрать контейнеры
   - [ ] Проверить на сервере

3. **Новые фичи**
   - [ ] Добавить новые endpoints
   - [ ] Улучшить UI
   - [ ] Интеграция с AmoCRM

4. **Bugfixes**
   - [ ] Исправить ошибки из console
   - [ ] Оптимизировать запросы

---

## 🎓 ПОЛЕЗНЫЕ КОМАНДЫ

```bash
# Frontend
cd services/crm-frontend
npm run dev          # Запуск dev сервера
npm run build        # Сборка production
npm run lint         # Проверка кода

# Backend
cd services/crm-backend
npm run dev          # Запуск dev сервера
npm run build        # Компиляция TypeScript
npm start            # Запуск production

# Docker
docker-compose build crm-backend crm-frontend
docker-compose up -d crm-backend crm-frontend
docker-compose logs -f crm-backend

# Git
git status
git add .
git commit -m "feat: ..."
git push origin main
```

---

## 📞 КОНТАКТЫ И ССЫЛКИ

**Локальные URL:**
- CRM Frontend: http://localhost:5174/
- CRM Backend: http://localhost:8084/
- Chatbot Service: http://localhost:8083/

**Production URL (планируемые):**
- CRM Frontend: https://app.performanteaiagency.com/crm/
- CRM Backend API: https://app.performanteaiagency.com/api/crm/
- Chatbot API: https://app.performanteaiagency.com/api/chatbot/

**Документация:**
- GitHub: https://github.com/dengineproblem/agents-monorepo
- Последний коммит: `d975a27` (2025-11-10)

---

## ✅ ЧЕКЛИСТ ПЕРЕД НАЧАЛОМ РАБОТЫ

- [ ] Прочитал `INFRASTRUCTURE.md` (раздел WhatsApp CRM & Chatbot)
- [ ] Прочитал `FRONTEND_API_CONVENTIONS.md` (раздел CRM & Chatbot API)
- [ ] Проверил что backend запущен (`curl http://localhost:8084/dialogs/stats`)
- [ ] Проверил что frontend запущен (`curl http://localhost:5174`)
- [ ] Понял структуру проекта
- [ ] Знаю где находятся `.env` файлы
- [ ] Понял систему API routing (Vite proxy / Nginx)
- [ ] Понял правила работы с API (без дублирования `/api/api/`)

---

## 🚨 КРИТИЧЕСКИ ВАЖНО

1. **НИКОГДА** не коммить `.env` файлы в git
2. **ВСЕГДА** следовать правилам API из `FRONTEND_API_CONVENTIONS.md`
3. **НИКОГДА** не добавлять `prefix: '/api'` при регистрации роутов в backend
4. **ВСЕГДА** проверять документацию перед изменениями
5. **ВСЕГДА** обновлять документацию после изменений

---

## 🎉 УДАЧНОЙ РАБОТЫ!

Если возникнут вопросы - обращайся к документации или спрашивай уточнения.

**Главное**: Следуй правилам, читай документацию, не ломай что уже работает! 🚀

---

**Последнее обновление**: 2025-11-10  
**Статус проекта**: ✅ Локальная разработка завершена, готов к дальнейшей работе

