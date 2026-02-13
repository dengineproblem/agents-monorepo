-- Migration 209: Migrate existing CAPI settings from account_directions to capi_settings
-- Берём самую свежую запись по updated_at для каждой уникальной комбинации (user_account_id, account_id, channel)

INSERT INTO capi_settings (
  user_account_id,
  account_id,
  channel,
  pixel_id,
  capi_access_token,
  capi_source,
  capi_crm_type,
  capi_interest_fields,
  capi_qualified_fields,
  capi_scheduled_fields,
  is_active
)
SELECT DISTINCT ON (d.user_account_id, d.account_id, inferred_channel)
  d.user_account_id,
  d.account_id,
  -- Определяем channel по objective + conversion_channel
  CASE
    WHEN d.objective = 'conversions' AND d.conversion_channel = 'whatsapp' THEN 'whatsapp'
    WHEN d.objective = 'conversions' AND d.conversion_channel = 'lead_form' THEN 'lead_forms'
    WHEN d.objective = 'conversions' AND d.conversion_channel = 'site' THEN 'site'
    WHEN d.objective = 'lead_forms' THEN 'lead_forms'
    WHEN d.objective = 'whatsapp_conversions' THEN 'whatsapp'  -- legacy
    ELSE 'whatsapp'  -- fallback
  END AS inferred_channel,
  das.pixel_id,
  d.capi_access_token,
  COALESCE(d.capi_source, 'whatsapp'),
  d.capi_crm_type,
  COALESCE(d.capi_interest_fields, '[]'::jsonb),
  COALESCE(d.capi_qualified_fields, '[]'::jsonb),
  COALESCE(d.capi_scheduled_fields, '[]'::jsonb),
  TRUE
FROM account_directions d
JOIN default_ad_settings das ON das.direction_id = d.id
WHERE d.capi_enabled = TRUE
  AND das.pixel_id IS NOT NULL
ORDER BY d.user_account_id, d.account_id, inferred_channel, d.updated_at DESC;

-- НЕ удаляем колонки из account_directions — backward compatibility для transition period
-- Удаление будет в миграции 210 после полного перехода
