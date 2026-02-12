-- =====================================================
-- Бэкфилл account_id в ad_creative_mapping
--
-- Проблема: маппинги, созданные через CreateCampaignWithCreative action,
-- сохранялись с account_id=NULL даже для мультиаккаунтных пользователей.
-- Это приводило к тому, что creativeResolver не находил маппинг при
-- поиске с фильтром .eq('account_id', uuid).
-- =====================================================

-- Шаг 1: Обновить account_id в ad_creative_mapping из direction
UPDATE ad_creative_mapping acm
SET account_id = ad.account_id
FROM account_directions ad
WHERE acm.direction_id = ad.id
  AND acm.account_id IS NULL
  AND ad.account_id IS NOT NULL;

-- Шаг 2: Привязать лиды к креативам через ad_creative_mapping
-- (для лидов, которые не были привязаны из-за бага в резолвере)
UPDATE leads l
SET creative_id = acm.user_creative_id,
    direction_id = COALESCE(l.direction_id, acm.direction_id)
FROM ad_creative_mapping acm
WHERE l.source_id = acm.ad_id
  AND l.creative_id IS NULL
  AND l.source_id IS NOT NULL;
