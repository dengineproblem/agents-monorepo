# ctwa_clid в CTWA: текущее состояние и диагностика

## Статус
- CAPI работает стабильно.
- При наличии `ctwa_clid` отправляется `action_source=business_messaging` + `messaging_channel=whatsapp`.
- При отсутствии `ctwa_clid` используется fallback `action_source=system_generated`.

Это означает, что отсутствие `ctwa_clid` не блокирует отправку событий, но ухудшает рекламную атрибуцию.

## Что уже реализовано

### 1. Надёжный fallback в `metaCapiClient.ts`

```typescript
if (useBusinessMessaging) {
  eventPayload.action_source = 'business_messaging';
  eventPayload.messaging_channel = 'whatsapp';
  eventPayload.ctwa_clid = normalizedCtwaClid;
} else {
  eventPayload.action_source = 'system_generated';
}
```

### 2. Расширенное извлечение `ctwa_clid` в webhook обработчиках

Проверяются несколько путей:
- `referral.ctwaClid` / `referral.ctwa_clid`
- `conversationContext.ctwaClid`
- `conversationContext.referralCtwaClid`
- `referredProductPromotion.ctwaClid`
- `externalAdReply.ctwaClid`
- top-level поля payload

### 3. Подробное логирование

Логи включают:
- откуда взят ad source (`sourceIdOrigin`: `external|referral|key|none`)
- откуда взят `ctwa_clid` (`ctwaClidSource`)
- префикс `ctwa_clid` для безопасной диагностики
- ключи `contextInfo/referral` если ad есть, но `ctwa_clid` нет

## Почему `ctwa_clid` может быть пустым

1. Провайдер webhook не передаёт CTWA metadata для конкретного сообщения.
2. `ctwa_clid` приходит только в первом сообщении после клика по рекламе.
3. Источник не является ad-сообщением (`source_type != ad/advertisement`).
4. Поле приходит в нестандартном месте, которое ещё не покрыто extractor'ом.

## Проверки в проде

```bash
# Evolution/WABA webhook diagnostics
docker logs --tail 1000 agent-service 2>&1 | grep -E "(ctwaClid|ctwa_clid|sourceIdOrigin|sourceType)"

# CAPI diagnostics
docker logs --tail 1000 chatbot-service 2>&1 | grep -E "(business_messaging|system_generated|eventIdStrategy|ctwa)"
```

```sql
-- Рекламные лиды с ctwa_clid
SELECT contact_phone, source_id, ctwa_clid, created_at
FROM dialog_analysis
WHERE source_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;
```

## Решение при системном отсутствии `ctwa_clid`

- Оставлять текущий fallback (`system_generated`) как безопасный режим.
- Оптимизацию кампаний вести через стандартные события (`CompleteRegistration`, `AddToCart/Subscribe`, `Purchase`).
- Для полного CTWA-matching приоритетно использовать источник сообщений, который гарантированно передаёт `ctwa_clid`.
