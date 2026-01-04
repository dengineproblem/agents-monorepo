# Проблема: ctwa_clid отсутствует для рекламных лидов

## Статус
**CAPI работает**, но без полной атрибуции (ctwa_clid = null)

## Что было сделано

### 1. Исправлена отправка CAPI событий
- **Проблема**: Meta API возвращал ошибки 2804064 и 2804066
- **Причина**: `action_source: 'business_messaging'` требует наличия `ctwa_clid`
- **Решение**: Условная логика в `metaCapiClient.ts`:
  ```typescript
  if (ctwaClid) {
    eventPayload.action_source = 'business_messaging';
    eventPayload.messaging_channel = 'whatsapp';
  } else {
    eventPayload.action_source = 'other';
  }
  ```
- **Результат**: 30/30 событий отправляются успешно
- **Коммит**: `0a446ee`

### 2. Создан endpoint для принудительной отправки CAPI
- **Файл**: `services/chatbot-service/src/server.ts`
- **Endpoint**: `POST /capi/resend`
- **Параметры**: `direction_id`, `dialog_ids`, `event_levels`

## Нерешённая проблема: ctwa_clid = null

### Суть проблемы
Все лиды в базе данных имеют `ctwa_clid: null`, хотя они приходят из рекламы Facebook/Instagram (Click-to-WhatsApp ads).

### Доказательства что лиды из рекламы
- У лидов есть `direction_id` (связь с рекламным направлением)
- Лиды маппятся с объявлениями в UI
- Пользователь подтверждает что все лиды приходят из рекламы

### SQL запрос для проверки
```sql
SELECT id, contact_phone, ctwa_clid, direction_id, source_id
FROM dialog_analysis
WHERE direction_id IS NOT NULL
LIMIT 10;
```
**Результат**: Все записи имеют `ctwa_clid: null`

### Где должен извлекаться ctwa_clid
**Файл**: `services/agent-service/src/routes/evolutionWebhooks.ts` (строки 154-161)

```typescript
const referral = contextInfo?.referral || data.referral;
const ctwaClid = referral?.ctwaClid ||  // Стандартное место
                 contextInfo?.ctwaClid ||  // Альтернативное место
                 externalAdReply?.ctwaClid ||  // В externalAdReply
                 data.ctwaClid;  // На верхнем уровне data
```

### Логирование показывает
```json
{
  "ctwaClid": null,
  "hasExternalAdReply": false,
  "hasReferral": false
}
```

**Вывод**: Evolution API НЕ передаёт ctwa_clid в вебхуках.

## Что нужно исследовать

### 1. Формат вебхуков Evolution API
- Посмотреть полную структуру входящего вебхука для рекламного лида
- Добавить детальный лог всего объекта `data` при входящем сообщении:
  ```typescript
  app.log.info({ fullData: JSON.stringify(data) }, 'Full webhook data');
  ```

### 2. Документация Evolution API
- Проверить, поддерживает ли Evolution API передачу ctwa_clid
- Возможно требуется специальная настройка или версия API

### 3. Альтернативные источники ctwa_clid
- WhatsApp Business API напрямую (не через Evolution)
- Meta Webhooks API
- Проверить, приходит ли ctwa_clid как query parameter при клике на рекламу

### 4. Тип remoteJid для рекламных лидов
- Рекламные лиды должны иметь `remoteJid` типа `@s.whatsapp.net` или `@lid`
- Групповые чаты (`@g.us`) - это НЕ рекламные лиды
- Нужно найти логи именно для рекламных лидов

## Файлы для изучения

| Файл | Описание |
|------|----------|
| `services/agent-service/src/routes/evolutionWebhooks.ts` | Обработка вебхуков Evolution API |
| `services/chatbot-service/src/lib/metaCapiClient.ts` | Отправка CAPI событий |
| `services/chatbot-service/src/lib/qualificationAgent.ts` | Квалификация лидов и вызов CAPI |
| `services/chatbot-service/src/server.ts` | Endpoint `/capi/resend` |

## Текущее состояние

| Компонент | Статус |
|-----------|--------|
| CAPI отправка событий | ✅ Работает (action_source: 'other') |
| Атрибуция с ctwa_clid | ❌ Не работает (ctwa_clid = null) |
| Извлечение ctwa_clid из вебхуков | ❓ Код есть, но данные не приходят |

## Команды для диагностики

```bash
# Логи agent-service (вебхуки)
docker logs --tail 500 agents-monorepo-agent-service-1 2>&1 | grep -i "Incoming message structure"

# Логи chatbot-service (CAPI)
docker logs --tail 300 chatbot-service-deploy 2>&1 | grep -i "capi"

# Тест отправки CAPI
curl -X POST http://localhost:8083/capi/resend \
  -H "Content-Type: application/json" \
  -d '{"direction_id": "YOUR_DIRECTION_ID", "event_levels": [1]}'
```

## Гипотезы

1. **Evolution API не поддерживает ctwa_clid** - нужно проверить документацию
2. **ctwa_clid приходит в другом месте** - нужно залогировать полный payload вебхука
3. **Требуется настройка Evolution API** - возможно нужно включить какую-то опцию
4. **Нужен прямой доступ к WhatsApp Business API** - Evolution может терять эти данные
