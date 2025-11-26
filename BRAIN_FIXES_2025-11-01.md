# Brain Agent Fixes - 2025-11-01

## Проблемы

### 1. Validation Error: "Array must contain at least 1 element" ❌

**Клиенты:** Iplant, RocketGo, Clean, Psychology

**Причина:**
- Brain Agent легитимно возвращал пустой массив `actions: []` когда:
  - Показатели хорошие, действия не нужны (Iplant, Psychology)
  - Реклама неактивна - reportOnlyMode (Clean)
- Agent Service требовал минимум 1 action в schema validation
- Результат: `validation_error` при утреннем кроне

### 2. Facebook API Error 1870189 (Invalid parameter) ❌

**Клиенты:** SpaceLab, performante

**Причина:**
- В `createAdSetInDirection.ts` для WhatsApp adsets:
  - `destination_type: 'WHATSAPP'` добавлялся ВСЕГДА
  - `promoted_object` добавлялся ТОЛЬКО если есть `page_id`
  - Facebook требует `promoted_object` если указан `destination_type`
- Если `page_id === null` → Facebook error 1870189

---

## Решения

### Фикс 1: Разрешить пустой массив actions ✅

**Файл:** `services/agent-service/src/actions/schema.ts`

**Изменение:**
```typescript
// БЫЛО:
actions: z.array(ActionSchema).min(1),

// СТАЛО:
actions: z.array(ActionSchema).min(0), // Разрешаем пустой массив
```

### Фикс 2: Обработка пустого массива в route ✅

**Файл:** `services/agent-service/src/routes/actions.ts`

**Добавлено после строки 23:**
```typescript
// Если actions пустой - возвращаем успешный response без выполнения
if (actions.length === 0) {
  return reply.code(202).send({ 
    executionId: 'no-actions-needed', 
    executed: false, 
    message: 'No actions to execute (all campaigns performing well or report-only mode)',
    actionsCount: 0 
  });
}
```

### Фикс 3: Исправлена логика WhatsApp adsets ✅

**Файл:** `services/agent-service/src/workflows/createAdSetInDirection.ts`

**Ключевые изменения:**

1. **Получение userAccount ПЕРЕД формированием adsetBody:**
```typescript
// ПЕРЕД formированием adsetBody (строка 260)
const { data: userAccount } = await supabase
  .from('user_accounts')
  .select('page_id, whatsapp_phone_number')
  .eq('id', user_account_id)
  .single();
```

2. **Проверка page_id для WhatsApp:**
```typescript
// КРИТИЧЕСКАЯ ПРОВЕРКА (строка 267)
if (direction.objective === 'whatsapp' && !userAccount?.page_id) {
  throw new Error(
    `Cannot create WhatsApp adset: page_id not configured. ` +
    `Please connect Facebook Page in settings.`
  );
}
```

3. **destination_type и promoted_object добавляются ВМЕСТЕ:**
```typescript
// После formирования adsetBody (строка 360)
if (direction.objective === 'whatsapp' && userAccount?.page_id) {
  adsetBody.destination_type = 'WHATSAPP';
  adsetBody.promoted_object = {
    page_id: String(userAccount.page_id),
    ...(whatsapp_phone_number && { whatsapp_phone_number })
  };
}
```

**Теперь логика идентична рабочим местам** (CreateCampaignWithCreative, autolaunch, creative test)

---

## Тестирование

### Автоматический тест

Создан скрипт: `test-empty-actions-fix.sh`

```bash
bash test-empty-actions-fix.sh
```

### Ручное тестирование

#### Тест 1: Пустой массив actions
```bash
curl -X POST http://localhost:3002/api/agent/actions \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "test-empty-actions",
    "account": { "userAccountId": "test-user" },
    "actions": [],
    "source": "test"
  }'

# Ожидаемый результат:
# {
#   "executionId": "no-actions-needed",
#   "executed": false,
#   "message": "No actions to execute...",
#   "actionsCount": 0
# }
```

#### Тест 2: Brain Agent в reportOnlyMode
```bash
# Brain Agent автоматически вернет actions: [] когда:
# - Реклама неактивна И были затраты вчера
# - Показатели хорошие, изменения не нужны

# Теперь не будет validation error ✅
```

#### Тест 3: WhatsApp adset через Direction.CreateAdSetWithCreatives
```bash
# С настроенным page_id:
# - destination_type и promoted_object добавляются ВМЕСТЕ
# - NO Facebook error 1870189 ✅

# БЕЗ page_id:
# - Понятная ошибка: "page_id not configured"
# - НЕ Facebook API error ✅
```

---

## Результат

### До фиксов:
- ❌ Iplant, RocketGo, Clean, Psychology: validation error при хороших показателях/reportOnlyMode
- ❌ SpaceLab, performante: Facebook error 1870189 при создании WhatsApp adsets
- ❌ Утренний крон постоянно падал с ошибками

### После фиксов:
- ✅ Brain Agent может вернуть пустой массив без ошибок
- ✅ WhatsApp adsets создаются корректно
- ✅ Понятные ошибки вместо Facebook API errors
- ✅ Утренний крон работает стабильно

---

## Файлы изменены

1. ✅ `services/agent-service/src/actions/schema.ts` - min(0) вместо min(1)
2. ✅ `services/agent-service/src/routes/actions.ts` - обработка пустого массива
3. ✅ `services/agent-service/src/workflows/createAdSetInDirection.ts` - фикс WhatsApp логики

## Дата внедрения

**2025-11-01**

Изменения критичны для стабильной работы утреннего крона Brain Agent.









