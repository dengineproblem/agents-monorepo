-- Миграция: Добавление specs в user_briefing_responses
-- Дата: 2025-12-13
-- Описание: Procedural Memory - хранение бизнес-правил (tracking, CRM, KPI)

ALTER TABLE user_briefing_responses
ADD COLUMN IF NOT EXISTS tracking_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS crm_spec JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS kpi_spec JSONB DEFAULT '{}';

-- Комментарии
COMMENT ON COLUMN user_briefing_responses.tracking_spec IS
'Настройки атрибуции: utm поля, нормализация телефона. Пример: {"utm_ad_id_field": "utm_content", "phone_normalization": {"country": "KZ", "keep_last_digits": 11}}';

COMMENT ON COLUMN user_briefing_responses.crm_spec IS
'Настройки CRM: этапы воронки, сигналы квалификации. Пример: {"pipeline_stages": [...], "hot_signals": [...], "cold_signals": [...]}';

COMMENT ON COLUMN user_briefing_responses.kpi_spec IS
'Глобальные KPI: max CPL, лимиты изменения бюджета. Пример: {"target_cpl_max": 5000, "budget_change_max_pct": 30, "priority_services": [...]}';
