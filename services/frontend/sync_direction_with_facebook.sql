-- Миграция: Синхронизация is_active с Facebook Campaign
-- Дата: 2025-10-11
-- Описание: При изменении is_active автоматически останавливать/запускать FB кампанию

-- =====================================================
-- 1. Включаем расширение pg_net для HTTP запросов
-- =====================================================
-- pg_net позволяет делать HTTP запросы из триггеров
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =====================================================
-- 2. Функция синхронизации с Facebook
-- =====================================================
CREATE OR REPLACE FUNCTION sync_direction_status_with_facebook()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT := 'https://agents.performanteaiagency.com/api/direction/sync-status';
  request_id BIGINT;
BEGIN
  -- Проверяем, изменился ли статус is_active
  IF (TG_OP = 'UPDATE' AND OLD.is_active IS DISTINCT FROM NEW.is_active) OR
     (TG_OP = 'INSERT' AND NEW.is_active = false) THEN
    
    -- Если есть fb_campaign_id, отправляем запрос на синхронизацию
    IF NEW.fb_campaign_id IS NOT NULL THEN
      
      -- Обновляем campaign_status в соответствии с is_active
      NEW.campaign_status := CASE 
        WHEN NEW.is_active THEN 'ACTIVE'
        ELSE 'PAUSED'
      END;
      
      -- Отправляем асинхронный HTTP запрос на webhook
      SELECT net.http_post(
        url := webhook_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'direction_id', NEW.id,
          'user_account_id', NEW.user_account_id,
          'fb_campaign_id', NEW.fb_campaign_id,
          'is_active', NEW.is_active,
          'action', CASE WHEN NEW.is_active THEN 'activate' ELSE 'pause' END
        )
      ) INTO request_id;
      
      -- Логируем запрос (опционально)
      RAISE NOTICE 'Direction % status changed to %. FB Campaign % sync request sent (request_id: %)',
        NEW.id, 
        CASE WHEN NEW.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,
        NEW.fb_campaign_id,
        request_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Комментарий к функции
COMMENT ON FUNCTION sync_direction_status_with_facebook() IS 'Автоматически синхронизирует статус направления с Facebook Campaign при изменении is_active';

-- =====================================================
-- 3. Создаём триггер синхронизации
-- =====================================================
DROP TRIGGER IF EXISTS trigger_sync_direction_with_facebook ON account_directions;

CREATE TRIGGER trigger_sync_direction_with_facebook
BEFORE UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION sync_direction_status_with_facebook();

-- =====================================================
-- 4. Альтернатива: Функция для ручного вызова из фронтенда
-- =====================================================
-- Если pg_net недоступен или webhook нужно вызывать из фронтенда
CREATE OR REPLACE FUNCTION toggle_direction_status(
  p_direction_id UUID,
  p_new_status BOOLEAN
)
RETURNS jsonb AS $$
DECLARE
  v_fb_campaign_id TEXT;
  v_user_account_id UUID;
  v_result jsonb;
BEGIN
  -- Получаем данные направления
  SELECT fb_campaign_id, user_account_id 
  INTO v_fb_campaign_id, v_user_account_id
  FROM account_directions
  WHERE id = p_direction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Direction not found'
    );
  END IF;
  
  -- Обновляем статус в БД
  UPDATE account_directions
  SET 
    is_active = p_new_status,
    campaign_status = CASE WHEN p_new_status THEN 'ACTIVE' ELSE 'PAUSED' END,
    updated_at = NOW()
  WHERE id = p_direction_id;
  
  -- Возвращаем данные для фронтенда (он сам вызовет API)
  RETURN jsonb_build_object(
    'success', true,
    'direction_id', p_direction_id,
    'fb_campaign_id', v_fb_campaign_id,
    'is_active', p_new_status,
    'action', CASE WHEN p_new_status THEN 'activate' ELSE 'pause' END,
    'webhook_url', 'https://agents.performanteaiagency.com/api/direction/sync-status'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION toggle_direction_status(UUID, BOOLEAN) IS 'Переключает статус направления и возвращает данные для синхронизации с Facebook. Фронтенд должен вызвать webhook.';

-- =====================================================
-- 5. Таблица логов синхронизации (опционально)
-- =====================================================
CREATE TABLE IF NOT EXISTS direction_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES account_directions(id) ON DELETE CASCADE,
  fb_campaign_id TEXT,
  action TEXT CHECK (action IN ('activate', 'pause')),
  status TEXT CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direction_sync_log_direction ON direction_sync_log(direction_id);
CREATE INDEX IF NOT EXISTS idx_direction_sync_log_created ON direction_sync_log(created_at DESC);

COMMENT ON TABLE direction_sync_log IS 'Лог синхронизации статусов направлений с Facebook';

-- =====================================================
-- 6. Функция для записи в лог
-- =====================================================
CREATE OR REPLACE FUNCTION log_direction_sync(
  p_direction_id UUID,
  p_fb_campaign_id TEXT,
  p_action TEXT,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO direction_sync_log (
    direction_id,
    fb_campaign_id,
    action,
    status,
    error_message
  ) VALUES (
    p_direction_id,
    p_fb_campaign_id,
    p_action,
    p_status,
    p_error_message
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. Grants
-- =====================================================
GRANT ALL ON direction_sync_log TO service_role;
GRANT EXECUTE ON FUNCTION toggle_direction_status(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION log_direction_sync(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- =====================================================
-- 8. RLS для таблицы логов
-- =====================================================
ALTER TABLE direction_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync logs"
  ON direction_sync_log
  FOR SELECT
  USING (
    direction_id IN (
      SELECT id FROM account_directions WHERE user_account_id = auth.uid()
    )
  );

CREATE POLICY "Service role has full access to sync logs"
  ON direction_sync_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- 9. Пример использования
-- =====================================================
-- Вариант 1: Автоматическая синхронизация через триггер (если pg_net доступен)
-- UPDATE account_directions SET is_active = false WHERE id = 'uuid';

-- Вариант 2: Через функцию из фронтенда:
-- SELECT * FROM toggle_direction_status('direction-uuid', false);
-- Фронтенд получит webhook_url и данные, затем вызовет API

-- Просмотр логов синхронизации:
-- SELECT * FROM direction_sync_log 
-- WHERE direction_id = 'uuid' 
-- ORDER BY created_at DESC 
-- LIMIT 10;

