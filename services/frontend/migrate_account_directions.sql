-- Миграция: Направления бизнеса (Account Directions)
-- Дата: 2025-10-11
-- Описание: Создание системы направлений для распределения бюджетов и креативов

-- =====================================================
-- 1. Таблица направлений бизнеса
-- =====================================================
CREATE TABLE IF NOT EXISTS account_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Добавляем все необходимые колонки, если их нет
DO $$ 
BEGIN
    -- user_account_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='user_account_id') THEN
        ALTER TABLE account_directions 
        ADD COLUMN user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE;
    END IF;
    
    -- name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='name') THEN
        ALTER TABLE account_directions 
        ADD COLUMN name TEXT NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100);
        
        COMMENT ON COLUMN account_directions.name IS 'Название направления (например: "Имплантация", "Виниры", "Брекеты")';
    END IF;
    
    -- fb_campaign_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='fb_campaign_id') THEN
        ALTER TABLE account_directions 
        ADD COLUMN fb_campaign_id TEXT;
        
        COMMENT ON COLUMN account_directions.fb_campaign_id IS 'ID Facebook кампании (создается автоматически при создании направления)';
    END IF;
    
    -- campaign_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='campaign_status') THEN
        ALTER TABLE account_directions 
        ADD COLUMN campaign_status TEXT DEFAULT 'PAUSED' CHECK (campaign_status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'));
        
        COMMENT ON COLUMN account_directions.campaign_status IS 'Статус Facebook кампании (синхронизируется с Facebook)';
    END IF;
    
    -- daily_budget_cents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='daily_budget_cents') THEN
        ALTER TABLE account_directions 
        ADD COLUMN daily_budget_cents INTEGER NOT NULL DEFAULT 1000 CHECK (daily_budget_cents >= 1000);
        
        COMMENT ON COLUMN account_directions.daily_budget_cents IS 'Суточный бюджет на это направление в центах (минимум $10)';
    END IF;
    
    -- target_cpl_cents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='target_cpl_cents') THEN
        ALTER TABLE account_directions 
        ADD COLUMN target_cpl_cents INTEGER NOT NULL DEFAULT 50 CHECK (target_cpl_cents >= 50);
        
        COMMENT ON COLUMN account_directions.target_cpl_cents IS 'Плановая стоимость заявки для этого направления в центах';
    END IF;
    
    -- is_active
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='account_directions' AND column_name='is_active') THEN
        ALTER TABLE account_directions 
        ADD COLUMN is_active BOOLEAN DEFAULT true;
        
        COMMENT ON COLUMN account_directions.is_active IS 'Активно ли направление (можно отключить без удаления)';
    END IF;
END $$;

-- Добавляем уникальный constraint если его нет
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_direction_name_per_user'
    ) THEN
        ALTER TABLE account_directions 
        ADD CONSTRAINT unique_direction_name_per_user UNIQUE (user_account_id, name);
    END IF;
END $$;

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_account_directions_user ON account_directions(user_account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_account_directions_campaign ON account_directions(fb_campaign_id) WHERE fb_campaign_id IS NOT NULL;

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_account_directions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_account_directions_updated_at ON account_directions;
CREATE TRIGGER trigger_update_account_directions_updated_at
BEFORE UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION update_account_directions_updated_at();

-- Комментарии к таблице
COMMENT ON TABLE account_directions IS 'Направления бизнеса для распределения бюджетов и креативов. Каждое направление = отдельная Facebook Campaign';

-- =====================================================
-- 2. Обновление таблицы user_creatives
-- =====================================================
-- Добавляем связь креативов с направлениями
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='user_creatives' AND column_name='direction_id') THEN
        ALTER TABLE user_creatives 
        ADD COLUMN direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;
        
        CREATE INDEX IF NOT EXISTS idx_user_creatives_direction ON user_creatives(direction_id) WHERE direction_id IS NOT NULL;
        
        COMMENT ON COLUMN user_creatives.direction_id IS 'Направление бизнеса, к которому относится этот креатив';
    END IF;
END $$;

-- =====================================================
-- 3. RLS (Row Level Security) политики
-- =====================================================

-- Включаем RLS для account_directions
ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;

-- Удаляем старые политики если есть
DROP POLICY IF EXISTS "Users can view own directions" ON account_directions;
DROP POLICY IF EXISTS "Users can insert own directions" ON account_directions;
DROP POLICY IF EXISTS "Users can update own directions" ON account_directions;
DROP POLICY IF EXISTS "Users can delete own directions" ON account_directions;
DROP POLICY IF EXISTS "Service role has full access to account_directions" ON account_directions;

-- Политика: пользователи могут видеть только свои направления
CREATE POLICY "Users can view own directions"
  ON account_directions
  FOR SELECT
  USING (user_account_id = auth.uid());

-- Политика: пользователи могут создавать направления для своего аккаунта
CREATE POLICY "Users can insert own directions"
  ON account_directions
  FOR INSERT
  WITH CHECK (user_account_id = auth.uid());

-- Политика: пользователи могут обновлять свои направления
CREATE POLICY "Users can update own directions"
  ON account_directions
  FOR UPDATE
  USING (user_account_id = auth.uid());

-- Политика: пользователи могут удалять свои направления
CREATE POLICY "Users can delete own directions"
  ON account_directions
  FOR DELETE
  USING (user_account_id = auth.uid());

-- Service role имеет полный доступ
CREATE POLICY "Service role has full access to account_directions"
  ON account_directions
  FOR ALL
  USING (auth.role() = 'service_role');

-- =====================================================
-- 4. Ограничения на количество направлений
-- =====================================================
-- Максимум 5 активных направлений на пользователя
CREATE OR REPLACE FUNCTION check_max_directions_per_user()
RETURNS TRIGGER AS $$
DECLARE
  direction_count INTEGER;
BEGIN
  -- Проверяем только при INSERT или когда активируем направление
  IF (TG_OP = 'INSERT' AND NEW.is_active = true) OR 
     (TG_OP = 'UPDATE' AND NEW.is_active = true AND OLD.is_active = false) THEN
    
    SELECT COUNT(*) INTO direction_count
    FROM account_directions
    WHERE user_account_id = NEW.user_account_id
      AND is_active = true
      AND id != NEW.id;
    
    IF direction_count >= 5 THEN
      RAISE EXCEPTION 'Maximum 5 active directions per user. Please deactivate an existing direction first.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_max_directions ON account_directions;
CREATE TRIGGER trigger_check_max_directions
BEFORE INSERT OR UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION check_max_directions_per_user();

-- =====================================================
-- 5. Grants для service_role
-- =====================================================
GRANT ALL ON account_directions TO service_role;

