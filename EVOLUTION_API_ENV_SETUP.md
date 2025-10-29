# Evolution API Environment Setup

## Необходимые переменные окружения

Добавьте следующие переменные в файл `.env.agent`:

```bash
# Evolution API Configuration
EVOLUTION_API_KEY=<generate-with-command-below>
EVOLUTION_DB_PASSWORD=<generate-with-command-below>
EVOLUTION_SERVER_URL=https://app.performanteaiagency.com/evolution
EVOLUTION_API_URL=http://evolution-api:8080
```

## Генерация секретных ключей

Выполните следующие команды для генерации безопасных ключей:

```bash
# Генерация Evolution API Key (32 байта, base64)
openssl rand -base64 32

# Генерация пароля для PostgreSQL (24 байта, base64)
openssl rand -base64 24
```

## Пример заполненного .env.agent

```bash
# Существующие переменные (не трогать)
SUPABASE_URL=...
SUPABASE_KEY=...
OPENAI_API_KEY=...

# Evolution API (ДОБАВИТЬ)
EVOLUTION_API_KEY=abc123xyz789example_key_here_32_bytes
EVOLUTION_DB_PASSWORD=db_password_here_24_bytes
EVOLUTION_SERVER_URL=https://app.performanteaiagency.com/evolution
EVOLUTION_API_URL=http://evolution-api:8080
```

## Проверка конфигурации

После добавления переменных:

1. Перезапустите Docker контейнеры:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

2. Проверьте, что Evolution API запустилась:
   ```bash
   docker logs evolution-api
   ```

3. Проверьте доступность через nginx:
   ```bash
   curl https://app.performanteaiagency.com/evolution/instance/fetchInstances \
     -H "apikey: YOUR_EVOLUTION_API_KEY"
   ```

## Troubleshooting

### Evolution API не запускается
- Проверьте логи: `docker logs evolution-api`
- Проверьте, что PostgreSQL запущен: `docker ps | grep evolution-postgres`
- Проверьте, что Redis запущен: `docker ps | grep evolution-redis`

### Webhook не работает
- Проверьте, что agent-service доступен из evolution-api:
  ```bash
  docker exec evolution-api curl http://agent-service:8082/health
  ```

### 502 Bad Gateway на /evolution/
- Проверьте, что Evolution API слушает на порту 8080:
  ```bash
  docker exec evolution-api netstat -tulpn | grep 8080
  ```
