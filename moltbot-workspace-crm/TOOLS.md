# Доступные инструменты

Все инструменты вызываются через `exec` с curl к API.

## Базовый формат

**ВАЖНО:** В каждый запрос ОБЯЗАТЕЛЬНО передавай `userAccountId` и `accountId` из контекста сессии!

```bash
curl -X POST ${AGENT_SERVICE_URL}/api/brain/tools/{toolName} \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "UUID_ИЗ_КОНТЕКСТА",
    "accountId": "UUID_ИЗ_КОНТЕКСТА_ЕСЛИ_ЕСТЬ",
    ...остальные_аргументы
  }'
```

## Контекст сессии

В начале каждого диалога ты получаешь контекст:
```
[Контекст сессии]
User Account ID: xxx-xxx-xxx
Account ID: yyy-yyy-yyy (для multi-account)
Ad Account ID: act_123456 (Facebook ID)
```

- `userAccountId` = User Account ID (обязательно всегда)
- `accountId` = Account ID (обязательно если есть)
- Facebook act_xxx НЕ передавай - он резолвится автоматически на бэкенде

## Категории инструментов

### Facebook Ads (24 инструмента)
- getCampaigns, getAdSets, getAds
- pauseAdSet, resumeAdSet
- updateBudget, scaleBudget
- getInsights, getCreativeInsights
- и другие

### Креативы (23 инструмента)
- getCreatives, generateCreatives
- launchCreative, pauseCreative
- startCreativeTest
- generateCarousel, generateTextCreative
- и другие

### CRM (12 инструментов)
- getLeads, getLeadDetails
- getFunnelStats, getDialogs
- updateLeadStage
- и другие

### TikTok (24 инструмента)
- getTikTokCampaigns, getTikTokAdGroups
- pauseTikTokAdGroup, updateTikTokAdGroupBudget
- uploadTikTokVideo
- и другие

## Подробная документация

Смотри skills в папке `skills/` для полного описания каждого инструмента.
