# 🔗 AmoCRM Integration - Интеграция с AmoCRM

**Дата создания**: 2025-11-08  
**Статус**: ✅ Полностью реализовано и работает  

---

## 📋 Обзор

AmoCRM интегрирован в приложение для синхронизации лидов и отслеживания воронки продаж в реальном времени.

### Основные возможности:

- ✅ **OAuth2 авторизация** - безопасное подключение AmoCRM аккаунта
- ✅ **Webhook-синхронизация** - автоматические обновления статусов лидов в реальном времени
- ✅ **Ручная синхронизация** - кнопка для принудительной синхронизации всех лидов
- ✅ **Сопоставление по телефону** - автоматический поиск соответствий между локальными и AmoCRM лидами
- ✅ **Отслеживание воронки** - визуализация статистики по этапам воронки

---

## 🏗️ Архитектура

### Frontend (React/TypeScript)

**Файл**: `services/frontend/src/pages/Profile.tsx`

**Функционал**:
- Кнопка "Подключить AmoCRM" с вводом поддомена
- Отображение статуса подключения
- Бадж "Webhook" если webhook активен
- Модальное окно управления (синхронизация, отключение)
- Использует `API_BASE_URL` согласно конвенциям

**Компоненты**:
- `ConnectionsGrid` - карточка подключения AmoCRM
- Модальные окна для подключения и управления

### Backend (Fastify/TypeScript)

**Структура файлов**:

```
services/agent-service/src/
├── routes/
│   ├── amocrmOAuth.ts         # OAuth авторизация
│   ├── amocrmManagement.ts    # API управления (webhook, sync)
│   ├── amocrmPipelines.ts     # Получение воронок и этапов
│   └── amocrmWebhooks.ts      # Прием webhook событий от AmoCRM
├── lib/
│   ├── amocrmTokens.ts        # Управление токенами
│   └── amocrmWebhook.ts       # Регистрация webhooks
├── workflows/
│   ├── amocrmSync.ts          # Синхронизация лидов
│   └── amocrmLeadsSync.ts     # Полная синхронизация всех лидов
└── adapters/
    └── amocrm.ts              # API клиент AmoCRM
```

---

## 🔄 Процесс подключения

### 1. Пользователь вводит поддомен

```typescript
// Frontend: Profile.tsx
const handleAmoCRMConnectSubmit = () => {
  const url = `${API_BASE_URL}/amocrm/auth?userAccountId=${user.id}&subdomain=${subdomain}`;
  window.location.href = url;
};
```

### 2. OAuth авторизация

**Endpoint**: `GET /amocrm/auth`

```typescript
// Backend: amocrmOAuth.ts
app.get('/amocrm/auth', async (request, reply) => {
  // 1. Генерирует state для безопасности
  // 2. Перенаправляет на AmoCRM OAuth
});
```

### 3. Callback и сохранение токенов

**Endpoint**: `GET /amocrm/callback`

```typescript
// Backend: amocrmOAuth.ts
app.get('/amocrm/callback', async (request, reply) => {
  // 1. Обменивает code на токены
  // 2. Сохраняет в БД (user_account_integrations)
  // 3. Автоматически регистрирует webhook
  // 4. Перенаправляет обратно на /profile
});
```

### 4. Автоматическая регистрация Webhook

```typescript
// Backend: amocrmWebhook.ts
await registerAmoCRMWebhook(userAccountId, subdomain, accessToken);
// Регистрирует webhook для событий:
// - add_lead (новый лид)
// - update_lead (обновление лида)
// - status_lead (изменение статуса)
```

---

## 🔔 Webhook синхронизация (Real-time)

### Как работает:

1. **AmoCRM отправляет webhook** при изменении лида
2. **Endpoint**: `POST /webhooks/amocrm?user_id={userAccountId}`
3. **Обработка** (`amocrmWebhooks.ts`):
   ```typescript
   // 1. Проверяет что это событие status_lead
   // 2. Вызывает processLeadStatusChange()
   ```

### Алгоритм сопоставления лидов:

```typescript
// Backend: workflows/amocrmSync.ts
export async function processLeadStatusChange(statusChange, userAccountId) {
  // 1. Ищем лид по amocrm_lead_id
  let lead = await supabase
    .from('leads')
    .select('*')
    .eq('amocrm_lead_id', amocrmLeadId)
    .maybeSingle();
  
  // 2. Если не найден - ищем по номеру телефона
  if (!lead) {
    const amocrmLead = await getLead(amocrmLeadId, subdomain, token);
    const contact = await getContact(contactId, subdomain, token);
    const phone = normalizePhone(extractPhoneFromContact(contact));
    
    lead = await supabase
      .from('leads')
      .select('*')
      .eq('user_account_id', userAccountId)
      .or(`phone.eq.${phone},chat_id.like.%${phone}%`)
      .maybeSingle();
    
    // 3. Если найден - сохраняем amocrm_lead_id для будущих webhook
    if (lead) {
      await supabase
        .from('leads')
        .update({ amocrm_lead_id: amocrmLeadId })
        .eq('id', lead.id);
    }
  }
  
  // 4. Обновляем статус воронки
  if (lead) {
    await supabase
      .from('leads')
      .update({ 
        amocrm_pipeline_id: pipelineId,
        amocrm_stage_id: stageId 
      })
      .eq('id', lead.id);
  }
}
```

### Нормализация телефонов:

```typescript
// Backend: workflows/amocrmSync.ts
function normalizePhone(phone: string): string {
  // Убирает все кроме цифр
  return phone.replace(/\D/g, '');
}
```

---

## 🔄 Ручная синхронизация

### Кнопка в UI

```typescript
// Frontend: Profile.tsx
const handleAmoCRMSync = async () => {
  const response = await fetch(
    `${API_BASE_URL}/amocrm/sync-leads?userAccountId=${user.id}`,
    { method: 'POST' }
  );
  const data = await response.json();
  // Показывает toast с результатами
};
```

### Backend обработка

**Endpoint**: `POST /amocrm/sync-leads`

```typescript
// Backend: amocrmManagement.ts
app.post('/amocrm/sync-leads', async (request, reply) => {
  const result = await syncLeadsFromAmoCRM(userAccountId, app);
  return reply.send({
    success: true,
    total: 150,
    updated: 45,
    errors: 0
  });
});
```

---

## 🕐 Fallback Cron синхронизация

### Зачем нужен:

- На случай пропущенных webhook событий
- Для восстановления после сбоев AmoCRM
- Резервная синхронизация каждые 6 часов (по умолчанию)

### Конфигурация:

**Файл**: `env.agent.example`

```bash
# Расписание cron для fallback синхронизации
# Основная синхронизация через webhooks
AMOCRM_LEADS_SYNC_CRON_SCHEDULE=0 */6 * * *  # Каждые 6 часов
```

**Файл**: `services/agent-brain/src/amocrmLeadsSyncCron.js`

```javascript
const CRON_SCHEDULE = process.env.AMOCRM_LEADS_SYNC_CRON_SCHEDULE || '0 */6 * * *';

cron.schedule(CRON_SCHEDULE, async () => {
  // Синхронизирует лиды для всех подключенных аккаунтов
});
```

---

## 🗄️ База данных

### Таблица: `user_account_integrations`

```sql
CREATE TABLE user_account_integrations (
  id UUID PRIMARY KEY,
  user_account_id UUID REFERENCES user_accounts(id),
  integration_type TEXT,  -- 'amocrm'
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  subdomain TEXT,
  metadata JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Таблица: `leads` (обновлена)

```sql
-- Добавлены поля для AmoCRM
ALTER TABLE leads ADD COLUMN amocrm_lead_id BIGINT;
ALTER TABLE leads ADD COLUMN amocrm_pipeline_id BIGINT;
ALTER TABLE leads ADD COLUMN amocrm_stage_id BIGINT;

CREATE INDEX idx_leads_amocrm_lead_id ON leads(amocrm_lead_id);
```

### Таблица: `amocrm_pipeline_stages`

```sql
CREATE TABLE amocrm_pipeline_stages (
  id UUID PRIMARY KEY,
  user_account_id UUID REFERENCES user_accounts(id),
  pipeline_id BIGINT,
  pipeline_name TEXT,
  stage_id BIGINT,
  stage_name TEXT,
  stage_color TEXT,
  stage_sort INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 📡 API Endpoints

### OAuth & Подключение

| Method | Endpoint | Описание |
|--------|----------|----------|
| `GET` | `/amocrm/auth` | Инициирует OAuth авторизацию |
| `GET` | `/amocrm/callback` | Callback после OAuth |
| `GET` | `/amocrm/status` | Статус подключения |
| `POST` | `/amocrm/disconnect` | Отключить AmoCRM |

### Управление

| Method | Endpoint | Описание |
|--------|----------|----------|
| `GET` | `/amocrm/webhook-status` | Статус webhook |
| `POST` | `/amocrm/register-webhook` | Зарегистрировать webhook |
| `POST` | `/amocrm/sync-leads` | Ручная синхронизация |

### Webhooks

| Method | Endpoint | Описание |
|--------|----------|----------|
| `POST` | `/webhooks/amocrm` | Прием событий от AmoCRM |

### Воронки

| Method | Endpoint | Описание |
|--------|----------|----------|
| `GET` | `/amocrm/pipelines` | Список воронок и этапов |

---

## 🔧 Конфигурация

### Environment переменные

**Файл**: `env.agent.example`

```bash
# AmoCRM OAuth credentials
AMOCRM_CLIENT_ID=your_client_id
AMOCRM_CLIENT_SECRET=your_client_secret
AMOCRM_REDIRECT_URI=https://app.performanteaiagency.com/amocrm/callback

# App URL для webhooks
APP_URL=https://app.performanteaiagency.com

# Cron расписание (опционально)
AMOCRM_LEADS_SYNC_CRON_SCHEDULE=0 */6 * * *
```

### Frontend API конвенции

**Следует правилам**: `FRONTEND_API_CONVENTIONS.md`

```typescript
// ✅ ПРАВИЛЬНО
import { API_BASE_URL } from '@/config/api';
fetch(`${API_BASE_URL}/amocrm/status?userAccountId=${userId}`);

// ❌ НЕПРАВИЛЬНО
fetch('/api/amocrm/status?userAccountId=${userId}');
```

---

## 🧪 Тестирование

### Проверка подключения через скрипт

**Файл**: `check-amocrm-connection.sh`

```bash
#!/bin/bash
USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

curl -s "http://localhost:8082/amocrm/status?userAccountId=${USER_ID}" | jq .
```

### Проверка webhook

```bash
# Проверить что webhook зарегистрирован
curl "http://localhost:8082/amocrm/webhook-status?userAccountId=${USER_ID}" | jq .
```

### Ручная синхронизация

```bash
# Запустить синхронизацию
curl -X POST "http://localhost:8082/amocrm/sync-leads?userAccountId=${USER_ID}" | jq .
```

### Логи

```bash
# Смотреть логи agent-service
docker-compose logs -f agent-service | grep amocrm

# Смотреть логи cron
docker-compose logs -f agent-brain | grep amocrm
```

---

## 🐛 Troubleshooting

### Проблема: UI показывает "Не подключено"

**Причина**: Фронтенд не использует `API_BASE_URL`

**Решение**:
1. Проверь что в `Profile.tsx` используется `${API_BASE_URL}/amocrm/...`
2. Пересобери фронтенд: `docker-compose build --no-cache frontend`
3. Hard refresh браузера: `Cmd+Shift+R`

### Проблема: Webhook не работает

**Причина**: Webhook не зарегистрирован или неверный URL

**Решение**:
```bash
# 1. Проверить статус
curl "http://localhost:8082/amocrm/webhook-status?userAccountId=${USER_ID}"

# 2. Зарегистрировать заново
curl -X POST "http://localhost:8082/amocrm/register-webhook?userAccountId=${USER_ID}"

# 3. Проверить APP_URL в env.agent
echo $APP_URL
# Должно быть: https://app.performanteaiagency.com
```

### Проблема: Лид не сопоставляется

**Причина**: Разные форматы телефонов

**Решение**:
- Проверь нормализацию телефонов в `workflows/amocrmSync.ts`
- Убедись что в AmoCRM контакт содержит телефон
- Проверь логи: `docker-compose logs agent-service | grep "Found phone for lead"`

---

## ✅ Чеклист для новых окружений

При развертывании на новом сервере:

- [ ] Добавить `.env` переменные (AMOCRM_CLIENT_ID, AMOCRM_CLIENT_SECRET, APP_URL)
- [ ] Зарегистрировать приложение в AmoCRM
- [ ] Обновить AMOCRM_REDIRECT_URI на правильный домен
- [ ] Проверить что APP_URL доступен снаружи (для webhooks)
- [ ] Применить миграции БД (`028_amocrm_pipeline_stages.sql`)
- [ ] Запустить agent-brain (для cron задач)
- [ ] Протестировать полный цикл: подключение → webhook → синхронизация

---

## 📊 Статистика интеграции

**Дата завершения**: 2025-11-08  
**Файлов изменено**: 15+  
**Новых endpoints**: 8  
**Новых таблиц**: 2  

**Основные достижения**:
- ✅ OAuth2 авторизация
- ✅ Real-time webhook синхронизация
- ✅ Fallback cron синхронизация
- ✅ Умное сопоставление лидов по телефону
- ✅ UI интеграция в профиль
- ✅ Следует API конвенциям проекта

---

## 📚 Связанная документация

- `FRONTEND_API_CONVENTIONS.md` - правила работы с API
- `AMOCRM_FUNNEL_ANALYTICS.md` - аналитика воронки AmoCRM
- `env.agent.example` - пример конфигурации

---

**Интеграция полностью работает и протестирована!** 🎉







