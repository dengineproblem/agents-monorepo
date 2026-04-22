-- ============================================================================
-- BACKFILL fb_creative_id_<objective> FOR CREATIVES ASSIGNED TO DIRECTIONS
-- ============================================================================
-- Контекст: endpoint POST /user-creatives/:id/assign-direction до фикса писал
-- созданный FB-креатив только в общее поле user_creatives.fb_creative_id, но
-- не в специфичное fb_creative_id_lead_forms / fb_creative_id_whatsapp /
-- fb_creative_id_site_leads / fb_creative_id_instagram_traffic.
-- Фильтр в campaignBuilder.getAvailableCreatives() ищет именно специфичное
-- поле под objective направления → такие креативы не попадали в автозапуск.
--
-- Бэкфил: копируем общий fb_creative_id в специфичное поле под objective
-- направления. Чтобы не сломать легаси-креативы (которые могли иметь
-- осмысленные значения в специфичных полях для ДРУГИХ objective), ограничиваем
-- выборку только теми, у которых ВСЕ специфичные поля NULL — это
-- подпись креативов, созданных через assign-direction до фикса.
-- ============================================================================

WITH assigned_only AS (
  SELECT uc.id, d.objective, d.conversion_channel
  FROM user_creatives uc
  JOIN account_directions d ON d.id = uc.direction_id
  WHERE uc.status = 'ready'
    AND uc.is_active = true
    AND uc.fb_creative_id IS NOT NULL
    AND uc.fb_creative_id_whatsapp IS NULL
    AND uc.fb_creative_id_site_leads IS NULL
    AND uc.fb_creative_id_lead_forms IS NULL
    AND uc.fb_creative_id_instagram_traffic IS NULL
)
UPDATE user_creatives uc
SET
  fb_creative_id_whatsapp = CASE
    WHEN a.objective IN ('whatsapp', 'instagram_dm')
      OR (a.objective = 'conversions' AND a.conversion_channel = 'whatsapp')
    THEN uc.fb_creative_id
    ELSE NULL
  END,
  fb_creative_id_instagram_traffic = CASE
    WHEN a.objective = 'instagram_traffic' THEN uc.fb_creative_id
    ELSE NULL
  END,
  fb_creative_id_site_leads = CASE
    WHEN a.objective = 'site_leads'
      OR (a.objective = 'conversions' AND a.conversion_channel = 'site')
    THEN uc.fb_creative_id
    ELSE NULL
  END,
  fb_creative_id_lead_forms = CASE
    WHEN a.objective = 'lead_forms'
      OR (a.objective = 'conversions' AND a.conversion_channel = 'lead_form')
    THEN uc.fb_creative_id
    ELSE NULL
  END
FROM assigned_only a
WHERE uc.id = a.id;
