#!/bin/bash
# Скрипт для проверки Moltbot переменных окружения на production сервере
# Выполнять на сервере: bash setup-moltbot-env.sh
#
# ВАЖНО: API ключи НЕ хранятся в этом скрипте по соображениям безопасности!
# Добавляй их вручную в .env.brain на сервере

set -e

echo "🚀 Проверка Moltbot переменных окружения"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Проверка что мы в правильной директории
if [ ! -f ".env.brain" ]; then
    echo -e "${RED}❌ Ошибка: файл .env.brain не найден${NC}"
    echo "Убедитесь что вы находитесь в директории ~/agents-monorepo"
    exit 1
fi

echo -e "${GREEN}✓ Найден .env.brain${NC}"
echo ""

# Функция для проверки наличия переменной
check_env_var() {
    local var_name=$1
    if grep -q "^${var_name}=" .env.brain; then
        echo -e "${GREEN}✓ ${var_name} настроен${NC}"
        return 0
    else
        echo -e "${RED}✗ ${var_name} НЕ НАЙДЕН${NC}"
        return 1
    fi
}

# Функция для добавления переменной (только для non-secret значений)
add_env_var() {
    local var_name=$1
    local var_value=$2

    if grep -q "^${var_name}=" .env.brain; then
        echo -e "${YELLOW}  Переменная уже существует, пропускаем${NC}"
    else
        echo -e "${GREEN}  Добавление ${var_name}...${NC}"
        echo "${var_name}=${var_value}" >> .env.brain
    fi
}

echo "Проверка необходимых переменных:"
echo ""

MISSING_VARS=0

# 1. MOLTBOT_TELEGRAM_BOT_TOKEN
echo "1. MOLTBOT_TELEGRAM_BOT_TOKEN"
if ! check_env_var "MOLTBOT_TELEGRAM_BOT_TOKEN"; then
    echo -e "${YELLOW}  Добавь вручную:${NC}"
    echo "  echo 'MOLTBOT_TELEGRAM_BOT_TOKEN=<ваш_токен>' >> .env.brain"
    MISSING_VARS=$((MISSING_VARS + 1))
fi
echo ""

# 2. OPENAI_API_KEY
echo "2. OPENAI_API_KEY"
if ! check_env_var "OPENAI_API_KEY"; then
    echo -e "${YELLOW}  Добавь вручную:${NC}"
    echo "  echo 'OPENAI_API_KEY=<ваш_ключ>' >> .env.brain"
    MISSING_VARS=$((MISSING_VARS + 1))
fi
echo ""

# 3. ANTHROPIC_API_KEY
echo "3. ANTHROPIC_API_KEY"
if ! check_env_var "ANTHROPIC_API_KEY"; then
    echo -e "${YELLOW}  Добавь вручную:${NC}"
    echo "  echo 'ANTHROPIC_API_KEY=<ваш_ключ>' >> .env.brain"
    MISSING_VARS=$((MISSING_VARS + 1))
fi
echo ""

# 4. SUPERMEMORY_API_KEY
echo "4. SUPERMEMORY_API_KEY (для долгосрочной памяти агента)"
if ! check_env_var "SUPERMEMORY_API_KEY"; then
    echo -e "${YELLOW}  Добавь вручную:${NC}"
    echo "  echo 'SUPERMEMORY_API_KEY=<ваш_ключ>' >> .env.brain"
    MISSING_VARS=$((MISSING_VARS + 1))
fi
echo ""

# 5. AGENT_SERVICE_URL (не секретное - можно добавить автоматически)
echo "5. AGENT_SERVICE_URL"
if ! check_env_var "AGENT_SERVICE_URL"; then
    echo -e "${GREEN}  Добавление AGENT_SERVICE_URL...${NC}"
    add_env_var "AGENT_SERVICE_URL" "http://agent-service:8082"
fi
echo ""

# 6. MOLTBOT_TOKEN (не секретное - можно добавить автоматически)
echo "6. MOLTBOT_TOKEN (для аутентификации между сервисами)"
if ! check_env_var "MOLTBOT_TOKEN"; then
    echo -e "${GREEN}  Добавление MOLTBOT_TOKEN...${NC}"
    add_env_var "MOLTBOT_TOKEN" "moltbot-dev-token-2026"
fi
echo ""

echo "═════════════════════════════════════════════════"
echo ""

if [ $MISSING_VARS -eq 0 ]; then
    echo -e "${GREEN}✅ Все переменные настроены!${NC}"
else
    echo -e "${YELLOW}⚠️  Найдено недостающих переменных: ${MISSING_VARS}${NC}"
    echo ""
    echo "Добавь недостающие ключи вручную в .env.brain"
    echo ""
fi

echo ""
echo "Следующие шаги:"
echo ""
echo "1. Проверь содержимое .env.brain (без показа значений):"
echo "   cat .env.brain | grep -E 'MOLTBOT|OPENAI|ANTHROPIC|SUPERMEMORY' | sed 's/=.*/=***/' "
echo ""
echo "2. Перезапусти Docker контейнеры:"
echo "   docker-compose build moltbot"
echo "   docker-compose up -d moltbot"
echo ""
echo "3. Проверь логи:"
echo "   docker logs moltbot -f"
echo ""
