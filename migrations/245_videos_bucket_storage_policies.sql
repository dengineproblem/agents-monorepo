-- Политики для bucket videos в Supabase Storage
-- Применять только если bucket videos существует, но политики отсутствуют
-- Проверить: Supabase Dashboard → Storage → videos → Policies

-- Разрешить аутентифицированным пользователям загружать файлы
CREATE POLICY "Allow authenticated uploads to videos bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'videos'
  AND name LIKE 'uploads/%'
);

-- Разрешить пользователям читать свои файлы
CREATE POLICY "Allow users to read own videos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'videos'
  AND name LIKE (concat('uploads/', auth.uid()::text, '/%'))
);

-- Разрешить удалять свои файлы (бэкенд использует service_role, но на всякий случай)
CREATE POLICY "Allow users to delete own videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'videos'
  AND name LIKE (concat('uploads/', auth.uid()::text, '/%'))
);
