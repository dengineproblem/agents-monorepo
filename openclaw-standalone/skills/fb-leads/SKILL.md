# Управление лидами

Просмотр, поиск, статистика лидов. Атрибуция по креативам и направлениям. Отвечает на "Сколько лидов сегодня?", "Покажи горячих", "Откуда лиды?".

---

## READ инструменты

### Последние лиды

```sql
SELECT
  l.name, l.phone, l.email,
  l.source_type, l.stage,
  l.created_at,
  d.name as direction,
  c.title as creative
FROM leads l
LEFT JOIN directions d ON l.direction_id = d.id
LEFT JOIN creatives c ON l.creative_id = c.id
ORDER BY l.created_at DESC
LIMIT {limit};
```

### Лиды за период

```sql
SELECT COUNT(*) as count
FROM leads
WHERE created_at >= CURRENT_DATE - INTERVAL '{days} days';
```

### По направлениям

```sql
SELECT
  d.name as direction,
  COUNT(l.id) as leads_count,
  MIN(l.created_at) as first_lead,
  MAX(l.created_at) as last_lead
FROM leads l
JOIN directions d ON l.direction_id = d.id
WHERE l.created_at >= CURRENT_DATE - INTERVAL '{days} days'
GROUP BY d.id, d.name
ORDER BY leads_count DESC;
```

### По дням

```sql
SELECT
  l.created_at::date as day,
  COUNT(*) as count
FROM leads l
WHERE l.created_at >= CURRENT_DATE - INTERVAL '{days} days'
GROUP BY day
ORDER BY day DESC;
```

### Атрибуция по креативам

```sql
SELECT
  c.title as creative,
  c.media_type,
  COUNT(l.id) as leads_count,
  c.avg_cpl_cents
FROM leads l
JOIN creatives c ON l.creative_id = c.id
WHERE l.created_at >= CURRENT_DATE - INTERVAL '{days} days'
GROUP BY c.id, c.title, c.media_type, c.avg_cpl_cents
ORDER BY leads_count DESC;
```

### По этапам воронки

```sql
SELECT stage, COUNT(*) as count
FROM leads
GROUP BY stage
ORDER BY count DESC;
```

---

## WRITE инструменты

### Обновить этап лида

```sql
UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2;
```

Этапы: `new_lead`, `contacted`, `qualified`, `consultation_booked`, `consultation_completed`, `deal_closed`, `deal_lost`

### Добавить заметку

```sql
UPDATE leads SET notes = $1, updated_at = NOW() WHERE id = $2;
```

---

## Формат ответа

```
👥 *Лиды за {период}*

📊 Всего: N лидов

*По направлениям:*
▶️ Алматы WhatsApp — N лидов
▶️ Астана LeadForms — N лидов

*Последние:*
1. 👤 Иван (+77001234567) — Алматы WhatsApp — 14:30
2. 👤 Мария (+77009876543) — Астана LeadForms — 13:15

*ТОП креативы:*
🎨 "Видео 1" — N лидов, CPL $X
🎨 "Видео 2" — N лидов, CPL $X
```
