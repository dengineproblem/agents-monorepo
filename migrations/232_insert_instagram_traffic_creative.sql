-- Убираем unique constraint чтобы одно видео можно было использовать в нескольких directions
DROP INDEX IF EXISTS ux_user_creatives_user_video;

-- 1. IMG_3225.MOV -> направление "Казахстан траффик"
INSERT INTO user_creatives (
  user_id,
  account_id,
  direction_id,
  title,
  status,
  media_type,
  fb_video_id,
  fb_creative_id,
  fb_creative_id_instagram_traffic
) VALUES (
  '8f49f4f2-6bb2-4c58-8ed3-15986a4a1924',
  '317af3cf-63f0-4178-b67a-008f379cdc40',
  '2709cd65-4447-4bfa-9c42-a183034ccd5c',
  'IMG_3225.MOV',
  'ready',
  'video',
  '1450309609815908',
  '1484515706668906',
  '1484515706668906'
);

-- 2. IMG_2971.MOV -> направление "Алматы трафик"
INSERT INTO user_creatives (
  user_id,
  account_id,
  direction_id,
  title,
  status,
  media_type,
  fb_video_id,
  fb_creative_id,
  fb_creative_id_instagram_traffic
) VALUES (
  '8f49f4f2-6bb2-4c58-8ed3-15986a4a1924',
  '317af3cf-63f0-4178-b67a-008f379cdc40',
  'a1628e48-5255-44b2-9dd6-bdc3efc602ee',
  'IMG_2971.MOV',
  'ready',
  'video',
  '26339730198993739',
  '1638524133851493',
  '1638524133851493'
);
