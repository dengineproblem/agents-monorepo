-- Миграция: Система онбординга пользователей
-- Дата: 2025-12-08
-- Описание: Добавляет этапы онбординга, теги, историю изменений,
--           таблицу уведомлений и флаг техадмина

-- ============================================
-- 1. Новые поля в user_accounts
-- ============================================

-- Этап онбординга пользователя
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS onboarding_stage VARCHAR(30) DEFAULT 'registered';

-- Добавляем constraint отдельно (PostgreSQL не поддерживает ADD CONSTRAINT IF NOT EXISTS напрямую)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_accounts_onboarding_stage_check'
  ) THEN
    ALTER TABLE user_accounts
    ADD CONSTRAINT user_accounts_onboarding_stage_check
    CHECK (onboarding_stage IN (
      'registered',           -- Регистрация
      'fb_pending',           -- Заявка на подключение FB
      'fb_connected',         -- FB подключен
      'direction_created',    -- Создал направление
      'creative_created',     -- Создал/загрузил креатив
      'ads_launched',         -- Запустил рекламу
      'first_report',         -- Получил первый отчёт
      'roi_configured',       -- Настроил ROI аналитику
      'active',               -- Активный пользователь
      'inactive'              -- Неактивен
    ));
  END IF;
END $$;

-- Теги пользователя (JSON массив)
-- Примеры: ["tiktok_connected", "generated_image", "generated_carousel",
--           "generated_text", "added_competitors", "added_audience"]
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS onboarding_tags JSONB DEFAULT '[]';

-- Флаг технического аккаунта (для impersonation)
-- Действия этого аккаунта НЕ записываются в аналитику
ALTER TABLE user_accounts
ADD COLUMN IF NOT EXISTS is_tech_admin BOOLEAN DEFAULT false;

-- Индекс для быстрой фильтрации по этапам
CREATE INDEX IF NOT EXISTS idx_user_accounts_onboarding_stage
ON user_accounts(onboarding_stage);

-- Индекс для фильтрации техадминов
CREATE INDEX IF NOT EXISTS idx_user_accounts_tech_admin
ON user_accounts(is_tech_admin) WHERE is_tech_admin = true;

-- ============================================
-- 2. Таблица истории изменений этапов (аудит)
-- ============================================

CREATE TABLE IF NOT EXISTS onboarding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Что изменилось
  stage_from VARCHAR(30),
  stage_to VARCHAR(30) NOT NULL,

  -- Кто изменил (техспец или система)
  changed_by UUID REFERENCES user_accounts(id),
  change_reason TEXT,

  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_history_user
ON onboarding_history(user_account_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_history_created
ON onboarding_history(created_at);

-- Комментарии
COMMENT ON TABLE onboarding_history IS 'История изменений этапов онбординга пользователей';
COMMENT ON COLUMN onboarding_history.changed_by IS 'ID пользователя который изменил этап (NULL = автоматически)';
COMMENT ON COLUMN onboarding_history.change_reason IS 'Причина изменения (опционально)';

-- ============================================
-- 3. Таблица уведомлений пользователей
-- ============================================

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Тип и содержимое
  type VARCHAR(50) NOT NULL,  -- 'fb_approved', 'fb_rejected', 'stage_changed', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,

  -- Статусы доставки
  is_read BOOLEAN DEFAULT false,
  telegram_sent BOOLEAN DEFAULT false,

  -- Метаданные (доп. данные для клиента)
  metadata JSONB DEFAULT '{}',

  -- Временные метки
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для получения уведомлений пользователя
CREATE INDEX IF NOT EXISTS idx_notifications_user
ON user_notifications(user_account_id);

-- Частичный индекс для быстрого подсчёта непрочитанных
CREATE INDEX IF NOT EXISTS idx_notifications_unread
ON user_notifications(user_account_id, is_read)
WHERE is_read = false;

-- Индекс для сортировки по дате
CREATE INDEX IF NOT EXISTS idx_notifications_created
ON user_notifications(created_at DESC);

-- Комментарии
COMMENT ON TABLE user_notifications IS 'Уведомления для пользователей (in-app и telegram)';
COMMENT ON COLUMN user_notifications.type IS 'Тип уведомления: fb_approved, fb_rejected, stage_changed, etc.';
COMMENT ON COLUMN user_notifications.telegram_sent IS 'Было ли отправлено в Telegram';

-- ============================================
-- 4. RLS политики
-- ============================================

-- Включаем RLS для таблиц
ALTER TABLE onboarding_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Политики для onboarding_history (только service_role)
DROP POLICY IF EXISTS "Service role full access to onboarding_history" ON onboarding_history;
CREATE POLICY "Service role full access to onboarding_history"
ON onboarding_history
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Политики для user_notifications (только service_role)
DROP POLICY IF EXISTS "Service role full access to user_notifications" ON user_notifications;
CREATE POLICY "Service role full access to user_notifications"
ON user_notifications
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 5. Обновление существующих пользователей
-- ============================================

-- Устанавливаем начальные этапы на основе существующих данных

-- Пользователи с fb_connection_status = 'pending_review' → fb_pending
UPDATE user_accounts
SET onboarding_stage = 'fb_pending'
WHERE fb_connection_status = 'pending_review'
  AND onboarding_stage = 'registered';

-- Пользователи с access_token (FB подключен) → fb_connected
UPDATE user_accounts
SET onboarding_stage = 'fb_connected'
WHERE access_token IS NOT NULL
  AND access_token != ''
  AND onboarding_stage = 'registered';

-- Пользователи с направлениями → direction_created
UPDATE user_accounts ua
SET onboarding_stage = 'direction_created'
WHERE onboarding_stage = 'fb_connected'
  AND EXISTS (
    SELECT 1 FROM account_directions ad
    WHERE ad.user_account_id = ua.id
  );

-- Пользователи с креативами → creative_created
UPDATE user_accounts ua
SET onboarding_stage = 'creative_created'
WHERE onboarding_stage = 'direction_created'
  AND EXISTS (
    SELECT 1 FROM user_creatives uc
    WHERE uc.user_id = ua.id
  );

-- Пользователи с запущенной рекламой → ads_launched
UPDATE user_accounts ua
SET onboarding_stage = 'ads_launched'
WHERE onboarding_stage IN ('creative_created', 'direction_created')
  AND EXISTS (
    SELECT 1 FROM creative_metrics_history cmh
    WHERE cmh.user_account_id = ua.id
  );

-- Активные пользователи (is_active = true и есть активность) → active
UPDATE user_accounts ua
SET onboarding_stage = 'active'
WHERE is_active = true
  AND onboarding_stage = 'ads_launched'
  AND EXISTS (
    SELECT 1 FROM creative_metrics_history cmh
    WHERE cmh.user_account_id = ua.id
      AND cmh.created_at > NOW() - INTERVAL '7 days'
  );

-- Неактивные пользователи → inactive
UPDATE user_accounts
SET onboarding_stage = 'inactive'
WHERE is_active = false;

-- Добавляем теги для пользователей с TikTok
UPDATE user_accounts
SET onboarding_tags = onboarding_tags || '["tiktok_connected"]'::jsonb
WHERE tiktok_access_token IS NOT NULL
  AND tiktok_access_token != ''
  AND NOT (onboarding_tags @> '["tiktok_connected"]');

-- Добавляем тег для пользователей, которые запускали быстрый тест креатива
UPDATE user_accounts ua
SET onboarding_tags = onboarding_tags || '["used_creative_test"]'::jsonb
WHERE EXISTS (
    SELECT 1 FROM creative_tests ct
    WHERE ct.user_id = ua.id
  )
  AND NOT (onboarding_tags @> '["used_creative_test"]');

-- Добавляем тег для пользователей, которые использовали LLM анализ креативов
UPDATE user_accounts ua
SET onboarding_tags = onboarding_tags || '["used_llm_analysis"]'::jsonb
WHERE EXISTS (
    SELECT 1 FROM creative_analysis ca
    WHERE ca.user_account_id = ua.id
  )
  AND NOT (onboarding_tags @> '["used_llm_analysis"]');
