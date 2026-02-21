# Тестирование креативов

Запуск A/B тестов новых креативов: $20 бюджет, автоостановка на 1000 показов, анализ результатов. Отвечает на "Протестируй этот креатив", "Результаты теста".

---

## Workflow запуска теста

### Шаг 1: Проверить креатив

```sql
SELECT * FROM creatives WHERE id = '{creative_id}' AND status = 'ready';
SELECT * FROM creative_tests WHERE creative_id = '{creative_id}';
```

Если тест уже существует — сообщи статус, не создавай дубликат.

### Шаг 2: Получить конфигурацию

```sql
SELECT fb_access_token, fb_ad_account_id, fb_page_id, fb_instagram_id FROM config WHERE id = 1;
SELECT * FROM directions WHERE id = '{direction_id}';
```

### Шаг 3: Создать тестовую кампанию

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/campaigns" \
  -d "name=ТЕСТ | {creative_title} | {date}" \
  -d "objective={fb_objective}" \
  -d "status=PAUSED" \
  -d "special_ad_categories=[]" \
  -d "access_token={token}"
```

### Шаг 4: Создать адсет ($20 бюджет)

Используй таргетинг из направления.

### Шаг 5: Создать объявление

С креативом из базы.

### Шаг 6: Создать Facebook Auto Rule

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_account_id}/adrules_library" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Auto-stop {creative_title}",
    "evaluation_spec": {
      "evaluation_type": "TRIGGER",
      "filters": [
        { "field": "impressions", "value": 1000, "operator": "GREATER_THAN" },
        { "field": "entity_type", "value": "ADSET", "operator": "EQUAL" }
      ]
    },
    "execution_spec": { "execution_type": "PAUSE" },
    "schedule_spec": { "schedule_type": "SEMI_HOURLY" }
  }' \
  "?access_token={token}"
```

### Шаг 7: Активировать и сохранить

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{campaign_id}?status=ACTIVE&access_token={token}"
```

```sql
INSERT INTO creative_tests (creative_id, campaign_id, adset_id, ad_id, rule_id, test_budget_cents, objective, status, started_at)
VALUES ($1, $2, $3, $4, $5, 2000, $6, 'running', NOW());
```

---

## Проверка результатов

### Прочитать метрики теста

```bash
curl -s "https://graph.facebook.com/v23.0/{adset_id}/insights?fields=impressions,reach,spend,clicks,link_clicks,actions,ctr,cpm,frequency,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions&date_preset=maximum&access_token={token}"
```

### Обновить результаты

```sql
UPDATE creative_tests SET
  status = 'completed',
  completed_at = NOW(),
  impressions = $1,
  clicks = $2,
  leads = $3,
  spend_cents = $4,
  ctr = $5,
  cpl_cents = $6,
  video_views = $7,
  video_avg_watch_time_sec = $8
WHERE id = $9;
```

### AI-анализ результатов

Оцени креатив по шкале 0-100:
- **excellent (80-100)**: CPL ≤ 70% target, CTR > 2%, хорошее удержание видео
- **good (60-79)**: CPL ≤ target, CTR > 1%
- **average (40-59)**: CPL 1-1.5x target
- **poor (0-39)**: CPL > 1.5x target, CTR < 0.5%

```sql
UPDATE creative_tests SET
  llm_score = $1,
  llm_verdict = $2,
  llm_reasoning = $3
WHERE id = $4;
```

---

## Формат ответа

**Запуск:**
```
🧪 *Тест запущен*

🎨 Креатив: {title}
💰 Бюджет: $20
🎯 Лимит: 1000 показов
📁 Направление: {direction}

Автоостановка настроена. Результаты через 4-8 часов.
```

**Результаты:**
```
🧪 *Результат теста*

🎨 Креатив: {title}
📊 Показы: 1,024
👥 Лидов: 3
💰 Потрачено: $6.50
🎯 CPL: $2.17 (target: $3.00)
📈 CTR: 1.8%

✅ Вердикт: *good* (72/100)
💡 Креатив показывает хорошие результаты, CPL ниже таргета. Рекомендую добавить в основные кампании.
```
