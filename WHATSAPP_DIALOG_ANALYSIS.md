# 📊 Анализ WhatsApp диалогов с GPT-5-mini

## Обзор

Система автоматического анализа WhatsApp диалогов из Evolution API с использованием **GPT-5-mini** для извлечения бизнес-инсайтов и генерации персонализированных сообщений для реанимации лидов.

---

## 🎯 Возможности

- **Автоматический анализ** всех диалогов из Evolution API instance
- **Фильтрация** по минимальному количеству входящих сообщений
- **AI-анализ** каждого диалога:
  - Тип бизнеса клиента
  - Владелец бизнеса или менеджер
  - Уровень интереса (hot/warm/cold)
  - Основная цель (clinic_lead, ai_targetolog, marketing_analysis)
  - Возражения
  - **Персонализированное сообщение** для реанимации
  - Скоринг лида (0-100)
- **Экспорт в CSV** для удобного просмотра
- **API endpoints** для интеграции с фронтендом

---

## 📋 Архитектура

```
┌─────────────────────────────────────────────────┐
│  Frontend (Button "Analyze Dialogs")            │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  POST /api/dialogs/analyze                      │
│  { instanceName, userAccountId, minIncoming }   │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  analyzeDialogs.ts                              │
│  1. Получить сообщения из Evolution PostgreSQL │
│  2. Группировать по контактам                   │
│  3. Фильтровать (≥ minIncoming)                 │
│  4. Анализ через GPT-5-mini                     │
│  5. Сохранить в Supabase                        │
└───────────────────┬─────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  Supabase: dialog_analysis table                │
│  - Метаданные контакта                          │
│  - Результаты анализа                           │
│  - next_message для реанимации                  │
└─────────────────────────────────────────────────┘
```

---

## 🚀 Установка

### 1. SQL Миграция

Выполните миграцию для создания таблицы `dialog_analysis` в Supabase:

```bash
psql -h your-supabase-host -U postgres -d postgres -f services/frontend/supabase/dialog_analysis_table.sql
```

Или через Supabase Dashboard → SQL Editor.

### 2. Установка зависимостей

```bash
cd services/agent-service
npm install
```

Новые зависимости:
- `pg` - PostgreSQL клиент для Evolution DB
- `@types/pg` - TypeScript типы

### 3. Переменные окружения

Добавьте в `.env.agent`:

```bash
# Evolution API Configuration
EVOLUTION_API_KEY=your-evolution-api-key-here
EVOLUTION_DB_PASSWORD=your-evolution-db-password-here
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_NAME=evolution

# OpenAI (уже должен быть настроен)
OPENAI_API_KEY=your-openai-api-key
```

### 4. Перезапуск сервисов

```bash
cd /root/agents-monorepo
docker-compose restart agent-service
```

---

## 📡 API Endpoints

### 1. POST /api/dialogs/analyze

Запустить анализ всех диалогов для instance.

**Request:**
```bash
curl -X POST https://app.performanteaiagency.com/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "instance_0f559eb0_1761736509038",
    "userAccountId": "uuid-пользователя",
    "minIncoming": 3
  }'
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "analyzed": 87,
    "hot": 12,
    "warm": 45,
    "cold": 30,
    "errors": 0
  }
}
```

### 2. GET /api/dialogs/analysis

Получить результаты анализа.

**Request:**
```bash
curl "https://app.performanteaiagency.com/api/dialogs/analysis?userAccountId=uuid&interestLevel=hot"
```

**Query Parameters:**
- `userAccountId` (required) - UUID пользователя
- `instanceName` (optional) - фильтр по instance
- `interestLevel` (optional) - hot, warm, cold
- `minScore` (optional) - минимальный score

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": "uuid",
      "contact_phone": "+77001234567",
      "contact_name": "Алия",
      "interest_level": "hot",
      "score": 85,
      "business_type": "Стоматология",
      "next_message": "Алия, готовы записать вас на консультацию?",
      "objection": null,
      "incoming_count": 5,
      "outgoing_count": 4,
      "last_message": "2025-11-02T10:30:00Z"
    }
  ],
  "count": 1
}
```

### 3. GET /api/dialogs/export-csv

Экспорт результатов в CSV.

**Request:**
```bash
curl "https://app.performanteaiagency.com/api/dialogs/export-csv?userAccountId=uuid&interestLevel=hot" \
  -o dialog-analysis.csv
```

**Query Parameters:**
- `userAccountId` (required)
- `instanceName` (optional)
- `interestLevel` (optional)

**Response:** CSV файл с полями:
```
contact_phone,contact_name,interest_level,score,business_type,objection,next_message,incoming_count,outgoing_count,last_message
```

### 4. GET /api/dialogs/stats

Получить статистику.

**Request:**
```bash
curl "https://app.performanteaiagency.com/api/dialogs/stats?userAccountId=uuid"
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 87,
    "hot": 12,
    "warm": 45,
    "cold": 30,
    "avgScore": 62,
    "totalMessages": 435
  }
}
```

### 5. DELETE /api/dialogs/analysis/:id

Удалить результат анализа.

**Request:**
```bash
curl -X DELETE "https://app.performanteaiagency.com/api/dialogs/analysis/uuid?userAccountId=uuid"
```

---

## 💻 CLI Использование

### Запуск анализа через CLI

```bash
cd services/agent-service
npm run analyze-dialogs instance_name user_account_id [minIncoming]
```

**Пример:**
```bash
npm run analyze-dialogs instance_0f559eb0_1761736509038 550e8400-e29b-41d4-a716-446655440000 3
```

**Аргументы:**
1. `instance_name` - имя Evolution API instance
2. `user_account_id` - UUID пользователя
3. `minIncoming` (optional, default: 3) - минимальное количество входящих сообщений

---

## 🧪 Формат промпта для GPT-5-mini

Диалоги передаются в упакованном формате для экономии токенов (~3x):

```
C: Здравствуйте! Хочу узнать подробнее об AI-таргетологе.
A: Добрый день! Для какого бизнеса?
C: Стоматология, Алматы
A: Вы владелец клиники?
C: Да
S: ПОДТВЕРЖДАЕМ ЗАПИСЬ: 02.11.2025 14:00 онлайн-консультация
```

Где:
- `C:` - клиент (customer)
- `A:` - агент (agent)
- `S:` - системное сообщение (system)

---

## 📊 Структура таблицы `dialog_analysis`

```sql
CREATE TABLE dialog_analysis (
  id UUID PRIMARY KEY,
  instance_name TEXT NOT NULL,
  user_account_id UUID,
  
  -- Метаданные контакта
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  incoming_count INT,
  outgoing_count INT,
  first_message TIMESTAMPTZ,
  last_message TIMESTAMPTZ,
  
  -- Результаты LLM анализа
  business_type TEXT,
  is_owner BOOLEAN,
  uses_ads_now BOOLEAN,
  has_sales_dept BOOLEAN,
  has_booking BOOLEAN,
  sent_instagram BOOLEAN,
  interest_level TEXT, -- hot/warm/cold
  main_intent TEXT,    -- clinic_lead/ai_targetolog/etc
  objection TEXT,
  next_message TEXT NOT NULL, -- 🔥 Главное поле
  action TEXT,
  score INT,           -- 0-100
  reasoning TEXT,
  
  -- Хранение истории
  messages JSONB,
  
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_name, contact_phone)
);
```

---

## 💰 Стоимость

**GPT-5-mini**:
- Input: ~$0.15 / 1M tokens (ожидаемая)
- Output: ~$0.60 / 1M tokens (ожидаемая)

**Примерная стоимость:**
- 1 диалог (20 сообщений) ≈ 500 tokens input + 200 tokens output
- 100 диалогов ≈ $0.02-0.05

---

## 🔧 Технические детали

### Evolution PostgreSQL структура

**Таблица `Message`:**
```sql
{
  "key": {
    "remoteJid": "+77001234567@s.whatsapp.net",
    "fromMe": false,
    "id": "message-id"
  },
  "pushName": "Алия",
  "message": {
    "conversation": "Здравствуйте!"
  },
  "messageTimestamp": "1730543400",
  "owner": "instance_name"
}
```

### Группировка сообщений

1. Запрос всех сообщений по `owner = instanceName`
2. Группировка по `key.remoteJid` (удаляем @s.whatsapp.net)
3. Фильтрация: `key.fromMe = false` для входящих
4. Подсчет incoming/outgoing, определение first/last message

### Обработка ошибок

- Если GPT-5-mini вернул некорректный JSON → логируем ошибку, пропускаем контакт
- Если Evolution DB недоступен → выбрасываем исключение
- Если Supabase недоступен → выбрасываем исключение

---

## 📝 Примеры использования

### Сценарий 1: Анализ всех диалогов

```bash
# Через API
curl -X POST https://app.performanteaiagency.com/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "instance_0f559eb0_1761736509038",
    "userAccountId": "550e8400-e29b-41d4-a716-446655440000",
    "minIncoming": 3
  }'
```

### Сценарий 2: Получить hot leads

```bash
curl "https://app.performanteaiagency.com/api/dialogs/analysis?userAccountId=uuid&interestLevel=hot&minScore=70"
```

### Сценарий 3: Экспорт hot leads в CSV

```bash
curl "https://app.performanteaiagency.com/api/dialogs/export-csv?userAccountId=uuid&interestLevel=hot" \
  -o hot-leads.csv
```

### Сценарий 4: CLI анализ

```bash
cd services/agent-service
npm run analyze-dialogs instance_name user_uuid 5
```

---

## 🚨 Troubleshooting

### Ошибка: "EVOLUTION_DB_PASSWORD is not set"

**Решение:**
```bash
echo "EVOLUTION_DB_PASSWORD=your-password" >> .env.agent
docker-compose restart agent-service
```

### Ошибка: "Instance not found"

**Причина:** Instance не принадлежит пользователю или не существует.

**Решение:** Проверьте instanceName в таблице `whatsapp_instances`:
```sql
SELECT * FROM whatsapp_instances WHERE user_account_id = 'uuid';
```

### Ошибка: "OpenAI API error"

**Причина:** Неверный API ключ или превышен лимит.

**Решение:**
1. Проверьте `OPENAI_API_KEY` в `.env.agent`
2. Проверьте баланс на https://platform.openai.com/account/billing

### Сообщения не группируются

**Причина:** Неверный формат данных в Evolution PostgreSQL.

**Решение:** Проверьте структуру таблицы Message:
```bash
docker exec -it evolution-postgres psql -U evolution -d evolution -c "\d Message"
```

---

## 🔐 Безопасность

1. **Аутентификация:** Всегда проверяем `user_account_id` перед анализом
2. **Изоляция данных:** Каждый пользователь видит только свои результаты
3. **RLS в Supabase:** Настроить Row Level Security для таблицы `dialog_analysis`

**Пример RLS политики:**
```sql
CREATE POLICY "Users can view their own analysis"
  ON dialog_analysis FOR SELECT
  USING (user_account_id = auth.uid());
```

---

## 📚 Связанные документы

- [EVOLUTION_API_INTEGRATION.md](EVOLUTION_API_INTEGRATION.md) - Интеграция Evolution API
- [EVOLUTION_API_USAGE.md](EVOLUTION_API_USAGE.md) - Использование Evolution API
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) - Архитектура проекта

---

## ✅ Готово!

Система анализа WhatsApp диалогов настроена и готова к использованию! 🎉

**Следующие шаги:**
1. Запустите миграцию SQL
2. Настройте переменные окружения
3. Перезапустите agent-service
4. Выполните первый анализ через API или CLI
5. Экспортируйте результаты в CSV
6. Интегрируйте с фронтендом для удобной отправки сообщений

