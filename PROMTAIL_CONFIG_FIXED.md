# Рабочая конфигурация Promtail для сбора Docker логов с Pino JSON

## Резюме

✅ **Promtail успешно настроен и работает корректно!**

Логи из Docker контейнеров `agent-brain` и `agent-service` теперь собираются, парсятся и отправляются в Loki с правильными лейблами.

## Проблемы, которые были решены

### 1. Docker Service Discovery вместо статических путей
**Проблема:** Использовалась статическая конфигурация с glob-паттерном `/*/*-json.log`, которая читала все контейнеры.

**Решение:** Настроен Docker Service Discovery с фильтрацией по лейблу `logging=promtail`:
```yaml
docker_sd_configs:
  - host: unix:///var/run/docker.sock
    filters:
      - name: label
        values: ["logging=promtail"]
```

### 2. Корректное построение путей к лог-файлам
**Проблема:** Promtail не знал, как найти файлы контейнеров.

**Решение:** Добавлены `relabel_configs` для динамического построения путей:
```yaml
relabel_configs:
  - source_labels: ['__meta_docker_container_id']
    regex: (.*)
    target_label: '__path__'
    replacement: '/var/lib/docker/containers/$1/$1-json.log'
  - source_labels: ['__meta_docker_container_name']
    regex: '/(.*)'
    target_label: 'container_name'
  - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
    target_label: 'compose_service'
  - replacement: 'docker-logs'
    target_label: 'job'
```

### 3. Удален проблемный timestamp stage
**Проблема:** Явный парсинг timestamp с `RFC3339Nano` вызывал ошибки при несовпадении формата.

**Решение:** Удален stage `timestamp`. Теперь используется timestamp из Docker wrapper, который автоматически извлекается stage `docker: {}`.

### 4. Снижена кардинальность лейблов
**Проблема:** Использовались высоко-кардинальные лейблы (`userAccountId`, `userTelegram`), которые создают слишком много уникальных stream'ов.

**Решение:** Оставлены только низко-кардинальные лейблы:
- `level` (error, info, warn, debug)
- `service` (agent-brain, agent-service)
- `msg` (тип сообщения)
- `userAccountName` (имя пользователя, ограниченное количество)
- `environment` (production, development)
- `module` (модуль приложения)

### 5. Добавлен обязательный лейбл `job`
**Проблема:** Loki возвращал ошибку "error at least one label pair is required per stream".

**Решение:** Добавлен базовый лейбл `job=docker-logs` через relabel_configs.

## Финальная конфигурация

Файл: `logging/promtail-config.yml`

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/promtail-positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker-logs
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        filters:
          - name: label
            values: ["logging=promtail"]
    relabel_configs:
      - source_labels: ['__meta_docker_container_id']
        regex: (.*)
        target_label: '__path__'
        replacement: '/var/lib/docker/containers/$1/$1-json.log'
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container_name'
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'compose_service'
      - replacement: 'docker-logs'
        target_label: 'job'
    pipeline_stages:
      # Шаг 1: Распарсить Docker JSON обёртку (извлекает поле "log" и timestamp)
      - docker: {}
      
      # Шаг 2: Распарсить Pino JSON внутри поля "log"
      - json:
          expressions:
            level:
            service:
            msg:
            userAccountName:
            environment:
            module:
      
      # Шаг 3: Преобразовать поля в labels для индексации (только низкокардинальные)
      - labels:
          level:
          service:
          msg:
          userAccountName:
          environment:
          module:
```

## Тестирование

Создан скрипт `test-promtail-logs.sh` для автоматической проверки работы Promtail:

```bash
./test-promtail-logs.sh
```

### Что проверяет скрипт:
1. ✅ Доступность Loki
2. ✅ Генерация реального лога через HTTP запрос к agent-brain
3. ✅ Появление новых логов в Loki за последние 30 секунд
4. ✅ Наличие всех ожидаемых лейблов
5. ✅ Статистика по сервисам

### Результат последнего теста:
```
✓ Loki доступен
✓ Найдено 3 логов за последние 30 сек!
✓ Тест пройден успешно!
✓ Promtail работает корректно
```

## Доступные лейблы в Loki

```
- compose_service     # Имя сервиса из docker-compose
- container_name      # Полное имя контейнера
- environment         # production / development
- filename            # Путь к лог-файлу
- job                 # docker-logs
- level               # error / info / warn / debug
- module              # Модуль приложения
- msg                 # Тип сообщения
- service             # agent-brain / agent-service
- stream              # stdout / stderr
```

## Примеры запросов LogQL

### Все ошибки от agent-brain:
```logql
{container_name="agents-monorepo-agent-brain-1", level="error"}
```

### Логи от конкретного пользователя:
```logql
{service="agent-brain"} |= "userAccountName" |= "Анатолий Степанов"
```

### Ошибки за последний час:
```logql
{level="error"} |= ""
```

### Count ошибок по сервисам:
```logql
sum by (service) (count_over_time({level="error"}[1h]))
```

## Мониторинг в Grafana

Доступ: http://localhost:3000

Логи можно просматривать через:
1. **Explore** → Data Source: Loki
2. Вводить LogQL запросы
3. Использовать Label Browser для фильтрации

## Как добавить новый контейнер в мониторинг

1. Добавить лейбл в `docker-compose.yml`:
```yaml
services:
  my-service:
    labels:
      logging: "promtail"
```

2. Перезапустить сервис:
```bash
docker-compose up -d my-service
```

3. Promtail автоматически обнаружит новый контейнер и начнёт собирать логи

## Отличия от предыдущей конфигурации

| Параметр | Было | Стало |
|----------|------|-------|
| Service Discovery | `static_configs` с glob | `docker_sd_configs` с фильтром |
| Путь к логам | Статический glob | Динамический через relabel |
| Timestamp | Явный парсинг `RFC3339Nano` | Автоматический из Docker |
| Лейблы | 8 (включая высоко-кардинальные) | 6 (только низко-кардинальные) |
| Базовые лейблы | Отсутствовали | `job`, `container_name`, `compose_service` |

## Troubleshooting

### Логи не появляются в Loki

1. Проверить логи Promtail:
```bash
docker-compose logs promtail --tail=50
```

2. Проверить, что контейнер помечен правильным лейблом:
```bash
docker ps --filter "label=logging=promtail"
```

3. Проверить доступные лейблы в Loki:
```bash
curl -s http://localhost:3100/loki/api/v1/labels | jq .
```

4. Запустить тест:
```bash
./test-promtail-logs.sh
```

### Ошибка "at least one label pair is required per stream"

Это означает, что Promtail отправляет логи без лейблов. Проверьте:
- Наличие `relabel_configs` с лейблом `job`
- Правильность pipeline_stages (должен быть `docker: {}` перед `json`)

### Слишком много stream'ов в Loki

Уменьшите количество лейблов в секции `labels` конфигурации Promtail. Оставьте только те, по которым действительно нужна фильтрация.

## Следующие шаги

1. ✅ Promtail собирает логи и отправляет в Loki
2. ✅ Создан тестовый скрипт
3. 📋 Создать дашборды в Grafana для визуализации
4. 📋 Настроить алерты на критичные ошибки
5. 📋 Документировать best practices для логирования

## Полезные команды

```bash
# Перезапустить Promtail
docker-compose restart promtail

# Проверить логи Promtail
docker-compose logs promtail -f

# Проверить логи Loki
docker-compose logs loki -f

# Тест конфигурации
./test-promtail-logs.sh

# Список лейблов в Loki
curl -s http://localhost:3100/loki/api/v1/labels | jq .

# Значения конкретного лейбла
curl -s http://localhost:3100/loki/api/v1/label/service/values | jq .

# Последние логи от agent-brain
curl -s -G --data-urlencode 'query={container_name="agents-monorepo-agent-brain-1"}' \
  --data-urlencode "start=$(python3 -c 'import time; print(int((time.time()-300)*1e9))')" \
  --data-urlencode "end=$(python3 -c 'import time; print(int(time.time()*1e9))')" \
  http://localhost:3100/loki/api/v1/query_range | jq '.data.result[0].values[-5:]'
```

## Заключение

Конфигурация Promtail теперь полностью рабочая и оптимизирована для production использования:

✅ Автоматическое обнаружение контейнеров по лейблу  
✅ Корректный парсинг Docker JSON + Pino JSON  
✅ Оптимизированные лейблы (низкая кардинальность)  
✅ Надёжная доставка логов в Loki  
✅ Тестовый скрипт для проверки  

Мониторинг stack (Promtail → Loki → Grafana) готов к использованию! 🎉

