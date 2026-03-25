-- Бэкфилл: проставляем user_account_id для консультантских продаж
-- Без user_account_id ROI-калькулятор не найдёт эти продажи

UPDATE purchases p
SET user_account_id = c.parent_user_account_id
FROM consultants c
WHERE p.consultant_id = c.id
  AND p.user_account_id IS NULL
  AND c.parent_user_account_id IS NOT NULL;
