# ✅ Evolution API Lead Migration - ЗАВЕРШЕНО

**Дата:** 5 ноября 2025  
**Статус:** Миграция завершена, готово к тестированию

---

## 🎯 Цель миграции

Переиспользовать правильную логику сопоставления лидов с креативами из GREEN-API в Evolution API, чтобы:
- Правильно извлекать `whatsapp_phone_number_id` из `account_directions` через JOIN
- Поддерживать fallback логику через `user_creatives`
- Подготовить систему к отключению GREEN-API (экономия $600-3000/год)

---

## ✅ Выполненные изменения

### Файл: `services/agent-service/src/routes/evolutionWebhooks.ts`

### 1. Добавлена функция `resolveCreativeAndDirection()` (строки 196-289)

**Источник:** Скопирована из `greenApiWebhooks.ts`

**Функционал:**
- PRIMARY lookup в `ad_creative_mapping` по `ad_id` с JOIN к `account_directions`
- FALLBACK lookup в `user_creatives` по URL (тоже с JOIN)
- Возвращает `{ creativeId, directionId, whatsappPhoneNumberId }`

```typescript
async function resolveCreativeAndDirection(
  sourceId: string,
  sourceUrl: string | null,
  userAccountId: string,
  app: FastifyInstance
): Promise<{ 
  creativeId: string | null; 
  directionId: string | null;
  whatsappPhoneNumberId: string | null;
}>
```

### 2. Обновлена функция `handleIncomingMessage()` (строки 160-193)

**До:**
```typescript
await processAdLead({
  userAccountId: instanceData.user_account_id,
  whatsappPhoneNumberId: whatsappNumber?.id, // ← Только из инстанса
  // ...
}, app);
```

**После:**
```typescript
// Resolve ПЕРЕД processAdLead
const { creativeId, directionId, whatsappPhoneNumberId: directionWhatsappId } = 
  await resolveCreativeAndDirection(
    finalSourceId,
    sourceUrl || mediaUrl,
    instanceData.user_account_id,
    app
  );

const finalWhatsappPhoneNumberId = directionWhatsappId || whatsappNumber?.id;

app.log.info({
  clientPhone,
  sourceId: finalSourceId,
  creativeId,
  directionId,
  whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
  usedDirectionWhatsApp: !!directionWhatsappId,
}, 'Resolved lead data from ad metadata');

await processAdLead({
  userAccountId: instanceData.user_account_id,
  whatsappPhoneNumberId: finalWhatsappPhoneNumberId, // ← Из direction!
  creativeId,      // ← Передаем напрямую
  directionId,     // ← Передаем напрямую
  // ...
}, app);
```

### 3. Упрощена функция `processAdLead()` (строки 294-377)

**Добавлены параметры:**
```typescript
async function processAdLead(params: {
  userAccountId: string;
  whatsappPhoneNumberId?: string;
  clientPhone: string;
  sourceId: string;
  creativeId: string | null;   // ← NEW
  directionId: string | null;  // ← NEW
  creativeUrl?: string;
  messageText: string;
  timestamp: Date;
  rawData: any;
}, app: FastifyInstance)
```

**Удалена inline логика:**
- Удалены ~25 строк inline поиска креатива
- Теперь использует уже разрешенные `creativeId` и `directionId`

**До:**
```typescript
// 1. PRIMARY: Найти creative по source_id (Ad ID) в ad_creative_mapping
const { data: adMapping } = await supabase
  .from('ad_creative_mapping')
  .select('user_creative_id, direction_id') // ← БЕЗ JOIN!
  .eq('ad_id', sourceId)
  .eq('user_id', userAccountId)
  .maybeSingle();

let creativeId = adMapping?.user_creative_id;
let directionId = adMapping?.direction_id;

// 2. FALLBACK: Найти по creative_url
if (!creativeId && creativeUrl) {
  // ... еще запросы
}
```

**После:**
```typescript
const { creativeId, directionId } = params; // Уже готовы!
```

### 4. Обновлен `conversion_source` (строка 357)

**До:** `conversion_source: 'FB_Ads'`  
**После:** `conversion_source: 'Evolution_API'`

---

## 📊 Результаты

### Сравнение GREEN-API vs Evolution API

| Функция | GREEN-API | Evolution API (ДО) | Evolution API (ПОСЛЕ) |
|---------|-----------|-------------------|----------------------|
| Извлечение `sourceId` | ✅ | ✅ | ✅ |
| Разрешение `creative_id` | ✅ | ⚠️ (без JOIN) | ✅ |
| Разрешение `direction_id` | ✅ | ⚠️ (без JOIN) | ✅ |
| `whatsapp_phone_number_id` из direction | ✅ | ❌ | ✅ |
| JOIN к `account_directions` | ✅ | ❌ | ✅ |
| Fallback через `user_creatives` | ✅ | ❌ | ✅ |

**Итог:** Evolution API теперь работает **ИДЕНТИЧНО** GREEN-API! 🎉

---

## 🧪 Тестирование

См. полную инструкцию: `EVOLUTION_LEAD_MIGRATION_TEST.md`

### Быстрая проверка

1. **Отправить тестовое сообщение через Click-to-WhatsApp**

2. **Проверить логи:**
```bash
docker logs agent-service-1 -f --tail=100
```

Ожидаемый вывод:
```json
{
  "message": "Resolved lead data from ad metadata",
  "creativeId": "uuid",
  "directionId": "uuid",
  "whatsappPhoneNumberId": "uuid-from-direction",
  "usedDirectionWhatsApp": true
}
```

3. **Проверить БД:**
```sql
SELECT 
  creative_id, 
  direction_id, 
  whatsapp_phone_number_id,
  conversion_source
FROM leads 
WHERE conversion_source = 'Evolution_API'
ORDER BY created_at DESC
LIMIT 1;
```

Все 3 поля (`creative_id`, `direction_id`, `whatsapp_phone_number_id`) должны быть заполнены!

---

## 🚀 Следующие шаги

### 1. Тестирование (1-2 дня)
- Отправить тестовые лиды
- Проверить логи и БД
- Убедиться в корректности данных

### 2. Мониторинг в production (1-2 недели)
- Следить за метриками лидов
- Сравнивать с GREEN-API
- Проверять whatsapp_phone_number_id

### 3. Постепенная миграция
- Evolution API работает параллельно с GREEN-API
- Переводить instances постепенно
- Мониторить качество данных

### 4. Отключение GREEN-API
- После 100% успешной миграции
- Отключить GREEN-API интеграцию
- **Экономия: $600-3000/год**

---

## 💡 Архитектура

### Как работает маппинг

```
sourceId (из WhatsApp) = Facebook Ad ID
    ↓
Поиск в ad_creative_mapping по ad_id
    ↓
= user_creative_id (UUID нашего креатива)
= direction_id (UUID направления)
    ↓
JOIN к account_directions
    ↓
= whatsapp_phone_number_id (UUID WhatsApp номера)
```

### Когда заполняется ad_creative_mapping?

При создании объявлений через:
- **creative_test** → `saveAdCreativeMapping()` (direction_id = null)
- **direction_launch** → `saveAdCreativeMappingBatch()` (direction_id заполнен)
- **campaign_builder** → `saveAdCreativeMapping()` (direction_id опционален)

### Fallback логика

Если PRIMARY lookup не нашел mapping:
1. Ищет в `user_creatives` по URL
2. Также делает JOIN к `account_directions`
3. Возвращает найденные данные или null

---

## 📝 Дополнительные файлы

- **Тест-гайд:** `EVOLUTION_LEAD_MIGRATION_TEST.md`
- **План миграции:** `evolution-api-lead-migration.plan.md`
- **Исходный код GREEN-API:** `services/agent-service/src/routes/greenApiWebhooks.ts`
- **Обновленный код Evolution API:** `services/agent-service/src/routes/evolutionWebhooks.ts`

---

## ✅ Чеклист завершения

- [x] Скопирована функция `resolveCreativeAndDirection()`
- [x] Обновлена `handleIncomingMessage()`
- [x] Упрощена `processAdLead()`
- [x] Обновлен `conversion_source`
- [x] Проверены linter ошибки (нет ошибок)
- [x] Создана документация по тестированию
- [ ] Выполнено тестирование с реальными лидами (требует действий пользователя)
- [ ] Проверены логи в production
- [ ] Подтверждена корректность данных в БД

---

## 🎉 Итог

Migration успешно завершена! Evolution API теперь использует ту же логику сопоставления лидов с креативами, что и GREEN-API, включая:

✅ JOIN к `account_directions` для извлечения `whatsapp_phone_number_id`  
✅ PRIMARY lookup через `ad_creative_mapping`  
✅ FALLBACK lookup через `user_creatives`  
✅ Корректное логирование для отладки  
✅ Совместимость с существующей системой  

**Готово к тестированию и deploy!** 🚀

