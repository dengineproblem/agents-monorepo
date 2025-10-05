# Video Processing API - Упрощенная версия

## 🎯 Изменения

Теперь API работает **как scoring агент** - все данные подтягиваются из `user_accounts` по `user_id`!

### Что изменилось:

**Было (старая версия):**
```bash
curl -X POST https://agents.performanteaiagency.com/process-video \
  -F "video=@video.mp4" \
  -F "user_id=xxx" \
  -F "ad_account_id=act_xxx" \
  -F "page_id=xxx" \
  -F "instagram_id=xxx" \
  -F "page_access_token=xxx" \
  # ... куча параметров
```

**Стало (новая версия):**
```bash
curl -X POST https://agents.performanteaiagency.com/process-video \
  -F "video=@video.mp4" \
  -F "user_id=xxx" \
  # Все остальное подтягивается из базы!
```

## 📋 Обязательные параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| `video` | File | Видео файл (до 500 MB) |
| `user_id` | UUID | ID пользователя из таблицы `user_accounts` |

## 📝 Опциональные параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| `title` | String | Название креатива |
| `description` | String | Текст для креативов |
| `language` | String | Язык транскрипции (по умолчанию 'ru') |
| `client_question` | String | Вопрос для WhatsApp welcome message |
| `site_url` | URL | URL сайта для Website Leads креатива |
| `utm` | String | UTM метки |

## 🗄️ Что берется из `user_accounts`

Из таблицы `user_accounts` автоматически подтягиваются:
- `access_token` - Facebook Page Access Token
- `ad_account_id` - ID рекламного аккаунта (act_XXXXXXXX)
- `page_id` - Facebook Page ID
- `instagram_id` - Instagram Business Account ID
- `instagram_username` - Instagram username (опционально)

## 🔧 Настройка базы данных

### 1. Примените миграцию

Выполните в Supabase SQL Editor:

```sql
-- Добавление полей для Instagram
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS instagram_id TEXT;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Или примените миграцию:
migrations/003_user_accounts_video_fields.sql
```

### 2. Заполните данные пользователя

```sql
UPDATE user_accounts 
SET 
  instagram_id = 'ваш_instagram_business_id',
  instagram_username = 'ваш_username'
WHERE id = 'user_id';
```

### 3. Проверьте данные

```sql
SELECT 
  id,
  access_token IS NOT NULL as has_token,
  ad_account_id,
  page_id,
  instagram_id,
  instagram_username
FROM user_accounts 
WHERE id = 'ваш_user_id';
```

## 🚀 Использование

### Через cURL

```bash
curl -X POST https://agents.performanteaiagency.com/process-video \
  -F "video=@video.mp4" \
  -F "user_id=123e4567-e89b-12d3-a456-426614174000" \
  -F "title=Промо видео" \
  -F "description=Описание креатива" \
  -F "site_url=https://example.com"
```

### Через тестовый скрипт

```bash
# Установите только user_id
export USER_ID="ваш_user_id_из_supabase"

# Запустите тест
./test-video-production.sh test-video.mp4
```

### JavaScript

```javascript
const formData = new FormData();
formData.append('video', videoFile);
formData.append('user_id', 'user_id_из_supabase');
formData.append('title', 'Промо видео');
formData.append('description', 'Описание');

const response = await fetch('https://agents.performanteaiagency.com/process-video', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

## ✅ Успешный ответ

```json
{
  "success": true,
  "message": "Video processed and creatives created successfully",
  "data": {
    "creative_id": "uuid",
    "fb_video_id": "123456789",
    "fb_creative_id_whatsapp": "23850123456789012",
    "fb_creative_id_instagram_traffic": "23850123456789013",
    "fb_creative_id_site_leads": "23850123456789014",
    "transcription": {
      "text": "Транскрипция аудио...",
      "language": "ru",
      "source": "whisper",
      "duration_sec": 45
    }
  }
}
```

## ❌ Возможные ошибки

### 404 - User account not found

```json
{
  "success": false,
  "error": "User account not found"
}
```

**Решение:** Проверьте, что user_id существует в таблице `user_accounts`

### 400 - User account incomplete

```json
{
  "success": false,
  "error": "User account incomplete",
  "message": "Missing required fields: access_token, ad_account_id, page_id, or instagram_id"
}
```

**Решение:** Заполните все обязательные поля в `user_accounts`:
```sql
UPDATE user_accounts 
SET 
  access_token = 'EAAxxxxx',
  ad_account_id = 'act_xxx',
  page_id = 'xxx',
  instagram_id = 'xxx'
WHERE id = 'user_id';
```

## 🔐 Безопасность

### Преимущества нового подхода:

✅ **Токены не передаются через API** - хранятся только в базе  
✅ **Централизованное управление** - все настройки в одном месте  
✅ **Проще для фронтенда** - нужен только user_id  
✅ **Меньше ошибок** - нет риска передать неверный токен  
✅ **Аудит** - все действия привязаны к user_id  

## 🎬 Быстрый старт

### 1. Получите ваш user_id

```sql
SELECT id, username FROM user_accounts WHERE username = 'ваш_username';
```

### 2. Проверьте данные

```sql
SELECT * FROM user_accounts WHERE id = 'ваш_user_id';
```

### 3. Запустите тест

```bash
export USER_ID="ваш_user_id"
./test-video-production.sh test-video.mp4
```

## 📊 Сравнение

| Аспект | Старая версия | Новая версия |
|--------|---------------|--------------|
| Параметров в запросе | 13+ | 2 (video + user_id) |
| Безопасность токенов | Передаются в запросе | Хранятся в БД |
| Настройка | В каждом запросе | Один раз в БД |
| Сложность | Высокая | Низкая |
| Совместимость | Standalone | Как scoring агент |

## 🔄 Миграция со старой версии

Если у вас уже есть код со старой версией API:

**Старый код:**
```javascript
formData.append('ad_account_id', 'act_xxx');
formData.append('page_id', 'xxx');
formData.append('instagram_id', 'xxx');
formData.append('page_access_token', 'EAAxxxx');
```

**Новый код:**
```javascript
// Удалите все эти строки, оставьте только:
// user_id уже есть в вашей сессии
```

## 📞 Поддержка

Если возникли проблемы:
1. Проверьте данные в `user_accounts`
2. Проверьте логи сервиса: `docker logs agent-service -f`
3. Убедитесь, что миграция 003 применена

---

**Версия:** 2.0.0  
**Дата:** 5 октября 2025  
**Статус:** ✅ Production Ready
