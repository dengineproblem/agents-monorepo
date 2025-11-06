# TikTok OAuth Integration - Testing Guide

## Статус реализации
✅ Backend endpoint создан: `/api/tiktok/oauth/exchange`
✅ Frontend страница создана: `/oauth/callback`
✅ Роуты зарегистрированы
✅ Environment variables добавлены

## Что нужно для тестирования

### 1. Обновить .env.agent на сервере
Добавьте реальные credentials (уже есть в `env.agent.example`):
```bash
TIKTOK_APP_ID=7527489318093668353
TIKTOK_APP_SECRET=e5fd337267bd6059119741d52fca5064e967d830
```

### 2. Пересобрать и перезапустить сервисы
```bash
cd /root/agents-monorepo

# Пересобрать agent-service с новым роутом
docker-compose build agent-service

# Пересобрать frontend с новой страницей
docker-compose build frontend

# Перезапустить сервисы
docker-compose up -d agent-service frontend

# Проверить что сервисы запустились
docker-compose ps
docker-compose logs -f agent-service --tail=50
```

## Как протестировать OAuth flow

### Шаг 1: Проверить backend endpoint
```bash
# Health check agent-service
curl https://performanteaiagency.com/api/health

# Должен ответить: {"ok":true}
```

### Шаг 2: Тест OAuth в браузере

1. Зайти на https://performanteaiagency.com/profile
2. Кликнуть "Connect TikTok"
3. Откроется окно TikTok авторизации
4. Авторизоваться и выбрать TikTok Ads аккаунт
5. TikTok редиректит на: `https://performanteaiagency.com/oauth/callback?auth_code=XXX&state=YYY`
6. Страница `/oauth/callback` должна:
   - Показать "Connecting TikTok..."
   - Вызвать backend `/api/tiktok/oauth/exchange`
   - При успехе показать "TikTok connected successfully!"
   - Редиректнуть на `/profile`
7. В Profile должен появиться TikTok как подключенный

### Шаг 3: Проверить в базе данных
```sql
SELECT 
  id, 
  username, 
  tiktok_business_id,
  LENGTH(tiktok_access_token) as token_length,
  tiktok_account_id
FROM user_accounts 
WHERE tiktok_access_token IS NOT NULL;
```

### Шаг 4: Проверить логи
```bash
# Backend логи
docker-compose logs agent-service | grep -i "tiktok"

# Должны увидеть:
# - "Exchanging TikTok OAuth code for access token"
# - "TikTok OAuth successful"
# - "Successfully saved TikTok tokens to database"

# Frontend логи в браузере (Developer Console)
# - "Processing TikTok OAuth callback"
# - "Decoded state: { userId: '...' }"
# - "TikTok OAuth response: { success: true, ... }"
# - "Updated localStorage with TikTok credentials"
```

## Возможные проблемы

### 1. 404 на /oauth/callback
**Причина:** Frontend не пересобран
**Решение:** 
```bash
docker-compose build frontend
docker-compose up -d frontend
```

### 2. 404 на /api/tiktok/oauth/exchange
**Причина:** Backend не пересобран или роут не зарегистрирован
**Решение:**
```bash
docker-compose build agent-service
docker-compose up -d agent-service
docker-compose logs agent-service | grep "TikTok"
```

### 3. "Invalid state parameter"
**Причина:** State encoding/decoding проблема
**Проверка:** В консоли браузера должно быть "Decoded state: { userId: '...' }"

### 4. "TikTok OAuth not configured on server"
**Причина:** TIKTOK_APP_SECRET не установлен
**Решение:** Проверить .env.agent и перезапустить:
```bash
docker exec agents-monorepo-agent-service-1 env | grep TIKTOK
```

### 5. "No TikTok advertiser accounts found"
**Причина:** У пользователя нет TikTok Ads аккаунта
**Решение:** Создать TikTok Ads аккаунт на https://ads.tiktok.com/

## Структура реализации

### Backend
- **Файл:** `services/agent-service/src/routes/tiktokOAuth.ts`
- **Endpoint:** `POST /tiktok/oauth/exchange`
- **Принимает:** `{ auth_code, state }`
- **Возвращает:** `{ success: true, access_token, business_id, ... }`

### Frontend
- **Файл:** `services/frontend/src/pages/OAuthCallback.tsx`
- **URL:** `/oauth/callback`
- **Обрабатывает:** TikTok callback с параметрами `auth_code` и `state`
- **Редиректит:** На `/profile` после успеха

### Environment Variables
```bash
TIKTOK_APP_ID=7527489318093668353
TIKTOK_APP_SECRET=e5fd337267bd6059119741d52fca5064e967d830
```

## После успешного тестирования

1. ✅ TikTok появляется как подключенный в Profile
2. ✅ В базе сохранены: `tiktok_access_token`, `tiktok_business_id`, `tiktok_account_id`
3. ✅ В localStorage обновлены TikTok поля
4. ✅ TikTok API можно использовать для запуска кампаний

