-- Разрешить anon роль для загрузки видео через TUS из браузера
-- Приложение использует кастомную авторизацию (не Supabase Auth),
-- поэтому TUS использует anon key (валидный Supabase JWT) как Bearer token

DROP POLICY IF EXISTS "Allow authenticated uploads to videos bucket" ON storage.objects;

CREATE POLICY "Allow uploads to videos bucket"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'videos'
  AND name LIKE 'uploads/%'
);
