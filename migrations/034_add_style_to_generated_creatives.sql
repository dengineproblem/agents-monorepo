-- Миграция: Добавление поля style_id в generated_creatives
-- Дата: 2025-11-22
-- Описание: Добавляем поле для хранения выбранного стиля креатива (modern_performance, live_ugc, visual_hook)

-- Добавляем новое поле в таблицу generated_creatives
ALTER TABLE generated_creatives
ADD COLUMN IF NOT EXISTS style_id TEXT;

-- Комментарий к новому полю
COMMENT ON COLUMN generated_creatives.style_id IS 'Стиль креатива: modern_performance (современная графика), live_ugc (живой UGC-контент) или visual_hook (визуальный зацеп)';

