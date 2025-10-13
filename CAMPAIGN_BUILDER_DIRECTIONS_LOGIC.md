# Campaign Builder: Логика работы с направлениями

## ❌ Текущая (неправильная) логика:

```
POST /api/campaign-builder/auto-launch
{ userId, objective }
↓
Ищет креативы БЕЗ direction_id (legacy)
↓
Создаёт НОВУЮ кампанию
↓
Создаёт ad sets в новой кампании
```

**Проблема:** Не работает с направлениями!

---

## ✅ Правильная логика:

```
POST /api/campaign-builder/auto-launch
{ userId, objective }
↓
1. Найти все АКТИВНЫЕ направления с этим objective
   WHERE objective = 'whatsapp' AND is_active = true
↓
2. Для КАЖДОГО направления:
   a) Найти креативы этого направления (direction_id = X)
   b) Если креативов нет → ПРОПУСТИТЬ это направление
   c) Взять бюджет направления (daily_budget_cents)
   d) Взять дефолтные настройки направления
   e) Взять fb_campaign_id направления (кампания УЖЕ существует!)
   f) Создать ad sets ВНУТРИ существующей кампании
↓
3. Вернуть результат по всем направлениям
```

---

## Пример запроса:

```javascript
POST /api/campaign-builder/auto-launch
{
  "userId": "uuid",
  "objective": "whatsapp"
}
```

---

## Пример ответа:

```json
{
  "success": true,
  "results": [
    {
      "direction_id": "uuid-1",
      "direction_name": "Имплантация",
      "campaign_id": "123456",
      "adsets_created": [
        {
          "adset_id": "789",
          "daily_budget_cents": 5000,
          "creatives": ["creative-1", "creative-2"]
        }
      ]
    },
    {
      "direction_id": "uuid-2",
      "direction_name": "Виниры",
      "campaign_id": "654321",
      "adsets_created": [
        {
          "adset_id": "987",
          "daily_budget_cents": 3000,
          "creatives": ["creative-3"]
        }
      ]
    },
    {
      "direction_id": "uuid-3",
      "direction_name": "Брекеты",
      "skipped": true,
      "reason": "No ready creatives for this direction"
    }
  ]
}
```

---

## Алгоритм (псевдокод):

```typescript
async function autoLaunch(userId: string, objective: string) {
  // 1. Получить все активные направления с этим objective
  const directions = await supabase
    .from('account_directions')
    .select('*')
    .eq('user_account_id', userId)
    .eq('objective', objective)
    .eq('is_active', true);

  const results = [];

  // 2. Для каждого направления
  for (const direction of directions) {
    // 2a. Найти креативы этого направления
    const creatives = await supabase
      .from('user_creatives')
      .select('*')
      .eq('user_id', userId)
      .eq('direction_id', direction.id)
      .eq('status', 'ready');

    // 2b. Если нет креативов → пропустить
    if (creatives.length === 0) {
      results.push({
        direction_id: direction.id,
        direction_name: direction.name,
        skipped: true,
        reason: 'No ready creatives'
      });
      continue;
    }

    // 2c-d. Взять бюджет и настройки направления
    const budget = direction.daily_budget_cents;
    const defaultSettings = await getDefaultSettings(direction.id);

    // 2e. Взять существующую кампанию направления
    const campaignId = direction.fb_campaign_id;

    // 2f. Создать ad sets в существующей кампании
    const adsets = await createAdSetsInCampaign({
      campaignId,
      creatives,
      budget,
      defaultSettings,
      objective
    });

    results.push({
      direction_id: direction.id,
      direction_name: direction.name,
      campaign_id: campaignId,
      adsets_created: adsets
    });
  }

  return { success: true, results };
}
```

---

## Ключевые отличия:

### Старая логика (legacy):
- ❌ Создаёт НОВУЮ кампанию
- ❌ Ищет креативы БЕЗ direction_id
- ❌ Один запрос = одна кампания

### Новая логика (с направлениями):
- ✅ Использует СУЩЕСТВУЮЩИЕ кампании (fb_campaign_id)
- ✅ Ищет креативы С direction_id
- ✅ Один запрос = ad sets в НЕСКОЛЬКИХ кампаниях (по одной на направление)

---

## Что нужно изменить:

1. **`/api/campaign-builder/auto-launch`:**
   - Убрать параметр `direction_id` (не нужен)
   - Добавить логику поиска всех активных направлений
   - Цикл по направлениям

2. **`getAvailableCreatives()`:**
   - Оставить как есть (уже работает с direction_id)

3. **`buildCampaignAction()`:**
   - Изменить: не создавать новую кампанию
   - Использовать существующий `fb_campaign_id` из направления

4. **Новая функция `createAdSetsInCampaign()`:**
   - Создаёт ad sets в существующей кампании
   - Использует дефолтные настройки направления

---

## Обратная совместимость (legacy):

Если у пользователя НЕТ активных направлений:
- Ищем креативы с `direction_id = null`
- Создаём НОВУЮ кампанию (старая логика)
- Используем глобальные настройки из `user_accounts`

---

## Приоритет:

1. **Если есть активные направления с objective** → используем новую логику
2. **Если нет направлений** → используем legacy логику

---

## Статус:

❌ **Требует реализации**

Текущий Campaign Builder не поддерживает эту логику.
Нужно переделать `/api/campaign-builder/auto-launch`.

