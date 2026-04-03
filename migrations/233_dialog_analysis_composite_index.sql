-- Составной индекс для GET /dialogs/analysis — ускоряет основной запрос CRM
-- WHERE user_account_id = ? ORDER BY score DESC, last_message DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dialog_analysis_user_score_message
ON dialog_analysis(user_account_id, score DESC, last_message DESC);
