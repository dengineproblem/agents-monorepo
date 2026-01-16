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
  "custom_event_type": "CONTENT_VIEW",
  "page_id": "290307200829671",
  "whatsapp_phone_number": "77077707066"
}
```

## Уровни оптимизации

| Уровень | UI название | custom_event_type | CAPI event_name | Триггер |
|---------|-------------|-------------------|-----------------|---------|
| level_1 | Интерес | `CONTENT_VIEW` | `ViewContent` | 3+ сообщения от клиента |
| level_2 | Квалификация | `COMPLETE_REGISTRATION` | `CompleteRegistration` | Клиент квалифицирован в CRM |
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
| `services/agent-service/src/lib/campaignBuilder.ts` | `getCustomEventType()`, switch cases |
| `services/agent-service/src/routes/directions.ts` | Валидация, INSERT/UPDATE |
| `services/agent-service/src/routes/campaignBuilder.ts` | promoted_object для новой цели |
| `services/agent-service/src/routes/tusUpload.ts` | Условная передача `instagramId` |
| `services/agent-service/src/adapters/facebook.ts` | Опциональный `instagramId` |
| `services/frontend/src/components/profile/CreateDirectionDialog.tsx` | UI создания, чекбокс Instagram |
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

Формируем promoted_object для WhatsApp-конверсий (CAPI)
├── directionId
├── directionName
├── objective: whatsapp_conversions
├── optimization_level
├── custom_event_type: CONTENT_VIEW|COMPLETE_REGISTRATION|PURCHASE
├── pixel_id
├── page_id
└── has_whatsapp_number
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

## Связанная документация

- [META_CAPI_INTEGRATION.md](META_CAPI_INTEGRATION.md) — интеграция с Conversions API
- [MULTI_ACCOUNT_GUIDE.md](MULTI_ACCOUNT_GUIDE.md) — мультиаккаунтность

---

*Создано: 2026-01-16*
