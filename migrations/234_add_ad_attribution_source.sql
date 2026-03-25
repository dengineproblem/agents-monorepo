-- Источник атрибуции к рекламе (для отслеживания как лид был привязан к креативу)
-- Значения: evolution_webhook, wwebjs_recovery, wwebjs_url_match, wwebjs_unattributed
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_attribution_source TEXT;
