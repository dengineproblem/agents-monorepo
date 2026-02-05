-- Таблица плановых показателей для консультантов
CREATE TABLE IF NOT EXISTS consultant_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,

  -- Период (неделя или месяц)
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('week', 'month')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Целевые показатели по конверсиям (в процентах)
  target_lead_to_booked_rate INTEGER CHECK (target_lead_to_booked_rate >= 0 AND target_lead_to_booked_rate <= 100),
  target_booked_to_completed_rate INTEGER CHECK (target_booked_to_completed_rate >= 0 AND target_booked_to_completed_rate <= 100),
  target_completed_to_sales_rate INTEGER CHECK (target_completed_to_sales_rate >= 0 AND target_completed_to_sales_rate <= 100),

  -- Целевые показатели по продажам
  target_sales_amount DECIMAL(12, 2) CHECK (target_sales_amount >= 0),
  target_sales_count INTEGER CHECK (target_sales_count >= 0),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Уникальность: один консультант - один период
  UNIQUE(consultant_id, period_type, period_start)
);

-- Индексы для быстрого поиска
CREATE INDEX idx_consultant_targets_consultant ON consultant_targets(consultant_id);
CREATE INDEX idx_consultant_targets_period ON consultant_targets(period_type, period_start, period_end);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_consultant_targets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_consultant_targets_updated_at
  BEFORE UPDATE ON consultant_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_consultant_targets_updated_at();

-- Комментарии
COMMENT ON TABLE consultant_targets IS 'Плановые показатели для консультантов по периодам';
COMMENT ON COLUMN consultant_targets.period_type IS 'Тип периода: week (неделя) или month (месяц)';
COMMENT ON COLUMN consultant_targets.target_lead_to_booked_rate IS 'Целевая конверсия Лид → Запись (%)';
COMMENT ON COLUMN consultant_targets.target_booked_to_completed_rate IS 'Целевая конверсия Запись → Проведено (%)';
COMMENT ON COLUMN consultant_targets.target_completed_to_sales_rate IS 'Целевая конверсия Проведено → Продажа (%)';
COMMENT ON COLUMN consultant_targets.target_sales_amount IS 'Целевая сумма продаж';
COMMENT ON COLUMN consultant_targets.target_sales_count IS 'Целевое количество продаж';
