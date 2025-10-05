-- Миграция для создания таблиц обработки видео и креативов
-- Создание: 2025-10-05
-- Описание: Таблицы для хранения пользовательских креативов и транскрипций видео

-- ============================================================
-- 1. Таблица user_creatives
-- ============================================================
-- Хранит информацию о загруженных и обработанных видео креативах

CREATE TABLE IF NOT EXISTS public.user_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  
  -- Facebook IDs
  fb_video_id TEXT,
  fb_creative_id_whatsapp TEXT,
  fb_creative_id_instagram_traffic TEXT,
  fb_creative_id_site_leads TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Indexes
  CONSTRAINT user_creatives_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Индексы для оптимизации поиска
CREATE INDEX IF NOT EXISTS idx_user_creatives_user_id ON public.user_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_user_creatives_status ON public.user_creatives(status);
CREATE INDEX IF NOT EXISTS idx_user_creatives_created_at ON public.user_creatives(created_at DESC);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_user_creatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_creatives_updated_at
  BEFORE UPDATE ON public.user_creatives
  FOR EACH ROW
  EXECUTE FUNCTION update_user_creatives_updated_at();

-- ============================================================
-- 2. Таблица creative_transcripts
-- ============================================================
-- Хранит транскрипции видео креативов

CREATE TABLE IF NOT EXISTS public.creative_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',
  source TEXT NOT NULL DEFAULT 'whisper' CHECK (source IN ('whisper', 'manual', 'auto')),
  text TEXT NOT NULL,
  confidence NUMERIC(5, 4),
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Foreign key
  CONSTRAINT creative_transcripts_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.user_creatives(id) ON DELETE CASCADE
);

-- Индексы для оптимизации поиска
CREATE INDEX IF NOT EXISTS idx_creative_transcripts_creative_id ON public.creative_transcripts(creative_id);
CREATE INDEX IF NOT EXISTS idx_creative_transcripts_lang ON public.creative_transcripts(lang);
CREATE INDEX IF NOT EXISTS idx_creative_transcripts_status ON public.creative_transcripts(status);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_creative_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_creative_transcripts_updated_at
  BEFORE UPDATE ON public.creative_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION update_creative_transcripts_updated_at();

-- ============================================================
-- 3. RLS (Row Level Security) политики
-- ============================================================

-- Включаем RLS для таблиц
ALTER TABLE public.user_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_transcripts ENABLE ROW LEVEL SECURITY;

-- Политики для user_creatives
-- Пользователи могут видеть только свои креативы
CREATE POLICY "Users can view own creatives"
  ON public.user_creatives
  FOR SELECT
  USING (auth.uid() = user_id);

-- Пользователи могут вставлять свои креативы
CREATE POLICY "Users can insert own creatives"
  ON public.user_creatives
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Пользователи могут обновлять свои креативы
CREATE POLICY "Users can update own creatives"
  ON public.user_creatives
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Пользователи могут удалять свои креативы
CREATE POLICY "Users can delete own creatives"
  ON public.user_creatives
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role имеет полный доступ к user_creatives
CREATE POLICY "Service role has full access to user_creatives"
  ON public.user_creatives
  FOR ALL
  USING (auth.role() = 'service_role');

-- Политики для creative_transcripts
-- Пользователи могут видеть транскрипции своих креативов
CREATE POLICY "Users can view own transcripts"
  ON public.creative_transcripts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_creatives
      WHERE user_creatives.id = creative_transcripts.creative_id
      AND user_creatives.user_id = auth.uid()
    )
  );

-- Service role имеет полный доступ к creative_transcripts
CREATE POLICY "Service role has full access to creative_transcripts"
  ON public.creative_transcripts
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 4. Комментарии для документации
-- ============================================================

COMMENT ON TABLE public.user_creatives IS 'Хранит информацию о пользовательских видео креативах для Facebook Ads';
COMMENT ON TABLE public.creative_transcripts IS 'Хранит транскрипции видео креативов';

COMMENT ON COLUMN public.user_creatives.status IS 'Статус обработки: processing, ready, failed';
COMMENT ON COLUMN public.user_creatives.fb_video_id IS 'ID загруженного видео в Facebook';
COMMENT ON COLUMN public.user_creatives.fb_creative_id_whatsapp IS 'ID креатива для WhatsApp';
COMMENT ON COLUMN public.user_creatives.fb_creative_id_instagram_traffic IS 'ID креатива для Instagram профиля';
COMMENT ON COLUMN public.user_creatives.fb_creative_id_site_leads IS 'ID креатива для лидов на сайт';

COMMENT ON COLUMN public.creative_transcripts.source IS 'Источник транскрипции: whisper, manual, auto';
COMMENT ON COLUMN public.creative_transcripts.confidence IS 'Уровень уверенности транскрипции (0-1)';
COMMENT ON COLUMN public.creative_transcripts.duration_sec IS 'Длительность аудио в секундах';
