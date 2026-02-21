# Создание Facebook кампаний

Создание Campaign → AdSet → Ad, загрузка креативов (видео/изображения) в Facebook. Отвечает на "Запусти кампанию", "Загрузи видео", "Создай адсет".

---

## Конфигурация

```sql
SELECT fb_access_token, fb_ad_account_id, fb_page_id, fb_instagram_id FROM config WHERE id = 1;
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

### 1. Загрузка видео в Facebook

**Для видео < 50 МБ:**

```bash
curl -s -X POST "https://graph-video.facebook.com/v23.0/{ad_account_id}/advideos" \
  -F "source=@{file_path}" \
  -F "title={title}" \
  -F "access_token={token}"
```

Возвращает: `{ "id": "video_id" }`

**Для видео > 50 МБ (chunked upload):**

```bash
# Шаг 1: Start
curl -s -X POST "https://graph-video.facebook.com/v23.0/{ad_account_id}/advideos" \
  -F "upload_phase=start" \
  -F "file_size={bytes}" \
  -F "access_token={token}"
# → { upload_session_id, video_id, start_offset, end_offset }

# Шаг 2: Transfer (повторять для каждого чанка)
curl -s -X POST "https://graph-video.facebook.com/v23.0/{ad_account_id}/advideos" \
  -F "upload_phase=transfer" \
  -F "upload_session_id={session_id}" \
  -F "start_offset={offset}" \
  -F "video_file_chunk=@{chunk_path}" \
  -F "access_token={token}"

# Шаг 3: Finish
curl -s -X POST "https://graph-video.facebook.com/v23.0/{ad_account_id}/advideos" \
  -F "upload_phase=finish" \
  -F "upload_session_id={session_id}" \
  -F "access_token={token}"
```

### 2. Загрузка изображения

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/adimages" \
  -F "filename=@{file_path}" \
  -F "access_token={token}"
```

Возвращает: `{ "images": { "filename": { "hash": "abc123", "url": "..." } } }`

### 3. Создание креатива (WhatsApp видео)

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/adcreatives" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "{creative_name}",
    "object_story_spec": {
      "page_id": "{page_id}",
      "video_data": {
        "video_id": "{fb_video_id}",
        "message": "{ad_text}",
        "call_to_action": {
          "type": "WHATSAPP_MESSAGE",
          "value": { "app_destination": "WHATSAPP" }
        }
      }
    }
  }' \
  "?access_token={token}"
```

Для других objective меняй `call_to_action.type`:
- WhatsApp: `WHATSAPP_MESSAGE`
- Lead Forms: `SIGN_UP` + `lead_gen_form_id`
- Instagram Traffic: `LEARN_MORE` + `link`
- Site Leads: `LEARN_MORE` + `link`

### 4. Создание кампании

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

### 5. Создание адсета

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

### 6. Создание объявления

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

-- Креатив
INSERT INTO creatives (title, media_type, file_path, fb_video_id, fb_image_hash, status, direction_id)
VALUES ($1, $2, $3, $4, $5, 'ready', $6) RETURNING id;

-- Маппинг
INSERT INTO ad_creative_mapping (ad_id, creative_id, direction_id, adset_id, campaign_id, source)
VALUES ($1, $2, $3, $4, $5, 'campaign_builder');
```

---

## Workflow

1. Пользователь: "Запусти кампанию на Алмату с видео /uploads/video.mp4"
2. Прочитай config (токены, page_id)
3. Загрузи видео в Facebook → получи video_id
4. Создай креатив (adcreatives) → получи creative_id
5. Создай кампанию → campaign_id
6. Создай адсет(ы) с таргетингом → adset_id
7. Создай объявление → ad_id
8. Сохрани всё в БД
9. Активируй кампанию: `POST {campaign_id}?status=ACTIVE`
10. Сообщи результат

⚠️ Спроси подтверждение перед запуском (бюджет, таргетинг, текст).
