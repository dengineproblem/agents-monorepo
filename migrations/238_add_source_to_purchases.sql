-- Добавляем поле source для отслеживания откуда пришла продажа
-- Источники: manual (ручной ввод), amocrm, bitrix24, crm_consultant

ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';

COMMENT ON COLUMN purchases.source IS 'Источник продажи: manual, amocrm, bitrix24, crm_consultant';

CREATE INDEX IF NOT EXISTS idx_purchases_source ON purchases(source);

-- Проставляем source для существующих записей
UPDATE purchases SET source = 'amocrm' WHERE amocrm_deal_id IS NOT NULL AND source = 'manual';
UPDATE purchases SET source = 'crm_consultant' WHERE consultant_id IS NOT NULL AND amocrm_deal_id IS NULL AND source = 'manual';
