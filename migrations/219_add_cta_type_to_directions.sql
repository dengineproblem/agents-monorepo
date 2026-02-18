-- Добавляем поле cta_type в account_directions
-- NULL = используется дефолт по objective (SIGN_UP для site_leads, LEARN_MORE для lead_forms)
ALTER TABLE account_directions ADD COLUMN cta_type TEXT;
