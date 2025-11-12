-- Migration: Drop skip_whatsapp_number_in_api flag from user_accounts
-- Date: 2025-11-12
-- Description:
-- Удаляем флаг skip_whatsapp_number_in_api, т.к. теперь используем
-- универсальную логику try-catch для всех пользователей:
-- 1) Пытаемся создать ad set с номером из направления
-- 2) Если получаем ошибку 2446885 - повторяем без номера (FB подставит дефолтный)

ALTER TABLE user_accounts
DROP COLUMN IF EXISTS skip_whatsapp_number_in_api;
