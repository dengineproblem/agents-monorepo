-- Добавляем флаг для лидов, требующих ручной привязки креатива
-- Используется когда лид пришел по fuzzy matching (совпадение client_question) без FB метаданных

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS needs_manual_match BOOLEAN DEFAULT false;

-- Индекс для быстрого поиска лидов, требующих ручной привязки
CREATE INDEX IF NOT EXISTS idx_leads_needs_manual_match
ON leads(user_account_id, needs_manual_match)
WHERE needs_manual_match = true;

-- Пометить существующих лидов без креатива как требующих привязки
UPDATE leads
SET needs_manual_match = true
WHERE creative_id IS NULL
  AND direction_id IS NOT NULL
  AND needs_manual_match IS NOT TRUE;
