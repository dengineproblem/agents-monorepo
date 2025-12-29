-- Migration 133: Creative A/B Tests
-- Таблицы для A/B тестирования креативов (офферов и образов)

-- 1. Добавляем поля OCR и описания образа в user_creatives
ALTER TABLE user_creatives
ADD COLUMN IF NOT EXISTS ocr_text TEXT,
ADD COLUMN IF NOT EXISTS image_description TEXT;

COMMENT ON COLUMN user_creatives.ocr_text IS 'Текст извлечённый с изображения через OCR (Gemini Vision)';
COMMENT ON COLUMN user_creatives.image_description IS 'AI-описание образа/визуала на изображении';

-- 2. Основная таблица A/B тестов
CREATE TABLE IF NOT EXISTS creative_ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
  direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL,

  -- Facebook IDs
  campaign_id TEXT,

  -- Параметры теста
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  total_budget_cents INTEGER NOT NULL DEFAULT 2000,  -- $20
  impressions_per_creative INTEGER,  -- Вычисляется: 1000 / N креативов
  creatives_count INTEGER NOT NULL DEFAULT 0,

  -- Результаты
  winner_creative_id UUID REFERENCES user_creatives(id) ON DELETE SET NULL,
  analysis_json JSONB,  -- LLM анализ результатов

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Таблица элементов теста (каждый креатив в тесте)
CREATE TABLE IF NOT EXISTS creative_ab_test_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES creative_ab_tests(id) ON DELETE CASCADE,
  user_creative_id UUID NOT NULL REFERENCES user_creatives(id) ON DELETE CASCADE,

  -- Facebook IDs
  adset_id TEXT,
  ad_id TEXT,

  -- Бюджет на этот креатив
  budget_cents INTEGER NOT NULL,
  impressions_limit INTEGER NOT NULL,

  -- Метрики из Facebook
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  ctr NUMERIC(10,4),
  link_ctr NUMERIC(10,4),
  leads INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  cpm_cents INTEGER,
  cpc_cents INTEGER,
  cpl_cents INTEGER,

  -- Ранг в тесте (1 = победитель)
  rank INTEGER,

  -- Текст и образ для инсайтов
  extracted_offer_text TEXT,
  extracted_image_description TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Один креатив может быть только в одном активном тесте
  UNIQUE(test_id, user_creative_id)
);

-- 4. Расширяем conversation_insights новыми категориями
-- Убираем старый constraint если есть
ALTER TABLE conversation_insights
  DROP CONSTRAINT IF EXISTS conversation_insights_category_check;

-- Добавляем новый constraint с дополнительными категориями
ALTER TABLE conversation_insights
  ADD CONSTRAINT conversation_insights_category_check
  CHECK (category IN (
    'insight',
    'rejection_reason',
    'objection',
    'recommendation',
    'offer_text',       -- Тексты офферов с креативов
    'creative_image'    -- Описания образов/визуалов
  ));

-- 5. Индексы
CREATE INDEX IF NOT EXISTS idx_creative_ab_tests_user_id ON creative_ab_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_creative_ab_tests_account_id ON creative_ab_tests(account_id);
CREATE INDEX IF NOT EXISTS idx_creative_ab_tests_status ON creative_ab_tests(status);
CREATE INDEX IF NOT EXISTS idx_creative_ab_tests_status_running ON creative_ab_tests(status) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_creative_ab_test_items_test_id ON creative_ab_test_items(test_id);
CREATE INDEX IF NOT EXISTS idx_creative_ab_test_items_creative_id ON creative_ab_test_items(user_creative_id);

-- Индексы для инсайтов по новым категориям
CREATE INDEX IF NOT EXISTS idx_conversation_insights_offer_text
  ON conversation_insights(user_account_id, category)
  WHERE category = 'offer_text';

CREATE INDEX IF NOT EXISTS idx_conversation_insights_creative_image
  ON conversation_insights(user_account_id, category)
  WHERE category = 'creative_image';

-- 6. RLS политики
ALTER TABLE creative_ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_ab_test_items ENABLE ROW LEVEL SECURITY;

-- Политики для creative_ab_tests
CREATE POLICY "Users can view own ab tests" ON creative_ab_tests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ab tests" ON creative_ab_tests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ab tests" ON creative_ab_tests
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ab tests" ON creative_ab_tests
  FOR DELETE USING (auth.uid() = user_id);

-- Service role полный доступ
CREATE POLICY "Service role full access to ab tests" ON creative_ab_tests
  FOR ALL USING (auth.role() = 'service_role');

-- Политики для creative_ab_test_items (через связь с тестом)
CREATE POLICY "Users can view own ab test items" ON creative_ab_test_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM creative_ab_tests
      WHERE id = test_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own ab test items" ON creative_ab_test_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM creative_ab_tests
      WHERE id = test_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own ab test items" ON creative_ab_test_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM creative_ab_tests
      WHERE id = test_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to ab test items" ON creative_ab_test_items
  FOR ALL USING (auth.role() = 'service_role');

-- 7. Триггер для updated_at
CREATE OR REPLACE FUNCTION update_creative_ab_tests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_creative_ab_tests_updated_at
  BEFORE UPDATE ON creative_ab_tests
  FOR EACH ROW
  EXECUTE FUNCTION update_creative_ab_tests_updated_at();

CREATE TRIGGER trigger_creative_ab_test_items_updated_at
  BEFORE UPDATE ON creative_ab_test_items
  FOR EACH ROW
  EXECUTE FUNCTION update_creative_ab_tests_updated_at();

-- 8. Комментарии
COMMENT ON TABLE creative_ab_tests IS 'A/B тесты креативов для сравнения офферов и образов';
COMMENT ON TABLE creative_ab_test_items IS 'Элементы A/B теста - каждый креатив с отдельным AdSet';

COMMENT ON COLUMN creative_ab_tests.total_budget_cents IS 'Общий бюджет теста в центах ($20 = 2000)';
COMMENT ON COLUMN creative_ab_tests.impressions_per_creative IS 'Лимит показов на каждый креатив (1000 / N)';
COMMENT ON COLUMN creative_ab_tests.winner_creative_id IS 'ID креатива-победителя (лучший CTR/CPL)';
COMMENT ON COLUMN creative_ab_tests.analysis_json IS 'JSON с LLM анализом результатов теста';

COMMENT ON COLUMN creative_ab_test_items.rank IS 'Позиция в рейтинге (1 = лучший результат)';
COMMENT ON COLUMN creative_ab_test_items.extracted_offer_text IS 'Текст оффера для сохранения в инсайты';
COMMENT ON COLUMN creative_ab_test_items.extracted_image_description IS 'Описание образа для сохранения в инсайты';
