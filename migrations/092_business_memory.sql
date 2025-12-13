-- Миграция: Business Memory Layer
-- Дата: 2025-12-13
-- Описание: Единая система памяти для Chat Assistant
--   1. Session Memory (focus_entities) - контекст текущего диалога
--   2. Procedural Memory (specs) - бизнес-правила
--   3. Mid-term Memory (agent_notes) - накопленные наблюдения
--   4. Semantic Memory (dialog summary/tags) - поиск по диалогам

-- ============================================================
-- 1. SESSION MEMORY: focus_entities в ai_conversations
-- ============================================================

ALTER TABLE ai_conversations
ADD COLUMN IF NOT EXISTS focus_entities JSONB DEFAULT '{}';

COMMENT ON COLUMN ai_conversations.focus_entities IS
'Контекст текущего диалога: campaignId, directionId, dialogPhone, period, creativeId';

-- ============================================================
-- 2. PROCEDURAL MEMORY + MID-TERM MEMORY в user_briefing_responses
-- ============================================================

-- Specs: бизнес-правила (атрибуция, CRM, KPI)
ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS tracking_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS crm_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS kpi_spec JSONB DEFAULT '{}';

-- Agent Notes: накопленные наблюдения по доменам
ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS agent_notes JSONB DEFAULT '{}';

-- Индекс для быстрого доступа
CREATE INDEX IF NOT EXISTS idx_briefing_user_account
ON user_briefing_responses(user_id, account_id);

-- Комментарии
COMMENT ON COLUMN user_briefing_responses.tracking_spec IS
'Настройки атрибуции: utm поля, нормализация телефона. Пример: {"utm_ad_id_field": "utm_content", "phone_normalization": {"country": "KZ", "keep_last_digits": 11}}';

COMMENT ON COLUMN user_briefing_responses.crm_spec IS
'Настройки CRM: этапы воронки, сигналы квалификации. Пример: {"pipeline_stages": [...], "hot_signals": [...], "cold_signals": [...]}';

COMMENT ON COLUMN user_briefing_responses.kpi_spec IS
'Глобальные KPI: max CPL, лимиты изменения бюджета. Пример: {"target_cpl_max": 5000, "budget_change_max_pct": 30, "priority_services": [...]}';

COMMENT ON COLUMN user_briefing_responses.agent_notes IS
'Накопленные наблюдения агентов по доменам. Структура: {"ads": {"notes": [...], "updated_at": "..."}, "creative": {...}, "whatsapp": {...}, "crm": {...}}';

-- ============================================================
-- 3. SEMANTIC MEMORY: расширение dialog_analysis
-- ============================================================

ALTER TABLE dialog_analysis
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS insights_json JSONB DEFAULT '{}';

-- FTS индекс для русского языка (поиск по резюме)
CREATE INDEX IF NOT EXISTS dialog_analysis_summary_fts
ON dialog_analysis USING gin(to_tsvector('russian', COALESCE(summary, '')));

-- GIN индекс для массива тегов
CREATE INDEX IF NOT EXISTS dialog_analysis_tags_idx
ON dialog_analysis USING gin(tags);

-- Комментарии
COMMENT ON COLUMN dialog_analysis.summary IS
'Краткое резюме диалога для поиска. Пример: "Клиент интересовался имплантацией, возражал по цене, просил рассрочку"';

COMMENT ON COLUMN dialog_analysis.tags IS
'Теги для фильтрации: услуга, тип возражения и т.д. Пример: ["имплантация", "возражение:цена", "рассрочка"]';

COMMENT ON COLUMN dialog_analysis.insights_json IS
'Структурированные инсайты. Пример: {"objections": ["дорого"], "interests": ["имплантация"], "next_action": "перезвонить через 3 дня"}';
