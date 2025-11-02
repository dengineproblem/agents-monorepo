# 🚀 Быстрый старт: Анализ WhatsApp диалогов

## За 5 минут

### 1. Выполните SQL миграцию

```bash
# Через Supabase Dashboard
# SQL Editor → Открыть файл → services/frontend/supabase/dialog_analysis_table.sql → Run
```

### 2. Добавьте переменные окружения

В файл `.env.agent` (на сервере `/root/agents-monorepo/.env.agent`):

```bash
# Evolution PostgreSQL (должен быть уже настроен)
EVOLUTION_DB_PASSWORD=ваш-пароль-evolution-db

# Если нужно переопределить (обычно не требуется):
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_NAME=evolution
```

### 3. Перезапустите сервис

```bash
cd /root/agents-monorepo
docker-compose restart agent-service
```

### 4. Запустите анализ

**Вариант A: Через API**

```bash
curl -X POST https://app.performanteaiagency.com/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "instance_0f559eb0_1761736509038",
    "userAccountId": "ваш-user-uuid",
    "minIncoming": 3
  }'
```

**Вариант B: Через CLI (в контейнере)**

```bash
docker exec -it agents-monorepo-agent-service-1 \
  npm run analyze-dialogs instance_name user_uuid 3
```

### 5. Получите результаты

**Просмотр в JSON:**
```bash
curl "https://app.performanteaiagency.com/api/dialogs/analysis?userAccountId=uuid&interestLevel=hot"
```

**Экспорт в CSV:**
```bash
curl "https://app.performanteaiagency.com/api/dialogs/export-csv?userAccountId=uuid" \
  -o results.csv
```

---

## 📊 Структура ответа

```json
{
  "success": true,
  "stats": {
    "total": 150,        // Всего контактов с ≥3 входящими
    "analyzed": 87,      // Успешно проанализировано
    "hot": 12,           // Горячие лиды
    "warm": 45,          // Теплые лиды
    "cold": 30,          // Холодные лиды
    "errors": 0          // Ошибки анализа
  }
}
```

## 🔍 Результат анализа

Каждый проанализированный диалог содержит:

- ✅ **contact_phone** - телефон клиента
- ✅ **contact_name** - имя (из WhatsApp)
- ✅ **interest_level** - hot/warm/cold
- ✅ **score** - 0-100 (качество лида)
- ✅ **business_type** - Стоматология/Косметология/etc
- ✅ **objection** - выявленные возражения
- 🔥 **next_message** - персонализированное сообщение для реанимации
- ✅ **action** - want_call/want_work/reserve/none
- ✅ **reasoning** - обоснование оценки

---

## 📱 Где взять instanceName?

**1. Через Supabase:**
```sql
SELECT instance_name, phone_number, status 
FROM whatsapp_instances 
WHERE user_account_id = 'your-uuid';
```

**2. Через API:**
```bash
curl "https://app.performanteaiagency.com/api/whatsapp/instances?userAccountId=uuid"
```

**3. Из Evolution API напрямую:**
```bash
curl "https://evolution.performanteaiagency.com/instance/fetchInstances" \
  -H "apikey: ваш-evolution-api-key"
```

---

## 💡 Примеры использования

### Анализ только горячих лидов

```bash
# 1. Запустить анализ
curl -X POST https://app.performanteaiagency.com/api/dialogs/analyze \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "...", "userAccountId": "...", "minIncoming": 5}'

# 2. Получить только hot
curl "https://app.performanteaiagency.com/api/dialogs/analysis?userAccountId=uuid&interestLevel=hot&minScore=70"
```

### Экспорт для Excel

```bash
curl "https://app.performanteaiagency.com/api/dialogs/export-csv?userAccountId=uuid" \
  -o leads.csv
  
# Открыть в Excel/Google Sheets
```

### Отправка сообщений (TODO: будет реализовано)

```bash
# Получить next_message для контакта
curl "https://app.performanteaiagency.com/api/dialogs/analysis?userAccountId=uuid" | \
  jq '.results[] | {phone: .contact_phone, message: .next_message}'

# Отправить через Evolution API (ручной способ)
curl -X POST "https://evolution.performanteaiagency.com/message/sendText/instance_name" \
  -H "apikey: key" \
  -H "Content-Type: application/json" \
  -d '{"number": "+77001234567", "text": "Алия, готовы записать вас..."}'
```

---

## 🐛 Частые проблемы

### "Instance not found"
→ Проверьте instanceName и userAccountId

### "EVOLUTION_DB_PASSWORD is not set"
→ Добавьте в `.env.agent` и перезапустите

### "OpenAI API error"
→ Проверьте OPENAI_API_KEY и баланс

### Нет результатов
→ Убедитесь что в Evolution DB есть сообщения с `owner = instanceName`

---

## 📚 Полная документация

Смотрите [WHATSAPP_DIALOG_ANALYSIS.md](WHATSAPP_DIALOG_ANALYSIS.md)

---

## ✅ Чеклист

- [ ] SQL миграция выполнена
- [ ] Переменные окружения добавлены
- [ ] Agent-service перезапущен
- [ ] Первый анализ запущен
- [ ] Результаты получены
- [ ] CSV экспортирован
- [ ] Фронтенд интеграция (опционально)

🎉 Готово!

