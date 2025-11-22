# Создание Storage Bucket в Supabase

## Проблема
Ошибка: `Bucket not found` при генерации креативов

## Решение

### Вариант 1: Через Supabase Dashboard (рекомендуется)

1. Откройте Supabase Dashboard: https://supabase.com/dashboard
2. Выберите ваш проект
3. Перейдите в раздел **Storage**
4. Нажмите **New bucket**
5. Создайте бакет со следующими параметрами:
   - **Name**: `creo` (или любое другое имя, если `public` занято)
   - **Public bucket**: ✅ **Включено** (чтобы изображения были доступны по прямым ссылкам)
   - **File size limit**: 50MB (достаточно для изображений)
   - **Allowed MIME types**: `image/*` (или оставьте пустым для всех типов)

6. Нажмите **Create bucket**

### Вариант 2: Через SQL (альтернатива)

Выполните в Supabase SQL Editor:

```sql
-- Создать бакет creo
INSERT INTO storage.buckets (id, name, public)
VALUES ('creo', 'creo', true)
ON CONFLICT (id) DO NOTHING;

-- Разрешить всем читать файлы (анонимный доступ)
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'creo');

-- Разрешить аутентифицированным пользователям загружать
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'creo' AND auth.role() = 'authenticated');
```

### Структура файлов

После создания бакета, файлы будут загружаться по пути:

```
creo/
  └── creatives/
      └── {user_id}/
          ├── {timestamp}_abc123.png
          ├── {timestamp}_def456.png
          └── ...
```

### Проверка

После создания бакета, проверьте работу генерации креативов:

```bash
curl -X POST http://localhost:8085/generate-creative \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "offer": "Test Offer",
    "bullets": "• Test 1\n• Test 2",
    "profits": "Test Profit",
    "cta": "Test CTA"
  }'
```

## Важно

- Бакет должен быть **публичным** (public: true)
- Это необходимо для того, чтобы изображения были доступны по прямым ссылкам без авторизации
- Файлы автоматически кешируются на 1 час (cacheControl: '3600')

