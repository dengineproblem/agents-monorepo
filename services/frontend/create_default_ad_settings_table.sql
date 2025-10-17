-- Таблица для хранения дефолтных настроек рекламы для каждого направления
CREATE TABLE IF NOT EXISTS default_ad_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL REFERENCES account_directions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Тип цели кампании (должен совпадать с direction.objective)
  campaign_goal TEXT NOT NULL CHECK (campaign_goal IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Общие настройки таргетинга
  cities TEXT[], -- Массив ID городов
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
  
  -- Уникальность: один набор настроек на направление
  UNIQUE(direction_id)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_direction_id ON default_ad_settings(direction_id);
CREATE INDEX IF NOT EXISTS idx_default_ad_settings_user_id ON default_ad_settings(user_id);

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

-- Комментарии к таблице
COMMENT ON TABLE default_ad_settings IS 'Дефолтные настройки рекламы для каждого направления (автозаполнение форм)';
COMMENT ON COLUMN default_ad_settings.direction_id IS 'ID направления из таблицы account_directions';
COMMENT ON COLUMN default_ad_settings.user_id IS 'ID пользователя (дублируется для удобства)';
COMMENT ON COLUMN default_ad_settings.campaign_goal IS 'Тип цели: whatsapp, instagram_traffic, site_leads (должен совпадать с direction.objective)';
COMMENT ON COLUMN default_ad_settings.cities IS 'Массив ID городов для таргетинга';
COMMENT ON COLUMN default_ad_settings.description IS 'Текст под видео по умолчанию';
COMMENT ON COLUMN default_ad_settings.client_question IS 'Вопрос клиента (только для campaign_goal=whatsapp)';
COMMENT ON COLUMN default_ad_settings.instagram_url IS 'URL профиля Instagram (только для campaign_goal=instagram_traffic)';
COMMENT ON COLUMN default_ad_settings.site_url IS 'URL сайта (только для campaign_goal=site_leads)';
COMMENT ON COLUMN default_ad_settings.pixel_id IS 'ID пикселя Facebook (только для campaign_goal=site_leads)';
COMMENT ON COLUMN default_ad_settings.utm_tag IS 'UTM метки (только для campaign_goal=site_leads)';