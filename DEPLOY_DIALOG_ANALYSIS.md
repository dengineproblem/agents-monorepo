# 🚀 Деплой анализа WhatsApp диалогов на сервер

## Шаг 1: SSH на сервер

```bash
ssh root@your-server-ip
cd /root/agents-monorepo
```

---

## Шаг 2: Обновить код

```bash
git pull origin main
```

---

## Шаг 3: Выполнить SQL миграцию

### Вариант A: Через Supabase Dashboard (рекомендуется)

1. Открыть: https://supabase.com/dashboard/project/YOUR_PROJECT/sql
2. Скопировать содержимое: `services/frontend/supabase/dialog_analysis_table.sql`
3. Вставить и нажать **Run**

### Вариант B: Через psql (если есть прямой доступ)

```bash
cat services/frontend/supabase/dialog_analysis_table.sql
# Скопировать и выполнить через Supabase SQL Editor
```

---

## Шаг 4: Проверить переменные окружения

```bash
# Проверить что есть EVOLUTION_DB_PASSWORD
grep EVOLUTION_DB_PASSWORD .env.agent

# Если нет - добавить:
cat >> .env.agent << 'EOF'

# Evolution API Configuration (для анализа WhatsApp диалогов)
EVOLUTION_API_KEY=52ea52572205cd16e2fbbb49edffb7fa0228aafdd1f6ae1df3da5d5b35577ac1
EVOLUTION_DB_PASSWORD=evolution_secure_password_2024
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_NAME=evolution
EOF
```

---

## Шаг 5: Пересобрать и перезапустить agent-service

```bash
# Пересборка с новыми зависимостями (pg)
docker-compose build agent-service

# Перезапуск
docker-compose restart agent-service

# Проверка логов
docker-compose logs -f agent-service --tail=50
```

**Ожидаемый вывод:** Должно быть `Connected to Evolution PostgreSQL`

---

## Шаг 6: Запустить анализ диалогов

### Вариант A: Через удобный скрипт

```bash
docker exec -it agents-monorepo-agent-service-1 \
  npm run --prefix /app tsx src/scripts/runAnalysis.ts instance_0f559eb0_1761736509038
```

### Вариант B: Прямой вызов с параметрами

```bash
docker exec -it agents-monorepo-agent-service-1 \
  npm run --prefix /app tsx src/scripts/analyzeDialogs.ts \
  instance_0f559eb0_1761736509038 \
  0f559eb0-53fa-4b6a-a51b-5d3e15e5864b \
  3
```

**Параметры:**
- `instance_0f559eb0_1761736509038` - instance name
- `0f559eb0-53fa-4b6a-a51b-5d3e15e5864b` - user account ID
- `3` - минимум входящих сообщений

### Вариант C: Через API

```bash
curl -X POST http://localhost:8082/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "instance_0f559eb0_1761736509038",
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "minIncoming": 3
  }'
```

---

## Шаг 7: Проверить результаты

### Через API

```bash
# Получить статистику
curl "http://localhost:8082/api/dialogs/stats?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"

# Получить результаты
curl "http://localhost:8082/api/dialogs/analysis?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b&interestLevel=hot"

# Экспорт CSV
curl "http://localhost:8082/api/dialogs/export-csv?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b" \
  -o /tmp/dialog-analysis.csv

cat /tmp/dialog-analysis.csv
```

### Через Supabase (SQL)

```sql
-- Посмотреть все результаты
SELECT 
  contact_phone,
  contact_name,
  interest_level,
  score,
  business_type,
  objection,
  LEFT(next_message, 80) as next_message_preview,
  incoming_count,
  outgoing_count,
  last_message
FROM dialog_analysis
WHERE user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
ORDER BY score DESC
LIMIT 20;

-- Статистика
SELECT 
  interest_level,
  COUNT(*) as count,
  ROUND(AVG(score)) as avg_score
FROM dialog_analysis
WHERE user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
GROUP BY interest_level;
```

---

## 🔍 Диагностика проблем

### Проблема: "EVOLUTION_DB_PASSWORD is not set"

```bash
# Проверить переменные
docker exec agents-monorepo-agent-service-1 env | grep EVOLUTION

# Добавить в .env.agent и перезапустить
docker-compose restart agent-service
```

### Проблема: "Cannot connect to Evolution PostgreSQL"

```bash
# Проверить что Evolution PostgreSQL запущен
docker ps | grep evolution-postgres

# Проверить подключение
docker exec agents-monorepo-agent-service-1 \
  nc -zv evolution-postgres 5432

# Проверить логи Evolution PostgreSQL
docker logs evolution-postgres --tail=50
```

### Проблема: "Instance not found"

```bash
# Проверить что instance существует в Supabase
docker exec -it agents-monorepo-agent-service-1 node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('whatsapp_instances')
  .select('instance_name, user_account_id, status')
  .eq('instance_name', 'instance_0f559eb0_1761736509038')
  .then(r => console.log(JSON.stringify(r, null, 2)));
"
```

### Проблема: "OpenAI API error"

```bash
# Проверить API ключ
docker exec agents-monorepo-agent-service-1 env | grep OPENAI_API_KEY

# Проверить баланс на https://platform.openai.com/account/billing
```

### Проблема: "No messages found in Evolution DB"

```bash
# Подключиться к Evolution PostgreSQL
docker exec -it evolution-postgres psql -U evolution -d evolution

# Проверить количество сообщений
SELECT COUNT(*) FROM "Message" WHERE "owner" = 'instance_0f559eb0_1761736509038';

# Посмотреть примеры сообщений
SELECT "key"->>'remoteJid' as phone, "pushName", "messageTimestamp" 
FROM "Message" 
WHERE "owner" = 'instance_0f559eb0_1761736509038' 
LIMIT 5;

# Выйти
\q
```

---

## 📊 Ожидаемый результат

После успешного анализа вы увидите:

```
✅ Анализ завершен!
═══════════════════════════════════════
📊 Всего контактов:      87
✓  Проанализировано:     87
🔥 Hot leads:            12
🌡️  Warm leads:           45
❄️  Cold leads:           30
❌ Ошибки:               0
═══════════════════════════════════════

📝 Примеры результатов (топ 5 по score):

1. +77001234567 (Алия)
   🔥 Interest: hot | Score: 90/100
   💼 Business: Стоматология
   💬 Next message: Алия, готовы записать вас на консультацию по AI-таргетологу...

2. +77009876543 (Нурлан)
   🔥 Interest: warm | Score: 75/100
   💼 Business: Косметология
   💬 Next message: Нурлан, давайте обсудим как увеличить поток клиентов...
```

---

## ✅ Чек-лист деплоя

- [ ] SSH на сервер
- [ ] `git pull origin main`
- [ ] SQL миграция выполнена
- [ ] EVOLUTION_DB_PASSWORD добавлен в .env.agent
- [ ] `docker-compose build agent-service`
- [ ] `docker-compose restart agent-service`
- [ ] Логи проверены (Connected to Evolution PostgreSQL)
- [ ] Анализ запущен
- [ ] Результаты проверены
- [ ] CSV экспортирован

---

## 🎉 Готово!

После выполнения всех шагов система анализа диалогов готова к работе!

**Документация:**
- Полная документация: `WHATSAPP_DIALOG_ANALYSIS.md`
- Быстрый старт: `DIALOG_ANALYSIS_QUICKSTART.md`
- Детали реализации: `DIALOG_ANALYSIS_IMPLEMENTATION.md`

