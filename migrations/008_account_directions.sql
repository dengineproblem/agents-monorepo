-- Миграция: Таблица направлений бизнеса (account_directions)
-- Дата: 2025-10-12
-- Описание: Каждое направление = 1 Facebook Campaign с выбранным objective

-- =====================================================
-- СОЗДАНИЕ ТАБЛИЦЫ
-- =====================================================

CREATE TABLE IF NOT EXISTS account_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Основные параметры направления
  name TEXT NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
  
  -- Тип кампании (objective)
  objective TEXT NOT NULL CHECK (objective IN ('whatsapp', 'instagram_traffic', 'site_leads')),
  
  -- Facebook Campaign (создается при создании направления)
  fb_campaign_id TEXT,
  campaign_status TEXT DEFAULT 'PAUSED' CHECK (campaign_status IN ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED')),
  
  -- Бюджет и целевые показатели
  daily_budget_cents INTEGER NOT NULL DEFAULT 1000 CHECK (daily_budget_cents >= 1000),
  target_cpl_cents INTEGER NOT NULL DEFAULT 50 CHECK (target_cpl_cents >= 50),
  
  -- Статус направления
  is_active BOOLEAN DEFAULT true,
  
  -- Метаданные
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ограничения
  CONSTRAINT unique_direction_name_per_user UNIQUE (user_account_id, name)
);

-- Комментарии
COMMENT ON TABLE account_directions IS 'Направления бизнеса. Каждое направление = 1 Facebook Campaign с определённым objective. Креативы и бюджеты распределяются по направлениям.';
COMMENT ON COLUMN account_directions.name IS 'Название направления (например: "Имплантация", "Виниры", "Брекеты")';
COMMENT ON COLUMN account_directions.objective IS 'Тип кампании: whatsapp, instagram_traffic, site_leads';
COMMENT ON COLUMN account_directions.fb_campaign_id IS 'ID Facebook кампании (создается автоматически при создании направления)';
COMMENT ON COLUMN account_directions.campaign_status IS 'Статус Facebook кампании';
COMMENT ON COLUMN account_directions.daily_budget_cents IS 'Суточный бюджет на направление (минимум $10 = 1000 центов)';
COMMENT ON COLUMN account_directions.target_cpl_cents IS 'Целевая стоимость заявки (минимум $0.50 = 50 центов)';
COMMENT ON COLUMN account_directions.is_active IS 'Активно ли направление';

-- =====================================================
-- ИНДЕКСЫ
-- =====================================================

CREATE INDEX idx_account_directions_user ON account_directions(user_account_id, is_active);
CREATE INDEX idx_account_directions_campaign ON account_directions(fb_campaign_id) WHERE fb_campaign_id IS NOT NULL;
CREATE INDEX idx_account_directions_objective ON account_directions(user_account_id, objective);

-- =====================================================
-- ТРИГГЕРЫ
-- =====================================================

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_account_directions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_account_directions_updated_at
BEFORE UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION update_account_directions_updated_at();

-- Триггер проверки максимум 5 активных направлений на пользователя
CREATE OR REPLACE FUNCTION check_max_directions_per_user()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Проверяем только при INSERT или при UPDATE is_active с false на true
  IF (TG_OP = 'INSERT' AND NEW.is_active = true) OR 
     (TG_OP = 'UPDATE' AND OLD.is_active = false AND NEW.is_active = true) THEN
    
    SELECT COUNT(*) INTO active_count
    FROM account_directions
    WHERE user_account_id = NEW.user_account_id
      AND is_active = true
      AND id != NEW.id; -- исключаем текущую запись при UPDATE
    
    IF active_count >= 5 THEN
      RAISE EXCEPTION 'Maximum 5 active directions per user. Current active: %', active_count;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_max_directions
BEFORE INSERT OR UPDATE ON account_directions
FOR EACH ROW
EXECUTE FUNCTION check_max_directions_per_user();

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================

ALTER TABLE account_directions ENABLE ROW LEVEL SECURITY;

-- Политика: пользователи видят только свои направления
CREATE POLICY "Users can view own directions"
  ON account_directions
  FOR SELECT
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Users can insert own directions"
  ON account_directions
  FOR INSERT
  WITH CHECK (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Users can update own directions"
  ON account_directions
  FOR UPDATE
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

CREATE POLICY "Users can delete own directions"
  ON account_directions
  FOR DELETE
  USING (auth.uid() = (SELECT id FROM user_accounts WHERE id = user_account_id));

-- Политика для service_role (полный доступ)
CREATE POLICY "Service role has full access to account_directions"
  ON account_directions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- СВЯЗЬ С user_creatives
-- =====================================================

-- Добавляем поле direction_id в user_creatives
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_creatives' AND column_name = 'direction_id'
  ) THEN
    ALTER TABLE user_creatives
      ADD COLUMN direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;
    
    CREATE INDEX idx_user_creatives_direction ON user_creatives(direction_id);
    
    COMMENT ON COLUMN user_creatives.direction_id IS 'Направление, к которому привязан креатив';
  END IF;
END $$;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
Структура:
- Каждое направление имеет ОДИН objective (whatsapp, instagram_traffic, site_leads)
- При создании направления создается ОДНА Facebook Campaign с этим objective
- Все креативы направления используют этот же objective
- Название кампании: "[{name}] {objective_readable}"
  Например: "[Имплантация] WhatsApp", "[Виниры] Instagram Traffic"

Если клиенту нужны разные objective для одного направления бизнеса,
он создаст 2 направления:
- "Имплантация (WhatsApp)" с objective=whatsapp
- "Имплантация (Instagram)" с objective=instagram_traffic
*/

