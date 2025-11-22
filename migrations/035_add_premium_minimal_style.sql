-- Миграция: Обновление описания поля style_id для добавления нового стиля premium_minimal
-- Дата: 2025-11-22
-- Описание: Добавляем поддержку четвертого стиля креатива - premium_minimal

-- Обновляем комментарий к полю style_id
COMMENT ON COLUMN generated_creatives.style_id IS 'Стиль креатива: modern_performance (современная графика), live_ugc (живой UGC-контент), visual_hook (визуальный зацеп) или premium_minimal (премиум минимализм)';

