# Создание Facebook кампаний

Создание Campaign → AdSet → Ad из уже загруженных креативов. Отвечает на "Запусти кампанию", "Создай адсет".

---

## Конфигурация

```sql
SELECT fb_access_token, fb_ad_account_id, fb_page_id, fb_instagram_id FROM config WHERE id = 1;
```

---

## Загрузка креативов

Креативы загружаются пользователем через upload page. При загрузке пользователь выбирает направление, сервис автоматически:
1. Загружает видео/изображение в Facebook
2. Создаёт FB creative
3. Сохраняет все ID в таблицу `creatives`

**Для создания кампании используй готовые креативы:**

```sql
SELECT c.id, c.title, c.media_type, c.fb_video_id, c.fb_creative_id,
       d.name AS direction_name, d.objective
FROM creatives c
JOIN directions d ON d.id = c.direction_id
WHERE c.status = 'ready'
ORDER BY c.created_at DESC;
```

---

## Objective mapping

| Направление | FB Objective | optimization_goal | billing_event |
|-------------|-------------|------------------|---------------|
| whatsapp | OUTCOME_ENGAGEMENT | CONVERSATIONS | IMPRESSIONS |
| lead_forms | OUTCOME_LEADS | LEAD_GENERATION | IMPRESSIONS |
| site_leads | OUTCOME_LEADS | OFFSITE_CONVERSIONS | IMPRESSIONS |
| instagram_traffic | OUTCOME_TRAFFIC | LINK_CLICKS | IMPRESSIONS |
| app_installs | OUTCOME_APP_PROMOTION | APP_INSTALLS | IMPRESSIONS |

---

## WRITE инструменты

### 1. Создание кампании

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/campaigns" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "{campaign_name}",
    "objective": "{fb_objective}",
    "status": "PAUSED",
    "special_ad_categories": []
  }' \
  "?access_token={token}"
```

### 2. Создание адсета

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/adsets" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "{adset_name}",
    "campaign_id": "{campaign_id}",
    "daily_budget": {budget_cents},
    "billing_event": "IMPRESSIONS",
    "optimization_goal": "{optimization_goal}",
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "status": "PAUSED",
    "start_time": "{iso_datetime}",
    "targeting": {
      "age_min": 18,
      "age_max": 65,
      "genders": [0],
      "geo_locations": {
        "cities": [{"key": "777934", "radius": 0, "distance_unit": "kilometer"}]
      },
      "publisher_platforms": ["facebook", "instagram"],
      "facebook_positions": ["feed", "story", "reel"],
      "instagram_positions": ["stream", "story", "reels"]
    }
  }' \
  "?access_token={token}"
```

### 3. Создание объявления

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/ads" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "{ad_name}",
    "adset_id": "{adset_id}",
    "creative": { "creative_id": "{fb_creative_id}" },
    "status": "ACTIVE"
  }' \
  "?access_token={token}"
```

**ВАЖНО:** `fb_creative_id` бери из таблицы `creatives` — поле `fb_creative_id`.

---

## Распределение бюджета по адсетам

```
$10-19 → 1 адсет
$20-29 → 2 адсета
$30-39 → 3 адсета
$40+   → floor(budget / 10) адсетов

Сумма бюджетов адсетов = бюджет направления
```

---

## Ограничения

- **Бюджет нового адсета:** $10-$20
- **Не создавать адсеты после 18:00 по Алматы** (UTC+5)
- Проверь текущее время:
  ```javascript
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', hour: 'numeric', hour12: false }).format(new Date())
  ```

---

## Сохранение в БД

После создания сохрани:

```sql
-- Направление (если новое)
INSERT INTO directions (name, objective, fb_campaign_id, daily_budget_cents, target_cpl_cents, targeting)
VALUES ($1, $2, $3, $4, $5, $6);

-- Адсет
INSERT INTO direction_adsets (direction_id, fb_adset_id, adset_name, daily_budget_cents)
VALUES ($1, $2, $3, $4);

-- Маппинг ad → creative
INSERT INTO ad_creative_mapping (ad_id, creative_id, direction_id, adset_id, campaign_id, fb_creative_id, source)
VALUES ($1, $2, $3, $4, $5, $6, 'campaign_builder');
```

---

## Workflow

1. Пользователь: "Запусти кампанию на направление X"
2. Прочитай config (токены, page_id)
3. Найди готовые креативы: `SELECT * FROM creatives WHERE status = 'ready' AND direction_id = ...`
4. Если креативов нет — предложи загрузить через upload page
5. Создай кампанию → campaign_id
6. Создай адсет(ы) с таргетингом → adset_id
7. Создай объявление(я) с fb_creative_id из creatives → ad_id
8. Сохрани маппинг в ad_creative_mapping
9. Активируй кампанию: `POST {campaign_id}?status=ACTIVE`
10. Сообщи результат
