# Руководство по деплою

Документ адаптирован под прод-сервер `/root/agents-monorepo`, где уже запущены контейнеры `agent-service`, `agent-brain`, `creative-analyzer`.

## 1. Перед стартом

- SSH доступ на сервер (`root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01`).
- Docker Compose v2.36.2 (как на сервере).
- Актуальные `.env.agent`, `.env.brain` с рабочими токенами Supabase и Facebook.
- Добавленный в чат Telegram-бот (боевой токен пока **не указан** — см. пункт 3).

## 2. Быстрый чек состояния

```bash
ssh root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01
cd /root/agents-monorepo

git status
git log -1 --oneline

docker compose ps
docker compose logs agent-service --tail 30
docker compose logs agent-brain --tail 30
docker compose logs creative-analyzer --tail 30
```

## 3. Проверь `.env`

В каталоге `/root/agents-monorepo` уже лежат файлы:

```bash
ls -al .env*
```

Открой и убедись, что заданы ключевые переменные (безопасно показать первые строки):

```bash
head -n 40 .env.agent
head -n 40 .env.brain
```

Нужно добавить боевые переменные для алертов (если их ещё нет):

```
LOG_ALERT_TELEGRAM_BOT_TOKEN=...
LOG_ALERT_TELEGRAM_CHAT_ID=...
LOG_ALERT_LOKI_ENVIRONMENT=production
```

*(Сейчас используются `LOG_ALERT_TEST_*`, поэтому боевые уведомления не отправляются.)*

## 4. Обновление кода

```bash
cd /root/agents-monorepo
git fetch --all
git checkout main
git pull origin main
```

При необходимости — просмотреть diff:

```bash
git diff --stat
```

## 5. Пересборка и рестарт

```bash
docker compose down
docker compose up -d --build
```

Убедись, что все контейнеры подняты:

```bash
docker compose ps
```

## 6. Постдеплойные проверки

1. **Логи** — отсутствие новых ошибок:
   ```bash
   docker compose logs agent-service --tail 50
   docker compose logs agent-brain --tail 50
   docker compose logs creative-analyzer --tail 50
   docker compose logs promtail --tail 50
   ```

2. **Здоровье сервисов**:
   ```bash
   curl -s http://localhost:8082/health
   curl -s http://localhost:7080/api/brain/llm-ping
   ```

3. **Grafana/Loki** (если подняты):
   ```bash
   curl -s http://localhost:3000/api/health
   curl -s http://localhost:3100/ready
   ```

4. **Telegram** — после добавления боевого токена и chat_id, сгенерируй тестовую ошибку (см. `LOGGING_GUIDE.md`).

5. **API-сценарии** — выполняем ручные проверки:
   - `/api/campaign-builder/manual-launch`
   - `/api/creative-test/start`

6. **Cron** — дождаться следующего цикла или инициировать вручную, если требуется.

## 7. Откат

```bash
git checkout HEAD~1
docker compose down
docker compose up -d --build
```

Либо переключиться на нужный тег/коммит (`git checkout <tag>`), в зависимости от ситуации.

## 8. Примечания

- `agent-brain` использует модель `gpt-4.1` (см. `.env.brain`).
- Чтобы алерты попадали в Telegram, обязательно задать `LOG_ALERT_TELEGRAM_BOT_TOKEN` и `LOG_ALERT_TELEGRAM_CHAT_ID`.
- Для безопасного доступа к Grafana извне настрой поддомен или туннель (`ssh -L 3000:localhost:3000 ...`).


