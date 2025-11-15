-- Миграция: Добавление флага достижения ключевого этапа для лидов
-- Дата: 2025-11-15
-- Описание: Флаг "reached_key_stage" устанавливается один раз когда лид достигает
--           ключевого этапа воронки и НИКОГДА не сбрасывается, даже если лид
--           движется дальше по воронке. Это решает проблему "once qualified, always qualified".

-- =====================================================
-- ДОБАВЛЕНИЕ КОЛОНКИ reached_key_stage
-- =====================================================

DO $$
BEGIN
    -- Добавляем флаг reached_key_stage если не существует
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'reached_key_stage'
    ) THEN
        ALTER TABLE leads
            ADD COLUMN reached_key_stage BOOLEAN DEFAULT false;

        COMMENT ON COLUMN leads.reached_key_stage IS
            'Флаг достижения ключевого этапа воронки. Устанавливается один раз при достижении key_stage и никогда не сбрасывается. Обеспечивает логику "once qualified, always qualified".';
    END IF;
END $$;

-- =====================================================
-- ИНДЕКСЫ
-- =====================================================

-- Индекс для быстрого поиска квалифицированных лидов
CREATE INDEX IF NOT EXISTS idx_leads_reached_key_stage
    ON leads(user_account_id, direction_id, reached_key_stage)
    WHERE reached_key_stage = true;

-- Composite индекс для статистики квалификации по креативам
CREATE INDEX IF NOT EXISTS idx_leads_qualification_stats
    ON leads(user_account_id, direction_id, creative_id, reached_key_stage, created_at)
    WHERE reached_key_stage = true;

-- =====================================================
-- ПЕРВИЧНАЯ УСТАНОВКА ФЛАГОВ ДЛЯ СУЩЕСТВУЮЩИХ ЛИДОВ
-- =====================================================

-- Установить флаг для лидов которые СЕЙЧАС находятся на key stage своего direction
-- Это покрывает кейс когда лид уже на ключевом этапе но флаг еще не установлен

UPDATE leads l
SET reached_key_stage = true
FROM account_directions d
WHERE l.direction_id = d.id
  AND l.reached_key_stage = false
  AND d.key_stage_pipeline_id IS NOT NULL
  AND d.key_stage_status_id IS NOT NULL
  AND l.current_pipeline_id = d.key_stage_pipeline_id
  AND l.current_status_id = d.key_stage_status_id;

-- Установить флаг для лидов которые КОГДА-ЛИБО были на key stage (проверка по истории)
-- Это покрывает кейс когда лид уже прошел key stage и движется дальше

UPDATE leads l
SET reached_key_stage = true
FROM account_directions d,
     amocrm_lead_status_history h
WHERE l.direction_id = d.id
  AND l.id = h.lead_id
  AND l.reached_key_stage = false
  AND d.key_stage_pipeline_id IS NOT NULL
  AND d.key_stage_status_id IS NOT NULL
  AND h.to_pipeline_id = d.key_stage_pipeline_id
  AND h.to_status_id = d.key_stage_status_id;

-- =====================================================
-- СТАТИСТИКА МИГРАЦИИ
-- =====================================================

-- Вывести статистику по установленным флагам (для лога миграции)
DO $$
DECLARE
    total_qualified INTEGER;
    qualified_by_current INTEGER;
    qualified_by_history INTEGER;
    total_leads INTEGER;
BEGIN
    -- Всего лидов
    SELECT COUNT(*) INTO total_leads FROM leads;

    -- Всего квалифицированных
    SELECT COUNT(*) INTO total_qualified FROM leads WHERE reached_key_stage = true;

    -- Квалифицированных по текущему статусу
    SELECT COUNT(*) INTO qualified_by_current
    FROM leads l
    JOIN account_directions d ON l.direction_id = d.id
    WHERE l.reached_key_stage = true
      AND l.current_pipeline_id = d.key_stage_pipeline_id
      AND l.current_status_id = d.key_stage_status_id;

    -- Квалифицированных по истории (уже прошли key stage)
    qualified_by_history := total_qualified - qualified_by_current;

    RAISE NOTICE '=== СТАТИСТИКА МИГРАЦИИ 032 ===';
    RAISE NOTICE 'Всего лидов: %', total_leads;
    RAISE NOTICE 'Квалифицированных лидов: %', total_qualified;
    RAISE NOTICE '  - На ключевом этапе сейчас: %', qualified_by_current;
    RAISE NOTICE '  - Прошли ключевой этап ранее: %', qualified_by_history;
    RAISE NOTICE 'Процент квалификации: %%%', ROUND((total_qualified::NUMERIC / NULLIF(total_leads, 0)) * 100, 2);
END $$;

-- =====================================================
-- ПРИМЕЧАНИЕ
-- =====================================================

/*
ВАЖНО: Логика "once qualified, always qualified"

Этот флаг решает проблему когда лид достигает ключевого этапа (например "Консультация назначена"),
а затем движется дальше (например "Консультация проведена", "Оплата получена").

БЕЗ этого флага:
  - Лид на "Консультация назначена" (key stage) → квалифицирован ✅
  - Лид на "Консультация проведена" → НЕ квалифицирован ❌ (БАГ!)
  - Лид на "Оплата получена" → НЕ квалифицирован ❌ (БАГ!)

С этим флагом:
  - Лид достигает "Консультация назначена" → флаг = true ✅
  - Лид движется дальше → флаг остается true ✅
  - Статистика квалификации корректная ✅

Флаг устанавливается в следующих местах:
1. amocrmWebhooks.ts - при получении webhook о смене статуса
2. amocrmLeadsSync.ts - при синхронизации лидов из amoCRM
3. recalculate-reached-flags endpoint - при ручном пересчете

Флаг НЕ сбрасывается при:
- Смене статуса лида на любой другой
- Изменении key stage для direction (требуется ручной пересчет)
- Удалении direction (лид остается квалифицированным)

Для пересчета флагов при смене key stage используйте:
  POST /amocrm/recalculate-reached-flags?userAccountId=UUID&directionId=UUID
*/
