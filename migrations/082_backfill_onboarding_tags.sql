-- Migration 082: Backfill onboarding tags

-- 0. Удаляем устаревший тег added_audience
UPDATE user_accounts
SET onboarding_tags = onboarding_tags - 'added_audience'
WHERE onboarding_tags @> '["added_audience"]'::jsonb;

-- 1. generated_image — у кого есть креативы с image_url
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["generated_image"]'::jsonb
WHERE id IN (
  SELECT DISTINCT user_id FROM generated_creatives WHERE image_url IS NOT NULL
)
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["generated_image"]'::jsonb)
AND is_tech_admin = false;

-- 2. generated_carousel — у кого есть карусели (creative_type = 'carousel' в generated_creatives)
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["generated_carousel"]'::jsonb
WHERE id IN (
  SELECT DISTINCT user_id FROM generated_creatives WHERE creative_type = 'carousel'
)
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["generated_carousel"]'::jsonb)
AND is_tech_admin = false;

-- 3. generated_text — у кого есть текстовые креативы (text_generation_history)
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["generated_text"]'::jsonb
WHERE id IN (
  SELECT DISTINCT user_id FROM text_generation_history
)
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["generated_text"]'::jsonb)
AND is_tech_admin = false;

-- 4. added_custom_audience — у кого есть ig_seed_audience_id
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["added_custom_audience"]'::jsonb
WHERE ig_seed_audience_id IS NOT NULL
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["added_custom_audience"]'::jsonb)
AND is_tech_admin = false;

-- 5. added_competitors — у кого есть конкуренты (через user_competitors)
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["added_competitors"]'::jsonb
WHERE id IN (
  SELECT DISTINCT user_account_id FROM user_competitors WHERE user_account_id IS NOT NULL
)
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["added_competitors"]'::jsonb)
AND is_tech_admin = false;

-- 6. launched_creative_test — у кого есть креатив-тесты (поле user_id)
UPDATE user_accounts
SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["launched_creative_test"]'::jsonb
WHERE id IN (
  SELECT DISTINCT user_id FROM creative_tests WHERE user_id IS NOT NULL
)
AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["launched_creative_test"]'::jsonb)
AND is_tech_admin = false;

-- 7. used_llm_analysis — у кого есть запросы к анализатору (если есть таблица)
-- UPDATE user_accounts
-- SET onboarding_tags = COALESCE(onboarding_tags, '[]'::jsonb) || '["used_llm_analysis"]'::jsonb
-- WHERE id IN (
--   SELECT DISTINCT user_id FROM llm_analysis_requests
-- )
-- AND NOT (COALESCE(onboarding_tags, '[]'::jsonb) @> '["used_llm_analysis"]'::jsonb)
-- AND is_tech_admin = false;

-- Проверка результата (выполнить отдельно после миграции):
-- SELECT COUNT(*) as users_with_tags FROM user_accounts
-- WHERE jsonb_array_length(COALESCE(onboarding_tags, '[]'::jsonb)) > 0 AND is_tech_admin = false;
