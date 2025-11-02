-- Диагностика проблемы WhatsApp для конкретных пользователей
-- Проблемные: a10e54ea-b278-44a4-88bb-a13c50249691, 173dfce9-206f-4d4d-bed8-9b7c56674834
-- Работающий: 0f559eb0-53fa-4b6a-a51b-5d3e15e5864b

-- ========================================
-- 1. ОБЩИЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЕЙ
-- ========================================
SELECT
  id,
  user_telegram,
  page_id,
  whatsapp_phone_number as legacy_whatsapp,
  CASE
    WHEN id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN '❌ ПРОБЛЕМНЫЙ #1'
    WHEN id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN '❌ ПРОБЛЕМНЫЙ #2'
    WHEN id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN '✅ РАБОТАЕТ'
    ELSE 'OTHER'
  END as status
FROM user_accounts
WHERE id IN (
  'a10e54ea-b278-44a4-88bb-a13c50249691',
  '173dfce9-206f-4d4d-bed8-9b7c56674834',
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
)
ORDER BY
  CASE
    WHEN id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN 1
    WHEN id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN 2
    WHEN id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN 3
  END;

-- ========================================
-- 2. WHATSAPP НАПРАВЛЕНИЯ (DIRECTIONS)
-- ========================================
SELECT
  ad.id as direction_id,
  ad.user_account_id,
  ad.name as direction_name,
  ad.objective,
  ad.whatsapp_phone_number_id,
  ua.user_telegram,
  CASE
    WHEN ad.user_account_id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN '❌ ПРОБЛЕМНЫЙ #1'
    WHEN ad.user_account_id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN '❌ ПРОБЛЕМНЫЙ #2'
    WHEN ad.user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN '✅ РАБОТАЕТ'
  END as status
FROM account_directions ad
JOIN user_accounts ua ON ua.id = ad.user_account_id
WHERE ad.user_account_id IN (
  'a10e54ea-b278-44a4-88bb-a13c50249691',
  '173dfce9-206f-4d4d-bed8-9b7c56674834',
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
)
AND ad.objective = 'whatsapp'
AND ad.is_active = true
ORDER BY
  CASE
    WHEN ad.user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN 1
    WHEN ad.user_account_id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN 2
    WHEN ad.user_account_id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN 3
  END;

-- ========================================
-- 3. WHATSAPP НОМЕРА В БД
-- ========================================
SELECT
  wpn.id,
  wpn.user_account_id,
  wpn.phone_number,
  wpn.label,
  wpn.is_default,
  wpn.is_active,
  ua.user_telegram,
  CASE
    WHEN wpn.user_account_id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN '❌ ПРОБЛЕМНЫЙ #1'
    WHEN wpn.user_account_id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN '❌ ПРОБЛЕМНЫЙ #2'
    WHEN wpn.user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN '✅ РАБОТАЕТ'
  END as status
FROM whatsapp_phone_numbers wpn
JOIN user_accounts ua ON ua.id = wpn.user_account_id
WHERE wpn.user_account_id IN (
  'a10e54ea-b278-44a4-88bb-a13c50249691',
  '173dfce9-206f-4d4d-bed8-9b7c56674834',
  '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
)
ORDER BY
  CASE
    WHEN wpn.user_account_id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN 1
    WHEN wpn.user_account_id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN 2
    WHEN wpn.user_account_id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN 3
  END,
  wpn.is_default DESC;

-- ========================================
-- 4. ПОСЛЕДНИЕ ОШИБКИ 2446885
-- ========================================
SELECT
  aa.id as action_id,
  aa.user_account_id,
  ua.user_telegram,
  aa.type,
  aa.created_at,
  aa.error_json->'error_details' as error_details,
  aa.params_json->'directionId' as direction_id,
  CASE
    WHEN aa.user_account_id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN '❌ ПРОБЛЕМНЫЙ #1'
    WHEN aa.user_account_id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN '❌ ПРОБЛЕМНЫЙ #2'
  END as status
FROM agent_actions aa
JOIN user_accounts ua ON ua.id = aa.user_account_id
WHERE aa.user_account_id IN (
  'a10e54ea-b278-44a4-88bb-a13c50249691',
  '173dfce9-206f-4d4d-bed8-9b7c56674834'
)
AND aa.error_json::text LIKE '%2446885%'
AND aa.created_at > NOW() - INTERVAL '7 days'
ORDER BY aa.created_at DESC
LIMIT 10;

-- ========================================
-- 5. ПОЛНАЯ КАРТИНА ДЛЯ КАЖДОГО ПОЛЬЗОВАТЕЛЯ
-- ========================================
WITH user_data AS (
  SELECT
    ua.id,
    ua.user_telegram,
    ua.page_id,
    ua.whatsapp_phone_number as legacy_whatsapp,
    CASE
      WHEN ua.id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN '❌ ПРОБЛЕМНЫЙ #1'
      WHEN ua.id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN '❌ ПРОБЛЕМНЫЙ #2'
      WHEN ua.id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN '✅ РАБОТАЕТ'
    END as status,
    CASE
      WHEN ua.id = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b' THEN 1
      WHEN ua.id = 'a10e54ea-b278-44a4-88bb-a13c50249691' THEN 2
      WHEN ua.id = '173dfce9-206f-4d4d-bed8-9b7c56674834' THEN 3
    END as sort_order
  FROM user_accounts ua
  WHERE ua.id IN (
    'a10e54ea-b278-44a4-88bb-a13c50249691',
    '173dfce9-206f-4d4d-bed8-9b7c56674834',
    '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'
  )
)
SELECT
  ud.status,
  ud.user_telegram,
  ud.page_id,
  ud.legacy_whatsapp,
  COUNT(DISTINCT ad.id) as whatsapp_directions_count,
  COUNT(DISTINCT wpn.id) as whatsapp_numbers_count,
  STRING_AGG(DISTINCT wpn.phone_number, ', ') as all_numbers,
  STRING_AGG(
    DISTINCT CASE WHEN wpn.is_default THEN wpn.phone_number END,
    ', '
  ) as default_number,
  COUNT(DISTINCT CASE WHEN aa.error_json::text LIKE '%2446885%' THEN aa.id END) as error_2446885_count
FROM user_data ud
LEFT JOIN account_directions ad ON ad.user_account_id = ud.id AND ad.objective = 'whatsapp' AND ad.is_active = true
LEFT JOIN whatsapp_phone_numbers wpn ON wpn.user_account_id = ud.id AND wpn.is_active = true
LEFT JOIN agent_actions aa ON aa.user_account_id = ud.id AND aa.created_at > NOW() - INTERVAL '7 days'
GROUP BY ud.status, ud.user_telegram, ud.page_id, ud.legacy_whatsapp, ud.sort_order
ORDER BY ud.sort_order;
