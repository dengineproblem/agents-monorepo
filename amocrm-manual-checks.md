# 🔧 AmoCRM Integration - Ручная диагностика на сервере

## 1. Проверка контейнеров

```bash
# Все контейнеры
docker ps

# Только agent-service
docker ps | grep agent-service

# Если контейнер не запущен - проверить статус
docker ps -a | grep agent-service

# Запустить если остановлен
docker-compose up -d agent-service
```

## 2. Проверка логов

```bash
# Последние 50 строк
docker logs agents-monorepo-agent-service-1 --tail 50

# Следить за логами в реальном времени
docker logs agents-monorepo-agent-service-1 -f

# Только ошибки
docker logs agents-monorepo-agent-service-1 --tail 200 | grep -i "error"

# Только AmoCRM
docker logs agents-monorepo-agent-service-1 --tail 200 | grep -i "amocrm"

# За последний час
docker logs agents-monorepo-agent-service-1 --since 1h
```

## 3. Проверка переменных окружения

```bash
# Проверить .env.agent на сервере
cat /root/agents-monorepo/.env.agent | grep AMOCRM

# Должно быть:
# AMOCRM_CLIENT_ID=...
# AMOCRM_CLIENT_SECRET=...
# AMOCRM_REDIRECT_URI=https://app.performanteaiagency.com/amocrm/callback

# Проверить что переменные загружены в контейнер
docker exec agents-monorepo-agent-service-1 sh -c 'echo $AMOCRM_CLIENT_ID' | cut -c1-10
docker exec agents-monorepo-agent-service-1 sh -c 'echo $AMOCRM_REDIRECT_URI'
```

## 4. Проверка роутов в коде

```bash
# Проверить что роуты зарегистрированы в server.ts
docker exec agents-monorepo-agent-service-1 grep "amocrm" /app/dist/server.js

# Должно быть:
# app.register(amocrmOAuthRoutes);
# app.register(amocrmWebhooksRoutes);
# app.register(amocrmPipelinesRoutes);
# app.register(amocrmManagementRoutes);
```

## 5. Проверка endpoints

### Прямой доступ к agent-service (минуя nginx)

```bash
# GET /amocrm/auth
curl -I http://localhost:8082/amocrm/auth

# GET /amocrm/callback
curl -I http://localhost:8082/amocrm/callback

# GET /amocrm/pipelines
curl http://localhost:8082/amocrm/pipelines?userAccountId=YOUR_ID

# GET /amocrm/webhook-status
curl http://localhost:8082/amocrm/webhook-status?userAccountId=YOUR_ID
```

### Через nginx (production)

```bash
# GET /amocrm/auth (должен редиректить на AmoCRM OAuth)
curl -I https://app.performanteaiagency.com/amocrm/auth

# Должен вернуть:
# HTTP/2 302 (редирект на AmoCRM)
# или HTTP/2 400 (если нет параметров)
# НЕ должен быть 404 или 502!
```

## 6. Проверка nginx конфигурации

```bash
# Проверить конфигурацию nginx
docker exec agents-monorepo-nginx-1 cat /etc/nginx/nginx.conf | grep -A 10 "location /amocrm"

# Если нет специального блока для /amocrm - это НОРМАЛЬНО
# AmoCRM endpoints идут через общий блок /api/ или напрямую
```

## 7. Типичные ошибки и решения

### ❌ Ошибка: "404 Not Found" на /amocrm/auth

**Причина:** Роуты не зарегистрированы или agent-service не запущен

**Решение:**
```bash
# 1. Проверить что контейнер запущен
docker ps | grep agent-service

# 2. Перезапустить
docker-compose restart agent-service

# 3. Проверить логи
docker logs agents-monorepo-agent-service-1 --tail 50

# 4. Если нужно - пересобрать
docker-compose build agent-service
docker-compose up -d agent-service
```

### ❌ Ошибка: "502 Bad Gateway"

**Причина:** agent-service упал или не отвечает

**Решение:**
```bash
# 1. Проверить логи на ошибки
docker logs agents-monorepo-agent-service-1 --tail 100 | grep -i error

# 2. Перезапустить
docker-compose restart agent-service

# 3. Проверить health
curl http://localhost:8082/health
```

### ❌ Ошибка: "Missing AMOCRM_CLIENT_ID"

**Причина:** Переменные окружения не загружены

**Решение:**
```bash
# 1. Проверить .env.agent
cat .env.agent | grep AMOCRM

# 2. Если пустые - добавить:
# AMOCRM_CLIENT_ID=your-client-id
# AMOCRM_CLIENT_SECRET=your-client-secret
# AMOCRM_REDIRECT_URI=https://app.performanteaiagency.com/amocrm/callback

# 3. Перезапустить контейнер
docker-compose down agent-service
docker-compose up -d agent-service
```

### ❌ Ошибка: OAuth редирект на неправильный URL

**Причина:** AMOCRM_REDIRECT_URI в .env.agent не совпадает с настройками в AmoCRM

**Решение:**
```bash
# 1. Проверить REDIRECT_URI в .env.agent
cat .env.agent | grep AMOCRM_REDIRECT_URI

# 2. Должен быть:
# AMOCRM_REDIRECT_URI=https://app.performanteaiagency.com/amocrm/callback

# 3. Проверить что в AmoCRM OAuth настройках тот же URL
# (зайти в настройки интеграции в AmoCRM)

# 4. Если изменил - перезапустить контейнер
docker-compose restart agent-service
```

## 8. Полная перезагрузка (если все остальное не помогло)

```bash
cd /root/agents-monorepo

# 1. Остановить
docker-compose down agent-service

# 2. Проверить что .env.agent правильный
cat .env.agent | grep AMOCRM

# 3. Пересобрать БЕЗ кэша
docker-compose build --no-cache agent-service

# 4. Запустить
docker-compose up -d agent-service

# 5. Следить за логами
docker logs agents-monorepo-agent-service-1 -f

# 6. Проверить endpoint
curl -I http://localhost:8082/amocrm/auth
```

## 9. Проверка через браузер

```bash
# 1. Открыть в браузере
https://app.performanteaiagency.com/amocrm/auth?userAccountId=YOUR_ID

# 2. Должен редиректить на AmoCRM OAuth страницу
# 3. После авторизации - редиректить обратно на /amocrm/callback
# 4. Должен показать success или сохранить токены
```

## 10. Проверка в Supabase

```bash
# После успешной авторизации должны появиться записи в таблице amocrm_tokens
# Проверить через Supabase UI:
# https://supabase.com/dashboard/project/YOUR_PROJECT/editor/amocrm_tokens
```

---

## 📋 Чеклист диагностики

- [ ] Контейнер agent-service запущен
- [ ] Логи не содержат ошибок
- [ ] Переменные AMOCRM_CLIENT_ID, AMOCRM_CLIENT_SECRET, AMOCRM_REDIRECT_URI загружены
- [ ] Роуты amocrmOAuthRoutes зарегистрированы в server.ts
- [ ] Endpoint /amocrm/auth отвечает (не 404)
- [ ] Endpoint доступен через nginx (https://app.../amocrm/auth)
- [ ] REDIRECT_URI совпадает с настройками в AmoCRM

---

**Если все пункты выполнены, но интеграция не работает - отправь полные логи для анализа!**
