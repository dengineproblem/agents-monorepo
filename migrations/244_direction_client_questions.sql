-- Migration: Add client_questions array to default_ad_settings
-- Description: Добавление поддержки нескольких вариантов вопроса клиента для WhatsApp
-- Date: 2026-04-06

ALTER TABLE default_ad_settings
ADD COLUMN IF NOT EXISTS client_questions JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN default_ad_settings.client_questions IS
  'Массив вариантов первого сообщения клиента (до 5 шт). Используется вместо client_question если не пустой.';
