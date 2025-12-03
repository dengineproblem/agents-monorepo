-- Migration 071: Add account_id to ad_creative_mapping
-- Created: 2025-12-03
-- Description: Добавляет account_id для поддержки мультиаккаунтности

-- =====================================================
-- ADD account_id COLUMN
-- =====================================================

ALTER TABLE ad_creative_mapping
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL;

-- Индекс для быстрого поиска по account_id
CREATE INDEX IF NOT EXISTS idx_ad_creative_mapping_account_id ON ad_creative_mapping(account_id);

-- Комментарий
COMMENT ON COLUMN ad_creative_mapping.account_id IS 'UUID из ad_accounts.id для мультиаккаунтности (NULL для legacy режима)';
