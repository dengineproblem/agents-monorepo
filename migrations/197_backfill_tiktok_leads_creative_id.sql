-- Migration 197: Backfill creative_id для существующих TikTok лидов
--
-- Проблема: TikTok webhook сохраняет leads.ad_id, но не заполняет creative_id.
-- ROI аналитика (salesApi.getROIData) связывает лидов с креативами через creative_id.
-- Без creative_id TikTok лиды не привязаны к креативам → нет данных о выручке в ROI.
--
-- Решение: Заполняем creative_id через ad_creative_mapping (ad_id → user_creative_id)

UPDATE leads l
SET creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE l.ad_id = acm.ad_id
  AND l.creative_id IS NULL
  AND l.platform = 'tiktok';
