# 🔧 Promtail - Следующие шаги по настройке сбора логов

## 📋 КОНТЕКСТ

Работали над настройкой системы мониторинга (Loki + Promtail + Grafana) для сбора логов из Docker контейнеров `agent-brain` и `agent-service`.

---

## ✅ ЧТО УЖЕ СДЕЛАНО И РАБОТАЕТ

### 1. Инфраструктура логирования
- ✅ **Loki** (порт 3100) - запущен и работает
- ✅ **Grafana** (порт 3000) - запущен, дашборды загружены
- ✅ **Promtail** (порт 9080) - запущен и читает Docker логи

### 2. Улучшения в коде
- ✅ Добавлены `supabaseClient` wrappers для централизованной обработки ошибок БД
  - `services/agent-brain/src/lib/supabaseClient.js`
  - `services/agent-service/src/lib/supabaseClient.ts`
- ✅ Улучшена обработка Facebook ошибок с `msg` кодами
  - `services/agent-service/src/lib/facebookErrors.ts` - словарь ошибок
  - `services/agent-service/src/adapters/facebook.ts` - логирование с msg кодами
- ✅ Улучшен `logAlerts.js` для Telegram уведомлений с эмодзи
  - `services/agent-brain/src/lib/logAlerts.js`
- ✅ Создан дашборд "Errors by User" в Grafana
  - `logging/grafana-provisioning/dashboards/errors-by-user.json`

### 3. Документация
- ✅ Обновлена `INFRASTRUCTURE.md` с секцией "Мониторинг и логирование"
- ✅ Создан `LOGGING_IMPROVEMENTS_SUMMARY.md` - детальный отчёт о проделанной работе
- ✅ Создан `DEPLOY_MONITORING_INSTRUCTIONS.md` - инструкция по деплою

### 4. Очистка
- ✅ Удалены тестовые файлы (`test-promtail-logs.sh`, `test-generate-errors.js`)
- ✅ Создан `cleanup-docker.sh` для автоматической очистки Docker
- ✅ Создан `docker-daemon.json.example` для ротации логов

---

## ❌ ЧТО НЕ ПОЛУЧИЛОСЬ

### Проблема: Promtail собирает логи, но они НЕ попадают в Loki

**Симптомы:**
1. ✅ Promtail запущен и находит контейнеры (логи: "tail routine: started")
2. ✅ Promtail читает файлы `/var/lib/docker/containers/*/*-json.log`
3. ✅ Loki доступен на `http://loki:3100` и отвечает на `/ready`
4. ✅ Labels появляются в Loki API (`/loki/api/v1/labels` возвращает: service, level, msg, и т.д.)
5. ❌ **НО** запросы к Loki API возвращают **пустые результаты** (`result: []`)

**Пример:**
```bash
# Генерируем тестовую ошибку
docker-compose exec agent-brain sh -c 'echo "{\"level\":\"error\",\"service\":\"agent-brain\",\"msg\":\"test\"}" >&2'

# Ждём 10 секунд

# Запрашиваем из Loki
curl 'http://localhost:3100/loki/api/v1/query?query={msg="test"}&limit=1'

# Результат: {"data":{"result":[]}} ❌
```

---

## 🔍 ЧТО ПРОБОВАЛИ

### Попытка 1: Docker Service Discovery
**Конфигурация:**
```yaml
scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        filters:
          - name: label
            values: ["logging=promtail"]
```

**Результат:** Promtail находил контейнеры, но не читал логи (нет `__path__`)

---

### Попытка 2: Docker SD + relabel для __path__
**Конфигурация:**
```yaml
relabel_configs:
  - source_labels: ['__meta_docker_container_id']
    target_label: '__path__'
    replacement: '/var/lib/docker/containers/${1}/*-json.log'
```

**Результат:** Синтаксис `${1}` не работал, Promtail не читал файлы

---

### Попытка 3: Static configs + match stage
**Конфигурация:**
```yaml
scrape_configs:
  - job_name: docker-logs
    static_configs:
      - targets: [localhost]
        labels:
          job: docker-logs
          __path__: /var/lib/docker/containers/*/*-json.log
    pipeline_stages:
      - docker: {}
      - json: {...}
      - match:
          selector: '{service=~"agent-brain|agent-service"}'
          action: keep
      - labels: {...}
```

**Результат:** Promtail **падал** (Restarting) из-за неправильного синтаксиса `match` stage

---

### Попытка 4: Static configs БЕЗ match (текущая конфигурация)
**Конфигурация:** `logging/promtail-config.yml`
```yaml
scrape_configs:
  - job_name: docker-logs
    static_configs:
      - targets: [localhost]
        labels:
          job: docker-logs
          __path__: /var/lib/docker/containers/*/*-json.log
    pipeline_stages:
      - docker: {}
      - json:
          expressions:
            level:
            message:
            service:
            environment:
            module:
            userAccountId:
            userAccountName:
            userTelegram:
            msg:
            time:
      - labels:
          level:
          service:
          environment:
          module:
          userAccountId:
          userAccountName:
          userTelegram:
          msg:
      - timestamp:
          source: time
          format: RFC3339Nano
```

**Результат:** 
- ✅ Promtail запущен и работает
- ✅ Читает файлы логов (видно в логах Promtail)
- ✅ Labels появляются в Loki API
- ❌ **НО логи НЕ попадают в Loki** (пустые результаты запросов)

---

## 🤔 ПОДОЗРЕНИЯ НА ПРИЧИНУ

### 1. Проблема с двойным JSON парсингом
Docker оборачивает Pino JSON в свой JSON:
```json
{"log":"{\"level\":\"error\",\"service\":\"agent-brain\",\"msg\":\"test\"}\n","stream":"stderr","time":"2025-10-31T..."}
```

**Возможно:**
- Stage `docker: {}` извлекает поле `log`
- Stage `json:` пытается парсить, но что-то идёт не так
- Логи отбрасываются из-за ошибок парсинга

### 2. Проблема с timestamp
Используем `timestamp` stage с форматом `RFC3339Nano`, но возможно:
- Формат времени из Pino не совпадает
- Timestamp некорректный → Loki отбрасывает логи

### 3. Проблема с labels cardinality
Слишком много labels (`userAccountId`, `userAccountName`, `userTelegram`, `msg`) → Loki может отбрасывать из-за высокой cardinality

### 4. Проблема с pipeline stages порядком
Возможно, нужно сначала извлечь labels, а потом применять timestamp

---

## 🎯 ЗАДАЧА ДЛЯ СЛЕДУЮЩЕГО АГЕНТА

### Цель
Настроить Promtail так, чтобы логи от `agent-brain` и `agent-service` **попадали в Loki** и были доступны через запросы типа:
```logql
{service="agent-brain",msg="fb_token_expired"}
{userAccountName="performante",level="error"}
```

### Требования
1. Собирать логи ТОЛЬКО от контейнеров с label `logging=promtail` (agent-brain, agent-service)
2. Извлекать поля из JSON в labels: `service`, `msg`, `userAccountName`, `level`, `environment`, `module`
3. Логи должны быть доступны в Loki через Grafana дашборды

---

## 📂 ПОЛЕЗНЫЕ ФАЙЛЫ

### Конфигурация
- `logging/promtail-config.yml` - текущая конфигурация Promtail
- `logging/loki-config.yml` - конфигурация Loki
- `docker-compose.yml` - Docker Compose с Promtail, Loki, Grafana

### Документация
- `INFRASTRUCTURE.md` - секция "Мониторинг и логирование"
- `LOGGING_IMPROVEMENTS_SUMMARY.md` - детальный отчёт о проделанной работе
- `DEPLOY_MONITORING_INSTRUCTIONS.md` - инструкция по деплою

### Дашборды Grafana
- `logging/grafana-provisioning/dashboards/errors-by-user.json`
- `logging/grafana-provisioning/dashboards/agent-brain-drilldown.json`
- `logging/grafana-provisioning/dashboards/campaign-builder-errors.json`

---

## 🔧 КОМАНДЫ ДЛЯ ДИАГНОСТИКИ

### Проверить статус Promtail
```bash
docker-compose ps promtail
docker-compose logs promtail --tail 50
```

### Проверить что Promtail читает файлы
```bash
docker-compose logs promtail | grep "tail routine: started"
```

### Проверить Loki
```bash
# Доступность
curl http://localhost:3100/ready

# Labels
curl http://localhost:3100/loki/api/v1/labels | jq '.'

# Значения label service
curl http://localhost:3100/loki/api/v1/label/service/values | jq '.'
```

### Сгенерировать тестовую ошибку
```bash
docker-compose exec agent-brain sh -c 'echo "{\"level\":\"error\",\"time\":\"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'\",\"service\":\"agent-brain\",\"environment\":\"production\",\"msg\":\"test_error\",\"userAccountName\":\"TestUser\",\"message\":\"Test error\"}" >&2'
```

### Проверить в Loki (через 10 сек)
```bash
curl -s 'http://localhost:3100/loki/api/v1/query?query=%7Bmsg%3D%22test_error%22%7D&limit=1' | jq '.data.result | length'

# Должно вернуть > 0, но сейчас возвращает 0
```

### Проверить все логи в Loki
```bash
curl -s 'http://localhost:3100/loki/api/v1/query?query=%7Bjob%3D%22docker-logs%22%7D&limit=10' | jq '.data.result | length'
```

---

## 💡 ВОЗМОЖНЫЕ РЕШЕНИЯ

### Вариант 1: Упростить pipeline (убрать timestamp)
Попробовать убрать `timestamp` stage - возможно, проблема в нём:
```yaml
pipeline_stages:
  - docker: {}
  - json:
      expressions:
        level:
        service:
        msg:
        userAccountName:
  - labels:
      level:
      service:
      msg:
      userAccountName:
```

### Вариант 2: Уменьшить количество labels
Оставить только критичные labels (service, level, msg), убрать `userAccountId`, `userAccountName`, `userTelegram`:
```yaml
- labels:
    level:
    service:
    msg:
```

### Вариант 3: Добавить drop stage для отладки
Добавить `drop` stage чтобы понять на каком этапе теряются логи:
```yaml
pipeline_stages:
  - docker: {}
  - output:
      source: log
  - json: {...}
  - output:
      source: service
```

### Вариант 4: Использовать regex вместо json
Попробовать парсить через `regex` вместо `json`:
```yaml
- regex:
    expression: '.*"service":"(?P<service>[^"]+)".*"msg":"(?P<msg>[^"]+)".*'
```

### Вариант 5: Проверить Loki limits
Возможно, Loki отбрасывает логи из-за лимитов. Проверить `logging/loki-config.yml`:
```yaml
limits_config:
  ingestion_rate_mb: 16
  per_stream_rate_limit: 16MB
```

---

## 🚨 ВАЖНО

1. **НЕ УДАЛЯЙ** текущую конфигурацию без бэкапа
2. **ТЕСТИРУЙ** каждое изменение отдельно
3. **ПРОВЕРЯЙ** логи Promtail после каждого изменения: `docker-compose logs promtail --tail 50`
4. **ИСПОЛЬЗУЙ** тестовые ошибки для проверки (команда выше)
5. **ДОКУМЕНТИРУЙ** что пробовал и какой результат

---

## 📊 ТЕКУЩЕЕ СОСТОЯНИЕ

✅ **ПРОБЛЕМА РЕШЕНА! (2025-10-31)**

- **Promtail:** ✅ Работает, читает файлы
- **Loki:** ✅ Работает, отвечает на API
- **Grafana:** ✅ Работает, дашборды загружены
- **Labels в Loki:** ✅ Появляются (service, level, msg, и т.д.)
- **Логи в Loki:** ✅ **РАБОТАЕТ!** Логи успешно попадают в Loki

---

## 🎉 РЕШЕНИЕ

### Что было сделано:

1. ✅ **Docker Service Discovery** с фильтрацией по `logging=promtail`
2. ✅ **Добавлены relabel_configs** для динамического построения путей к логам
3. ✅ **Удален timestamp stage** (теперь используется timestamp из Docker)
4. ✅ **Снижена кардинальность лейблов** (убраны userAccountId, userTelegram)
5. ✅ **Добавлены базовые лейблы** (job, container_name, compose_service)
6. ✅ **Создан тестовый скрипт** `test-promtail-logs.sh`

### Результат:
```bash
# Запуск теста
./test-promtail-logs.sh

# Вывод:
✓ Loki доступен
✓ Найдено 3 логов за последние 30 сек!
✓ Тест пройден успешно!
✓ Promtail работает корректно
```

## 📖 Полная документация

См. **`PROMTAIL_CONFIG_FIXED.md`** для:
- Детального описания всех изменений
- Финальной конфигурации
- Примеров LogQL запросов
- Troubleshooting guide
- Полезных команд

---

## 🎯 КРИТЕРИЙ УСПЕХА

✅ **ВЫПОЛНЕНО!** Тест проходит успешно:
```bash
# Тест
./test-promtail-logs.sh

# Результат: ✅ Promtail работает корректно
```

---

## 📞 КОНТАКТЫ И ССЫЛКИ

- **GitHub:** https://github.com/dengineproblem/agents-monorepo
- **Последний коммит:** `d1e27e5` - "Улучшения системы логирования и мониторинга"
- **Promtail docs:** https://grafana.com/docs/loki/latest/clients/promtail/
- **Loki docs:** https://grafana.com/docs/loki/latest/

---

**Удачи! Система почти готова, осталось только заставить логи попадать в Loki.** 🚀

