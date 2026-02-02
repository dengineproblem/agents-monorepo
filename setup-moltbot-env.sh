#!/bin/bash
# Скрипт для настройки Moltbot переменных окружения на production сервере
# Выполнять на сервере: bash setup-moltbot-env.sh

set -e

echo "🚀 Настройка Moltbot переменных окружения"
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
        echo -e "${GREEN}✓ ${var_name} уже настроен${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ ${var_name} не найден${NC}"
        return 1
    fi
}

# Функция для добавления переменной
add_env_var() {
    local var_name=$1
    local var_value=$2

    if grep -q "^${var_name}=" .env.brain; then
        echo -e "${YELLOW}  Обновление существующей переменной...${NC}"
        sed -i "s|^${var_name}=.*|${var_name}=${var_value}|" .env.brain
    else
        echo -e "${GREEN}  Добавление новой переменной...${NC}"
        echo "${var_name}=${var_value}" >> .env.brain
    fi
}

echo "Проверка необходимых переменных:"
echo ""

# 1. MOLTBOT_TELEGRAM_BOT_TOKEN
echo "1. MOLTBOT_TELEGRAM_BOT_TOKEN"
if ! check_env_var "MOLTBOT_TELEGRAM_BOT_TOKEN"; then
    echo -e "${GREEN}  Добавление MOLTBOT_TELEGRAM_BOT_TOKEN...${NC}"
    add_env_var "MOLTBOT_TELEGRAM_BOT_TOKEN" "8270141950:AAFFa__O01_aT8kyu3d43y05mcg785FF-lQ"
fi
echo ""

# 2. OPENAI_API_KEY
echo "2. OPENAI_API_KEY"
check_env_var "OPENAI_API_KEY"
echo ""

# 3. ANTHROPIC_API_KEY
echo "3. ANTHROPIC_API_KEY"
check_env_var "ANTHROPIC_API_KEY"
echo ""

# 4. SUPERMEMORY_API_KEY
echo "4. SUPERMEMORY_API_KEY (для долгосрочной памяти агента)"
if ! check_env_var "SUPERMEMORY_API_KEY"; then
    echo -e "${GREEN}  Добавление SUPERMEMORY_API_KEY...${NC}"
    add_env_var "SUPERMEMORY_API_KEY" "sm_7x9qjUcog6Bd5dBALQujXa_fdAfFQIogtNPbksejoqunoIpFgrpyPlXIQGtoFitTAKtOkkheJQdpjuDawswCWXk"
fi
echo ""

# 5. AGENT_SERVICE_URL
echo "5. AGENT_SERVICE_URL"
if ! check_env_var "AGENT_SERVICE_URL"; then
    echo -e "${GREEN}  Добавление AGENT_SERVICE_URL...${NC}"
    add_env_var "AGENT_SERVICE_URL" "http://agent-service:8082"
fi
echo ""

# 6. MOLTBOT_TOKEN (должен совпадать с docker-compose.yml)
echo "6. MOLTBOT_TOKEN (для аутентификации между сервисами)"
if ! check_env_var "MOLTBOT_TOKEN"; then
    echo -e "${GREEN}  Добавление MOLTBOT_TOKEN...${NC}"
    add_env_var "MOLTBOT_TOKEN" "moltbot-dev-token-2026"
fi
echo ""

echo "═════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}✓ Проверка завершена!${NC}"
echo ""
echo "Следующие шаги:"
echo ""
echo "1. Если есть недостающие переменные, добавь их вручную в .env.brain"
echo ""
echo "2. Проверь содержимое .env.brain:"
echo "   cat .env.brain | grep -E 'MOLTBOT|OPENAI_API_KEY|ANTHROPIC_API_KEY'"
echo ""
echo "3. Перезапусти Docker контейнеры:"
echo "   docker-compose build moltbot"
echo "   docker-compose up -d moltbot"
echo ""
echo "4. Проверь логи:"
echo "   docker logs moltbot -f"
echo ""
