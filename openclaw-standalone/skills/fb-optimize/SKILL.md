# Оптимизация Facebook рекламы

Управление бюджетами, пауза/запуск адсетов, определение пожирателей бюджета (ad-eaters). Отвечает на "Поставь на паузу дорогие", "Увеличь бюджет", "Покажи пожирателей".

---

## Health Score формула

### Компоненты

**1. CPL Gap (вес: 45 баллов)**

```
target = direction.target_cpl_cents
ratio = eCPL_yesterday / target

ratio ≤ 0.7:  +45  (≥30% дешевле плана)
ratio ≤ 0.9:  +30  (10-30% дешевле)
ratio ≤ 1.1:  +10  (в пределах ±10%)
ratio ≤ 1.3:  -30  (10-30% дороже)
ratio > 1.3:  -45  (≥30% дороже)

Особые случаи:
- 0 лидов, spend ≥ 2x target → -45
- 0 лидов, spend < 2x target → 0 (мало данных)
```

Для **instagram_traffic** вместо CPL используй CPC (spend / link_clicks).

**2. Тренды (до ±15 баллов)**

```
Если eCPL_3d < eCPL_7d:       +15 (улучшение)
Если eCPL_3d > eCPL_7d * 1.1: -7.5 (ухудшение)

Если eCPL_7d < eCPL_30d:       +15
Если eCPL_7d > eCPL_30d * 1.1: -7.5
```

**3. Диагностика (до -30 баллов)**

```
CTR < 1%:              -8  (слабый креатив)
CPM > медиана * 1.3:   -12 (дорогой аукцион)
Frequency > 2:         -10 (выгорание аудитории)
```

**4. Today-компенсация**

Применяется если today impressions ≥ 300:

```
Вчера были лиды, сегодня есть:
  eCPL_today ≤ 0.5 × eCPL_yesterday → ПОЛНАЯ компенсация + 15 бонус
  eCPL_today ≤ 0.7 × eCPL_yesterday → 60% компенсация + 10
  eCPL_today ≤ 0.9 × eCPL_yesterday → +5 бонус

Вчера 0 лидов, сегодня есть (сравни с target):
  todayRatio ≤ 0.7 → полное восстановление + 15
  todayRatio ≤ 1.0 → 70% восстановление + 10
  todayRatio ≤ 1.3 → 30% восстановление
```

**5. Volume Factor (множитель доверия)**

```
impressions ≥ 1000:              factor = 1.0
impressions ≤ 100:               factor = 0.6
100 < impressions < 1000:        factor = 0.6 + 0.4 × (impressions - 100) / 900

finalScore = rawScore × factor
```

**6. Классификация**

```
score ≥ 25:   'very_good'
score ≥ 5:    'good'
score ≥ -5:   'neutral'
score ≥ -25:  'slightly_bad'
score < -25:  'bad'
```

---

## Ad-Eater Detection (пожиратели бюджета)

Объявление — пожиратель если:

```
spend ≥ $3  И  impressions ≥ 300  И (
  CPL > 3× target_cpl_cents     (КРИТИЧНО)
  ИЛИ
  spend > 50% бюджета адсета И leads = 0    (НЕМЕДЛЕННАЯ ПАУЗА)
)
```

---

## Матрица действий

| HS Класс | Действие | Бюджет |
|----------|----------|--------|
| very_good (≥25) | Масштабировать | +10..+30% |
| good (5-24) | Держать | +0..+10% при недоборе |
| neutral (-5..+4) | Наблюдать | Проверить пожирателей |
| slightly_bad (-25..-6) | Снижать | -20..-50%, ротация |
| bad (≤-25) | Пауза/снижение | -50% или полная пауза |

---

## Ограничения бюджетов

- Максимум повышения: **+30%** за шаг
- Максимум снижения: **-50%** за шаг
- Диапазон: **$3 - $100** (300-10000 центов)
- Новый адсет: **$10-$20**
- Не создавать адсеты после **18:00 по Алматы** (UTC+5)

---

## READ инструменты

### Активные адсеты из Facebook API

```bash
curl -s "https://graph.facebook.com/v23.0/{ad_account_id}/adsets?fields=id,name,daily_budget,status,campaign_id&filtering=[{\"field\":\"effective_status\",\"operator\":\"IN\",\"value\":[\"ACTIVE\"]}]&access_token={token}"
```

### Инсайты адсета за период

```bash
curl -s "https://graph.facebook.com/v23.0/{adset_id}/insights?fields=impressions,reach,spend,clicks,actions,ctr,cpm,frequency&time_range={\"since\":\"{date_from}\",\"until\":\"{date_to}\"}&access_token={token}"
```

Периоды: today, yesterday, last_3d, last_7d, last_30d.

### Извлечение leads из actions

```
actions[].action_type:
  onsite_conversion.total_messaging_connection → WhatsApp лиды
  onsite_conversion.lead_grouped → Lead form лиды
  offsite_conversion.fb_pixel_lead → Pixel лиды
```

Для instagram_traffic считай link_clicks вместо leads.

### Последний скоринг из БД

```sql
SELECT * FROM scoring_history
WHERE date >= CURRENT_DATE - 3
ORDER BY date DESC, health_score ASC;
```

---

## WRITE инструменты

### Пауза адсета

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{adset_id}?status=PAUSED&access_token={token}"
```

### Запуск адсета

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{adset_id}?status=ACTIVE&access_token={token}"
```

### Обновление бюджета

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{adset_id}?daily_budget={cents}&access_token={token}"
```

`daily_budget` в **центах** (например $15 = 1500).

Проверь лимиты перед изменением:
1. Новый бюджет ≥ 300 (min $3)
2. Новый бюджет ≤ 10000 (max $100)
3. Изменение ≤ +30% от текущего (повышение)
4. Изменение ≤ -50% от текущего (снижение)

### Пауза объявления (ad-eater)

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/{ad_id}?status=PAUSED&access_token={token}"
```

### Сохранить результат скоринга

```sql
INSERT INTO scoring_history (date, adset_id, adset_name, direction_id, health_score, health_class, cpl_score, trend_score, diagnostics_score, today_compensation, volume_factor, ecpl_cents, ctr, cpm, frequency, impressions, spend_cents, action_type, action_details)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
ON CONFLICT (adset_id, date) DO UPDATE SET
  health_score = EXCLUDED.health_score,
  health_class = EXCLUDED.health_class,
  action_type = EXCLUDED.action_type,
  action_details = EXCLUDED.action_details;
```

---

## Формат ответа

```
🔧 *Оптимизация рекламы*

*Скоринг:*
🟢 Алматы | adset_1 | HS: +32 (very_good) | CPL: $2.50 → +20% бюджет
🔴 Астана | adset_2 | HS: -28 (bad) | CPL: $8.00 → ⏸ ПАУЗА

*Пожиратели:*
❌ ad_123 — потратил $15, 0 лидов (50% бюджета адсета) → ⏸ ПАУЗА

*Выполнено:*
✅ adset_1: бюджет $10 → $12 (+20%)
✅ adset_2: PAUSED
✅ ad_123: PAUSED (ad-eater)
```

⚠️ Спроси подтверждение перед WRITE операциями.
