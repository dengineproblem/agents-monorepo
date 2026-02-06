-- Migration 196: RPC function for efficient chat users listing
-- Date: 2026-02-06
-- Purpose: Replace .limit(500) + JS grouping with efficient DISTINCT ON query
-- Fixes: admin chats showing only ~10 days of conversations

CREATE OR REPLACE FUNCTION get_chat_users_with_last_message(
  p_source_filter TEXT[] DEFAULT ARRAY['bot', 'admin'],
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  telegram_id TEXT,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count BIGINT,
  total_users BIGINT
)
LANGUAGE sql STABLE
AS $$
  WITH last_messages AS (
    SELECT DISTINCT ON (c.user_account_id)
      c.user_account_id,
      c.message,
      c.created_at
    FROM admin_user_chats c
    WHERE c.source = ANY(p_source_filter)
      AND c.user_account_id IS NOT NULL
    ORDER BY c.user_account_id, c.created_at DESC
  ),
  unread_counts AS (
    SELECT
      c.user_account_id,
      COUNT(*) AS cnt
    FROM admin_user_chats c
    WHERE c.source = ANY(p_source_filter)
      AND c.direction = 'from_user'
      AND c.read_at IS NULL
      AND c.user_account_id IS NOT NULL
    GROUP BY c.user_account_id
  ),
  combined AS (
    SELECT
      lm.user_account_id,
      u.username,
      u.telegram_id,
      lm.message AS last_message,
      lm.created_at AS last_message_time,
      COALESCE(uc.cnt, 0) AS unread_count
    FROM last_messages lm
    JOIN user_accounts u ON u.id = lm.user_account_id
    LEFT JOIN unread_counts uc ON uc.user_account_id = lm.user_account_id
    WHERE (p_search IS NULL OR u.username ILIKE '%' || p_search || '%')
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM combined
  )
  SELECT
    c.user_account_id AS user_id,
    c.username,
    c.telegram_id,
    c.last_message,
    c.last_message_time,
    c.unread_count,
    t.cnt AS total_users
  FROM combined c, total t
  ORDER BY c.unread_count DESC, c.last_message_time DESC
  OFFSET p_offset
  LIMIT p_limit;
$$;
