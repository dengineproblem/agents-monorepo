-- Обновить лимит файла для bucket videos
-- Миграция 245 использовала ON CONFLICT DO NOTHING, поэтому если bucket уже существовал,
-- file_size_limit не был установлен. TUS анонсирует полный размер файла в Upload-Length
-- и Supabase отклоняет его с 413 если размер превышает лимит.

UPDATE storage.buckets
SET file_size_limit = 536870912  -- 512 MB
WHERE id = 'videos';
