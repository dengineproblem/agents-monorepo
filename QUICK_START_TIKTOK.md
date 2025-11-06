# TikTok OAuth - Quick Start 🚀

## ✅ Что готово

Полностью реализован TikTok OAuth в вашем agents-monorepo:

### Backend (4 файла)
- ✅ `services/agent-service/src/routes/tiktokOAuth.ts` - новый роут
- ✅ `services/agent-service/src/server.ts` - зарегистрирован роут
- ✅ `env.agent.example` - добавлены TIKTOK_APP_ID и TIKTOK_APP_SECRET

### Frontend (2 файла)
- ✅ `services/frontend/src/pages/OAuthCallback.tsx` - новая страница
- ✅ `services/frontend/src/App.tsx` - добавлен роут /oauth/callback

### Документация (3 файла)
- ✅ `TIKTOK_OAUTH_SUMMARY.md` - полная документация
- ✅ `TIKTOK_OAUTH_TESTING.md` - гид по тестированию
- ✅ `DEPLOY_TIKTOK_OAUTH.sh` - скрипт деплоя

## 🚀 Как задеплоить (1 команда)

На сервере выполните:

```bash
cd /root/agents-monorepo && \
git pull && \
docker-compose build agent-service frontend && \
docker-compose up -d agent-service frontend && \
sleep 5 && \
docker-compose logs --tail=30 agent-service
```

## 🧪 Как протестировать (3 шага)

1. Откройте https://performanteaiagency.com/profile
2. Кликните "Connect TikTok"
3. Авторизуйтесь в TikTok

**Готово!** TikTok должен подключиться.

## 📊 Что проверить

```bash
# Логи backend
docker-compose logs agent-service | grep -i tiktok

# Логи frontend (в браузере Console)
# Должно быть: "TikTok OAuth completed, redirecting to profile"
```

## 📝 Файлы для commit

```bash
git status
# Должно показать:
# modified:   services/agent-service/src/server.ts
# modified:   env.agent.example
# new file:   services/agent-service/src/routes/tiktokOAuth.ts
# new file:   services/frontend/src/pages/OAuthCallback.tsx
# modified:   services/frontend/src/App.tsx
# new file:   TIKTOK_OAUTH_*.md
# new file:   DEPLOY_TIKTOK_OAUTH.sh
```

## ❓ Проблемы?

См. `TIKTOK_OAUTH_TESTING.md` секция "Возможные проблемы"

---

**Всё готово к деплою!** 🎉
