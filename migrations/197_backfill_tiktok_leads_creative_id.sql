-- Migration 197: Backfill creative_id для лидов через UTM-параметры
--
-- Проблема: Некоторые лиды приходят с UTM, содержащим ad_id (через макрос {{ad.id}} или __CID__),
-- но creative_id не был заполнен при вставке.
-- ROI аналитика (salesApi.getROIData) связывает лидов с креативами через creative_id.
--
-- Решение: Ищем ad_id в любом из UTM-полей (пользователь сам выбирает поле при настройке)
-- и заполняем creative_id через ad_creative_mapping (ad_id → user_creative_id)

UPDATE leads l
SET creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE l.creative_id IS NULL
  AND (
    l.utm_source = acm.ad_id
    OR l.utm_medium = acm.ad_id
    OR l.utm_campaign = acm.ad_id
    OR l.utm_term = acm.ad_id
    OR l.utm_content = acm.ad_id
  );
