# WhatsApp Leads Sync — Синхронизация лидов

## Цель
Синхронизировать WhatsApp лиды из SaaS в локальную базу данных для объединённой аналитики.

## Когда использовать
- Когда нужен единый отчёт по лидам (реклама + WhatsApp)
- Для анализа воронки от рекламы до квалификации
- Для CAPI отчётности

## Шаги

### 1. Получить SaaS credentials
```bash
SAAS_DB=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_db_url FROM config WHERE id = 1")
SAAS_ID=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_account_id FROM config WHERE id = 1")
```

Если `SAAS_DB` пуст — SaaS pairing не настроен.

### 2. Получить WhatsApp лиды из SaaS
```bash
psql "$SAAS_DB" -c "
  SELECT
    da.contact_phone,
    da.contact_name,
    da.direction_id,
    da.ctwa_clid,
    da.capi_interest_sent,
    da.capi_qualified_sent,
    da.capi_scheduled_sent,
    da.incoming_count,
    da.first_message,
    da.last_message
  FROM dialog_analysis da
  WHERE da.user_account_id = '$SAAS_ID'
    AND da.first_message > NOW() - INTERVAL '7 days'
  ORDER BY da.last_message DESC;
"
```

### 3. Синхронизировать в локальную БД
Для каждого WhatsApp лида, которого нет в локальной БД:
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" <<SQL
INSERT INTO leads (
  name, phone, source_type, utm_source,
  chat_id, ctwa_clid, direction_id,
  stage, created_at
)
VALUES (
  '{CONTACT_NAME}',
  '{CONTACT_PHONE}',
  'whatsapp',
  'whatsapp',
  '{CONTACT_PHONE}',
  '{CTWA_CLID}',
  '{DIRECTION_ID}',
  'new_lead',
  '{FIRST_MESSAGE}'
)
ON CONFLICT DO NOTHING;
SQL
```

### 4. Обновить CAPI статусы
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -c "
  UPDATE leads SET
    reached_key_stage = true,
    stage = 'qualified'
  WHERE phone = '{PHONE}' AND source_type = 'whatsapp';
"
```

### 5. Отчёт по конверсиям
```bash
psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" <<'SQL'
SELECT
  source_type,
  stage,
  COUNT(*) as count,
  MIN(created_at)::date as first_date,
  MAX(created_at)::date as last_date
FROM leads
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source_type, stage
ORDER BY source_type, count DESC;
SQL
```

### 6. CAPI события
```bash
psql "$SAAS_DB" -c "
  SELECT
    event_name,
    event_level,
    capi_status,
    COUNT(*) as count,
    MIN(created_at)::date as first_date
  FROM capi_events_log
  WHERE user_account_id = '$SAAS_ID'
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY event_name, event_level, capi_status
  ORDER BY event_level;
"
```

## Результат
- WhatsApp лиды синхронизированы в локальную БД
- Единый отчёт по всем источникам лидов
- CAPI статусы обновлены
