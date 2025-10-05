-- Миграция для дефолтных настроек рекламы
-- Создается для хранения предустановленных параметров кампаний по типам целей

-- Таблица для хранения дефолтных настроек рекламы пользователя
CREATE TABLE IF NOT EXISTS default_ad_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Тип цели кампании
  campaign_goal TEXT NOT NULL CHECK (campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Общие настройки таргетинга
  cities TEXT[], -- Массив ID городов Facebook
  age_min INTEGER DEFAULT 18,
  age_max INTEGER DEFAULT 65,
  gender TEXT DEFAULT 'all' CHECK (gender IN ('all', 'male', 'female')),
  
  -- Текст под видео
  description TEXT DEFAULT 'Напишите нам, чтобы узнать подробности',
  
  -- Настройки для WhatsApp (используется когда campaign_goal = 'whatsapp')
  client_question TEXT DEFAULT 'Здравствуйте! Хочу узнать об этом подробнее.',
  
  -- Настройки для посещения профиля Instagram (campaign_goal = 'instagram_traffic')
  instagram_url TEXT,
  
  -- Настройки для лидов на сайте (campaign_goal = 'site_leads')
  site_url TEXT,
  pixel_id TEXT,
  utm_tag TEXT DEFAULT 'utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}',
  
  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Уникальность: один набор настроек на пользователя и тип цели
  UNIQUE(user_id, campaign_goal)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_user_id ON default_ad_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_campaign_goal ON default_ad_settings(user_id, campaign_goal);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_default_ad_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_default_ad_settings_updated_at
BEFORE UPDATE ON default_ad_settings
FOR EACH ROW
EXECUTE FUNCTION update_default_ad_settings_updated_at();

-- RLS политики
ALTER TABLE default_ad_settings ENABLE ROW LEVEL SECURITY;

-- Политика: пользователи могут видеть только свои настройки
CREATE POLICY default_ad_settings_select_own
ON default_ad_settings
FOR SELECT
USING (auth.uid() = user_id);

-- Политика: пользователи могут обновлять только свои настройки
CREATE POLICY default_ad_settings_update_own
ON default_ad_settings
FOR UPDATE
USING (auth.uid() = user_id);

-- Политика: пользователи могут вставлять только свои настройки
CREATE POLICY default_ad_settings_insert_own
ON default_ad_settings
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Политика: пользователи могут удалять только свои настройки
CREATE POLICY default_ad_settings_delete_own
ON default_ad_settings
FOR DELETE
USING (auth.uid() = user_id);

-- Service role имеет полный доступ
GRANT ALL ON default_ad_settings TO service_role;

-- Комментарии к таблице
COMMENT ON TABLE default_ad_settings IS 'Дефолтные настройки рекламы для автозаполнения форм при создании кампаний';
COMMENT ON COLUMN default_ad_settings.campaign_goal IS 'Тип цели: whatsapp (переписка в WhatsApp), instagram_traffic (визиты в профиль Instagram), site_leads (лиды на сайте)';
COMMENT ON COLUMN default_ad_settings.cities IS 'Массив ID городов Facebook для таргетинга (geo_locations)';
COMMENT ON COLUMN default_ad_settings.age_min IS 'Минимальный возраст аудитории (18-65)';
COMMENT ON COLUMN default_ad_settings.age_max IS 'Максимальный возраст аудитории (18-65)';
COMMENT ON COLUMN default_ad_settings.gender IS 'Пол аудитории: all (все), male (мужчины), female (женщины)';
COMMENT ON COLUMN default_ad_settings.description IS 'Текст под видео по умолчанию';
COMMENT ON COLUMN default_ad_settings.client_question IS 'Вопрос клиента (только для campaign_goal=whatsapp)';
COMMENT ON COLUMN default_ad_settings.instagram_url IS 'URL профиля Instagram (только для campaign_goal=instagram_traffic)';
COMMENT ON COLUMN default_ad_settings.site_url IS 'URL сайта (только для campaign_goal=site_leads)';
COMMENT ON COLUMN default_ad_settings.pixel_id IS 'ID пикселя Facebook для отслеживания конверсий (только для campaign_goal=site_leads)';
COMMENT ON COLUMN default_ad_settings.utm_tag IS 'UTM метки для отслеживания источника трафика (только для campaign_goal=site_leads)';

-- Пример вставки дефолтных настроек для тестирования
-- INSERT INTO default_ad_settings (user_id, campaign_goal, cities, age_min, age_max, gender, description, client_question)
-- VALUES (
--   '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
--   'whatsapp',
--   ARRAY['2643743', '2643743'], -- ID городов Facebook (пример: Алматы, Астана)
--   25,
--   45,
--   'all',
--   'Узнайте подробности в WhatsApp!',
--   'Здравствуйте! Интересует ваше предложение.'
-- );
