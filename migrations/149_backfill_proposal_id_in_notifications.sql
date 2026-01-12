-- Backfill: добавляем proposal_id в metadata существующих уведомлений brain_proposals
-- Связываем через notification_id в pending_brain_proposals

UPDATE user_notifications n
SET metadata = n.metadata || jsonb_build_object('proposal_id', p.id::text)
FROM pending_brain_proposals p
WHERE n.type = 'brain_proposals'
  AND p.notification_id = n.id
  AND (n.metadata->>'proposal_id') IS NULL;

-- Для уведомлений без связи через notification_id, попробуем связать по ad_account_id и времени
UPDATE user_notifications n
SET metadata = n.metadata || jsonb_build_object('proposal_id', p.id::text)
FROM pending_brain_proposals p
WHERE n.type = 'brain_proposals'
  AND (n.metadata->>'proposal_id') IS NULL
  AND p.ad_account_id = (n.metadata->>'ad_account_id')::uuid
  AND p.created_at BETWEEN n.created_at - interval '1 minute' AND n.created_at + interval '1 minute';
