---
name: Manual Launch — добавление креативов в существующие активные адсеты
date: 2026-04-23
status: approved
---

# Manual Launch: добавление креативов в существующие активные адсеты

## Цель

В модалке "Запуск рекламы" дать пользователю режим, в котором новые креативы добавляются как Ads в **уже работающие** активные адсеты направления, без изменения настроек самих адсетов (бюджет, таргетинг, optimization_goal не трогаем).

## Архитектура

### Frontend (`ManualLaunchDialog.tsx`)

Глобальный тумблер сверху модалки:
- **«Создать новые адсеты»** — текущее поведение (без изменений).
- **«Добавить в существующие»** — новый режим.

В новом режиме:
- При выборе направления подгружается live-список активных адсетов через FB API.
- Отображается `имя адсета · $X/день · N объявлений` + чекбокс мультивыбора и `Выбрать все`.
- Адсет, который превысит лимит 50 ads после добавления, дизейблится с подсказкой «осталось K слотов».
- Один общий пул креативов (как в текущем режиме). Каждый выбранный креатив добавляется в каждый выбранный адсет (декартово произведение).
- Empty state: «В этом направлении нет активных адсетов» + кнопка переключения обратно.
- Поля бюджета и времени старта скрыты (не применимы).

### Backend

#### `GET /api/campaign-builder/direction/:direction_id/active-adsets`

- Достаёт `direction.fb_campaign_id` и credentials.
- Запрос в FB: `GET /{campaign_id}/adsets?effective_status=['ACTIVE']&fields=id,name,daily_budget,optimization_goal`.
- Для каждого адсета подтягивает `ads_count` из `direction_adsets` (если записи нет — `0`).
- Возвращает: `{ adsets: [{ fb_adset_id, name, daily_budget, optimization_goal, ads_count }] }`.

#### `POST /api/campaign-builder/manual-launch-existing`

Тело:
```json
{
  "user_account_id": "uuid",
  "account_id": "uuid|null",
  "direction_id": "uuid",
  "creative_ids": ["uuid", ...],
  "target_adset_ids": ["fb_adset_id", ...]
}
```

Логика:
1. Валидация direction (active, fb_campaign_id есть) + креативов (status=ready, direction_id совпадает).
2. Для каждого `creative_id` — `buildAdCreative()` (immutable FB AdCreative пересобираем на лету, как в `workflowCreateAdSetInDirection`).
3. Для каждой пары `(adset, creative)` — собираем batch-запрос на создание `ads` через `graphBatch` (один общий батч на весь запрос). Имя ad: `{direction.name} - {creative.title} {idx}`.
4. После создания записываем `ad_creative_mapping` батчем (`source: 'direction_launch'`, с `adset_id` и `campaign_id`).
5. Для каждого адсета upsert в `direction_adsets`:
   - Если запись есть — RPC `increment_ads_count(fb_adset_id, +created_count)`.
   - Если нет — INSERT новой записи `{ direction_id, fb_adset_id, adset_name, status: 'ACTIVE', ads_count: created_count }`, чтобы трекать дальше.
6. Возврат: `{ success, adsets_used, total_ads, results: [{ fb_adset_id, ads_created, ads: [...], errors? }] }`.

## Маппинг таблиц

| Таблица | Запись |
|---|---|
| `ad_creative_mapping` | INSERT по 1 строке на каждое созданное Ad — `ad_id, user_creative_id, direction_id, user_id, account_id, adset_id, campaign_id, fb_creative_id, source='direction_launch'`. Дубликаты на `ad_id` игнорируются (UNIQUE). |
| `direction_adsets` | UPSERT: если адсет ещё не известен — создаём запись. Иначе атомарно инкрементим `ads_count` через RPC. Поля `daily_budget_cents`/`status` синхронизируем по данным из FB. |
| `account_directions` | Не трогаем. |
| `user_creatives` | Только чтение (валидация). |

## Edge cases

- **Адсет в БД отсутствует** (создан в Ads Manager): создаём запись на лету с актуальным `daily_budget_cents` и `status='ACTIVE'`.
- **Лимит 50 ads на адсет**: проверяем `current_ads + creatives.length > 50` для каждого адсета — возвращаем 400 если превышение.
- **Креатив не привязан к direction**: warn, но не блокируем (как в текущем workflow).
- **FB API rate limit / частичные failures**: считаем по результатам batch-ответа, возвращаем частичный успех с `errors[]`.
- **TikTok**: пока только Facebook (TikTok-оптимизация выходит за scope).

## Что НЕ делаем (out of scope)

- Не трогаем `manual-launch-multi` и `workflowCreateAdSetInDirection`.
- Не вводим per-adset distribution (только единый пул).
- Не делаем edit настроек существующего адсета.
- Не поддерживаем TikTok в этом режиме.
- Не пишем юнит-тесты (пользователь явно попросил быстро доделать без лишнего).
