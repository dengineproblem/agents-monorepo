-- Миграция: хеширование паролей bcrypt
-- Включаем pgcrypto для функции crypt() и gen_salt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Хешируем пароли в user_accounts (только те, что ещё не захешированы)
UPDATE user_accounts
SET password = crypt(password, gen_salt('bf', 10))
WHERE password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%';

-- Хешируем пароли в consultant_accounts (только те, что ещё не захешированы)
UPDATE consultant_accounts
SET password = crypt(password, gen_salt('bf', 10))
WHERE password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%';
