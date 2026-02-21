# Отчёты по рекламе

Ежедневные и еженедельные отчёты, утренний брифинг. Отвечает на "Утренний отчёт", "Отчёт за неделю", "Сравни с прошлой неделей".

---

## Утренний брифинг (ежедневный крон)

### Шаг 1: Метрики за вчера

```sql
SELECT
  SUM(spend) as spend,
  SUM(leads) as leads,
  SUM(impressions) as impressions,
  SUM(clicks) as clicks,
  CASE WHEN SUM(leads) > 0 THEN ROUND(SUM(spend) / SUM(leads), 2) END as cpl,
  CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks)::decimal / SUM(impressions) * 100, 2) END as ctr
FROM metrics_history
WHERE date = CURRENT_DATE - 1;
```

### Шаг 2: Сравнение с позавчера

```sql
SELECT
  SUM(spend) as spend, SUM(leads) as leads,
  CASE WHEN SUM(leads) > 0 THEN ROUND(SUM(spend) / SUM(leads), 2) END as cpl
FROM metrics_history
WHERE date = CURRENT_DATE - 2;
```

### Шаг 3: По направлениям

```sql
SELECT
  d.name, d.target_cpl_cents,
  SUM(m.spend) as spend,
  SUM(m.leads) as leads,
  CASE WHEN SUM(m.leads) > 0 THEN ROUND(SUM(m.spend) / SUM(m.leads), 2) END as cpl
FROM metrics_history m
JOIN directions d ON m.campaign_id = d.fb_campaign_id
WHERE m.date = CURRENT_DATE - 1 AND d.is_active = true
GROUP BY d.id, d.name, d.target_cpl_cents
ORDER BY spend DESC;
```

### Шаг 4: Health Score summary

```sql
SELECT
  health_class,
  COUNT(*) as count
FROM scoring_history
WHERE date = (SELECT MAX(date) FROM scoring_history)
GROUP BY health_class;
```

### Шаг 5: Лиды за вчера

```sql
SELECT COUNT(*) FROM leads WHERE created_at::date = CURRENT_DATE - 1;
```

### Шаг 6: Проблемы

```sql
-- Адсеты с bad HS
SELECT adset_name, health_score, ecpl_cents, direction_id
FROM scoring_history
WHERE date = (SELECT MAX(date) FROM scoring_history)
  AND health_class = 'bad';

-- Пожиратели (из последнего скоринга)
SELECT adset_name, health_score, spend_cents, ecpl_cents
FROM scoring_history
WHERE date = (SELECT MAX(date) FROM scoring_history)
  AND health_class IN ('bad', 'slightly_bad')
  AND ecpl_cents > (SELECT target_cpl_cents * 3 FROM directions d WHERE d.id = scoring_history.direction_id);
```

### Шаг 7: Курс

```sql
SELECT rate FROM currency_rates WHERE from_currency = 'USD' AND to_currency = 'KZT';
```

---

## Формат утреннего брифинга

```
🌅 *Утренний брифинг | {дата}*

💰 Потрачено: $X (Y тенге)
👥 Лидов: N (вчера N, {±X%})
🎯 CPL: $X (target: $Y) {✅/⚠️/❌}
📈 CTR: X%
📊 CPM: $X

*По направлениям:*
▶️ Алматы WhatsApp — $X, N лидов, CPL $X ✅
▶️ Астана LeadForms — $X, N лидов, CPL $X ⚠️

*Health Score:*
🟢 very_good: N | 🔵 good: N | ⚪ neutral: N | 🟡 slightly_bad: N | 🔴 bad: N

*Проблемы:*
⚠️ Адсет "X" — HS: -30 (bad), CPL $8 (target $3) — рекомендую паузу
❌ Пожиратель в "Y" — потратил $15, 0 лидов

💡 *Рекомендации:*
1. Поставить на паузу адсет "X"
2. Проверить креатив в "Y"

💱 Курс: $1 = {rate} тенге
```

---

## Еженедельный отчёт

### Текущая неделя vs прошлая

```sql
WITH current_week AS (
  SELECT SUM(spend) as spend, SUM(leads) as leads, SUM(impressions) as impressions
  FROM metrics_history
  WHERE date >= date_trunc('week', CURRENT_DATE)
),
last_week AS (
  SELECT SUM(spend) as spend, SUM(leads) as leads, SUM(impressions) as impressions
  FROM metrics_history
  WHERE date >= date_trunc('week', CURRENT_DATE) - 7
    AND date < date_trunc('week', CURRENT_DATE)
)
SELECT
  cw.spend as this_spend, cw.leads as this_leads,
  lw.spend as last_spend, lw.leads as last_leads,
  ROUND((cw.spend - lw.spend) / NULLIF(lw.spend, 0) * 100, 1) as spend_change_pct,
  ROUND((cw.leads - lw.leads)::decimal / NULLIF(lw.leads, 0) * 100, 1) as leads_change_pct
FROM current_week cw, last_week lw;
```

### ТОП и BOTTOM адсеты за неделю

```sql
SELECT
  adset_name,
  ROUND(AVG(health_score)) as avg_hs,
  mode() WITHIN GROUP (ORDER BY health_class) as main_class
FROM scoring_history
WHERE date >= date_trunc('week', CURRENT_DATE)
GROUP BY adset_id, adset_name
ORDER BY avg_hs DESC;
```

---

## Формат еженедельного отчёта

```
📊 *Недельный отчёт | {week_start} — {week_end}*

*Сравнение с прошлой неделей:*
💰 Бюджет: $X → $Y ({±Z%})
👥 Лиды: N → M ({±Z%})
🎯 CPL: $X → $Y ({±Z%})

*ТОП адсеты:*
🥇 "Адсет 1" — HS: +35, CPL: $2.10
🥈 "Адсет 2" — HS: +22, CPL: $2.80
🥉 "Адсет 3" — HS: +18, CPL: $3.10

*Проблемные:*
⚠️ "Адсет X" — HS: -15, CPL: $5.50

*Общий итог:*
{2-3 предложения: что было хорошо, что плохо, что делать на следующей неделе}
```
