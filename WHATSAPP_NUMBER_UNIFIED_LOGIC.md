# WhatsApp Number - Unified Try-Catch Logic

**Дата**: 2025-11-12
**Статус**: ✅ Реализовано

---

## 📋 Задача

Упразднить флаг `skip_whatsapp_number_in_api` и вернуть всех пользователей на единую логику обработки WhatsApp номеров:

1. **Попытка 1**: Создать ad set с номером из направления
2. **Попытка 2**: Если ошибка 2446885 → создать ad set БЕЗ номера (Facebook подставит дефолтный)

---

## 🎯 Проблема

Ранее использовался feature flag `skip_whatsapp_number_in_api`:
- `true` (по умолчанию) → НЕ отправляем номер в API
- `false` → отправляем номер с fallback логикой

Это создавало:
- ✗ Излишнюю сложность в коде
- ✗ Различное поведение для разных пользователей
- ✗ Необходимость поддерживать две ветки логики

---

## ✅ Решение

### Единая логика для всех

Теперь **все пользователи** используют одинаковый подход:

```typescript
// 1. Формируем promoted_object ВСЕГДА с номером (если есть)
const promoted_object = {
  page_id: String(page_id),
  ...(whatsapp_phone_number && { whatsapp_phone_number })
};

// 2. Пытаемся создать ad set
try {
  adsetResult = await graph('POST', `${ad_account_id}/adsets`, token, adsetBody);
} catch (error) {
  const errorSubcode = error?.error?.error_subcode;

  // 3. Если ошибка 2446885 и есть номер - повторяем БЕЗ номера
  if (errorSubcode === 2446885 && whatsapp_phone_number) {
    const adsetBodyWithoutNumber = {
      ...adsetBody,
      promoted_object: {
        page_id: String(page_id)
        // whatsapp_phone_number убран
      }
    };

    adsetResult = await graph('POST', `${ad_account_id}/adsets`, token, adsetBodyWithoutNumber);

    log.info({ fallback_used: true }, 'Ad set created without WhatsApp number');
  } else {
    throw error;
  }
}
```

### Преимущества

✅ **Простота**: Одна логика для всех
✅ **Автоматизм**: Нет необходимости в ручной настройке флага
✅ **Надежность**: Автоматический fallback при ошибке
✅ **Совместимость**: Работает для всех типов аккаунтов

---

## 🔧 Реализация

### 1. Обновленные файлы

| # | Файл | Изменения |
|---|------|-----------|
| 1 | [createAdSetInDirection.ts](services/agent-service/src/workflows/createAdSetInDirection.ts) | Убрана проверка `skip_whatsapp_number_in_api`, добавлен try-catch с fallback |
| 2 | [campaignBuilder.ts (lib)](services/agent-service/src/lib/campaignBuilder.ts) | Обновлена функция `createAdSetInCampaign` с try-catch логикой |
| 3 | [campaignBuilder.ts (routes)](services/agent-service/src/routes/campaignBuilder.ts) | Убраны проверки флага в auto-launch и manual-launch |
| 4 | [creativeTest.ts (workflow)](services/agent-service/src/workflows/creativeTest.ts) | Убрана проверка флага, добавлен try-catch |
| 5 | [createCampaignWithCreative.ts](services/agent-service/src/workflows/createCampaignWithCreative.ts) | Убрана проверка флага, добавлен try-catch, обновлен тип |
| 6 | [actions.ts](services/agent-service/src/routes/actions.ts) | Убрано получение и использование `skipWhatsAppNumberInApi` |
| 7 | [creativeTest.ts (routes)](services/agent-service/src/routes/creativeTest.ts) | Убрано получение и использование флага |

### 2. Миграция БД

**Файл**: [migrations/032_drop_skip_whatsapp_number_flag.sql](migrations/032_drop_skip_whatsapp_number_flag.sql)

```sql
ALTER TABLE user_accounts
DROP COLUMN IF EXISTS skip_whatsapp_number_in_api;
```

---

## 📊 Места создания ad sets

Обновлены **все** места где создаются ad sets:

### 1. Auto-launch (`campaignBuilder.ts`)
- Вызывает `createAdSetInCampaign` → содержит try-catch логику

### 2. Manual-launch (`campaignBuilder.ts`)
- Вызывает `createAdSetInCampaign` → содержит try-catch логику

### 3. Test Creative (`creativeTest.ts` workflow)
- Прямой вызов Facebook API с try-catch логикой

### 4. Create Campaign with Creative (`createCampaignWithCreative.ts`)
- Прямой вызов Facebook API с try-catch логикой

### 5. AgentBrain (`actions.ts`)
- Вызывает `createCampaignWithCreative` → содержит try-catch логику

### 6. Direction workflows (`createAdSetInDirection.ts`)
- Прямой вызов Facebook API с try-catch логикой

---

## 🔄 Поток обработки

### Стандартный случай (номер работает)

```
1. Формируем promoted_object с номером
2. Отправляем в Facebook API
3. ✅ Ad set создан успешно
```

### Случай с ошибкой 2446885

```
1. Формируем promoted_object с номером
2. Отправляем в Facebook API
3. ❌ Ошибка 2446885 (WhatsApp Business requirement)
4. Логируем warning
5. Формируем promoted_object БЕЗ номера
6. Повторно отправляем в Facebook API
7. ✅ Ad set создан успешно (Facebook использует дефолтный номер)
```

---

## 📝 Логирование

Во всех местах добавлено детальное логирование:

### При успехе с номером
```typescript
log.info({
  adsetId: result.id,
  whatsapp_number: whatsapp_phone_number
}, 'Ad set created successfully with WhatsApp number from direction');
```

### При fallback
```typescript
log.warn({
  error_subcode: 2446885,
  whatsapp_number_attempted: whatsapp_phone_number
}, '⚠️ Facebook API error 2446885 detected - retrying WITHOUT whatsapp_phone_number');

// После успеха
log.info({
  adsetId: result.id,
  fallback_used: true
}, '✅ Ad set created successfully WITHOUT whatsapp_phone_number (Facebook will use page default)');
```

---

## 🎓 Уроки

1. **Упрощение лучше**: Единая логика проще в поддержке чем feature flags
2. **Try-catch работает**: Автоматический fallback надежнее ручной настройки
3. **Логирование критично**: Детальные логи помогают понять что происходит
4. **Консистентность важна**: Все места создания ad sets работают одинаково

---

## 🚀 Применение

### Для новых пользователей
**Автоматически работает** - ничего настраивать не нужно

### Для существующих пользователей
**Автоматически переключаются** на новую логику после:
1. Применения миграции 032
2. Деплоя обновленного кода

---

## 📚 Связанная документация

- [WHATSAPP_WORKAROUND_WITH_BACKWARD_COMPATIBILITY.md](WHATSAPP_WORKAROUND_WITH_BACKWARD_COMPATIBILITY.md) - Старый подход с флагом (deprecated)
- [WHATSAPP_NUMBERS_LOGIC.md](WHATSAPP_NUMBERS_LOGIC.md) - Общая логика работы с WhatsApp номерами
- [FACEBOOK_API_QUESTION_WHATSAPP_2446885.md](FACEBOOK_API_QUESTION_WHATSAPP_2446885.md) - Исследование проблемы

---

**Дата реализации:** 2025-11-12
**Автор:** Claude Agent
**Статус:** ✅ Ready for deployment
