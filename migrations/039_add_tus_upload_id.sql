-- Миграция для добавления tus_upload_id в user_creatives
-- Создание: 2026-01-10
-- Описание: Уникальный идентификатор TUS загрузки для точного отслеживания статуса

ALTER TABLE public.user_creatives
ADD COLUMN IF NOT EXISTS tus_upload_id TEXT;

-- Индекс для быстрого поиска по tus_upload_id
CREATE INDEX IF NOT EXISTS idx_user_creatives_tus_upload_id
ON public.user_creatives(tus_upload_id)
WHERE tus_upload_id IS NOT NULL;

COMMENT ON COLUMN public.user_creatives.tus_upload_id IS 'ID загрузки TUS для отслеживания статуса обработки';
