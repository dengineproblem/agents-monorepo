# 🎯 TikTok OAuth Integration - Complete Documentation

> **Status:** ✅ Completed and Working  
> **Date:** November 5, 2025  
> **Commits:** b3c5045, b94aa56, 98cd8e0, 6a86fe6, 6b52ac7, 42f81e2

---

## 📋 Overview

Полная интеграция TikTok Marketing API OAuth 2.0 для подключения TikTok Business аккаунтов пользователей.

### Что реализовано:

- ✅ Backend endpoint `/tiktok/oauth/exchange` для обмена auth_code на access_token
- ✅ Frontend страница `/oauth/callback` для обработки редиректа от TikTok
- ✅ Получение списка advertiser accounts пользователя
- ✅ Сохранение токенов в Supabase (tiktok_access_token, tiktok_business_id)
- ✅ Обработка ошибок и логирование
- ✅ Роуты зарегистрированы в App.tsx для обоих доменов

---

## 🏗️ Architecture

### Flow диаграмма:

```
User clicks "Connect TikTok"
    ↓
Frontend redirects to TikTok OAuth
    ↓
User authorizes in TikTok Business
    ↓
TikTok redirects to /oauth/callback?auth_code=XXX&state=YYY
    ↓
Frontend OAuthCallback.tsx extracts params
    ↓
POST /api/tiktok/oauth/exchange { auth_code, state }
    ↓
Backend exchanges code for access_token
    ↓
Backend gets advertiser accounts
    ↓
Backend saves to Supabase
    ↓
Frontend updates localStorage
    ↓
Redirect back to /profile
```

---

## 📁 Files Changed

### Backend:

**1. `services/agent-service/src/routes/tiktokOAuth.ts`** (NEW)
- OAuth exchange endpoint
- TikTok API integration
- Supabase token storage

**2. `services/agent-service/src/server.ts`**
- Registered tiktokOAuthRoutes

**3. `env.agent.example`**
- Added TIKTOK_APP_ID
- Added TIKTOK_APP_SECRET

### Frontend:

**4. `services/frontend/src/pages/OAuthCallback.tsx`** (EXISTING)
- Handles OAuth callback
- Calls backend API
- Updates localStorage

**5. `services/frontend/src/App.tsx`** (EXISTING)
- Registered /oauth/callback route

---

## 🔧 Configuration

### Environment Variables:

#### Backend (`/root/agents-monorepo/.env.agent`):
```bash
# TikTok Marketing API OAuth
TIKTOK_APP_ID=7527489318093668353
TIKTOK_APP_SECRET=e5fd337267bd6059119741d52fca5064e967d830
```

#### Frontend (built into Docker image):
```typescript
// In Profile.tsx and Dashboard.tsx
const redirect = encodeURIComponent('https://performanteaiagency.com/oauth/callback');
const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=7527489318093668353&state=${state}&redirect_uri=${redirect}`;
```

### TikTok Developer Portal Settings:

**App ID:** 7527489318093668353  
**Redirect URI:** `https://performanteaiagency.com/oauth/callback`

---

## 🔑 Key Technical Details

### **КРИТИЧНО: Access Token Header**

TikTok Marketing API v1.3 требует передачу `access_token` в **заголовке `Access-Token`**, НЕ в query параметрах!

```typescript
// ❌ WRONG - returns 40104 "The access_token is empty"
const url = `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?access_token=${token}`;
fetch(url);

// ✅ CORRECT
const url = `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?app_id=XXX&secret=YYY`;
fetch(url, {
  headers: { 'Access-Token': token }
});
```

**Source:** [TikTok Postman Collection](https://www.postman.com/tiktok/tiktok-api-for-business/)

### HTTP Methods:

- `/oauth2/access_token/` → **POST** (exchange auth_code for token)
- `/oauth2/advertiser/get/` → **GET** (get advertiser list)

---

## 🐛 Issues Encountered & Solutions

### Issue 1: 404 on /oauth/callback
**Problem:** Frontend не собрался с новой страницей  
**Solution:** Пересобрать frontend БЕЗ кэша (`--no-cache`)

### Issue 2: "Missing state parameter"
**Problem:** Backend не видел переменные окружения  
**Solution:** Добавить в правильный файл `/root/agents-monorepo/.env.agent` и пересобрать

### Issue 3: "The access_token is empty" (40104)
**Problem:** Передавали token в query params  
**Solution:** Использовать заголовок `Access-Token`

### Issue 4: 405 Method Not Allowed
**Problem:** Пытались использовать POST для `/advertiser/get/`  
**Solution:** Использовать GET метод

---

## 📊 Database Schema

### Table: `user_accounts`

```sql
ALTER TABLE user_accounts 
ADD COLUMN tiktok_access_token TEXT NULL,
ADD COLUMN tiktok_account_id TEXT NULL,
ADD COLUMN tiktok_business_id TEXT NULL;
```

**Fields:**
- `tiktok_access_token` - Access token для TikTok Marketing API
- `tiktok_business_id` - ID рекламного аккаунта (advertiser_id)
- `tiktok_account_id` - Имя аккаунта (advertiser_name)

---

## 🚀 Deployment Steps

### On Local Machine:

```bash
# Commit changes
git add .
git commit -m "feat: Add TikTok OAuth integration"
git push origin main
```

### On Production Server:

```bash
cd /root/agents-monorepo

# 1. Pull changes
git pull origin main

# 2. Add env variables (if not already)
nano /root/agents-monorepo/.env.agent
# Add TIKTOK_APP_ID and TIKTOK_APP_SECRET

# 3. Rebuild agent-service
docker-compose build --no-cache agent-service
docker-compose up -d agent-service

# 4. Rebuild frontend-appreview (for performanteaiagency.com)
docker-compose build --no-cache frontend-appreview
docker-compose up -d frontend-appreview

# 5. Rebuild frontend (for app.performanteaiagency.com)
docker-compose build --no-cache frontend
docker-compose up -d frontend

# 6. Restart nginx
docker-compose restart nginx

# 7. Check logs
docker-compose logs -f agent-service | grep -i tiktok
```

---

## ✅ Testing

### Manual Test Flow:

1. Open `https://app.performanteaiagency.com/profile`
2. Click "Connect TikTok" button
3. Authorize in TikTok Business portal
4. Should redirect to `/oauth/callback`
5. Should show "Connecting TikTok..." → "TikTok connected successfully!"
6. Should redirect back to `/profile`
7. TikTok should show as connected

### Check Backend Logs:

```bash
docker-compose logs agent-service --tail 100 | grep -i tiktok
```

Expected logs:
```
Exchanging TikTok OAuth code for access token
Processing TikTok OAuth exchange
TikTok token exchange response (responseCode: 0)
TikTok advertiser raw response (httpStatus: 200)
TikTok OAuth successful
Successfully saved TikTok tokens to database
```

### Check Database:

```sql
SELECT 
  username,
  tiktok_access_token IS NOT NULL as has_token,
  tiktok_business_id,
  tiktok_account_id
FROM user_accounts
WHERE tiktok_access_token IS NOT NULL;
```

---

## 📚 API Reference

### Backend Endpoint:

**POST** `/api/tiktok/oauth/exchange`

**Request Body:**
```json
{
  "auth_code": "string (required)",
  "state": "string (required, base64url encoded JSON)"
}
```

**State Format:**
```json
{
  "user_id": "uuid",
  "ts": 1234567890
}
```

**Response (Success):**
```json
{
  "success": true,
  "access_token": "string",
  "business_id": "string",
  "account_id": "string",
  "advertisers": [
    {
      "id": "string",
      "name": "string"
    }
  ],
  "message": "TikTok connected successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "string"
}
```

---

## 🔗 External References

- [TikTok Marketing API Docs](https://business-api.tiktok.com/portal/docs)
- [OAuth 2.0 Authorization](https://business-api.tiktok.com/portal/docs?id=1832209711206401)
- [TikTok Postman Collection](https://www.postman.com/tiktok/tiktok-api-for-business/)
- [GitHub Issue: Access Token Header](https://github.com/airbytehq/airbyte/issues/14299)

---

## 🎓 Lessons Learned

1. **Always read official Postman collections** - they show the actual working implementation
2. **TikTok API uses custom headers** - not standard Bearer tokens
3. **Docker cache is persistent** - always use `--no-cache` for code changes
4. **Test on correct domain** - production vs app-review versions are separate
5. **State encoding** - use base64url, not base64
6. **Auth codes are one-time use** - need fresh code for each test

---

## 🔄 Future Improvements

### Potential Enhancements:

1. **Token Refresh Flow**
   - TikTok tokens expire, implement refresh logic
   - Store refresh_token if provided

2. **Multiple Advertiser Selection**
   - Let user choose which advertiser account to use
   - Currently uses first account

3. **Dynamic Redirect URI**
   - Use `window.location.origin` instead of hardcoded domain
   - Would work on both domains automatically

4. **Error Recovery**
   - Retry logic for transient errors
   - Better user feedback on specific error types

5. **Webhook Integration**
   - TikTok can send webhooks for campaign events
   - Would need separate endpoint

---

## 👥 Contributors

- **AI Assistant** - Implementation & debugging
- **Anatolij Stepanov** - Requirements & testing

---

## 📝 Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-05 | 1.0.0 | Initial implementation and documentation |

---

**Status:** ✅ Production Ready  
**Last Updated:** November 5, 2025

