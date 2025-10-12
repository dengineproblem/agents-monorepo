-- Миграция: Привязываем default_ad_settings к направлениям
-- Теперь настройки принадлежат направлению, а не пользователю

-- 1. Добавляем direction_id к default_ad_settings
ALTER TABLE default_ad_settings
ADD COLUMN direction_id UUID REFERENCES account_directions(id) ON DELETE CASCADE;

-- 2. Создаём индекс для быстрого поиска по направлению
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_direction_id 
ON default_ad_settings(direction_id);

-- 3. Делаем user_id опциональным (NULL) для обратной совместимости
-- Старые записи (без direction_id) остаются привязанными к user_id
ALTER TABLE default_ad_settings
ALTER COLUMN user_id DROP NOT NULL;

-- 4. Удаляем старое ограничение уникальности (user_id, campaign_goal)
ALTER TABLE default_ad_settings
DROP CONSTRAINT IF EXISTS default_ad_settings_user_id_campaign_goal_key;

-- 5. Добавляем новое ограничение: одна запись на направление
-- (campaign_goal не нужен, т.к. direction уже имеет objective)
ALTER TABLE default_ad_settings
ADD CONSTRAINT default_ad_settings_direction_unique 
UNIQUE(direction_id);

-- 6. Добавляем CHECK: либо user_id, либо direction_id должны быть заполнены
ALTER TABLE default_ad_settings
ADD CONSTRAINT default_ad_settings_owner_check
CHECK (
  (user_id IS NOT NULL AND direction_id IS NULL) OR 
  (user_id IS NULL AND direction_id IS NOT NULL)
);

-- 7. Обновляем RLS политики для поддержки directions

-- Удаляем старые политики
DROP POLICY IF EXISTS default_ad_settings_select_own ON default_ad_settings;
DROP POLICY IF EXISTS default_ad_settings_update_own ON default_ad_settings;
DROP POLICY IF EXISTS default_ad_settings_insert_own ON default_ad_settings;
DROP POLICY IF EXISTS default_ad_settings_delete_own ON default_ad_settings;

-- Новые политики с поддержкой directions
CREATE POLICY default_ad_settings_select_policy
ON default_ad_settings
FOR SELECT
USING (
  -- Либо это настройки пользователя (legacy)
  (user_id IS NOT NULL AND auth.uid() = user_id)
  OR
  -- Либо это настройки направления, принадлежащего пользователю
  (direction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_directions 
    WHERE account_directions.id = default_ad_settings.direction_id 
    AND account_directions.user_account_id = auth.uid()
  ))
);

CREATE POLICY default_ad_settings_insert_policy
ON default_ad_settings
FOR INSERT
WITH CHECK (
  -- Либо создаём настройки пользователя (legacy)
  (user_id IS NOT NULL AND auth.uid() = user_id)
  OR
  -- Либо создаём настройки для направления пользователя
  (direction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_directions 
    WHERE account_directions.id = default_ad_settings.direction_id 
    AND account_directions.user_account_id = auth.uid()
  ))
);

CREATE POLICY default_ad_settings_update_policy
ON default_ad_settings
FOR UPDATE
USING (
  -- Либо это настройки пользователя (legacy)
  (user_id IS NOT NULL AND auth.uid() = user_id)
  OR
  -- Либо это настройки направления пользователя
  (direction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_directions 
    WHERE account_directions.id = default_ad_settings.direction_id 
    AND account_directions.user_account_id = auth.uid()
  ))
);

CREATE POLICY default_ad_settings_delete_policy
ON default_ad_settings
FOR DELETE
USING (
  -- Либо это настройки пользователя (legacy)
  (user_id IS NOT NULL AND auth.uid() = user_id)
  OR
  -- Либо это настройки направления пользователя
  (direction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_directions 
    WHERE account_directions.id = default_ad_settings.direction_id 
    AND account_directions.user_account_id = auth.uid()
  ))
);

-- 8. Комментарии
COMMENT ON COLUMN default_ad_settings.direction_id IS 
'ID направления бизнеса (если настройки привязаны к направлению). Взаимоисключающе с user_id.';

COMMENT ON CONSTRAINT default_ad_settings_direction_unique ON default_ad_settings IS
'Одна запись настроек на направление (campaign_goal определяется из direction.objective)';

COMMENT ON CONSTRAINT default_ad_settings_owner_check ON default_ad_settings IS
'Настройки должны принадлежать либо пользователю (user_id), либо направлению (direction_id), но не обоим';

-- 9. Пример вставки настроек для направления
-- INSERT INTO default_ad_settings (direction_id, campaign_goal, cities, age_min, age_max, gender, description, client_question)
-- VALUES (
--   'direction-uuid-here',
--   'whatsapp', -- Должно совпадать с direction.objective
--   ARRAY['2643743'],
--   25,
--   45,
--   'all',
--   'Узнайте подробности в WhatsApp!',
--   'Здравствуйте! Интересует ваше предложение.'
-- );

