-- Migration: Add Bitrix24 fields to purchases table
-- Description: Enables Bitrix24 deal → purchases sync for ROI calculation (analogous to AmoCRM)
-- Date: 2026-04-17

ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS bitrix24_deal_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_purchases_bitrix24_deal_id ON purchases(bitrix24_deal_id) WHERE bitrix24_deal_id IS NOT NULL;

COMMENT ON COLUMN purchases.bitrix24_deal_id IS 'ID of the corresponding deal in Bitrix24';
