#!/bin/bash

# Скрипт для автоматической настройки .env файла creative-generation-service
# Копирует необходимые переменные из корневого .env или .env.agent

echo "🔧 Настройка переменных окружения для Creative Generation Service..."

# Путь к корневому каталогу проекта
ROOT_DIR="../../"
SERVICE_DIR="."

# Проверяем наличие корневого .env или .env.agent
if [ -f "$ROOT_DIR/.env" ]; then
    SOURCE_ENV="$ROOT_DIR/.env"
    echo "✓ Найден корневой .env"
elif [ -f "$ROOT_DIR/.env.agent" ]; then
    SOURCE_ENV="$ROOT_DIR/.env.agent"
    echo "✓ Найден .env.agent"
else
    echo "❌ Ошибка: Не найден ни .env, ни .env.agent в корневом каталоге"
    exit 1
fi

# Создаем .env файл для сервиса
TARGET_ENV="$SERVICE_DIR/.env"

echo "📝 Создание $TARGET_ENV..."

# Извлекаем необходимые переменные
OPENAI_KEY=$(grep "^OPENAI_API_KEY=" "$SOURCE_ENV" | cut -d'=' -f2-)
SUPABASE_URL=$(grep "^SUPABASE_URL=" "$SOURCE_ENV" | cut -d'=' -f2-)
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" "$SOURCE_ENV" | cut -d'=' -f2-)

# Если не нашли SUPABASE_SERVICE_ROLE_KEY, пробуем другие варианты
if [ -z "$SUPABASE_KEY" ]; then
    SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE=" "$SOURCE_ENV" | cut -d'=' -f2-)
fi

if [ -z "$SUPABASE_KEY" ]; then
    SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" "$SOURCE_ENV" | cut -d'=' -f2-)
fi

# Проверяем наличие необходимых переменных
if [ -z "$OPENAI_KEY" ]; then
    echo "⚠️  Предупреждение: OPENAI_API_KEY не найден в $SOURCE_ENV"
fi

if [ -z "$SUPABASE_URL" ]; then
    echo "⚠️  Предупреждение: SUPABASE_URL не найден в $SOURCE_ENV"
fi

if [ -z "$SUPABASE_KEY" ]; then
    echo "⚠️  Предупреждение: SUPABASE_SERVICE_KEY не найден в $SOURCE_ENV"
fi

# Создаем .env файл
cat > "$TARGET_ENV" << EOF
# OpenAI API Key
OPENAI_API_KEY=$OPENAI_KEY

# OpenAI Model
OPENAI_MODEL=gpt-4o-mini

# Supabase Configuration
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_KEY

# Server Configuration
PORT=8085
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# CORS Configuration
CORS_ORIGIN=*
EOF

echo "✅ Файл .env создан успешно!"
echo ""
echo "📋 Содержимое (без ключей):"
echo "   OPENAI_API_KEY: $([ -n "$OPENAI_KEY" ] && echo "установлен" || echo "НЕ УСТАНОВЛЕН")"
echo "   OPENAI_MODEL: gpt-4o-mini"
echo "   SUPABASE_URL: $([ -n "$SUPABASE_URL" ] && echo "установлен" || echo "НЕ УСТАНОВЛЕН")"
echo "   SUPABASE_SERVICE_KEY: $([ -n "$SUPABASE_KEY" ] && echo "установлен" || echo "НЕ УСТАНОВЛЕН")"
echo "   PORT: 8085"
echo ""
echo "🚀 Теперь можно запустить сервис:"
echo "   npm run dev"


