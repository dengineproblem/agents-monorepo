# 📊 СИСТЕМА АНАЛИТИКИ РАССЫЛОК

> **Дата создания:** 17 ноября 2025  
> **Статус:** ✅ Реализовано

---

## 📋 ОГЛАВЛЕНИЕ

1. [Общая концепция](#общая-концепция)
2. [Архитектура системы](#архитектура-системы)
3. [Обработчики событий](#обработчики-событий)
4. [Метрики и формулы](#метрики-и-формулы)
5. [API эндпоинты](#api-эндпоинты)
6. [Frontend компоненты](#frontend-компоненты)
7. [База данных](#база-данных)
8. [Примеры использования](#примеры-использования)

---

## 🎯 ОБЩАЯ КОНЦЕПЦИЯ

### Ключевой принцип

**LLM используется ТОЛЬКО для генерации текста сообщений.**

Вся аналитика строится на:
- ✅ Событиях (отправка, ответ, смена этапа)
- ✅ SQL-запросах и агрегациях
- ✅ Ежедневных снимках состояния
- ❌ БЕЗ использования LLM для анализа

### Что отслеживаем

1. **Ответы лидов** - кто ответил на рассылку
2. **Конверсии** - кто перешёл на ключевой этап после рассылки
3. **Динамика температуры** - как меняется база (hot/warm/cold)
4. **Эффективность стратегий** - какие типы сообщений работают лучше
5. **Эффективность по этапам** - на каких этапах рассылки эффективнее

### Окно аттрибуции

**7 дней** - если лид совершил целевое действие в течение 7 дней после рассылки, считаем что рассылка повлияла.

---

## 🏗️ АРХИТЕКТУРА СИСТЕМЫ

```
┌─────────────────────────────────────────────────────────────┐
│                    СОБЫТИЯ СИСТЕМЫ                           │
└─────────────────────────────────────────────────────────────┘

1. ОТПРАВКА РАССЫЛКИ
   campaignWorker.ts → sendMessageBatch()
   ↓
   Сохраняет в campaign_messages:
   - interest_level_at_send
   - funnel_stage_at_send
   - score_at_send

2. ВХОДЯЩЕЕ СООБЩЕНИЕ ОТ ЛИДА
   server.ts → /process-message
   ↓
   campaignAnalytics.ts → markCampaignReply()
   ↓
   Обновляет campaign_messages:
   - has_reply = true
   - first_reply_at = NOW()

3. СМЕНА ЭТАПА ВОРОНКИ
   chatbotEngine.ts → moveFunnelStage()
   ↓
   campaignAnalytics.ts → markTargetAction()
   ↓
   Проверяет: ключевой этап? в окне аттрибуции?
   ↓
   Обновляет campaign_messages:
   - led_to_target_action = true
   - target_action_type = 'key_stage_transition'
   - target_action_at = NOW()

4. ЕЖЕДНЕВНЫЙ СНИМОК (23:55)
   leadSnapshotCron.ts
   ↓
   Сохраняет в lead_daily_snapshot:
   - interest_level
   - score
   - funnel_stage
   - campaign_messages_count
```

---

## 🔄 ОБРАБОТЧИКИ СОБЫТИЙ

### 1. При отправке рассылки

**Файл:** `services/chatbot-service/src/workers/campaignWorker.ts`

**Что делает:**
```typescript
// Получаем текущее состояние лида
const { data: leadAnalytics } = await supabase
  .from('dialog_analysis')
  .select('interest_level, funnel_stage, score')
  .eq('id', msg.lead_id)
  .single();

// Сохраняем при отправке
await supabase
  .from('campaign_messages')
  .update({
    status: 'sent',
    sent_at: NOW(),
    interest_level_at_send: leadAnalytics.interest_level,
    funnel_stage_at_send: leadAnalytics.funnel_stage,
    score_at_send: leadAnalytics.score,
  });
```

**Зачем:** Фиксируем состояние лида на момент отправки для последующего анализа эффективности.

---

### 2. При получении ответа

**Файл:** `services/chatbot-service/src/lib/campaignAnalytics.ts`

**Функция:** `markCampaignReply(leadId, replyTime)`

**Алгоритм:**
```typescript
1. Найти последнее отправленное сообщение для этого лида:
   - status = 'sent'
   - has_reply = false
   - ORDER BY sent_at DESC
   - LIMIT 1

2. Если найдено → обновить:
   - has_reply = true
   - first_reply_at = NOW()
```

**Вызывается из:** `server.ts` → `/process-message` (при каждом входящем сообщении)

---

### 3. При смене этапа воронки

**Файл:** `services/chatbot-service/src/lib/campaignAnalytics.ts`

**Функция:** `markTargetAction(leadId, userAccountId, newStage, actionTime)`

**Алгоритм:**
```typescript
1. Проверить: новый этап ключевой?
   - Получить key_funnel_stages из business_profile
   - Если newStage НЕ в списке → выход

2. Найти последнее сообщение в окне аттрибуции (7 дней):
   - status = 'sent'
   - led_to_target_action = false
   - sent_at >= (NOW() - 7 days)
   - ORDER BY sent_at DESC
   - LIMIT 1

3. Если найдено → обновить:
   - led_to_target_action = true
   - target_action_type = 'key_stage_transition'
   - target_action_at = NOW()
```

**Вызывается из:** `chatbotEngine.ts` → `moveFunnelStage()` (при изменении funnel_stage)

---

### 4. Ежедневный снимок

**Файл:** `services/chatbot-service/src/cron/leadSnapshotCron.ts`

**Расписание:** Каждый день в 23:55

**Алгоритм:**
```typescript
1. Получить всех пользователей с autopilot_enabled = true

2. ДЛЯ КАЖДОГО ПОЛЬЗОВАТЕЛЯ:
   a) Получить всех лидов с autopilot_enabled = true
   
   b) Создать снимки:
      {
        user_account_id,
        lead_id,
        snapshot_date: CURRENT_DATE,
        interest_level,
        score,
        funnel_stage,
        campaign_messages_count
      }
   
   c) UPSERT в lead_daily_snapshot
      (на случай повторного запуска)
```

**Зачем:** Отслеживать динамику изменения базы лидов во времени.

---

## 📈 МЕТРИКИ И ФОРМУЛЫ

### 1. Reply Rate (Процент ответов)

**Формула:**
```sql
reply_rate = (COUNT(DISTINCT lead_id WHERE has_reply = true) / 
              COUNT(DISTINCT lead_id WHERE status = 'sent')) * 100
```

**SQL функция:** `calculate_reply_rate(p_user_account_id, p_date_from, p_date_to)`

**Что показывает:** Какой процент уникальных лидов ответил на рассылку.

---

### 2. Conversion Rate (Процент конверсий)

**Формула:**
```sql
conversion_rate = (COUNT(DISTINCT lead_id WHERE led_to_target_action = true) / 
                   COUNT(DISTINCT lead_id WHERE status = 'sent')) * 100
```

**SQL функция:** `calculate_conversion_rate(p_user_account_id, p_date_from, p_date_to)`

**Что показывает:** Какой процент лидов перешёл на ключевой этап после рассылки.

---

### 3. Average Time to Reply (Среднее время до ответа)

**Формула:**
```sql
avg_time_to_reply = AVG(EXTRACT(EPOCH FROM (first_reply_at - sent_at)) / 3600)
```

**SQL функция:** `get_avg_time_to_reply(p_user_account_id, p_date_from, p_date_to)`

**Единица измерения:** Часы

**Что показывает:** Как быстро в среднем лиды отвечают на рассылку.

---

### 4. Average Time to Action (Среднее время до действия)

**Формула:**
```sql
avg_time_to_action = AVG(EXTRACT(EPOCH FROM (target_action_at - sent_at)) / 86400)
```

**SQL функция:** `get_avg_time_to_action(p_user_account_id, p_date_from, p_date_to)`

**Единица измерения:** Дни

**Что показывает:** Сколько в среднем проходит времени от рассылки до целевого действия.

---

### 5. Temperature Dynamics (Динамика температуры)

**SQL функция:** `get_temperature_dynamics(p_user_account_id, p_days)`

**Что возвращает:**
```sql
{
  snapshot_date: DATE,
  hot_count: INTEGER,
  warm_count: INTEGER,
  cold_count: INTEGER,
  total_leads: INTEGER
}[]
```

**Что показывает:** Как менялось распределение hot/warm/cold лидов за последние N дней.

---

## 🌐 API ЭНДПОИНТЫ

Все эндпоинты находятся в `services/chatbot-service/src/routes/campaign.ts`

### GET /campaign/analytics/overview

**Параметры:**
- `userAccountId` (query, required)

**Ответ:**
```typescript
{
  totalSent: number,
  replyRate: number,        // процент
  conversionRate: number,   // процент
  avgTimeToReply: number,   // часы
  avgTimeToAction: number   // дни
}
```

**Пример:**
```bash
GET /campaign/analytics/overview?userAccountId=xxx
```

---

### GET /campaign/analytics/by-strategy

**Параметры:**
- `userAccountId` (query, required)

**Ответ:**
```typescript
[
  {
    strategy_type: string,      // check_in, value, case, offer, direct_selling
    sent: number,
    replies: number,
    replyRate: string,          // процент (строка)
    conversions: number,
    conversionRate: string      // процент (строка)
  }
]
```

**Что показывает:** Эффективность каждой стратегии сообщений.

---

### GET /campaign/analytics/by-temperature

**Параметры:**
- `userAccountId` (query, required)

**Ответ:**
```typescript
[
  {
    interest_level: string,     // hot, warm, cold
    sent: number,
    replies: number,
    replyRate: string,
    conversions: number,
    conversionRate: string
  }
]
```

**Что показывает:** Эффективность рассылок по температуре лидов.

---

### GET /campaign/analytics/temperature-dynamics

**Параметры:**
- `userAccountId` (query, required)
- `days` (query, optional, default: 30)

**Ответ:**
```typescript
[
  {
    snapshot_date: string,      // YYYY-MM-DD
    hot_count: number,
    warm_count: number,
    cold_count: number,
    total_leads: number
  }
]
```

**Что показывает:** Динамика изменения температуры базы за последние N дней.

---

### GET /campaign/analytics/by-stage

**Параметры:**
- `userAccountId` (query, required)

**Ответ:**
```typescript
[
  {
    funnel_stage: string,
    sent: number,
    replies: number,
    conversions: number
  }
]
```

**Что показывает:** Эффективность рассылок по этапам воронки.

---

## 🎨 FRONTEND КОМПОНЕНТЫ

### CampaignStatsDashboard

**Файл:** `services/crm-frontend/src/components/campaigns/CampaignStatsDashboard.tsx`

**Структура:**

1. **Overview Cards** (5 карточек)
   - Отправлено
   - Процент ответов
   - Конверсия
   - Время до ответа
   - Время до действия

2. **Temperature Distribution** (Pie Chart)
   - Текущее распределение hot/warm/cold
   - Визуализация через recharts

3. **Temperature Dynamics** (Line Chart)
   - Динамика изменения за 30 дней
   - 3 линии: горячие, тёплые, холодные

4. **Strategy Effectiveness** (Таблица)
   - Все стратегии с метриками
   - Цветовая индикация (зелёный/жёлтый/красный)

5. **Temperature Effectiveness** (3 карточки)
   - Отдельная карточка для hot/warm/cold
   - Иконки: 🔥 / 💨 / ❄️

6. **Stage Effectiveness** (Таблица)
   - Эффективность по этапам воронки

**Обновление:** Каждые 60 секунд (React Query)

---

## 💾 БАЗА ДАННЫХ

### Таблица: campaign_messages (расширенная)

**Новые поля:**

| Поле | Тип | Описание |
|------|-----|----------|
| `interest_level_at_send` | TEXT | Температура на момент отправки |
| `funnel_stage_at_send` | TEXT | Этап воронки на момент отправки |
| `score_at_send` | INTEGER | Балл на момент отправки |
| `has_reply` | BOOLEAN | Ответил ли лид |
| `first_reply_at` | TIMESTAMPTZ | Время первого ответа |
| `led_to_target_action` | BOOLEAN | Привело ли к целевому действию |
| `target_action_type` | TEXT | Тип действия |
| `target_action_at` | TIMESTAMPTZ | Когда произошло действие |

**Индексы:**
```sql
idx_campaign_messages_reply (user_account_id, has_reply, sent_at)
idx_campaign_messages_action (user_account_id, led_to_target_action, target_action_at)
idx_campaign_messages_analytics (user_account_id, interest_level_at_send, funnel_stage_at_send, strategy_type, sent_at)
idx_campaign_messages_lead_sent (lead_id, sent_at DESC)
```

---

### Таблица: lead_daily_snapshot (новая)

**Структура:**

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Primary key |
| `user_account_id` | UUID | ID пользователя |
| `lead_id` | UUID | ID лида |
| `snapshot_date` | DATE | Дата снимка |
| `interest_level` | TEXT | Температура |
| `score` | INTEGER | Балл |
| `funnel_stage` | TEXT | Этап воронки |
| `campaign_messages_count` | INTEGER | Количество сообщений |
| `created_at` | TIMESTAMPTZ | Время создания |

**Constraint:**
```sql
UNIQUE(lead_id, snapshot_date)
```

**Индексы:**
```sql
idx_lead_snapshot_user_date (user_account_id, snapshot_date DESC)
idx_lead_snapshot_lead (lead_id, snapshot_date DESC)
idx_lead_snapshot_interest (user_account_id, snapshot_date, interest_level)
```

---

## 📝 ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ

### Пример 1: Получить общую статистику

```typescript
import { getAnalyticsOverview } from '@/services/campaignApi';

const overview = await getAnalyticsOverview(userId);

console.log(`Отправлено: ${overview.totalSent}`);
console.log(`Процент ответов: ${overview.replyRate}%`);
console.log(`Конверсия: ${overview.conversionRate}%`);
```

---

### Пример 2: Проанализировать эффективность стратегий

```typescript
import { getAnalyticsByStrategy } from '@/services/campaignApi';

const strategies = await getAnalyticsByStrategy(userId);

// Найти лучшую стратегию
const best = strategies.reduce((prev, curr) => 
  parseFloat(curr.conversionRate) > parseFloat(prev.conversionRate) ? curr : prev
);

console.log(`Лучшая стратегия: ${best.strategy_type}`);
console.log(`Конверсия: ${best.conversionRate}%`);
```

---

### Пример 3: Отследить динамику температуры

```typescript
import { getTemperatureDynamics } from '@/services/campaignApi';

const dynamics = await getTemperatureDynamics(userId, 30);

// Сравнить сегодня с 30 дней назад
const today = dynamics[0];
const monthAgo = dynamics[dynamics.length - 1];

const hotGrowth = today.hot_count - monthAgo.hot_count;
console.log(`Рост горячих лидов за месяц: ${hotGrowth}`);
```

---

## 🔍 ОТЛАДКА И МОНИТОРИНГ

### Проверка обработчиков событий

**1. Проверить отметку ответов:**
```sql
SELECT 
  id, 
  lead_id, 
  has_reply, 
  first_reply_at, 
  sent_at
FROM campaign_messages
WHERE user_account_id = 'xxx'
  AND status = 'sent'
  AND has_reply = true
ORDER BY first_reply_at DESC
LIMIT 10;
```

**2. Проверить отметку конверсий:**
```sql
SELECT 
  id, 
  lead_id, 
  led_to_target_action, 
  target_action_type,
  target_action_at,
  sent_at
FROM campaign_messages
WHERE user_account_id = 'xxx'
  AND led_to_target_action = true
ORDER BY target_action_at DESC
LIMIT 10;
```

**3. Проверить снимки:**
```sql
SELECT 
  snapshot_date,
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE interest_level = 'hot') as hot,
  COUNT(*) FILTER (WHERE interest_level = 'warm') as warm,
  COUNT(*) FILTER (WHERE interest_level = 'cold') as cold
FROM lead_daily_snapshot
WHERE user_account_id = 'xxx'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 30;
```

---

### Логи

**Отметка ответов:**
```bash
docker logs agents-monorepo-chatbot-service-1 | grep "Marked campaign message as replied"
```

**Отметка конверсий:**
```bash
docker logs agents-monorepo-chatbot-service-1 | grep "Marked campaign message as led to target action"
```

**Снимки:**
```bash
docker logs agents-monorepo-chatbot-service-1 | grep "Daily lead snapshot completed"
```

---

## 🎯 РЕКОМЕНДАЦИИ

### 1. Мониторинг метрик

**Хорошие показатели:**
- Reply Rate: > 20%
- Conversion Rate: > 10%
- Avg Time to Reply: < 24 часов
- Avg Time to Action: < 3 дней

**Если метрики низкие:**
- Проверить качество сообщений
- Пересмотреть стратегии
- Увеличить интервалы между касаниями
- Проверить таргетинг (температура, этапы)

---

### 2. Оптимизация стратегий

**Анализируйте:**
- Какие стратегии дают лучший reply rate
- Какие стратегии дают лучший conversion rate
- Для каких температур какие стратегии работают

**Действуйте:**
- Увеличивайте долю эффективных стратегий
- Отключайте неэффективные
- A/B тестируйте новые подходы

---

### 3. Работа с температурой

**Следите за динамикой:**
- Растёт ли доля горячих лидов?
- Не увеличивается ли доля холодных?
- Как быстро лиды "остывают"?

**Корректируйте:**
- Интервалы касаний по температуре
- Стратегии для разных температур
- Контент сообщений

---

## 📚 СВЯЗАННЫЕ ДОКУМЕНТЫ

- `CAMPAIGN_AUTOMATION_FLOW.md` - Общая система рассылок
- `CAMPAIGN_QUEUE_IMPROVEMENTS_SUMMARY.md` - Система скоринга
- `STRATEGY_SYSTEM.md` - Система стратегий сообщений

---

**Дата последнего обновления:** 17 ноября 2025  
**Версия:** 1.0  
**Статус:** ✅ Реализовано и готово к использованию

🎉 **Аналитика без LLM = Быстро, точно, масштабируемо!**

