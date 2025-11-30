-- Миграция: Таблицы для раздела "Конкуренты"
-- Дата: 2025-11-29
-- Описание: Система отслеживания креативов конкурентов из Meta Ads Library

-- =====================================================
-- ТАБЛИЦА 1: competitors (Глобальный реестр конкурентов)
-- =====================================================

CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Идентификация в Facebook
  fb_page_id TEXT NOT NULL UNIQUE,
  fb_page_url TEXT NOT NULL,

  -- Основная информация
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
  avatar_url TEXT,
  country_code TEXT NOT NULL DEFAULT 'KZ' CHECK (char_length(country_code) = 2),

  -- Статус
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'error')),
  last_error TEXT,

  -- Метаданные сбора
  last_crawled_at TIMESTAMPTZ,
  next_crawl_at TIMESTAMPTZ DEFAULT NOW(),
  creatives_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE competitors IS 'Глобальный реестр конкурентов. Один конкурент может быть связан с несколькими user_accounts через user_competitors';
COMMENT ON COLUMN competitors.fb_page_id IS 'Уникальный ID Facebook страницы (резолвится из URL)';
COMMENT ON COLUMN competitors.fb_page_url IS 'Оригинальный URL страницы Facebook';
COMMENT ON COLUMN competitors.status IS 'Статус: pending (ожидает первого сбора), active (работает), error (ошибка)';
COMMENT ON COLUMN competitors.next_crawl_at IS 'Время следующего сбора креативов (еженедельно)';
COMMENT ON COLUMN competitors.creatives_count IS 'Количество собранных креативов';

-- Индексы
CREATE INDEX idx_competitors_page_id ON competitors(fb_page_id);
CREATE INDEX idx_competitors_status ON competitors(status) WHERE status = 'active';
CREATE INDEX idx_competitors_next_crawl ON competitors(next_crawl_at) WHERE status = 'active';

-- Триггер для updated_at
CREATE OR REPLACE FUNCTION update_competitors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_competitors_updated_at
BEFORE UPDATE ON competitors
FOR EACH ROW
EXECUTE FUNCTION update_competitors_updated_at();

-- =====================================================
-- ТАБЛИЦА 2: user_competitors (Связь пользователей с конкурентами)
-- =====================================================

CREATE TABLE IF NOT EXISTS user_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,

  -- Пользовательские настройки
  display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) <= 200),
  is_favorite BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Уникальность: один конкурент на пользователя один раз
  CONSTRAINT unique_user_competitor UNIQUE (user_account_id, competitor_id)
);

COMMENT ON TABLE user_competitors IS 'Связь пользователей с конкурентами (many-to-many). Позволяет разным пользователям отслеживать одних конкурентов';
COMMENT ON COLUMN user_competitors.display_name IS 'Переопределенное название конкурента для пользователя';
COMMENT ON COLUMN user_competitors.is_favorite IS 'Избранный конкурент';
COMMENT ON COLUMN user_competitors.is_active IS 'Активен ли для этого пользователя';

-- Индексы
CREATE INDEX idx_user_competitors_user ON user_competitors(user_account_id, is_active);
CREATE INDEX idx_user_competitors_competitor ON user_competitors(competitor_id);

-- RLS (отключен - авторизация на уровне API через userAccountId)
-- Бэкенд использует service_role key, который обходит RLS автоматически

-- =====================================================
-- ТАБЛИЦА 3: competitor_creatives (Креативы конкурентов)
-- =====================================================

CREATE TABLE IF NOT EXISTS competitor_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,

  -- Идентификация в Facebook Ads Library
  fb_ad_archive_id TEXT NOT NULL UNIQUE,

  -- Медиа контент
  media_type TEXT NOT NULL CHECK (media_type IN ('video', 'image', 'carousel')),
  media_urls JSONB DEFAULT '[]',
  thumbnail_url TEXT,

  -- Текстовый контент
  body_text TEXT,
  headline TEXT,
  cta_type TEXT,

  -- Метаданные из Ads Library
  platforms JSONB DEFAULT '["facebook"]',
  first_shown_date DATE,
  is_active BOOLEAN DEFAULT true,

  -- Сырые данные от API (для отладки)
  raw_data JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE competitor_creatives IS 'Креативы конкурентов из Facebook Ads Library. Дедуплицированы глобально по fb_ad_archive_id';
COMMENT ON COLUMN competitor_creatives.fb_ad_archive_id IS 'ID объявления в Ads Library (уникальный)';
COMMENT ON COLUMN competitor_creatives.media_type IS 'Тип медиа: video, image, carousel';
COMMENT ON COLUMN competitor_creatives.media_urls IS 'JSON массив URL медиа файлов';
COMMENT ON COLUMN competitor_creatives.platforms IS 'JSON массив платформ: facebook, instagram, messenger';
COMMENT ON COLUMN competitor_creatives.is_active IS 'Активно ли объявление в Ads Library';

-- Индексы
CREATE INDEX idx_competitor_creatives_competitor ON competitor_creatives(competitor_id, created_at DESC);
CREATE INDEX idx_competitor_creatives_archive_id ON competitor_creatives(fb_ad_archive_id);
CREATE INDEX idx_competitor_creatives_media_type ON competitor_creatives(media_type);
CREATE INDEX idx_competitor_creatives_active ON competitor_creatives(is_active);

-- =====================================================
-- ТАБЛИЦА 4: competitor_creative_analysis (OCR/ASR анализ)
-- =====================================================

CREATE TABLE IF NOT EXISTS competitor_creative_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES competitor_creatives(id) ON DELETE CASCADE UNIQUE,

  -- Транскрипция (для видео)
  transcript TEXT,
  transcript_lang TEXT DEFAULT 'ru',

  -- OCR (для изображений)
  ocr_text TEXT,

  -- Статус обработки
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE competitor_creative_analysis IS 'Результаты OCR/ASR обработки креативов конкурентов';
COMMENT ON COLUMN competitor_creative_analysis.transcript IS 'Транскрипция аудио из видео (Whisper)';
COMMENT ON COLUMN competitor_creative_analysis.ocr_text IS 'Текст с изображения (GPT-4 Vision)';
COMMENT ON COLUMN competitor_creative_analysis.processing_status IS 'Статус обработки: pending, processing, completed, failed';

-- Индексы
CREATE INDEX idx_analysis_creative ON competitor_creative_analysis(creative_id);
CREATE INDEX idx_analysis_status ON competitor_creative_analysis(processing_status) WHERE processing_status IN ('pending', 'processing');

-- =====================================================
-- ТАБЛИЦА 5: competitor_crawl_jobs (История сборов)
-- =====================================================

CREATE TABLE IF NOT EXISTS competitor_crawl_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,

  -- Статус задачи
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Результаты
  creatives_found INTEGER DEFAULT 0,
  creatives_new INTEGER DEFAULT 0,

  -- Ошибки
  error_message TEXT,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE competitor_crawl_jobs IS 'История и очередь задач сбора креативов конкурентов';
COMMENT ON COLUMN competitor_crawl_jobs.creatives_found IS 'Всего найдено креативов';
COMMENT ON COLUMN competitor_crawl_jobs.creatives_new IS 'Новых креативов (не дубликатов)';

-- Индексы
CREATE INDEX idx_crawl_jobs_competitor ON competitor_crawl_jobs(competitor_id, created_at DESC);
CREATE INDEX idx_crawl_jobs_status ON competitor_crawl_jobs(status) WHERE status IN ('pending', 'running');
