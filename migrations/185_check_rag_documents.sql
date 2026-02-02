-- =============================================
-- Проверка RAG документов на наличие "Данияр"
-- =============================================

-- Проверить все RAG документы
SELECT
    id,
    file_name,
    ai_bot_config_id,
    LENGTH(file_content) as content_length,
    LEFT(file_content, 500) as content_preview,
    created_at
FROM ai_bot_documents
WHERE file_content ILIKE '%Данияр%'
   OR file_content ILIKE '%Daniiar%'
   OR file_content ILIKE '%Daniyar%';

-- Если не найдено - показать все документы
SELECT
    'Все RAG документы (если "Данияр" не найден)' as info;

SELECT
    id,
    file_name,
    ai_bot_config_id,
    LENGTH(file_content) as content_length,
    LEFT(file_content, 300) as content_preview,
    created_at
FROM ai_bot_documents
ORDER BY created_at DESC
LIMIT 10;
