-- Добавляем поле locales для таргетинга по языку аудитории Facebook
-- locales: массив Facebook locale ID (например, 6 = Russian, 26 = English (US))
-- NULL или пустой массив = таргетинг на все языки (стандартное поведение FB)
-- Список ID получают через Facebook Targeting Search API: GET /search?type=adlocale

ALTER TABLE default_ad_settings
  ADD COLUMN IF NOT EXISTS locales INTEGER[] DEFAULT NULL;

COMMENT ON COLUMN default_ad_settings.locales IS
  'Facebook locale IDs для таргетинга по языку аудитории. NULL = все языки. Пример: [6] = русский, [26] = английский (US). Список ID: GET /search?type=adlocale.';
