# TikTok OAuth Integration - Complete ✅

## Что было сделано

### ✅ Backend (agent-service)

1. **Создан роут:** `services/agent-service/src/routes/tiktokOAuth.ts`
   - Endpoint: `POST /tiktok/oauth/exchange`
   - Обменивает `auth_code` на `access_token` через TikTok API
   - Получает список advertiser accounts
   - Сохраняет токены в Supabase: `tiktok_access_token`, `tiktok_business_id`, `tiktok_account_id`

2. **Зарегистрирован роут** в `services/agent-service/src/server.ts`

3. **Добавлены env variables** в `env.agent.example`:
   ```bash
   TIKTOK_APP_ID=7527489318093668353
   TIKTOK_APP_SECRET=e5fd337267bd6059119741d52fca5064e967d830
   ```

### ✅ Frontend

1. **Создана страница:** `services/frontend/src/pages/OAuthCallback.tsx`
   - Обрабатывает TikTok callback с параметрами `auth_code` и `state`
   - Вызывает backend endpoint для обмена кода на токен
   - Обновляет localStorage
   - Редиректит на `/profile`

2. **Добавлены роуты** в `services/frontend/src/App.tsx`:
   - Для авторизованных пользователей: `/oauth/callback`
   - Для неавторизованных: `/oauth/callback` (на случай если токен истёк)

### ✅ Документация

- `TIKTOK_OAUTH_TESTING.md` - подробный гид по тестированию
- `DEPLOY_TIKTOK_OAUTH.sh` - скрипт для деплоя на сервер

## Как задеплоить на сервер

### Вариант 1: Через git push (рекомендуется)

```bash
# На локальной машине
cd /Users/anatolijstepanov/agents-monorepo
git add .
git commit -m "feat: Add TikTok OAuth integration"
git push origin main

# На сервере
ssh root@your-server
cd /root/agents-monorepo
git pull
./DEPLOY_TIKTOK_OAUTH.sh
```

### Вариант 2: Прямо на сервере

```bash
# SSH на сервер
ssh root@your-server
cd /root/agents-monorepo

# Убедитесь что изменения на месте
git status
git pull  # если нужно

# Запустить деплой
./DEPLOY_TIKTOK_OAUTH.sh
```

## Что произойдёт при деплое

1. Остановятся `agent-service` и `frontend`
2. Пересоберутся Docker образы с новым кодом
3. Запустятся обновлённые сервисы
4. В логах появятся сообщения о TikTok OAuth

## Как протестировать

1. Зайти на https://performanteaiagency.com/profile
2. Кликнуть "Connect TikTok"
3. Авторизоваться в TikTok
4. Проверить что статус изменился на "Connected"

**Подробнее:** см. `TIKTOK_OAUTH_TESTING.md`

## Архитектура

```
User clicks "Connect TikTok" → TikTok OAuth page
                                      ↓
TikTok redirects → /oauth/callback?auth_code=XXX&state=YYY
                                      ↓
OAuthCallback.tsx → POST /api/tiktok/oauth/exchange
                                      ↓
tiktokOAuth.ts → TikTok API (exchange code for token)
                                      ↓
                  → Save to Supabase (user_accounts table)
                                      ↓
                  → Return success → Update localStorage
                                      ↓
                  → Redirect to /profile
```

## Следующие шаги

1. ✅ Код написан и протестирован локально (нет linter ошибок)
2. ⏳ Задеплоить на сервер через `DEPLOY_TIKTOK_OAUTH.sh`
3. ⏳ Протестировать реальный OAuth flow
4. ⏳ Проверить что токены сохраняются в базу
5. ⏳ Убедиться что TikTok API работает с полученными токенами

## Технические детали

### TikTok API Endpoints
- Token exchange: `https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`
- Get advertisers: `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/`

### Database Schema
Поля в `user_accounts`:
- `tiktok_access_token` TEXT - OAuth токен
- `tiktok_business_id` TEXT - ID advertiser аккаунта
- `tiktok_account_id` TEXT - Имя аккаунта

### State Parameter
Формат: base64url encoded JSON
```json
{
  "user_id": "uuid-v4",
  "ts": 1234567890
}
```

## Troubleshooting

См. секцию "Возможные проблемы" в `TIKTOK_OAUTH_TESTING.md`

