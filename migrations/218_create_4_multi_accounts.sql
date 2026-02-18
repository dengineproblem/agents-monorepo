-- Migration: 218_create_4_multi_accounts.sql
-- Description: Создание 4 мультиаккаунтов для демонстрации
-- Без telegram_id, с логином/паролем, подписка 29к с 2026-02-18

-- Аккаунт 1
INSERT INTO user_accounts (
  id, username, password,
  tarif, tarif_expires, tarif_renewal_cost,
  is_active, multi_account_enabled,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'user_dd4ac44e', 'sf4bGAGh',
  'subscription_1m', '2026-03-18', 29000,
  true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Аккаунт 2
INSERT INTO user_accounts (
  id, username, password,
  tarif, tarif_expires, tarif_renewal_cost,
  is_active, multi_account_enabled,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'user_ea5ab672', 'xVcHpBVr',
  'subscription_1m', '2026-03-18', 29000,
  true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Аккаунт 3
INSERT INTO user_accounts (
  id, username, password,
  tarif, tarif_expires, tarif_renewal_cost,
  is_active, multi_account_enabled,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'user_c9b15cd2', 'Jee5Zmkm',
  'subscription_1m', '2026-03-18', 29000,
  true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Аккаунт 4
INSERT INTO user_accounts (
  id, username, password,
  tarif, tarif_expires, tarif_renewal_cost,
  is_active, multi_account_enabled,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'user_2a736513', 'dcZJG5gU',
  'subscription_1m', '2026-03-18', 29000,
  true, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Проверка:
-- SELECT id, username, password, tarif, tarif_expires, tarif_renewal_cost, multi_account_enabled FROM user_accounts WHERE username IN ('user_dd4ac44e', 'user_ea5ab672', 'user_c9b15cd2', 'user_2a736513');
