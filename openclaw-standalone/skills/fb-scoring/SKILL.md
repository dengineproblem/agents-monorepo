# Скоринг Facebook рекламы (крон)

Периодический расчёт Health Score для всех активных адсетов. Запускается по крону каждые 3-6 часов. Сохраняет результаты в БД и метрики.

---

## Workflow

### Шаг 1: Получить конфигурацию

```sql
SELECT fb_access_token, fb_ad_account_id, default_target_cpl_cents FROM config WHERE id = 1;
SELECT id, name, objective, fb_campaign_id, target_cpl_cents FROM directions WHERE is_active = true;
```

### Шаг 2: Для каждого направления — получить адсеты из Facebook

```bash
curl -s "https://graph.facebook.com/v23.0/{campaign_id}/adsets?fields=id,name,daily_budget,status&filtering=[{\"field\":\"effective_status\",\"operator\":\"IN\",\"value\":[\"ACTIVE\"]}]&access_token={token}"
```

### Шаг 3: Для каждого адсета — получить метрики за 5 окон

Запроси insights за: today, yesterday, last_3d (date_preset), last_7d, last_30d.

```bash
curl -s "https://graph.facebook.com/v23.0/{adset_id}/insights?fields=impressions,reach,spend,clicks,link_clicks,actions,ctr,cpm,frequency&time_range={\"since\":\"{from}\",\"until\":\"{to}\"}&access_token={token}"
```

**Извлечение leads из actions:**
```
WhatsApp: actions[action_type='onsite_conversion.total_messaging_connection'].value
LeadForms: actions[action_type='onsite_conversion.lead_grouped'].value
Pixel: actions[action_type='offsite_conversion.fb_pixel_lead'].value
```

Для instagram_traffic используй link_clicks вместо leads.

### Шаг 4: Рассчитать Health Score

Применяй формулу из `fb-optimize/SKILL.md`:

1. **CPL Gap** (45 баллов) — ratio = eCPL / target
2. **Тренды** (±15) — 3d vs 7d, 7d vs 30d
3. **Диагностика** (-30 max) — CTR, CPM, Frequency
4. **Today Compensation** — если сегодня лучше вчера
5. **Volume Factor** — множитель доверия по impressions
6. **Классификация** — very_good / good / neutral / slightly_bad / bad

### Шаг 5: Сохранить результаты

```sql
-- Скоринг
INSERT INTO scoring_history (date, adset_id, adset_name, direction_id, health_score, health_class, cpl_score, trend_score, diagnostics_score, today_compensation, volume_factor, ecpl_cents, ctr, cpm, frequency, impressions, spend_cents, action_type)
VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'none')
ON CONFLICT (adset_id, date) DO UPDATE SET
  health_score = EXCLUDED.health_score,
  health_class = EXCLUDED.health_class,
  cpl_score = EXCLUDED.cpl_score,
  trend_score = EXCLUDED.trend_score,
  diagnostics_score = EXCLUDED.diagnostics_score;

-- Метрики (вчерашний день)
INSERT INTO metrics_history (date, adset_id, campaign_id, impressions, reach, clicks, link_clicks, leads, spend, ctr, cpm, cpl, frequency)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (adset_id, date) DO UPDATE SET
  impressions = EXCLUDED.impressions,
  leads = EXCLUDED.leads,
  spend = EXCLUDED.spend,
  cpl = EXCLUDED.cpl;
```

### Шаг 6: Обновить курс валют

```bash
curl -s "https://api.exchangerate-api.com/v4/latest/USD" | jq '.rates.KZT'
```

```sql
INSERT INTO currency_rates (from_currency, to_currency, rate, updated_at)
VALUES ('USD', 'KZT', $1, NOW())
ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW();
```

### Шаг 7: Лог выполнения

```sql
INSERT INTO scoring_executions (started_at, completed_at, duration_ms, status, adsets_analyzed, high_risk_count, actions_taken)
VALUES ($1, NOW(), $2, 'success', $3, $4, $5);
```

---

## Автооптимизация (опционально)

После скоринга можно автоматически применить действия из `fb-optimize`:

```
very_good → увеличить бюджет +10..+30%
good → ничего
neutral → проверить ad-eaters
slightly_bad → снизить -20..-50%
bad → поставить на паузу
```

Решение: выполнять ли автоматически или предложить пользователю — зависит от настроек. По умолчанию — только предложить.

---

## Если нет записей — завершись молча

Если нет активных directions или адсетов — ничего не делай, не сообщай.
