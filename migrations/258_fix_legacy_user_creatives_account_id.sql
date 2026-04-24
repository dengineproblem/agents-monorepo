-- 258: Fix legacy user_creatives.account_id inconsistency
--
-- ПРОБЛЕМА (ROAS dashboard zeros for new creatives):
-- Для пользователей с multi_account_enabled = false фронт слал currentAdAccountId
-- в upload-метадате, и tusUpload.ts сохранял user_creatives.account_id = UUID.
-- При этом account_directions.account_id и ad_creative_mapping.account_id
-- оставались NULL — split-brain.
--
-- scoring.js::getActiveCreatives в legacy-режиме (accountUUID = null) делает
--   .is('account_id', null) по user_creatives
-- и исключает именно эти свежие записи → saveCreativeMetricsToHistory
-- не запускается → creative_metrics_history пуста → РОА-дашборд показывает 0.
--
-- FIX: нормализуем user_creatives.account_id = NULL для всех пользователей
-- в legacy-режиме. Идемпотентно.

UPDATE user_creatives uc
SET account_id = NULL
FROM user_accounts ua
WHERE uc.user_id = ua.id
  AND ua.multi_account_enabled = false
  AND uc.account_id IS NOT NULL;

-- Проверка (для ручной валидации после применения):
-- SELECT COUNT(*) FROM user_creatives uc
--   JOIN user_accounts ua ON ua.id = uc.user_id
--  WHERE ua.multi_account_enabled = false AND uc.account_id IS NOT NULL;
-- Ожидается: 0
