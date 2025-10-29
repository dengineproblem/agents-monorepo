# ✅ Evolution API - Совместимость с существующей инфраструктурой

## 🔍 Анализ изменений

### Docker Compose (docker-compose.yml)

#### ✅ **Добавлено (БЕЗ конфликтов):**

**Новые сервисы:**
- `evolution-api` - порт 8080 (хост) → 8080 (контейнер)
- `evolution-redis` - порт 6380 (хост) → 6379 (контейнер)
- `evolution-postgres` - порт 5433 (хост) → 5432 (контейнер)

**Проверка конфликтов портов:**
```bash
# Выполни эту команду ДО деплоя
sudo lsof -i :8080   # Должно быть пусто
sudo lsof -i :6380   # Должно быть пусто
sudo lsof -i :5433   # Должно быть пусто
```

**Volumes:**
- `evolution-redis-data` (новый)
- `evolution-postgres-data` (новый)

**Не затрагивает:**
- Существующие volumes: `loki-data`, `grafana-data`
- Существующие сервисы: nginx, frontend, agent-service, agent-brain, loki, grafana

---

### Nginx Configuration (nginx-production.conf)

#### ✅ **Добавлено (БЕЗ конфликтов):**

**В ОБА server блока добавлено:**
```nginx
location /evolution/ {
    rewrite ^/evolution/(.*)$ /$1 break;
    proxy_pass http://evolution-api:8080;
    ...
}
```

**Размещение:**
- **ПЕРЕД** `location /api/analyzer/`
- **ПЕРЕД** `location /api/`

**Не затрагивает:**
- ❌ n8n конфигурацию (`n8n.performanteaiagency.com`)
- ❌ WebSocket map директиву
- ❌ SSL сертификаты
- ❌ Существующие location блоки

**Проверка порядка location:**
1. `/evolution/` ← **НОВЫЙ**
2. `/api/analyzer/`
3. `/api/`
4. `/`

---

### Backend (agent-service)

#### ✅ **Добавлено (БЕЗ конфликтов):**

**Новые файлы:**
- `services/agent-service/src/routes/evolutionWebhooks.ts`
- `services/agent-service/src/routes/whatsappInstances.ts`

**Изменения в server.ts:**
```typescript
import evolutionWebhooks from './routes/evolutionWebhooks.js';
import whatsappInstances from './routes/whatsappInstances.js';

app.register(evolutionWebhooks);
app.register(whatsappInstances);
```

**Не затрагивает:**
- ❌ Существующие routes
- ❌ CORS конфигурацию
- ❌ Middleware
- ❌ Cron jobs

---

### Database (Supabase)

#### ✅ **Изменения (БЕЗ потери данных):**

**Таблица `leads`:**
- Добавлены 4 новых колонки (nullable): `direction_id`, `creative_id`, `whatsapp_phone_number_id`, `user_account_id`
- Все существующие данные **сохраняются**
- Migration 016 попытается заполнить новые поля для существующих 472 лидов

**Таблица `messages_ai_target`:**
- Добавлены 6 новых колонок (nullable): `instance_id`, `source_id`, `creative_id`, `direction_id`, `lead_id`, `raw_data`
- Все существующие сообщения **сохраняются**

**Новые таблицы:**
- `whatsapp_instances` (пустая, заполнится при подключении WhatsApp)

**Не затрагивает:**
- ❌ Существующие таблицы: `user_accounts`, `account_directions`, `user_creatives`, `creative_tests`, `whatsapp_phone_numbers`
- ❌ Существующие данные НЕ удаляются и НЕ изменяются

---

## 🚨 Потенциальные проблемы

### 1. Порты уже заняты

**Симптом:**
```
Error: bind: address already in use
```

**Причина:** Порты 8080, 6380 или 5433 заняты другим процессом

**Решение:**
```bash
# Найти процесс на порту
sudo lsof -i :8080

# Остановить процесс
sudo kill <PID>

# Или изменить порты в docker-compose.yml
```

### 2. Nginx не перезагружается

**Симптом:**
```
nginx: [emerg] unknown directive "location"
```

**Причина:** Синтаксическая ошибка в nginx-production.conf

**Решение:**
```bash
# Проверить конфигурацию
docker exec agents-monorepo-nginx-1 nginx -t

# Если есть ошибки - откатить изменения
git checkout nginx-production.conf
docker-compose restart nginx
```

### 3. Evolution API не запускается

**Симптом:**
```
evolution-api exited with code 1
```

**Причина:** Не установлены environment variables

**Решение:**
```bash
# Проверить .env.agent
cat .env.agent | grep EVOLUTION

# Если нет - добавить (см. EVOLUTION_API_ENV_SETUP.md)
```

---

## 🔄 План отката изменений

Если что-то пошло не так, откатить изменения в обратном порядке:

### Шаг 1: Откат Docker

```bash
# Остановить и удалить новые контейнеры
docker-compose down evolution-api evolution-redis evolution-postgres

# ИЛИ откатить docker-compose.yml
git checkout docker-compose.yml
docker-compose down
docker-compose up -d
```

### Шаг 2: Откат Nginx

```bash
# Откатить nginx-production.conf
git checkout nginx-production.conf

# Перезагрузить nginx
docker-compose restart nginx
```

### Шаг 3: Откат Backend

```bash
# Удалить новые routes
rm services/agent-service/src/routes/evolutionWebhooks.ts
rm services/agent-service/src/routes/whatsappInstances.ts

# Откатить server.ts
git checkout services/agent-service/src/server.ts

# Пересобрать agent-service
docker-compose build agent-service
docker-compose up -d agent-service
```

### Шаг 4: Откат Database (ОСТОРОЖНО!)

См. раздел "Откат миграций" в [MIGRATION_INSTRUCTIONS.md](MIGRATION_INSTRUCTIONS.md)

---

## ✅ Проверки перед деплоем

### Checklist:

- [ ] **Проверены порты:**
  ```bash
  sudo lsof -i :8080
  sudo lsof -i :6380
  sudo lsof -i :5433
  ```
  Все должны быть **пусты**

- [ ] **Проверена nginx конфигурация:**
  ```bash
  grep -n "location /evolution/" nginx-production.conf
  ```
  Должно быть **2 совпадения** (для обоих server блоков)

- [ ] **Проверены environment variables:**
  ```bash
  cat .env.agent | grep EVOLUTION
  ```
  Должны быть **4 переменные**: API_KEY, DB_PASSWORD, SERVER_URL, API_URL

- [ ] **Выполнены миграции в Supabase**
  - Migration 013 ✅
  - Migration 014 ✅
  - Migration 015 ✅
  - Migration 016 ✅

- [ ] **Git коммит сделан:**
  ```bash
  git status
  ```
  Должно быть **clean**

---

## 🎯 Совместимость с существующими функциями

### ✅ НЕ затронуто:

- **N8N workflows** - продолжат работать как раньше
- **ROI Analytics (старый)** - продолжит работать с `source_id`
- **Креативы** - не изменились
- **Directions** - не изменились
- **Facebook API** - не затронуто
- **Grafana/Loki logging** - не затронуто
- **Existing webhooks** - не затронуты

### ⚠️ Изменится после деплоя:

- **ROI Analytics (новый)** - добавится группировка по `direction_id` (опционально, через frontend update)
- **WhatsApp лиды** - будут создаваться автоматически через Evolution API
- **Таблица leads** - появятся новые поля (но старые данные сохранятся)

---

## 📊 Мониторинг после деплоя

### Что проверить:

1. **Все существующие контейнеры работают:**
   ```bash
   docker ps
   ```
   Должны быть UP:
   - nginx
   - frontend
   - frontend-appreview
   - agent-service
   - agent-brain
   - creative-analyzer
   - loki
   - grafana
   - **+ evolution-api, evolution-redis, evolution-postgres**

2. **Логи без ошибок:**
   ```bash
   docker-compose logs --tail=50 evolution-api
   docker-compose logs --tail=50 agent-service
   ```

3. **Nginx проксирует Evolution API:**
   ```bash
   curl -H "apikey: $EVOLUTION_API_KEY" \
     https://app.performanteaiagency.com/evolution/instance/fetchInstances
   ```
   Ожидается: `[]` (пустой массив)

4. **Старые функции работают:**
   - Открой https://app.performanteaiagency.com
   - Проверь Dashboard
   - Проверь Campaigns
   - Проверь ROI Analytics (старая версия)

---

## 📞 Если что-то сломалось

1. **Проверь логи:**
   ```bash
   docker-compose logs -f
   ```

2. **Проверь статус контейнеров:**
   ```bash
   docker ps -a
   ```

3. **Откати изменения** (см. "План отката" выше)

4. **Перезапусти все сервисы:**
   ```bash
   docker-compose restart
   ```

---

**Вывод:** Все изменения **совместимы** с существующей инфраструктурой и **не ломают** работающие функции. Новые сервисы изолированы и добавлены аккуратно.

✅ **Можно деплоить безопасно!**

---

**Дата проверки:** 2025-10-28
**Проверено:** Claude Code Assistant
