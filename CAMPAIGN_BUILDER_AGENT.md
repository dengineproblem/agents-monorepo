# Campaign Builder Agent - Автоматический запуск рекламы

**Дата создания**: 08.10.2025  
**Версия**: 1.0.0

## 🎯 Назначение

Campaign Builder Agent — это специализированный LLM-агент для автоматического создания новых рекламных кампаний на основе доступных креативов и их скоринга.

### Отличия от Agent Brain

| Параметр | Agent Brain | Campaign Builder |
|----------|-------------|------------------|
| **Задача** | Управление существующими кампаниями | Создание НОВЫХ кампаний |
| **Действия** | Оптимизация бюджетов, паузы, дубликаты | Подбор креативов, формирование adset |
| **Запуск** | Автоматический cron (08:00) | По запросу с фронтенда (webhook) |
| **LLM модель** | gpt-5 (из BRAIN_MODEL) | gpt-4o (из CAMPAIGN_BUILDER_MODEL) |
| **Входные данные** | Метрики из Facebook API | Креативы + скоринг из БД |

## 🏗️ Архитектура

```
Frontend
  ↓ (webhook POST /api/campaign-builder/auto-launch)
┌─────────────────────────────────────────────────┐
│ Campaign Builder Agent                          │
│                                                  │
│ 1. Получить доступные креативы                  │
│    - user_creatives (status='ready')            │
│    - creative_scores (risk_score, performance)  │
│                                                  │
│ 2. Получить бюджетные ограничения              │
│    - plan_daily_budget_cents                    │
│    - default_cpl_target_cents                   │
│                                                  │
│ 3. LLM анализирует и формирует план             │
│    - Выбирает 2-3 лучших креатива               │
│    - Рассчитывает оптимальный бюджет            │
│    - Генерирует reasoning                        │
│                                                  │
│ 4. Создание кампании                            │
│    ↓ workflowCreateCampaignWithCreative         │
│    Campaign → AdSet → Ads (2-3 креатива)        │
│                                                  │
│ 5. Возвращает результат                         │
│    - campaign_id, adset_id, ads[]               │
│    - план с обоснованием                         │
└─────────────────────────────────────────────────┘
```

## 📊 Логика выбора креативов

### Критерии оценки (приоритет)

1. **Risk Score** (0-100):
   - ✅ **0-30 (Low)** — отличные креативы, приоритет
   - ⚠️ **31-60 (Medium)** — средние креативы, можно использовать
   - ❌ **61-100 (High)** — проблемные креативы, избегать

2. **Creative Score** (если есть):
   - ✅ **70+** — отличные креативы
   - ⚠️ **50-69** — средние креативы
   - ❌ **<50** — слабые креативы

3. **Performance метрики** (если есть история):
   - CTR > 1.5% — хороший показатель
   - CPM < $6 — эффективная стоимость
   - CPL < target_cpl — достигает целей

4. **Новые креативы** (без истории):
   - Можно протестировать 1-2 новых креатива
   - Но не более, чтобы не рисковать бюджетом

### Правила формирования adset

- **Минимум**: 1 креатив
- **Оптимально**: 2-3 креатива (A/B тестирование)
- **Максимум**: 5 креативов (чтобы не размывать бюджет)

### Распределение бюджета

- На 1 креатив: $5-10/день
- На 2-3 креатива: $10-20/день
- На 4-5 креативов: $20-30/день

## 🚀 API Endpoints

### 1. POST `/api/campaign-builder/auto-launch`

**Основной endpoint для автоматического запуска рекламы**

#### Request Body:

```json
{
  "user_account_id": "uuid-пользователя",
  "objective": "whatsapp|instagram_traffic|site_leads",
  "campaign_name": "Осенняя распродажа 2025",
  "requested_budget_cents": 150000,
  "additional_context": "Фокус на женскую аудиторию 25-35 лет",
  "auto_activate": false
}
```

**Обязательные поля:**
- `user_account_id` — UUID пользователя из user_accounts
- `objective` — тип кампании

**Опциональные поля:**
- `campaign_name` — название (если не указано, LLM сгенерирует)
- `requested_budget_cents` — запрашиваемый бюджет (LLM может скорректировать)
- `additional_context` — дополнительный контекст для LLM
- `auto_activate` — сразу активировать кампанию (по умолчанию false — создается в PAUSED)

#### Response (Success):

```json
{
  "success": true,
  "campaign_id": "120210123456789",
  "adset_id": "120210123456790",
  "ads": [
    {
      "ad_id": "120210123456791",
      "user_creative_id": "uuid-1",
      "fb_creative_id": "120210..."
    },
    {
      "ad_id": "120210123456792",
      "user_creative_id": "uuid-2",
      "fb_creative_id": "120210..."
    }
  ],
  "plan": {
    "campaign_name": "Осенняя распродажа 2025",
    "objective": "whatsapp",
    "daily_budget_cents": 150000,
    "daily_budget_usd": 15.00,
    "selected_creatives": [
      {
        "user_creative_id": "uuid-1",
        "title": "Скидка 30% на всё",
        "reason": "Low risk (15), отличный CTR 2.3%, CPL $1.84"
      },
      {
        "user_creative_id": "uuid-2",
        "title": "Новая коллекция осень 2025",
        "reason": "Новый креатив для тестирования"
      }
    ],
    "reasoning": "Выбрано 2 креатива: один проверенный с отличными метриками, один новый для тестирования. Бюджет $15/день позволяет протестировать оба.",
    "estimated_cpl": 2.10,
    "confidence": "high"
  },
  "status": "PAUSED",
  "message": "Campaign created successfully with 2 ad(s)"
}
```

#### Response (Error):

```json
{
  "success": false,
  "error": "No ready creatives available for this objective",
  "stage": "planning"
}
```

**Стадии ошибок:**
- `planning` — ошибка при формировании плана (нет креативов, мало бюджета)
- `execution` — ошибка при создании кампании в Facebook
- `unknown` — неожиданная ошибка

---

### 2. POST `/api/campaign-builder/preview`

**Предпросмотр плана БЕЗ создания кампании**

Полезно для фронтенда, чтобы показать пользователю что будет создано.

#### Request Body:

```json
{
  "user_account_id": "uuid",
  "objective": "whatsapp",
  "campaign_name": "Тестовая кампания",
  "requested_budget_cents": 100000
}
```

#### Response:

```json
{
  "success": true,
  "plan": {
    "campaign_name": "Тестовая кампания",
    "objective": "whatsapp",
    "daily_budget_cents": 100000,
    "daily_budget_usd": 10.00,
    "selected_creatives": [...],
    "reasoning": "...",
    "estimated_cpl": 2.10,
    "confidence": "high"
  }
}
```

---

### 3. GET `/api/campaign-builder/available-creatives`

**Получить список доступных креативов с их скорингом**

#### Query Parameters:

- `user_account_id` (required) — UUID пользователя
- `objective` (optional) — фильтр по типу кампании

#### Response:

```json
{
  "success": true,
  "creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Скидка 30%",
      "fb_creative_id_whatsapp": "120210...",
      "fb_creative_id_instagram_traffic": "120210...",
      "fb_creative_id_site_leads": "120210...",
      "created_at": "2025-10-01T10:00:00Z",
      "risk_score": 15,
      "risk_level": "Low",
      "creative_score": 85,
      "recommendations": ["Отличный креатив для WhatsApp кампаний"]
    }
  ],
  "count": 1
}
```

---

### 4. GET `/api/campaign-builder/budget-constraints`

**Получить бюджетные ограничения пользователя**

#### Query Parameters:

- `user_account_id` (required) — UUID пользователя

#### Response:

```json
{
  "success": true,
  "constraints": {
    "plan_daily_budget_cents": 5000000,
    "plan_daily_budget_usd": 500.00,
    "available_budget_cents": 5000000,
    "available_budget_usd": 500.00,
    "default_cpl_target_cents": 200,
    "default_cpl_target_usd": 2.00,
    "min_budget_per_campaign_cents": 500,
    "min_budget_per_campaign_usd": 5.00,
    "max_budget_per_campaign_cents": 3000000,
    "max_budget_per_campaign_usd": 300.00
  }
}
```

## 🔧 Конфигурация

### Переменные окружения

```bash
# В .env.agent или docker-compose.yml

# OpenAI API для LLM
OPENAI_API_KEY=sk-...

# Модель для Campaign Builder (по умолчанию gpt-4o)
CAMPAIGN_BUILDER_MODEL=gpt-4o

# Supabase (уже настроено)
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
```

### Зависимости

Campaign Builder использует:
- `user_creatives` — таблица с креативами
- `creative_scores` — таблица со скорингом (из Scoring Agent)
- `user_accounts` — бюджеты и настройки пользователя
- `default_ad_settings` — дефолтные настройки таргетинга

## 📝 Примеры использования

### Пример 1: Создание WhatsApp кампании

```bash
curl -X POST http://localhost:8082/api/campaign-builder/auto-launch \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "ваш-uuid",
    "objective": "whatsapp",
    "campaign_name": "WhatsApp Лиды - Октябрь 2025",
    "requested_budget_cents": 200000,
    "additional_context": "Фокус на Алматы и Астану",
    "auto_activate": false
  }'
```

### Пример 2: Предпросмотр плана

```bash
curl -X POST http://localhost:8082/api/campaign-builder/preview \
  -H 'Content-Type: application/json' \
  -d '{
    "user_account_id": "ваш-uuid",
    "objective": "instagram_traffic",
    "requested_budget_cents": 150000
  }'
```

### Пример 3: Список доступных креативов

```bash
curl "http://localhost:8082/api/campaign-builder/available-creatives?user_account_id=ваш-uuid&objective=whatsapp"
```

### Пример 4: Бюджетные ограничения

```bash
curl "http://localhost:8082/api/campaign-builder/budget-constraints?user_account_id=ваш-uuid"
```

## 🧪 Тестирование

### Локальный запуск

```bash
# 1. Перейти в директорию agent-service
cd services/agent-service

# 2. Установить зависимости
npm install

# 3. Запустить в dev режиме
npm run dev
```

### Docker запуск

```bash
# Пересобрать и перезапустить
docker-compose build agent-service
docker-compose up -d agent-service

# Проверить логи
docker logs agents-monorepo-agent-service-1 --tail 100
```

### Проверка работы

```bash
# Health check
curl http://localhost:8082/health

# Тест auto-launch (используйте реальный user_account_id)
./test-campaign-builder.sh
```

## 🚨 Возможные ошибки

### 1. "No ready creatives available for this objective"

**Причина**: У пользователя нет готовых креативов для выбранного objective.

**Решение**:
- Проверьте таблицу `user_creatives` (status='ready')
- Убедитесь что у креатива есть нужный `fb_creative_id_*`

```sql
SELECT id, title, status, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads
FROM user_creatives
WHERE user_id = 'ваш-uuid'
AND status = 'ready';
```

### 2. "Failed to fetch user account"

**Причина**: Неверный `user_account_id` или пользователь не существует.

**Решение**:
```sql
SELECT id, ad_account_id, access_token, plan_daily_budget_cents
FROM user_accounts
WHERE id = 'ваш-uuid';
```

### 3. "OpenAI API error: 401"

**Причина**: Неверный `OPENAI_API_KEY`.

**Решение**: Проверьте переменную окружения.

### 4. "All creatives with High risk"

**Причина**: LLM не хочет использовать креативы с высоким риском.

**Решение**:
- Проверьте scoring креативов
- Создайте новые креативы
- Или дождитесь обновления скоров (Scoring Agent запускается вместе с Brain Agent)

## 📊 Мониторинг

### Логи

```bash
# Логи Campaign Builder
docker logs agents-monorepo-agent-service-1 | grep "\[CampaignBuilder\]"

# Логи LLM вызовов
docker logs agents-monorepo-agent-service-1 | grep "OpenAI API"
```

### Метрики

В будущем можно добавить:
- Таблицу `campaign_builder_executions` (аналог `scoring_executions`)
- Метрики: success rate, average response time, most used creatives

## 🔄 Обновление и деплой

### Локальное обновление

```bash
cd services/agent-service
npm run build
npm run dev
```

### Docker обновление

```bash
docker-compose build --no-cache agent-service
docker-compose up -d agent-service
```

### Railway/Production

```bash
git add .
git commit -m "feat: Campaign Builder Agent"
git push origin main
```

## 💡 Best Practices

### Для фронтенда

1. **Всегда используйте `/preview` перед `/auto-launch`**
   - Покажите пользователю план
   - Дайте возможность отредактировать

2. **Показывайте доступные креативы**
   - Используйте `/available-creatives`
   - Отображайте их скоры и статус

3. **Обрабатывайте ошибки gracefully**
   - Проверяйте `stage` в error response
   - Предлагайте решения (создать креативы, увеличить бюджет)

4. **Создавайте кампании в PAUSED**
   - `auto_activate: false` по умолчанию
   - Дайте пользователю проверить перед активацией

### Для бэкенда

1. **Мониторьте LLM вызовы**
   - Логируйте все запросы и ответы
   - Считайте стоимость (tokens)

2. **Кэшируйте данные креативов**
   - Используйте Redis для частых запросов
   - Инвалидируйте при изменении

3. **Валидируйте планы от LLM**
   - Проверяйте бюджеты
   - Проверяйте наличие креативов

## 📚 Связанная документация

- [PROJECT_OVERVIEW_RU.md](./PROJECT_OVERVIEW_RU.md) — общий обзор проекта
- [SCORING_AGENT_PLAN.md](./SCORING_AGENT_PLAN.md) — документация по Scoring Agent
- [DEFAULT_AD_SETTINGS.md](./DEFAULT_AD_SETTINGS.md) — дефолтные настройки кампаний

---

**Документация обновлена**: 08.10.2025  
**Версия**: 1.0.0  
**Автор**: Campaign Builder Agent Team

