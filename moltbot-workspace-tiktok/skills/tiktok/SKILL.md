---
name: tiktok
description: Управление TikTok рекламой
---

# TikTok Ads Skill

Этот skill позволяет управлять рекламными кампаниями TikTok.

## Базовый формат вызова

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/{toolName} \
  -H "Content-Type: application/json" \
  -d '{...параметры...}'
```

---

## READ Tools (Чтение данных)

### getTikTokCampaigns
Получить кампании TikTok.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokCampaigns \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123", "period": "last_7d", "status": "active"}'
```

### getTikTokCampaignDetails
Детали кампании.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokCampaignDetails \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "123"}'
```

### getTikTokAdGroups
Получить группы объявлений.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokAdGroups \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123", "campaignId": "456", "status": "active"}'
```

### getTikTokAds
Получить объявления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokAds \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123", "adGroupId": "456"}'
```

### getTikTokSpendReport
Отчёт по расходам.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokSpendReport \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123", "period": "last_7d", "breakdown": "day"}'
```

### getTikTokAccountStatus
Статус аккаунта.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokAccountStatus \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123"}'
```

### getTikTokAdvertiserInfo
Информация о рекламодателе.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokAdvertiserInfo \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123"}'
```

### getTikTokDirections
Направления TikTok.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokDirections \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123"}'
```

### getTikTokDirectionCreatives
Креативы направления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokDirectionCreatives \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123"}'
```

### getTikTokDirectionInsights
Инсайты направления.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/getTikTokDirectionInsights \
  -H "Content-Type: application/json" \
  -d '{"directionId": "123", "period": "last_7d"}'
```

---

## WRITE Tools (Изменение данных)

**ВАЖНО**: Перед выполнением WRITE операций запроси подтверждение!

### pauseTikTokCampaign
Поставить кампанию на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseTikTokCampaign \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "123", "reason": "Budget optimization"}'
```

### resumeTikTokCampaign
Возобновить кампанию.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeTikTokCampaign \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "123"}'
```

### pauseTikTokAdGroup
Поставить группу на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseTikTokAdGroup \
  -H "Content-Type: application/json" \
  -d '{"adGroupId": "123", "reason": "High CPA"}'
```

### resumeTikTokAdGroup
Возобновить группу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeTikTokAdGroup \
  -H "Content-Type: application/json" \
  -d '{"adGroupId": "123"}'
```

### updateTikTokAdGroupBudget
Изменить бюджет группы.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/updateTikTokAdGroupBudget \
  -H "Content-Type: application/json" \
  -d '{"adGroupId": "123", "dailyBudget": 5000}'
```

### pauseTikTokAd
Поставить объявление на паузу.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/pauseTikTokAd \
  -H "Content-Type: application/json" \
  -d '{"adId": "123", "reason": "Low CTR"}'
```

### resumeTikTokAd
Возобновить объявление.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/resumeTikTokAd \
  -H "Content-Type: application/json" \
  -d '{"adId": "123"}'
```

### uploadTikTokVideo
Загрузить видео.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/uploadTikTokVideo \
  -H "Content-Type: application/json" \
  -d '{"advertiserId": "123", "videoUrl": "https://...", "filename": "creative.mp4"}'
```

---

## Сравнение с Facebook

### compareTikTokWithFacebook
Сравнить метрики TikTok и Facebook.

```bash
curl -s -X POST http://agent-brain:7080/brain/tools/compareTikTokWithFacebook \
  -H "Content-Type: application/json" \
  -d '{
    "tiktokAdvertiserId": "123",
    "facebookAdAccountId": "act_456",
    "period": "last_7d"
  }'
```

---

## Примеры использования

### Анализ TikTok кампаний
1. Получи кампании: `getTikTokCampaigns`
2. Сравни с Facebook: `compareTikTokWithFacebook`
3. Оптимизируй бюджеты

### Оптимизация
1. Получи группы: `getTikTokAdGroups`
2. Найди с высоким CPA
3. Поставь на паузу: `pauseTikTokAdGroup`
