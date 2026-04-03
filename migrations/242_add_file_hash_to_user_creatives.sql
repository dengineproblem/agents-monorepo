-- Migration 242: Add file_hash to user_creatives for video deduplication
-- Позволяет переиспользовать fb_video_id при повторной загрузке одного файла

ALTER TABLE user_creatives ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Индекс для быстрого поиска дублей: hash + account_id, только для загруженных видео
CREATE INDEX IF NOT EXISTS idx_user_creatives_file_hash
  ON user_creatives(user_id, file_hash, account_id)
  WHERE file_hash IS NOT NULL AND fb_video_id IS NOT NULL AND status = 'ready';
