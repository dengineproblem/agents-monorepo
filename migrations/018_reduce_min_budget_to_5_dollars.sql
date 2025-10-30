-- Миграция: Снижение минимального бюджета до $5
-- Дата: 2025-10-30
-- Описание: Изменение CHECK constraint для daily_budget_cents с 1000 ($10) на 500 ($5)

-- =====================================================
-- ИЗМЕНЕНИЕ CHECK CONSTRAINT
-- =====================================================

-- Удаляем старое ограничение
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS account_directions_daily_budget_cents_check;

-- Добавляем новое ограничение с минимумом $5 (500 центов)
ALTER TABLE account_directions
  ADD CONSTRAINT account_directions_daily_budget_cents_check
  CHECK (daily_budget_cents >= 500);

-- Обновляем комментарий
COMMENT ON COLUMN account_directions.daily_budget_cents IS 'Суточный бюджет на направление (минимум $5 = 500 центов)';

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
Изменение применено к следующим аспектам системы:
1. Database constraint: daily_budget_cents >= 500 (вместо 1000)
2. Backend validation: обновлено в routes/directions.ts
3. Frontend validation: обновлено в CreateDirectionDialog.tsx и EditDirectionDialog.tsx

Старые направления с бюджетом >= $10 не требуют изменений.
Новые направления теперь могут иметь бюджет от $5 до любого значения.
*/
