# 🔧 FIX: Port 7080 Already in Use

## Проблема
```
Error: failed to bind host port for 127.0.0.1:7080:172.19.0.2:7080/tcp: address already in use
```

## Решение

### Вариант 1: Остановить все контейнеры и перезапустить

```bash
# 1. Остановить ВСЕ контейнеры проекта
cd /root/agents-monorepo  # или где у тебя проект
docker-compose down

# 2. Проверить что контейнеры остановлены
docker ps

# 3. Запустить заново
docker-compose up -d

# 4. Проверить логи
docker-compose logs -f agent-brain
```

---

### Вариант 2: Найти и убить процесс на порту 7080

```bash
# 1. Найти что занимает порт 7080
sudo lsof -i :7080

# Или через netstat:
sudo netstat -tulpn | grep :7080

# 2. Убить процесс (замени PID на реальный)
sudo kill -9 <PID>

# 3. Запустить контейнеры
docker-compose up -d
```

---

### Вариант 3: Остановить старые Docker контейнеры вручную

```bash
# 1. Показать ВСЕ контейнеры (включая остановленные)
docker ps -a

# 2. Найти старый контейнер agent-brain и остановить
docker stop root-agent-brain-1
docker rm root-agent-brain-1

# Или все контейнеры проекта:
docker stop $(docker ps -q)
docker rm $(docker ps -aq)

# 3. Запустить заново
cd /root/agents-monorepo
docker-compose up -d
```

---

## ⚠️ БЫСТРОЕ РЕШЕНИЕ (рекомендуется)

```bash
# В одну команду:
cd /root/agents-monorepo && \
docker-compose down && \
docker-compose up -d && \
docker-compose ps
```

---

## Проверка что всё работает

```bash
# 1. Проверить статус
docker-compose ps

# Должно быть примерно так:
# NAME                                  STATUS
# root-agent-brain-1                    Up X seconds
# root-agent-service-1                  Up X seconds
# root-creative-analyzer-1              Up X seconds

# 2. Проверить логи
docker-compose logs --tail=20 agent-brain
docker-compose logs --tail=20 agent-service

# 3. Тест API
curl http://localhost:7080/health
curl http://localhost:8082/health
```

---

## Если ничего не помогло

```bash
# Ядерный вариант: удалить ВСЕ контейнеры и пересобрать
cd /root/agents-monorepo
docker-compose down -v  # -v удалит и volumes
docker system prune -a  # Очистит всё (ВНИМАНИЕ: удалит все неиспользуемые образы!)
docker-compose build --no-cache
docker-compose up -d
```

