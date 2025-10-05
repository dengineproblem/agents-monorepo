# Быстрый тест Video API с существующим пользователем

## 🎯 Используем того же пользователя, что и для scoring агента

У вас уже есть пользователь с заполненными:
- ✅ `access_token`
- ✅ `ad_account_id`
- ✅ `page_id`

Нужно только добавить Instagram данные!

## 🚀 Быстрый запуск (3 шага)

### 1. Добавьте Instagram поля

В Supabase SQL Editor выполните:

```sql
-- Сначала посмотрите ID вашего пользователя
SELECT id, username FROM user_accounts LIMIT 1;

-- Добавьте Instagram данные (замените на свои)
UPDATE user_accounts 
SET 
  instagram_id = 'ваш_instagram_business_id',
  instagram_username = 'ваш_username'
WHERE id = 'скопируйте_id_из_первого_запроса';

-- Проверьте
SELECT 
  id,
  access_token IS NOT NULL as has_token,
  ad_account_id,
  page_id,
  instagram_id,
  instagram_username
FROM user_accounts 
WHERE id = 'ваш_id';
```

### 2. Получите ваш USER_ID

```sql
-- Скопируйте ID из результата
SELECT id FROM user_accounts LIMIT 1;
```

### 3. Запустите тест

```bash
# Установите USER_ID (скопируйте из SQL выше)
export USER_ID="ваш_user_id_здесь"

# Запустите тест!
cd /Users/anatolijstepanov/agents-monorepo
./test-video-production.sh test-video.mp4
```

## 📋 Что будет происходить:

1. ✅ Проверка health endpoint
2. 📤 Отправка видео на сервер
3. 🔍 Получение данных пользователя из `user_accounts`
4. 🎵 Извлечение аудио (FFmpeg)
5. 📝 Транскрибация (OpenAI Whisper)
6. ⬆️ Загрузка видео в Facebook
7. 🎨 Создание 3 креативов:
   - 💬 WhatsApp (Click to WhatsApp)
   - 📸 Instagram Traffic
   - 🌐 Website Leads
8. 💾 Сохранение всех данных
9. ✅ Возврат результата

## 🔍 Где найти Instagram Business Account ID

### Способ 1: Facebook Business Manager

1. Откройте https://business.facebook.com
2. Настройки → Аккаунты → Instagram аккаунты
3. Скопируйте Instagram Business Account ID

### Способ 2: Graph API

```bash
curl -X GET "https://graph.facebook.com/v20.0/me/accounts?access_token=ваш_токен"
```

Найдите ваш Instagram ID в ответе.

## ⚡ Один скрипт для всего

Скопируйте и выполните (замените значения):

```bash
# 1. Ваши данные
SUPABASE_URL="https://ваш-проект.supabase.co"
SUPABASE_KEY="ваш_service_role_key"
USER_ID="ваш_user_id"
INSTAGRAM_ID="ваш_instagram_business_id"
INSTAGRAM_USERNAME="ваш_username"

# 2. Обновление через curl
curl -X PATCH "$SUPABASE_URL/rest/v1/user_accounts?id=eq.$USER_ID" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instagram_id\":\"$INSTAGRAM_ID\",\"instagram_username\":\"$INSTAGRAM_USERNAME\"}"

# 3. Запуск теста
export USER_ID="$USER_ID"
./test-video-production.sh test-video.mp4
```

## 📊 Ожидаемый результат

```bash
✅ Сервис работает
📤 Отправка видео на обработку...

✅ Видео успешно обработано!

📊 Созданные ресурсы:
  📝 Creative ID: 123e4567-e89b-12d3-a456-426614174000
  🎬 FB Video ID: 987654321
  💬 WhatsApp Creative: 23850123456789012
  📸 Instagram Creative: 23850123456789013
  🌐 Site Leads Creative: 23850123456789014

📝 Транскрипция:
  "Привет! В этом видео..."
```

## ❓ FAQ

**Q: Нужно ли каждый раз передавать токены?**  
A: Нет! Все токены хранятся в `user_accounts`, передаете только `user_id`

**Q: Можно ли использовать локально?**  
A: Да, измените URL: `API_URL="http://localhost:8080"`

**Q: Как посмотреть созданные креативы?**  
A: Facebook Ads Manager → https://business.facebook.com/adsmanager

**Q: Транскрипция не работает?**  
A: Проверьте `OPENAI_API_KEY` в `.env.agent`

## 🎬 Готовы тестировать!

Всего 3 команды:
```bash
# 1. Получите USER_ID из Supabase
# 2. Экспортируйте
export USER_ID="ваш_id"
# 3. Запустите
./test-video-production.sh test-video.mp4
```

🚀 **Поехали!**
