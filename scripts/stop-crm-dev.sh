#!/bin/bash

# CRM Development Environment Shutdown Script
# Останавливает SSH туннель и все сервисы CRM

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

LOCAL_PORT="5434"
VITE_PORT="5174"

echo -e "${BLUE}🛑 Остановка CRM Development Environment...${NC}\n"

# 1. Остановка SSH туннеля
echo -e "${YELLOW}[1/3]${NC} Остановка SSH туннеля..."

if lsof -ti:$LOCAL_PORT > /dev/null 2>&1; then
    SSH_PID=$(lsof -ti:$LOCAL_PORT)
    echo -e "${YELLOW}→${NC} Найден SSH туннель (PID: $SSH_PID)"
    
    kill $SSH_PID 2>/dev/null || true
    sleep 1
    
    if lsof -ti:$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${RED}✗${NC} Не удалось остановить SSH туннель, пробуем force kill..."
        kill -9 $SSH_PID 2>/dev/null || true
        sleep 1
    fi
    
    if ! lsof -ti:$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} SSH туннель остановлен"
    else
        echo -e "${RED}✗${NC} Ошибка: SSH туннель всё ещё активен"
    fi
else
    echo -e "${BLUE}ℹ${NC} SSH туннель не запущен"
fi

# 2. Остановка Vite dev server
echo -e "\n${YELLOW}[2/3]${NC} Остановка Vite dev server..."

if lsof -ti:$VITE_PORT > /dev/null 2>&1; then
    VITE_PID=$(lsof -ti:$VITE_PORT)
    echo -e "${YELLOW}→${NC} Найден Vite процесс (PID: $VITE_PID)"
    
    kill $VITE_PID 2>/dev/null || true
    sleep 1
    
    if lsof -ti:$VITE_PORT > /dev/null 2>&1; then
        echo -e "${RED}✗${NC} Не удалось остановить Vite, пробуем force kill..."
        kill -9 $VITE_PID 2>/dev/null || true
        sleep 1
    fi
    
    if ! lsof -ti:$VITE_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Vite dev server остановлен"
    else
        echo -e "${RED}✗${NC} Ошибка: Vite всё ещё работает"
    fi
else
    echo -e "${BLUE}ℹ${NC} Vite dev server не запущен"
fi

# 3. Остановка Docker контейнеров (опционально)
echo -e "\n${YELLOW}[3/3]${NC} Остановка Docker контейнеров..."

cd "$(dirname "$0")/.."

read -p "Остановить Docker контейнеры (crm-backend, chatbot-service)? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}→${NC} Остановка контейнеров..."
    
    docker-compose stop crm-backend chatbot-service 2>/dev/null || true
    
    if ! docker ps | grep -q "agents-monorepo-crm-backend-1"; then
        echo -e "${GREEN}✓${NC} Docker контейнеры остановлены"
    else
        echo -e "${YELLOW}!${NC} Некоторые контейнеры всё ещё работают"
    fi
else
    echo -e "${BLUE}ℹ${NC} Docker контейнеры оставлены работающими"
fi

# Финальный статус
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ CRM Development Environment остановлен${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${BLUE}📝 Для повторного запуска:${NC}"
echo -e "  ${YELLOW}./scripts/start-crm-dev.sh${NC}\n"

exit 0

