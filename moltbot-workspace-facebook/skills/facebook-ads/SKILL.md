---
name: facebook-ads
description: Управление Facebook/Instagram рекламой через API
---

# Facebook Ads Skill

Этот skill позволяет управлять рекламными кампаниями Facebook и Instagram.

## Базовый формат вызова

Все команды выполняются через `exec` с curl на agent-brain:

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/{toolName} \
  -H "Content-Type: application/json" \
  -d '{...параметры...}'
```

---

## READ Tools (Чтение данных)

### getCampaigns
Получить список кампаний с метриками.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCampaigns \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "period": "last_7d", "status": "active"}'
```

Параметры:
- `adAccountId` (required) - ID рекламного аккаунта
- `period` - Период: last_1d, last_3d, last_7d, last_14d, last_30d
- `status` - Статус: active, paused, all

### getCampaignDetails
Детали конкретной кампании.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getCampaignDetails \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "123456789", "period": "last_7d"}'
```

### getAdSets
Получить адсеты кампании.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getAdSets \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "campaignId": "123", "status": "active"}'
```

### getAds
Получить объявления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getAds \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "adSetId": "123", "status": "active"}'
```

### getSpendReport
Отчёт по расходам.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getSpendReport \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "period": "last_7d", "breakdown": "day"}'
```

### getDirections
Получить направления (группы кампаний).

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getDirections \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123"}'
```

### getDirectionMetrics
Метрики направления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getDirectionMetrics \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123", "period": "last_7d"}'
```

### getROIReport
ROI отчёт по направлениям.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getROIReport \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "period": "last_30d"}'
```

### getAdAccountStatus
Статус рекламного аккаунта.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getAdAccountStatus \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123"}'
```

### getAgentBrainActions
История действий агента.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getAgentBrainActions \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "limit": 20}'
```

---

## WRITE Tools (Изменение данных)

**ВАЖНО**: Перед выполнением WRITE операций запроси подтверждение у пользователя!

### pauseAdSet
Поставить адсет на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseAdSet \
  -H "Content-Type: application/json" \
  -d '{"adSetId": "123456789", "reason": "High CPL"}'
```

### resumeAdSet
Возобновить адсет.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeAdSet \
  -H "Content-Type: application/json" \
  -d '{"adSetId": "123456789"}'
```

### updateBudget
Изменить бюджет адсета.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/updateBudget \
  -H "Content-Type: application/json" \
  -d '{"adSetId": "123", "dailyBudget": 5000, "reason": "Scale up"}'
```

Параметры:
- `adSetId` (required) - ID адсета
- `dailyBudget` (required) - Новый дневной бюджет в копейках (5000 = 50.00)
- `reason` - Причина изменения

### pauseAd
Поставить объявление на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseAd \
  -H "Content-Type: application/json" \
  -d '{"adId": "123456789", "reason": "Low CTR"}'
```

### resumeAd
Возобновить объявление.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeAd \
  -H "Content-Type: application/json" \
  -d '{"adId": "123456789"}'
```

### updateDirectionBudget
Изменить бюджет направления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/updateDirectionBudget \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123", "dailyBudget": 10000}'
```

### pauseDirection
Поставить направление на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseDirection \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123", "reason": "Budget optimization"}'
```

### resumeDirection
Возобновить направление.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeDirection \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123"}'
```

### triggerBrainOptimizationRun
Запустить оптимизацию через Brain.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/triggerBrainOptimizationRun \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123"}'
```

### customFbQuery
Выполнить произвольный запрос к Facebook API.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/customFbQuery \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "act_123", "endpoint": "insights", "params": {"level": "campaign"}}'
```

---

## Примеры использования

### Анализ эффективности
1. Получи кампании: `getCampaigns`
2. Отфильтруй по CTR < 1%
3. Предложи действия

### Оптимизация бюджета
1. Получи ROI отчёт: `getROIReport`
2. Найди направления с ROAS > 2
3. Увеличь бюджет на 20%: `updateDirectionBudget`
