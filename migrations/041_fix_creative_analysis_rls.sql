-- Migration: Fix RLS policy for creative_analysis
-- Created: 2025-11-21
-- Purpose: Разрешить фронтенду (anon роль) читать анализы

-- Удаляем старую политику которая не работает для anon
DROP POLICY IF EXISTS "Users can view own creative analyses" ON creative_analysis;

-- Создаем новую политику для SELECT без auth.uid()
-- Фронтенд передает user_account_id в запросе, не используя auth
CREATE POLICY "Allow read access for creative analyses"
  ON creative_analysis FOR SELECT
  USING (true);

-- Для INSERT/UPDATE/DELETE оставляем доступ только service_role
CREATE POLICY "Service role can modify creative analyses"
  ON creative_analysis FOR ALL
  USING (auth.role() = 'service_role');


