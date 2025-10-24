# ✅ FIX: Facebook OAuth Flow

**Проблема:** OAuth авторизация Facebook ломалась, потому что `FB_APP_SECRET` использовался везде (включая обычные API запросы), что конфликтовало с токенами из Supabase.

---

## 🔧 ЧТО ИСПРАВЛЕНО:

### 1. Убрали `appsecret_proof` из обычных API запросов

**Файл:** `services/agent-service/src/adapters/facebook.ts`

**До:**
```typescript
if (FB_APP_SECRET) usp.set('appsecret_proof', appsecret_proof(token));
```

**После:**
```typescript
// НЕ используем appsecret_proof - токены могут быть от других приложений
// if (FB_APP_SECRET) usp.set('appsecret_proof', appsecret_proof(token));
```

**Причина:** 
- `appsecret_proof` генерируется из `FB_APP_SECRET` + `access_token`
- Если токен от приложения A, а `FB_APP_SECRET` от приложения B → proof невалидный
- Facebook отклоняет запросы

### 2. Оставили `FB_APP_SECRET` для OAuth

**Файл:** `services/agent-service/src/routes/facebookWebhooks.ts`

`FB_APP_SECRET` **НУЖЕН** для:
- OAuth token exchange (строка 39)
- Data deletion signed request verification (строка 273)

Эти эндпоинты работают напрямую с Facebook App, поэтому `FB_APP_SECRET` тут корректен.

---

## ⚙️ ЧТО НУЖНО СДЕЛАТЬ НА СЕРВЕРЕ:

### Шаг 1: Добавить `FB_APP_SECRET` в `.env` файл

На сервере в `/root/agents-monorepo/services/agent-service/.env`:

```bash
# Найди FB_APP_SECRET в Facebook Developer Console:
# https://developers.facebook.com/apps/1441781603583445/settings/basic/

FB_APP_SECRET=твой_реальный_app_secret_здесь
```

**Где взять App Secret:**
1. Перейди: https://developers.facebook.com/apps/1441781603583445/settings/basic/
2. Раздел "App Secret"
3. Click "Show" (может попросить пароль)
4. Скопируй значение

### Шаг 2: Перезапустить agent-service

```bash
cd ~/agents-monorepo
docker-compose restart agent-service

# Или полная пересборка:
docker-compose up -d --build agent-service
```

### Шаг 3: Проверить OAuth

1. Открой `https://performanteaiagency.com/profile`
2. Click "Connect Facebook"
3. Авторизуйся
4. Выбери Ad Account/Page
5. Проверь что кампании отображаются на Dashboard

---

## 📋 ПРОВЕРКА:

### Проверить что OAuth работает:

```bash
# На сервере проверь логи:
docker logs agents-monorepo-agent-service-1 --tail 50 | grep oauth
```

Должно быть:
```
✅ Successfully exchanged code for token
✅ Successfully connected Facebook
```

НЕ должно быть:
```
❌ Error validating client secret
❌ Failed to exchange code for token
```

### Проверить что обычные API запросы работают:

```bash
# Логи должны показывать успешные запросы к Facebook API:
docker logs agents-monorepo-agent-service-1 --tail 100 | grep facebook
```

Не должно быть ошибок про `appsecret_proof`.

---

## ✅ РЕЗУЛЬТАТ:

После исправления:
- ✅ OAuth работает (используется `FB_APP_SECRET`)
- ✅ Обычные API запросы работают (НЕ используется `appsecret_proof`)
- ✅ Нет конфликтов между разными приложениями
- ✅ Можно использовать токены от любого Facebook App

---

## 🔒 БЕЗОПАСНОСТЬ:

`FB_APP_SECRET` — это **конфиденциальные данные**!

- ✅ Храни в `.env` (не коммить в git!)
- ✅ Используй только на backend (не в frontend!)
- ❌ Никогда не показывай в логах
- ❌ Не передавай клиенту

---

## 📝 ПРИМЕЧАНИЕ:

`appsecret_proof` — это дополнительная мера безопасности от Facebook, но:
- Не обязательна для большинства запросов
- Работает только если токен и secret от ОДНОГО приложения
- Конфликтует если токены в Supabase от разных приложений

Мы оставили её ТОЛЬКО для OAuth (где всегда одно приложение), но убрали из обычных API запросов (где могут быть токены от разных приложений).

---

**ГОТОВО!** OAuth должен заработать после добавления `FB_APP_SECRET` в `.env` и рестарта agent-service! ✅

