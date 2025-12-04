-- Миграция: разрешить country_code = 'ALL' для поиска по всем странам
--
-- Изменяем CHECK constraint для поддержки:
-- - Двухбуквенные коды стран (KZ, RU, BY, UA и т.д.)
-- - 'ALL' для поиска по всем странам

-- Удаляем старый constraint
ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_country_code_check;

-- Добавляем новый constraint: 2-3 символа
ALTER TABLE competitors ADD CONSTRAINT competitors_country_code_check
  CHECK (char_length(country_code) >= 2 AND char_length(country_code) <= 3);
