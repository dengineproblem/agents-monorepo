-- Migration 026: Ad Creative Mapping
-- Created: 2025-11-04
-- Description: Связь всех Facebook Ads с креативами и направлениями для трекинга лидов

-- =====================================================
-- TABLE: ad_creative_mapping
-- =====================================================
-- Связывает каждый созданный Facebook Ad с креативом и направлением
-- Это позволяет отслеживать, откуда пришел лид по ad_id из метаданных WhatsApp
CREATE TABLE IF NOT EXISTS ad_creative_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Facebook Ad ID (уникальный)
  ad_id TEXT NOT NULL UNIQUE,
  
  -- Связи с нашими сущностями
  user_creative_id UUID NOT NULL REFERENCES user_creatives(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Дополнительная информация
  adset_id TEXT,
  campaign_id TEXT,
  fb_creative_id TEXT,
  
  -- Метаданные
  source TEXT, -- 'creative_test', 'direction_launch', 'campaign_builder', 'duplicate'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Индексы для быстрого поиска
  CONSTRAINT ad_creative_mapping_ad_id_key UNIQUE(ad_id)
);

-- Индексы для быстрых запросов
CREATE INDEX IF NOT EXISTS idx_ad_creative_mapping_ad_id ON ad_creative_mapping(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_mapping_user_creative_id ON ad_creative_mapping(user_creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_mapping_direction_id ON ad_creative_mapping(direction_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_mapping_user_id ON ad_creative_mapping(user_id);

-- Комментарии
COMMENT ON TABLE ad_creative_mapping IS 'Связь Facebook Ads с креативами и направлениями для трекинга лидов';
COMMENT ON COLUMN ad_creative_mapping.ad_id IS 'Facebook Ad ID из метаданных WhatsApp сообщения';
COMMENT ON COLUMN ad_creative_mapping.user_creative_id IS 'Креатив, использованный в этой рекламе';
COMMENT ON COLUMN ad_creative_mapping.direction_id IS 'Направление, в котором была запущена реклама (если применимо)';
COMMENT ON COLUMN ad_creative_mapping.source IS 'Источник создания: creative_test, direction_launch, campaign_builder, duplicate';

-- =====================================================
-- MIGRATE EXISTING DATA from creative_tests
-- =====================================================
-- Переносим существующие связи из creative_tests
INSERT INTO ad_creative_mapping (ad_id, user_creative_id, direction_id, user_id, campaign_id, adset_id, source, created_at)
SELECT 
  ct.ad_id,
  ct.user_creative_id,
  uc.direction_id,
  ct.user_id,
  ct.campaign_id,
  ct.adset_id,
  'creative_test',
  ct.started_at
FROM creative_tests ct
INNER JOIN user_creatives uc ON ct.user_creative_id = uc.id
WHERE ct.ad_id IS NOT NULL
ON CONFLICT (ad_id) DO NOTHING;

-- Показываем статистику
DO $$
DECLARE
    total_mapped INTEGER;
    from_tests INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_mapped FROM ad_creative_mapping;
    SELECT COUNT(*) INTO from_tests FROM ad_creative_mapping WHERE source = 'creative_test';
    
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Ad Creative Mapping Migration Complete';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Total mapped ads: %', total_mapped;
    RAISE NOTICE 'From creative_tests: %', from_tests;
    RAISE NOTICE '==============================================';
END $$;
