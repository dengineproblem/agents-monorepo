-- Migration 104: Add Bitrix24 Key Stage columns to account_directions
-- This enables tracking up to 3 key qualification stages per direction for Bitrix24 integration
-- Similar to AmoCRM key stages but using TEXT for status_id (Bitrix24 uses "NEW", "C1:NEW", etc.)

-- ============================================================================
-- 1. Add Bitrix24 key stage columns to account_directions
-- ============================================================================

ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_1_category_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_1_status_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_2_category_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_2_status_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_3_category_id INTEGER,
  ADD COLUMN IF NOT EXISTS bitrix24_key_stage_3_status_id TEXT;

COMMENT ON COLUMN account_directions.bitrix24_key_stage_1_category_id IS 'Bitrix24 deal category (pipeline) ID for key stage 1';
COMMENT ON COLUMN account_directions.bitrix24_key_stage_1_status_id IS 'Bitrix24 status ID for key stage 1 (e.g., "NEW", "C1:NEW")';
COMMENT ON COLUMN account_directions.bitrix24_key_stage_2_category_id IS 'Bitrix24 deal category (pipeline) ID for key stage 2';
COMMENT ON COLUMN account_directions.bitrix24_key_stage_2_status_id IS 'Bitrix24 status ID for key stage 2';
COMMENT ON COLUMN account_directions.bitrix24_key_stage_3_category_id IS 'Bitrix24 deal category (pipeline) ID for key stage 3';
COMMENT ON COLUMN account_directions.bitrix24_key_stage_3_status_id IS 'Bitrix24 status ID for key stage 3';

-- ============================================================================
-- 2. Create indexes for Bitrix24 key stages (similar to AmoCRM indexes)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_1
    ON account_directions(user_account_id, bitrix24_key_stage_1_category_id, bitrix24_key_stage_1_status_id)
    WHERE bitrix24_key_stage_1_category_id IS NOT NULL AND bitrix24_key_stage_1_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_2
    ON account_directions(user_account_id, bitrix24_key_stage_2_category_id, bitrix24_key_stage_2_status_id)
    WHERE bitrix24_key_stage_2_category_id IS NOT NULL AND bitrix24_key_stage_2_status_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_directions_bitrix24_key_stage_3
    ON account_directions(user_account_id, bitrix24_key_stage_3_category_id, bitrix24_key_stage_3_status_id)
    WHERE bitrix24_key_stage_3_category_id IS NOT NULL AND bitrix24_key_stage_3_status_id IS NOT NULL;

-- ============================================================================
-- 3. Add constraints (both fields must be either NULL or NOT NULL together)
-- ============================================================================

-- Note: Dropping constraints first if they exist to avoid errors on re-run
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_1_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions DROP CONSTRAINT check_bitrix24_key_stage_1_complete;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_2_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions DROP CONSTRAINT check_bitrix24_key_stage_2_complete;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_bitrix24_key_stage_3_complete'
        AND table_name = 'account_directions'
    ) THEN
        ALTER TABLE account_directions DROP CONSTRAINT check_bitrix24_key_stage_3_complete;
    END IF;
END $$;

ALTER TABLE account_directions
    ADD CONSTRAINT check_bitrix24_key_stage_1_complete
    CHECK (
        (bitrix24_key_stage_1_category_id IS NULL AND bitrix24_key_stage_1_status_id IS NULL)
        OR
        (bitrix24_key_stage_1_category_id IS NOT NULL AND bitrix24_key_stage_1_status_id IS NOT NULL)
    );

ALTER TABLE account_directions
    ADD CONSTRAINT check_bitrix24_key_stage_2_complete
    CHECK (
        (bitrix24_key_stage_2_category_id IS NULL AND bitrix24_key_stage_2_status_id IS NULL)
        OR
        (bitrix24_key_stage_2_category_id IS NOT NULL AND bitrix24_key_stage_2_status_id IS NOT NULL)
    );

ALTER TABLE account_directions
    ADD CONSTRAINT check_bitrix24_key_stage_3_complete
    CHECK (
        (bitrix24_key_stage_3_category_id IS NULL AND bitrix24_key_stage_3_status_id IS NULL)
        OR
        (bitrix24_key_stage_3_category_id IS NOT NULL AND bitrix24_key_stage_3_status_id IS NOT NULL)
    );

-- ============================================================================
-- 4. Statistics
-- ============================================================================

DO $$
DECLARE
    total_directions INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_directions FROM account_directions;

    RAISE NOTICE '=== MIGRATION 104 COMPLETE ===';
    RAISE NOTICE 'Total directions: %', total_directions;
    RAISE NOTICE 'Added Bitrix24 key stage columns (1-3) to account_directions';
END $$;
