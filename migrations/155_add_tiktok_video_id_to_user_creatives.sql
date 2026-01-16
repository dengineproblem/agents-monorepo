-- Migration: Add tiktok_video_id to user_creatives for TikTok creatives filtering

ALTER TABLE user_creatives
  ADD COLUMN IF NOT EXISTS tiktok_video_id TEXT;

COMMENT ON COLUMN user_creatives.tiktok_video_id IS
  'TikTok video ID associated with the creative (uploaded to TikTok Ads).';

CREATE INDEX IF NOT EXISTS idx_user_creatives_tiktok_video_id
  ON user_creatives(tiktok_video_id)
  WHERE tiktok_video_id IS NOT NULL;
