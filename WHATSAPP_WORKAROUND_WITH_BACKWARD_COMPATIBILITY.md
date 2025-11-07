# WhatsApp API Workaround с обратной совместимостью

**Дата:** 2025-11-07
**Статус:** ✅ Реализовано

---

## 📋 Проблема

**Facebook API bug 2446885**: При создании ad sets через API с указанием `whatsapp_phone_number` в `promoted_object`, Facebook возвращает ошибку "Требуется WhatsApp Business", **даже если номер Business**. Через интерфейс Facebook Ads Manager всё работает нормально.

### Симптомы:
- ❌ Создание ad sets через API с `whatsapp_phone_number` → ошибка 2446885
- ✅ Создание ad sets через Facebook UI с тем же номером → работает
- ✅ Создание ad sets через API **БЕЗ** `whatsapp_phone_number` → Facebook сам подставляет дефолтный номер → работает

---

## ✅ Решение

### Workaround
**НЕ отправлять** `whatsapp_phone_number` в `promoted_object` при создании ad sets через API. Facebook сам подставит дефолтный номер со страницы.

### Обратная совместимость
Добавлен флаг `user_accounts.skip_whatsapp_number_in_api`:

| Значение | Поведение | Когда использовать |
|----------|-----------|-------------------|
| `true` (по умолчанию) | **НЕ отправлять** `whatsapp_phone_number` → Facebook подставляет дефолтный | Для пользователей с bug 2446885 |
| `false` | **Отправлять** `whatsapp_phone_number` с 4-tier fallback (старая логика) | Для пользователей, у которых работает старая логика |

---

## 🔧 Реализация

### 1. Миграция БД

**Файл:** [migrations/031_add_skip_whatsapp_number_flag.sql](migrations/031_add_skip_whatsapp_number_flag.sql)

```sql
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS skip_whatsapp_number_in_api BOOLEAN NOT NULL DEFAULT true;
```

### 2. Изменённые файлы

| # | Файл | Строки | Изменение |
|---|------|--------|-----------|
| 1 | [createAdSetInDirection.ts](services/agent-service/src/workflows/createAdSetInDirection.ts#L368-L380) | 368-380 | Проверка флага при формировании `promoted_object` |
| 2 | [campaignBuilder.ts /auto-launch-v2](services/agent-service/src/routes/campaignBuilder.ts#L252-L265) | 252-265 | Проверка флага для auto-launch |
| 3 | [campaignBuilder.ts /manual-launch](services/agent-service/src/routes/campaignBuilder.ts#L567-L580) | 567-580 | Проверка флага для manual-launch |
| 4 | [creativeTest.ts workflow](services/agent-service/src/workflows/creativeTest.ts#L184-L193) | 184-193 | Проверка флага в workflow теста |
| 5 | [creativeTest.ts route](services/agent-service/src/routes/creativeTest.ts#L84-L86) | 84-86 | Получение номера с fallback если флаг=false |
| 6 | [createCampaignWithCreative.ts](services/agent-service/src/workflows/createCampaignWithCreative.ts#L271-L283) | 271-283 | Проверка флага при создании кампании |
| 7 | [actions.ts Brain Agent](services/agent-service/src/routes/actions.ts#L281-L329) | 281-329 | 3-tier fallback для старой логики |

### 3. Логика проверки флага

```typescript
if (userAccount.skip_whatsapp_number_in_api !== false) {
  // НОВАЯ ЛОГИКА (по умолчанию): не отправляем номер
  promoted_object = {
    page_id: String(userAccount.page_id)
    // whatsapp_phone_number намеренно НЕ передается
  };
} else {
  // СТАРАЯ ЛОГИКА (обратная совместимость): отправляем номер с fallback
  const whatsapp_phone_number = await getWhatsAppPhoneNumber(direction, user_account_id, supabase) || undefined;
  promoted_object = {
    page_id: String(userAccount.page_id),
    ...(whatsapp_phone_number && { whatsapp_phone_number })
  };
}
```

---

## 📊 Логирование

Все места создания ad sets теперь логируют:

```typescript
log.info({
  skip_whatsapp_number_in_api: skipWhatsAppNumber,
  whatsapp_number_in_db: whatsapp_phone_number || null,
  whatsapp_number_sent_to_fb: skipWhatsAppNumber ? null : (whatsapp_phone_number || null),
  facebook_will_use_page_default: direction.objective === 'whatsapp' && skipWhatsAppNumber
}, skipWhatsAppNumber
  ? 'Creating new ad set via API (WhatsApp number NOT sent - Facebook will use page default)'
  : 'Creating new ad set via API (WhatsApp number sent with fallback - old behavior)');
```

---

## 🚀 Применение

### Для новых пользователей
**Автоматически:** `skip_whatsapp_number_in_api = true` (по умолчанию)
→ Используется workaround, номер НЕ отправляется

### Для существующих пользователей

#### Если у пользователя **ЕСТЬ** проблема 2446885:
```sql
-- Оставить как есть (по умолчанию true)
-- Ничего не делать
```

#### Если у пользователя **работает старая логика**:
```sql
-- Переключить на старую логику
UPDATE user_accounts
SET skip_whatsapp_number_in_api = false
WHERE id = 'user_id_here';
```

---

## 🎯 Примеры использования

### Пример 1: Пользователь с двумя направлениями и разными номерами

**Ситуация:**
- Направление "Продажа курсов" → WhatsApp номер `+77771234567`
- Направление "Консультации" → WhatsApp номер `+77779876543`
- Старая логика работала корректно

**Решение:**
```sql
UPDATE user_accounts
SET skip_whatsapp_number_in_api = false
WHERE id = 'user_id';
```

Теперь система будет использовать:
- Для "Продажа курсов" → `+77771234567` (из `direction.whatsapp_phone_number_id`)
- Для "Консультации" → `+77779876543` (из `direction.whatsapp_phone_number_id`)

### Пример 2: Пользователь с ошибкой 2446885

**Ситуация:**
- Одно направление "Терапия"
- При создании ad sets → ошибка 2446885

**Решение:**
```sql
-- Ничего не делать, флаг уже true по умолчанию
```

Система НЕ отправляет `whatsapp_phone_number` → Facebook подставляет дефолтный → работает.

---

## 📚 Связанная документация

- [WHATSAPP_ERROR_2446885_FIX.md](WHATSAPP_ERROR_2446885_FIX.md) - Первоначальное исправление (без обратной совместимости)
- [FACEBOOK_API_QUESTION_WHATSAPP_2446885.md](FACEBOOK_API_QUESTION_WHATSAPP_2446885.md) - Исследование проблемы
- [WHATSAPP_NUMBERS_LOGIC.md](WHATSAPP_NUMBERS_LOGIC.md) - Полное описание логики работы с WhatsApp номерами

---

## 🎓 Уроки

1. **Обратная совместимость критична** - нельзя ломать работающие решения пользователей
2. **Feature flags решают** - добавление флага позволяет постепенный rollout
3. **Логирование флага** - помогает быстро понять, какая логика используется
4. **Default значение true** - новая логика (workaround) применяется к новым пользователям автоматически
5. **Opt-out, а не opt-in** - пользователи с проблемой получают фикс по умолчанию

---

**Дата реализации:** 2025-11-07
**Автор:** Claude Agent
**Статус:** ✅ Ready for deployment
