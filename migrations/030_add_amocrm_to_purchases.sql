-- Migration: Add AmoCRM fields to purchases table
-- Description: Adds columns to link purchases with AmoCRM deals to prevent duplicates and enable sync
-- Date: 2025-11-20

-- Add AmoCRM fields
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS amocrm_deal_id BIGINT,
ADD COLUMN IF NOT EXISTS amocrm_pipeline_id INTEGER,
ADD COLUMN IF NOT EXISTS amocrm_status_id INTEGER;

-- Create index for faster lookups during sync
CREATE INDEX IF NOT EXISTS idx_purchases_amocrm_deal_id ON purchases(amocrm_deal_id) WHERE amocrm_deal_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN purchases.amocrm_deal_id IS 'ID of the corresponding deal in AmoCRM';

