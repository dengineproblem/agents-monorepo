# 🧪 Campaign Builder - Инструкция по тестированию

## 🚀 Быстрый старт

### Вариант 1: Локальный запуск (для разработки)

```bash
# 1. Переходим в директорию сервиса
cd services/agent-service

# 2. Проверяем .env.agent
cat ../../.env.agent

# Должны быть:
# OPENAI_API_KEY=sk-...
# SUPABASE_URL=https://...
# SUPABASE_SERVICE_ROLE_KEY=...
# CAMPAIGN_BUILDER_MODEL=gpt-4o

# 3. Запускаем в dev режиме
npm run dev
```

Сервис запустится на `http://localhost:8082`

---

### Вариант 2: Docker (продакшн)

```bash
# 1. Убедитесь что Docker Desktop запущен
docker info

# 2. Пересобираем образ
docker-compose build agent-service

# 3. Запускаем
docker-compose up -d agent-service

# 4. Проверяем логи
docker logs agents-monorepo-agent-service-1 --tail 50 -f
```

---

## 📋 Тестовые сценарии

### Тест 1: Health Check

```bash
curl http://localhost:8082/health
```

**Ожидаемый результат:**
```json
{"ok": true}
```

---

### Тест 2: Получить доступные креативы

```bash
# Замените YOUR_UUID на реальный user_account_id
curl "http://localhost:8082/api/campaign-builder/available-creatives?user_account_id=YOUR_UUID&objective=whatsapp"
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "fb_creative_id_whatsapp": "120210...",
      "risk_score": 15,
      "risk_level": "Low",
      "creative_score": 85
    }
  ],
  "count": 1
}
```

---

### Тест 3: Бюджетные ограничения

```bash
curl "http://localhost:8082/api/campaign-builder/budget-constraints?user_account_id=YOUR_UUID"
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "constraints": {
    "plan_daily_budget_usd": 500.00,
    "available_budget_usd": 500.00,
    "default_cpl_target_usd": 2.00,
    "min_budget_per_campaign_usd": 10.00,
    "max_budget_per_campaign_usd": 300.00
  }
}
```

---

### Тест 4: Preview (без создания кампании)

```bash
curl -X POST http://localhost:8082/api/campaign-builder/preview \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "YOUR_UUID",
    "objective": "whatsapp",
    "campaign_name": "Test Preview",
    "requested_budget_cents": 150000
  }'
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "action": {
    "type": "CreateCampaignWithCreative",
    "campaign_name": "Test Preview",
    "objective": "WhatsApp",
    "daily_budget_usd": 15.00,
    "selected_creatives": ["uuid-1", "uuid-2", "uuid-3"],
    "reasoning": "Выбрано 3 креатива: 2 проверенных с хорошими метриками...",
    "estimated_cpl": 2.10,
    "confidence": "high"
  }
}
```

---

### Тест 5: Auto-launch (СОЗДАЕТ РЕАЛЬНУЮ КАМПАНИЮ!)

⚠️ **ВНИМАНИЕ: Создает настоящую кампанию в Facebook!**

```bash
curl -X POST http://localhost:8082/api/campaign-builder/auto-launch \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "YOUR_UUID",
    "objective": "whatsapp",
    "campaign_name": "Auto Test Campaign",
    "requested_budget_cents": 150000,
    "auto_activate": false
  }'
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "execution_id": "uuid-execution",
  "campaign_id": "120210...",
  "adset_id": "120210...",
  "ads": [
    {
      "ad_id": "120210...",
      "user_creative_id": "uuid-1",
      "fb_creative_id": "120210..."
    }
  ],
  "paused_campaigns": [
    {
      "campaign_id": "123",
      "name": "Old Campaign"
    }
  ],
  "paused_campaigns_count": 1,
  "action": {
    "type": "CreateCampaignWithCreative",
    "reasoning": "...",
    "confidence": "high"
  },
  "status": "PAUSED",
  "message": "Campaign created successfully"
}
```

---

## 🔍 Проверка логов

### Локальный режим

```bash
# В терминале где запущен npm run dev
# Смотрите вывод в реальном времени
```

### Docker режим

```bash
# Все логи
docker logs agents-monorepo-agent-service-1 --tail 100

# Только Campaign Builder
docker logs agents-monorepo-agent-service-1 2>&1 | grep CampaignBuilder

# Следить за логами
docker logs agents-monorepo-agent-service-1 -f
```

---

## 📊 Проверка в БД (Supabase)

### Выполнения actions

```sql
-- Последние запуски Campaign Builder
SELECT 
  id,
  source,
  status,
  created_at,
  request_json->>'account' as account,
  response_json
FROM agent_executions
WHERE source = 'campaign-builder'
ORDER BY created_at DESC
LIMIT 10;
```

### Созданные actions

```sql
-- Actions из Campaign Builder
SELECT 
  ae.id,
  ae.source,
  aa.type,
  aa.status,
  aa.params_json,
  aa.started_at,
  aa.completed_at
FROM agent_actions aa
JOIN agent_executions ae ON aa.execution_id = ae.id
WHERE ae.source = 'campaign-builder'
ORDER BY aa.created_at DESC;
```

---

## 🐛 Troubleshooting

### Ошибка: "No ready creatives available"

**Причина:** Нет креативов со статусом 'ready' для выбранного objective

**Решение:**
```sql
-- Проверить креативы пользователя
SELECT id, title, status, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic
FROM user_creatives
WHERE user_id = 'YOUR_UUID'
AND status = 'ready';
```

---

### Ошибка: "User has no Facebook access token"

**Причина:** У пользователя нет access_token в user_accounts

**Решение:**
```sql
-- Проверить токен
SELECT id, access_token, ad_account_id, page_id
FROM user_accounts
WHERE id = 'YOUR_UUID';
```

---

### Ошибка: "OpenAI API error: 401"

**Причина:** Неверный OPENAI_API_KEY

**Решение:**
```bash
# Проверить ключ
grep OPENAI_API_KEY .env.agent

# Обновить и перезапустить
docker-compose restart agent-service
```

---

### LLM генерирует error: "Минимум 2 креатива для запуска"

**Причина:** Доступен только 1 креатив (это НЕ ошибка, LLM работает корректно)

**Решение:** Загрузить больше креативов через `/api/video/webhook`

---

## 📈 Мониторинг

### Метрики для отслеживания

1. **Время выполнения** - сколько занимает создание кампании
2. **Success rate** - процент успешных запусков
3. **LLM confidence** - как часто LLM уверен в решении
4. **Креативов использовано** - среднее количество на кампанию
5. **Бюджет** - средний бюджет кампаний

### Пример запроса для аналитики

```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'completed') as successful,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_sec,
  AVG((response_json->0->>'ads_count')::int) as avg_ads_per_campaign
FROM agent_executions
WHERE source = 'campaign-builder'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## ✅ Чеклист перед продакшн

- [ ] OPENAI_API_KEY настроен и валиден
- [ ] SUPABASE_URL и SERVICE_ROLE_KEY настроены
- [ ] Есть хотя бы 2-3 ready креатива у тестового пользователя
- [ ] User в user_accounts имеет access_token и ad_account_id
- [ ] User имеет plan_daily_budget_cents и default_cpl_target_cents
- [ ] Default ad settings настроены для нужных objectives
- [ ] Протестирован /preview endpoint
- [ ] Протестирован /auto-launch с auto_activate=false
- [ ] Проверено что старые кампании останавливаются
- [ ] Проверены логи в agent_executions
- [ ] Кампании создаются в Facebook Ads Manager

---

**Дата создания**: 08.10.2025  
**Версия**: 1.0.0

