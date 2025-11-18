-- Проверка направлений с WhatsApp номерами
SELECT 
  ad.id as direction_id,
  ad.name as direction_name,
  ad.objective,
  ad.whatsapp_phone_number_id,
  wpn.phone_number,
  wpn.is_default,
  wpn.is_active,
  ua.whatsapp_phone_number as legacy_phone
FROM account_directions ad
LEFT JOIN whatsapp_phone_numbers wpn ON ad.whatsapp_phone_number_id = wpn.id
LEFT JOIN user_accounts ua ON ad.user_account_id = ua.id
WHERE ad.objective = 'whatsapp'
ORDER BY ad.created_at DESC
LIMIT 10;











