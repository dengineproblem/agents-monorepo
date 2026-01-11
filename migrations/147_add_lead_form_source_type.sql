-- Добавить 'lead_form' как допустимый source_type для лидов с Facebook Lead Forms

-- Удаляем старый constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_type_check;

-- Добавляем новый constraint с 'lead_form'
ALTER TABLE leads ADD CONSTRAINT leads_source_type_check
  CHECK (source_type IN ('whatsapp', 'website', 'manual', 'lead_form'));
