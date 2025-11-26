#!/bin/bash

# CRM Development Environment Startup Script
# Запускает SSH туннель к production Evolution PostgreSQL и все необходимые сервисы

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PRODUCTION_SERVER="root@147.182.186.15"
LOCAL_PORT="5434"
REMOTE_PORT="5433"

echo -e "${BLUE}🚀 Запуск CRM Development Environment...${NC}\n"

# 1. Проверка существующего SSH туннеля
echo -e "${YELLOW}[1/5]${NC} Проверка SSH туннеля..."

if lsof -ti:$LOCAL_PORT > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} SSH туннель уже запущен на порту $LOCAL_PORT"
else
    echo -e "${YELLOW}→${NC} Запуск SSH туннеля к production БД..."
    
    # Проверка SSH доступа
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes $PRODUCTION_SERVER exit 2>/dev/null; then
        echo -e "${RED}✗${NC} Ошибка: Не удалось подключиться к $PRODUCTION_SERVER"
        echo -e "${YELLOW}Подсказка:${NC} Убедись что SSH ключи настроены и сервер доступен"
        exit 1
    fi
    
    # Запуск SSH туннеля в фоновом режиме
    ssh -L $LOCAL_PORT:localhost:$REMOTE_PORT $PRODUCTION_SERVER -N -f
    
    # Ждём установки туннеля
    sleep 2
    
    if lsof -ti:$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} SSH туннель успешно запущен (localhost:$LOCAL_PORT → production:$REMOTE_PORT)"
    else
        echo -e "${RED}✗${NC} Ошибка: SSH туннель не запустился"
        exit 1
    fi
fi

# 2. Запуск Docker контейнеров
echo -e "\n${YELLOW}[2/5]${NC} Запуск backend сервисов..."

cd "$(dirname "$0")/.."

# Проверка что .env.crm существует
if [ ! -f ".env.crm" ]; then
    echo -e "${RED}✗${NC} Ошибка: Файл .env.crm не найден"
    echo -e "${YELLOW}Подсказка:${NC} Создай .env.crm с настройками для production БД"
    exit 1
fi

# Запуск контейнеров
docker-compose up -d crm-backend chatbot-service evolution-postgres 2>/dev/null

# Ждём инициализации
echo -e "${YELLOW}→${NC} Ожидание инициализации контейнеров..."
sleep 5

# Проверка статуса контейнеров
if docker ps | grep -q "agents-monorepo-crm-backend-1"; then
    echo -e "${GREEN}✓${NC} crm-backend запущен"
else
    echo -e "${RED}✗${NC} Ошибка: crm-backend не запустился"
    echo -e "${YELLOW}Подсказка:${NC} Проверь логи: docker logs agents-monorepo-crm-backend-1"
    exit 1
fi

if docker ps | grep -q "agents-monorepo-chatbot-service-1"; then
    echo -e "${GREEN}✓${NC} chatbot-service запущен"
else
    echo -e "${YELLOW}!${NC} chatbot-service не запущен (опционально)"
fi

# 3. Проверка подключения к БД
echo -e "\n${YELLOW}[3/5]${NC} Проверка подключения к production БД..."

# Ждём подключения backend к БД
sleep 3

# Проверяем логи backend
if docker logs agents-monorepo-crm-backend-1 2>&1 | grep -q "Connected to Evolution PostgreSQL"; then
    echo -e "${GREEN}✓${NC} Подключение к production Evolution PostgreSQL установлено"
elif docker logs agents-monorepo-crm-backend-1 2>&1 | grep -q "Evolution PostgreSQL pool error"; then
    echo -e "${RED}✗${NC} Ошибка подключения к БД"
    echo -e "${YELLOW}Логи backend:${NC}"
    docker logs agents-monorepo-crm-backend-1 --tail 20
    exit 1
else
    echo -e "${YELLOW}!${NC} Статус подключения к БД неясен, проверь логи"
fi

# 4. Запуск Vite dev server
echo -e "\n${YELLOW}[4/5]${NC} Запуск Vite dev server..."

# Проверка что процесс Vite уже не запущен
if lsof -ti:5174 > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Vite dev server уже запущен на порту 5174"
else
    echo -e "${YELLOW}→${NC} Запуск Vite в фоновом режиме..."
    
    cd services/crm-frontend
    
    # Проверка node_modules
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}→${NC} Установка зависимостей..."
        npm install
    fi
    
    # Запуск в фоновом режиме с логированием
    nohup npm run dev > /tmp/crm-frontend-dev.log 2>&1 &
    VITE_PID=$!
    
    cd ../..
    
    # Ждём запуска Vite
    echo -e "${YELLOW}→${NC} Ожидание запуска Vite..."
    for i in {1..10}; do
        if lsof -ti:5174 > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Vite dev server запущен (PID: $VITE_PID)"
            break
        fi
        sleep 1
    done
    
    if ! lsof -ti:5174 > /dev/null 2>&1; then
        echo -e "${RED}✗${NC} Ошибка: Vite не запустился"
        echo -e "${YELLOW}Подсказка:${NC} Проверь логи: tail -f /tmp/crm-frontend-dev.log"
        exit 1
    fi
fi

# 5. Финальный статус
echo -e "\n${YELLOW}[5/5]${NC} Проверка статуса всех сервисов..."

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ CRM Development Environment готов!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${BLUE}📊 Статус сервисов:${NC}"
echo -e "  • SSH туннель:     ${GREEN}✓${NC} localhost:$LOCAL_PORT → production:$REMOTE_PORT"
echo -e "  • crm-backend:     ${GREEN}✓${NC} http://localhost:8084"
echo -e "  • chatbot-service: ${GREEN}✓${NC} http://localhost:8083"
echo -e "  • crm-frontend:    ${GREEN}✓${NC} http://localhost:5174"

echo -e "\n${BLUE}🌐 Открыть в браузере:${NC}"
echo -e "  ${GREEN}http://localhost:5174${NC}\n"

echo -e "${BLUE}📝 Полезные команды:${NC}"
echo -e "  Логи backend:   ${YELLOW}docker logs -f agents-monorepo-crm-backend-1${NC}"
echo -e "  Логи frontend:  ${YELLOW}tail -f /tmp/crm-frontend-dev.log${NC}"
echo -e "  Остановить всё: ${YELLOW}./scripts/stop-crm-dev.sh${NC}\n"

# Открываем браузер (опционально)
if command -v open > /dev/null 2>&1; then
    echo -e "${YELLOW}→${NC} Открываем браузер..."
    sleep 2
    open http://localhost:5174
fi

exit 0





