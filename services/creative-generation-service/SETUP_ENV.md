# Настройка переменных окружения для Creative Generation Service

## Автоматическая настройка

Запустите скрипт для автоматического копирования переменных из корневого .env:

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/creative-generation-service
./setup-env.sh
```

## Ручная настройка

Если скрипт не работает, создайте файл `.env` вручную:

```bash
cd /Users/anatolijstepanov/agents-monorepo/services/creative-generation-service
touch .env
```

Затем добавьте следующие переменные:

```bash
# OpenAI API Key (из корневого .env или .env.agent)
OPENAI_API_KEY=ваш-ключ-openai

# OpenAI Model
OPENAI_MODEL=gpt-4o-mini

# Supabase Configuration (из корневого .env или .env.agent)
SUPABASE_URL=ваш-supabase-url
SUPABASE_SERVICE_KEY=ваш-supabase-service-role-key

# Server Configuration
PORT=8085
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=*
```

## Проверка настроек

После настройки переменных окружения:

1. Убедитесь, что OPENAI_API_KEY установлен:
```bash
grep OPENAI_API_KEY .env
```

2. Убедитесь, что SUPABASE_URL и SUPABASE_SERVICE_KEY установлены:
```bash
grep SUPABASE .env
```

3. Запустите сервис:
```bash
npm run dev
```

4. Проверьте healthcheck:
```bash
curl http://localhost:8085/health
```

## Источники переменных

- `OPENAI_API_KEY` - используется из корневых `.env`, `.env.agent` или `.env.brain`
- `SUPABASE_URL` и `SUPABASE_SERVICE_KEY` - используются из корневого `.env` или `.env.agent`
- Поддерживаются альтернативные имена: `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`

## Troubleshooting

### Ошибка "User not found"

Проблема: Supabase не может найти пользователя.

Решение:
1. Проверьте правильность `SUPABASE_URL` и `SUPABASE_SERVICE_KEY`
2. Убедитесь, что используется Service Role Key (не anon key)
3. Проверьте, что пользователь существует в таблице `user_accounts`

### Ошибка "OPENAI_API_KEY is required"

Проблема: Не установлен OpenAI API ключ.

Решение:
1. Скопируйте ключ из корневого `.env` файла
2. Или получите новый на https://platform.openai.com/api-keys
3. Добавьте в `.env` файл сервиса


