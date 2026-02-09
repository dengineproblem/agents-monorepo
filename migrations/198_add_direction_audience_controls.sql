-- Migration: Direction-level controls for Advantage+ Audience and Custom Audience
-- Allows disabling Advantage+ and attaching a fixed Custom Audience per direction.

ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS advantage_audience_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE account_directions
  ADD COLUMN IF NOT EXISTS custom_audience_id TEXT;

COMMENT ON COLUMN account_directions.advantage_audience_enabled IS
  'Enable/disable Meta Advantage+ Audience for ad set targeting at direction level';

COMMENT ON COLUMN account_directions.custom_audience_id IS
  'Meta Custom Audience ID applied to all ad sets created for the direction (optional)';
