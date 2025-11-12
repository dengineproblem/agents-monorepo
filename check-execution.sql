-- Проверяем execution
SELECT 
  id,
  status,
  executed,
  source,
  created_at,
  finished_at,
  error_json::text
FROM agent_executions
WHERE id = '3836a819-2dc8-489c-a51e-2dfd7e1832f9';

-- Проверяем actions этого execution
SELECT 
  action_idx,
  type,
  status,
  params_json::text,
  result_json::text,
  error_json::text,
  created_at,
  finished_at
FROM agent_actions
WHERE execution_id = '3836a819-2dc8-489c-a51e-2dfd7e1832f9'
ORDER BY action_idx;





