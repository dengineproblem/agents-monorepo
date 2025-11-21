-- Добавление user_creative_id в creative_metrics_history для упрощения запросов
-- 
-- Проблема: Сейчас приходится делать join через fb_creative_id
-- Решение: Храним user_creative_id напрямую в метриках

-- 1. Добавляем столбец
ALTER TABLE creative_metrics_history 
ADD COLUMN IF NOT EXISTS user_creative_id UUID;

-- 2. Создаем индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_creative_metrics_user_creative_id 
ON creative_metrics_history(user_creative_id, user_account_id, date DESC);

-- 3. Добавляем foreign key (опционально, для целостности данных)
ALTER TABLE creative_metrics_history
ADD CONSTRAINT fk_creative_metrics_user_creative
FOREIGN KEY (user_creative_id) 
REFERENCES user_creatives(id)
ON DELETE CASCADE;

-- 4. Заполняем существующие записи (бэкфил)
-- Используем ad_creative_mapping для связи
UPDATE creative_metrics_history cmh
SET user_creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE cmh.user_creative_id IS NULL
  AND cmh.ad_id = acm.ad_id;

-- Альтернативный способ через fb_creative_id (если нет в mapping)
UPDATE creative_metrics_history cmh
SET user_creative_id = acm.user_creative_id
FROM ad_creative_mapping acm
WHERE cmh.user_creative_id IS NULL
  AND cmh.creative_id = acm.fb_creative_id
  AND cmh.user_account_id = acm.user_id;

-- Комментарии
COMMENT ON COLUMN creative_metrics_history.user_creative_id IS 
'UUID креатива из user_creatives для упрощения запросов без джойнов';

