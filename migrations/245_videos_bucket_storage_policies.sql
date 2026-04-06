-- Создание bucket videos и политики доступа для прямой загрузки из браузера

-- Создаём bucket videos (private, с лимитом 512MB на файл)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'videos',
  'videos',
  false,
  536870912, -- 512 MB
  ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg', 'video/mov']
)
ON CONFLICT (id) DO NOTHING;

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
