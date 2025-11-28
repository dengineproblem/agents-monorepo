-- Миграция: добавление связи user_creatives -> generated_creatives
-- Цель: получать тексты (offer, bullets, profits) и изображения для image/carousel креативов

-- 1. Связь с generated_creatives для получения текстов image/carousel
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS generated_creative_id UUID
REFERENCES generated_creatives(id) ON DELETE SET NULL;

-- 2. URL изображения для миниатюр (image креативы)
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Данные карусели (carousel креативы)
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS carousel_data JSONB;

-- 4. Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_user_creatives_generated_creative
ON user_creatives(generated_creative_id)
WHERE generated_creative_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_creatives_media_type_user
ON user_creatives(user_id, media_type);

-- 5. Комментарии для документации
COMMENT ON COLUMN user_creatives.generated_creative_id IS
'Ссылка на AI-сгенерированный креатив (для image/carousel). Позволяет получить offer/bullets/profits.';

COMMENT ON COLUMN user_creatives.image_url IS
'URL изображения в Supabase Storage (для media_type=image). Используется для показа миниатюр.';

COMMENT ON COLUMN user_creatives.carousel_data IS
'JSONB массив карточек карусели (для media_type=carousel). Структура: [{order, text, image_url, image_url_4k}]';
