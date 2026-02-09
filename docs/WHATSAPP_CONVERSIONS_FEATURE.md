# WhatsApp-конверсии (CAPI оптимизация)

## Обзор

Функция **WhatsApp-конверсии** позволяет создавать рекламные кампании Click-to-WhatsApp (CTWA) с оптимизацией по событиям Conversions API (CAPI). В отличие от обычной цели WhatsApp (оптимизация по переписками), эта цель оптимизируется под конкретные бизнес-события.

## Архитектура

### Facebook Marketing API

| Параметр | Значение |
|----------|----------|
| Campaign objective | `OUTCOME_SALES` |
| Ad Set optimization_goal | `OFFSITE_CONVERSIONS` |
| Ad Set billing_event | `IMPRESSIONS` |
| Ad Set destination_type | `WHATSAPP` |

### Promoted Object

```json
{
  "pixel_id": "4205947936322188",
  "custom_event_type": "COMPLETE_REGISTRATION",
  "page_id": "290307200829671",
  "whatsapp_phone_number": "77077707066"
}
```

## Уровни оптимизации

| Уровень | UI название | custom_event_type | CAPI event_name | Триггер |
|---------|-------------|-------------------|-----------------|---------|
| level_1 | Интерес | `COMPLETE_REGISTRATION` | `CompleteRegistration` | 3+ сообщения от клиента |
| level_2 | Квалификация | `ADD_TO_CART` (или `SUBSCRIBE`) | `AddToCart` (или `Subscribe`) | Клиент квалифицирован в CRM |
| level_3 | Запись/Покупка | `PURCHASE` | `Purchase` | Клиент записался или купил |

## База данных

### Миграция

```sql
-- migrations/154_add_whatsapp_conversions_objective.sql
ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS optimization_level TEXT DEFAULT 'level_1';

ALTER TABLE account_directions
ADD COLUMN IF NOT EXISTS use_instagram BOOLEAN DEFAULT true;

COMMENT ON COLUMN account_directions.optimization_level IS
  'Meta CAPI optimization level for whatsapp_conversions: level_1, level_2, level_3';

COMMENT ON COLUMN account_directions.use_instagram IS
  'Использовать Instagram аккаунт для показа рекламы. Если false - реклама показывается от имени Facebook страницы';
```

### Колонки в `account_directions`

| Колонка | Тип | Описание |
|---------|-----|----------|
| `objective` | TEXT | `whatsapp_conversions` |
| `optimization_level` | TEXT | `level_1` \| `level_2` \| `level_3` |
| `use_instagram` | BOOLEAN | Использовать Instagram аккаунт (default: true) |

## Опция Instagram аккаунта

Чекбокс **"Использовать Instagram аккаунт"** в настройках направления позволяет контролировать, от чьего имени показывается реклама в Instagram:

| Значение | Поведение |
|----------|-----------|
| `true` (по умолчанию) | Креатив создаётся с `instagram_user_id` — реклама показывается от имени Instagram Business Account |
| `false` | Креатив создаётся БЕЗ `instagram_user_id` — реклама показывается от имени Facebook Page |

### Когда использовать `use_instagram = false`

- К Facebook Page не подключён Instagram Business Account
- Ошибка `instagram_user_id must be a valid Instagram account id`
- Нужно запустить рекламу в Instagram без привязки Instagram аккаунта

## API

### Создание направления

```http
POST /api/directions
Content-Type: application/json

{
  "userAccountId": "uuid",
  "name": "Мой бизнес - WhatsApp CAPI",
  "platform": "facebook",
  "objective": "whatsapp_conversions",
  "optimization_level": "level_2",
  "use_instagram": false,
  "daily_budget_cents": 5000,
  "target_cpl_cents": 200,
  "default_settings": {
    "pixel_id": "4205947936322188",
    "cities": ["moscow"],
    "age_min": 25,
    "age_max": 55
  }
}
```

### Обновление уровня оптимизации

```http
PATCH /api/directions/:id
Content-Type: application/json

{
  "optimization_level": "level_3"
}
```

## Файлы

| Файл | Изменения |
|------|-----------|
| `migrations/154_add_whatsapp_conversions_objective.sql` | Миграция БД |
| `services/frontend/src/types/direction.ts` | TypeScript типы |
| `services/agent-service/src/lib/campaignBuilder.ts` | `getCustomEventType()`, `createAdSetInCampaign()` с objective |
| `services/agent-service/src/routes/directions.ts` | Валидация, INSERT/UPDATE |
| `services/agent-service/src/routes/campaignBuilder.ts` | promoted_object + передача objective в createAdSetInCampaign |
| `services/agent-service/src/workflows/createAdSetInDirection.ts` | promoted_object для whatsapp_conversions (Brain workflow) |
| `services/agent-service/src/routes/tusUpload.ts` | Условная передача `instagramId` |
| `services/agent-service/src/adapters/facebook.ts` | Опциональный `instagramId` |
| `services/frontend/src/components/profile/CreateDirectionDialog.tsx` | UI создания, чекбокс Instagram |
| `services/frontend/src/components/profile/DirectionsCard.tsx` | Передача `use_instagram` в API |
| `services/frontend/src/components/profile/EditDirectionDialog.tsx` | UI редактирования |

## Логирование

При создании/запуске кампании логируются:

```
Создаём направление WhatsApp-конверсии с CAPI оптимизацией
├── userAccountId
├── directionName
├── objective: whatsapp_conversions
├── optimization_level: level_1|level_2|level_3
├── fb_campaign_id
└── capi_source

Формируем promoted_object для WhatsApp-конверсий (CAPI) - manual launch
├── directionId
├── directionName
├── objective: whatsapp_conversions
├── optimization_level
├── custom_event_type: COMPLETE_REGISTRATION|ADD_TO_CART|SUBSCRIBE|PURCHASE
├── pixel_id
├── page_id
└── has_whatsapp_number

WhatsApp-conversions: setting destination_type=WHATSAPP for CAPI optimization
├── campaignId
├── name
├── objective: whatsapp_conversions
├── optimization_goal: OFFSITE_CONVERSIONS
├── destination_type: WHATSAPP
├── promoted_object_pixel_id
└── promoted_object_event_type

WhatsApp-conversions ad set: promoted_object configured for CAPI optimization (Brain workflow)
├── directionId
├── directionName
├── objective: whatsapp_conversions
├── optimization_level
├── pixel_id
├── pixel_source: direction|defaultSettings
├── custom_event_type
├── page_id
├── whatsapp_phone_number
└── destination_type: WHATSAPP

Final ad set parameters before Facebook API call
├── campaignId
├── name
├── objective
├── optimization_goal
├── destination_type
├── promoted_object
├── pixel_id
├── custom_event_type
└── targeting_automation
```

## Требования

1. **Meta Pixel обязателен** — без pixel_id запуск рекламы невозможен
2. **CAPI интеграция** — события должны отправляться через Conversions API
3. **WhatsApp Business** — номер должен быть подключен к Facebook Page

## Валидация

При запуске рекламы без pixel_id:
- Auto-launch: направление пропускается с предупреждением
- Manual launch: возвращается ошибка 400

```
WhatsApp-конверсии требуют настроенный Meta Pixel. Добавьте Pixel в настройках направления.
```

## Исправленные баги (2026-01-16)

### 1. Чекбокс use_instagram не сохранялся при создании направления

**Проблема:** При создании направления через UI, чекбокс "Использовать Instagram аккаунт" игнорировался — в БД всегда записывалось `true`.

**Причина:** В `DirectionsCard.tsx` поле `use_instagram` не передавалось в API payload.

**Решение:** Добавлена передача поля в `handleCreate`:
```typescript
...(data.use_instagram !== undefined && { use_instagram: data.use_instagram }),
```

### 2. destination_type "сайт" вместо "WhatsApp"

**Проблема:** При создании группы объявлений для `whatsapp_conversions` место получения конверсии устанавливалось как "сайт" вместо "WhatsApp".

**Причина:**
1. В `createAdSetInDirection.ts` отсутствовал блок для формирования `promoted_object` для `whatsapp_conversions`
2. В `routes/campaignBuilder.ts` не передавался параметр `objective` в функцию `createAdSetInCampaign`

**Решение:**
1. Добавлен блок обработки `whatsapp_conversions` в `createAdSetInDirection.ts` с полным `promoted_object`
2. Добавлена передача `objective: direction.objective` в обоих вызовах `createAdSetInCampaign` (auto-launch и manual launch)

**Эталонные параметры Ad Set (из кампании 120237359222880784):**
```json
{
  "optimization_goal": "OFFSITE_CONVERSIONS",
  "billing_event": "IMPRESSIONS",
  "destination_type": "WHATSAPP",
  "promoted_object": {
    "pixel_id": "4205947936322188",
    "custom_event_type": "COMPLETE_REGISTRATION",
    "page_id": "290307200829671",
    "whatsapp_phone_number": "77077707066"
  }
}
```

## Связанная документация

- [META_CAPI_INTEGRATION.md](META_CAPI_INTEGRATION.md) — интеграция с Conversions API
- [MULTI_ACCOUNT_GUIDE.md](MULTI_ACCOUNT_GUIDE.md) — мультиаккаунтность

---

*Создано: 2026-01-16*
*Обновлено: 2026-01-16 — исправлены баги use_instagram и destination_type*
