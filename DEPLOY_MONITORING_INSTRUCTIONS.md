# 🚀 Инструкция по деплою системы мониторинга

## ✅ Что было сделано локально

1. ✅ Упрощена конфигурация Promtail (убран проблемный match stage)
2. ✅ Promtail собирает логи от всех контейнеров через static_configs
3. ✅ Добавлены supabaseClient wrappers для централизованной обработки ошибок
4. ✅ Улучшена обработка Facebook ошибок с msg кодами
5. ✅ Добавлен дашборд "Errors by User" в Grafana
6. ✅ Настроены Telegram алерты с эмодзи
7. ✅ Обновлена документация INFRASTRUCTURE.md
8. ✅ Закоммичено и готово к пушу

---

## 📦 Деплой на сервер

### Шаг 1: Запушить изменения (на локальной машине)

```bash
cd ~/agents-monorepo

# Если git push не сработал в автоматическом режиме, выполните вручную:
git push origin main
```

---

### Шаг 2: Подключиться к серверу

```bash
ssh root@your-server
```

---

### Шаг 3: Подтянуть изменения

```bash
cd ~/agents-monorepo
git pull origin main
```

---

### Шаг 4: Перезапустить контейнеры мониторинга

```bash
# Пересобрать и перезапустить Loki, Promtail, Grafana
docker-compose build loki promtail grafana
docker-compose up -d loki promtail grafana

# Пересобрать и перезапустить agent-brain (для supabaseClient и logAlerts)
docker-compose build agent-brain creative-analyzer
docker-compose up -d agent-brain creative-analyzer

# Пересобрать и перезапустить agent-service (для supabaseClient и Facebook errors)
docker-compose build agent-service
docker-compose up -d agent-service
```

---

### Шаг 5: Проверить статус контейнеров

```bash
docker-compose ps
```

**Ожидаемый результат:**
- Все контейнеры должны быть в статусе `Up`
- Особенно проверьте: `promtail`, `loki`, `grafana`, `agent-brain`, `agent-service`

**Если Promtail в статусе `Restarting`:**
```bash
# Проверить логи
docker-compose logs promtail --tail 50

# Если есть ошибки в конфигурации - исправить и перезапустить
docker-compose restart promtail
```

---

### Шаг 6: Проверить работу Loki

```bash
# Проверить доступность Loki
curl http://localhost:3100/ready

# Проверить что labels появились
curl http://localhost:3100/loki/api/v1/labels

# Должен вернуть список labels: service, level, msg, userAccountName, и т.д.
```

---

### Шаг 7: Проверить Grafana (через SSH tunnel)

**На локальной машине:**
```bash
ssh -L 3000:localhost:3000 root@your-server
```

**В браузере:**
1. Открыть http://localhost:3000
2. Логин: `admin` / Пароль: `admin` (или из переменных окружения)
3. Перейти в Dashboards → Browse
4. Проверить что дашборды загружены:
   - Errors by User
   - Agent Brain Drilldown
   - Campaign Builder Errors

---

### Шаг 8: Проверить Telegram алерты

**Проверить переменные окружения:**
```bash
# На сервере
cat ~/agents-monorepo/.env.brain | grep LOG_ALERT
```

**Должны быть установлены:**
```bash
LOG_ALERT_TELEGRAM_BOT_TOKEN=...
LOG_ALERT_TELEGRAM_CHAT_ID=...
LOKI_URL=http://loki:3100
LOG_ALERT_POLL_INTERVAL_MS=30000
LOG_ALERT_DEDUP_WINDOW_MS=600000
LOG_ALERT_CRITICAL_ONLY=true  # опционально
```

**Если переменных нет - добавить:**
```bash
nano ~/agents-monorepo/.env.brain

# Добавить строки выше, сохранить (Ctrl+O, Enter, Ctrl+X)

# Перезапустить agent-brain
docker-compose restart agent-brain
```

**Проверить логи agent-brain:**
```bash
docker-compose logs agent-brain --tail 50 | grep -i "loki\|alert"
```

Должны быть сообщения типа:
- "Log alerts worker started"
- "Querying Loki for errors..."

---

### Шаг 9: Тестирование (опционально)

**Сгенерировать тестовую ошибку:**
```bash
docker-compose exec agent-brain sh -c 'echo "{\"level\":\"error\",\"time\":\"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'\",\"service\":\"agent-brain\",\"environment\":\"production\",\"msg\":\"test_error\",\"userAccountName\":\"TestUser\",\"message\":\"Test error for monitoring\"}" >&2'
```

**Подождать 10 секунд и проверить в Loki:**
```bash
curl -s 'http://localhost:3100/loki/api/v1/query?query=%7Bmsg%3D%22test_error%22%7D&limit=1' | jq '.data.result | length'
```

Должно вернуть `1` (или больше) - это значит, что логи попадают в Loki.

**Проверить в Grafana:**
1. Открыть дашборд "Errors by User"
2. Выбрать `TestUser` из выпадающего списка
3. Должна появиться тестовая ошибка

---

## 🧹 Очистка Docker (опционально)

Если на сервере мало места, выполните очистку:

```bash
# Применить ротацию логов Docker (один раз)
sudo cp ~/agents-monorepo/docker-daemon.json.example /etc/docker/daemon.json
sudo systemctl restart docker
docker-compose restart

# Очистить старые образы и контейнеры
~/agents-monorepo/cleanup-docker.sh

# Добавить в cron для автоматической очистки (каждое воскресенье в 3:00)
crontab -e
# Добавить строку:
0 3 * * 0 /root/agents-monorepo/cleanup-docker.sh >> /var/log/docker-cleanup.log 2>&1
```

---

## 🔍 Диагностика проблем

### Promtail не запускается (Restarting)

```bash
# Проверить логи
docker-compose logs promtail --tail 100

# Проверить конфигурацию
cat ~/agents-monorepo/logging/promtail-config.yml

# Если есть синтаксические ошибки - исправить и перезапустить
docker-compose restart promtail
```

### Loki не отвечает

```bash
# Проверить статус
docker-compose ps loki

# Проверить логи
docker-compose logs loki --tail 50

# Перезапустить
docker-compose restart loki

# Проверить доступность
curl http://localhost:3100/ready
```

### Grafana не показывает логи

```bash
# Проверить что Loki datasource настроен
# В Grafana UI: Configuration → Data Sources → Loki
# URL должен быть: http://loki:3100

# Перезапустить Grafana
docker-compose restart grafana

# Проверить что дашборды загружены
ls -la ~/agents-monorepo/logging/grafana-provisioning/dashboards/
```

### Telegram алерты не приходят

```bash
# Проверить переменные окружения
docker-compose exec agent-brain printenv | grep LOG_ALERT

# Проверить логи agent-brain
docker-compose logs agent-brain --tail 100 | grep -i "alert\|loki"

# Проверить что Loki доступен из agent-brain
docker-compose exec agent-brain curl http://loki:3100/ready

# Если нет - перезапустить
docker-compose restart agent-brain
```

---

## ✅ Чеклист после деплоя

- [ ] Все контейнеры в статусе `Up`
- [ ] Promtail не в статусе `Restarting`
- [ ] Loki отвечает на `/ready`
- [ ] Grafana открывается через SSH tunnel
- [ ] Дашборды загружены в Grafana
- [ ] Loki datasource настроен в Grafana
- [ ] Переменные окружения для Telegram алертов установлены
- [ ] Логи agent-brain показывают "Log alerts worker started"

---

## 📚 Полезные ссылки

- **Документация:** `INFRASTRUCTURE.md` (секция "Мониторинг и логирование")
- **Детальный отчёт:** `LOGGING_IMPROVEMENTS_SUMMARY.md`
- **Grafana:** http://localhost:3000 (через SSH tunnel)
- **Loki API:** http://localhost:3100 (на сервере)

---

## 🎉 Готово!

Система мониторинга развернута и готова к работе. Теперь вы можете:

- 🔍 Искать ошибки по пользователям в Grafana
- 📊 Анализировать логи через LogQL запросы
- 📱 Получать Telegram уведомления о критических ошибках
- 🗄️ Хранить логи в Loki для последующего анализа

**Время на поиск ошибки пользователя:** ~10 секунд ✅








