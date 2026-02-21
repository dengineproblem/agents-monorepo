# Дашборд Facebook рекламы

Отвечает на вопросы "Как дела с рекламой?", "Покажи метрики", "Сколько потратили".

---

## READ инструменты

### Общая сводка за период

```sql
SELECT
  SUM(spend) as total_spend,
  SUM(leads) as total_leads,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  CASE WHEN SUM(leads) > 0 THEN ROUND(SUM(spend) / SUM(leads), 2) ELSE NULL END as avg_cpl,
  CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks)::decimal / SUM(impressions) * 100, 2) ELSE 0 END as avg_ctr,
  CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) ELSE 0 END as avg_cpm
FROM metrics_history
WHERE date >= CURRENT_DATE - INTERVAL '{days} days';
```

Подставляй `{days}`: 1 (вчера), 3, 7, 30.

### Метрики по направлениям

```sql
SELECT
  d.name as direction,
  d.objective,
  d.target_cpl_cents,
  SUM(m.spend) as spend,
  SUM(m.leads) as leads,
  CASE WHEN SUM(m.leads) > 0 THEN ROUND(SUM(m.spend) / SUM(m.leads), 2) ELSE NULL END as cpl,
  SUM(m.impressions) as impressions
FROM metrics_history m
JOIN directions d ON m.campaign_id = d.fb_campaign_id
WHERE m.date >= CURRENT_DATE - INTERVAL '{days} days'
  AND d.is_active = true
GROUP BY d.id, d.name, d.objective, d.target_cpl_cents
ORDER BY spend DESC;
```

### Последние Health Score по адсетам

```sql
SELECT
  sh.adset_name,
  sh.health_score,
  sh.health_class,
  sh.ecpl_cents,
  sh.action_type,
  d.name as direction,
  d.target_cpl_cents
FROM scoring_history sh
JOIN directions d ON sh.direction_id = d.id
WHERE sh.date = (SELECT MAX(date) FROM scoring_history)
ORDER BY sh.health_score DESC;
```

### ТОП креативов по CPL

```sql
SELECT
  c.title,
  c.media_type,
  c.total_spend_cents,
  c.total_leads,
  c.avg_cpl_cents,
  c.avg_ctr,
  c.performance_class
FROM creatives c
WHERE c.status = 'ready' AND c.total_leads > 0
ORDER BY c.avg_cpl_cents ASC
LIMIT 10;
```

### Курс валют

```sql
SELECT rate FROM currency_rates WHERE from_currency = 'USD' AND to_currency = 'KZT';
```

### Лиды за сегодня/вчера

```sql
SELECT COUNT(*) as count, source_type
FROM leads
WHERE created_at >= CURRENT_DATE - INTERVAL '{days} days'
GROUP BY source_type;
```

---

## Формат ответа

Компактная Telegram-карточка:

```
📊 *Реклама за {период}*

💰 Потрачено: $X (Y тенге)
👥 Лидов: N
🎯 CPL: $X (Y тенге)
📈 CTR: X%
📊 CPM: $X

*По направлениям:*
▶️ Алматы WhatsApp — $X, N лидов, CPL $X ✅
▶️ Астана LeadForms — $X, N лидов, CPL $X ⚠️

*Health Score:*
🟢 very_good: N адсетов
🔵 good: N
⚪ neutral: N
🟡 slightly_bad: N
🔴 bad: N
```

Используй эмодзи:
- ✅ CPL ≤ target
- ⚠️ CPL > target но < 2x
- ❌ CPL > 2x target
- 📈 рост vs прошлый период
- 📉 падение vs прошлый период

Конвертируй $ в тенге через курс из `currency_rates`.
