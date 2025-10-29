#!/bin/bash
# ============================================
# СКРИПТ ПРОВЕРКИ ПОРТОВ НА PRODUCTION СЕРВЕРЕ
# Выполнить на сервере перед деплоем Evolution API
# ============================================

echo "================================================"
echo "ПРОВЕРКА ПОРТОВ ДЛЯ EVOLUTION API"
echo "================================================"
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. СУЩЕСТВУЮЩИЕ Docker контейнеры и их порты
echo "=== 1. СУЩЕСТВУЮЩИЕ Docker контейнеры ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker не запущен или недоступен"
echo ""

# 2. КРИТИЧЕСКАЯ ПРОВЕРКА: Новые порты Evolution API
echo "=== 2. ПРОВЕРКА НОВЫХ ПОРТОВ (должны быть СВОБОДНЫ) ==="
echo ""

# Порт 8080 - Evolution API
echo -n "Порт 8080 (Evolution API): "
if sudo lsof -i :8080 >/dev/null 2>&1; then
    echo -e "${RED}❌ ЗАНЯТ${NC}"
    echo "   Процесс:"
    sudo lsof -i :8080 | tail -n +2
    CONFLICT_8080=1
else
    echo -e "${GREEN}✅ СВОБОДЕН${NC}"
    CONFLICT_8080=0
fi
echo ""

# Порт 6380 - Evolution Redis
echo -n "Порт 6380 (Evolution Redis): "
if sudo lsof -i :6380 >/dev/null 2>&1; then
    echo -e "${RED}❌ ЗАНЯТ${NC}"
    echo "   Процесс:"
    sudo lsof -i :6380 | tail -n +2
    CONFLICT_6380=1
else
    echo -e "${GREEN}✅ СВОБОДЕН${NC}"
    CONFLICT_6380=0
fi
echo ""

# Порт 5433 - Evolution PostgreSQL
echo -n "Порт 5433 (Evolution PostgreSQL): "
if sudo lsof -i :5433 >/dev/null 2>&1; then
    echo -e "${RED}❌ ЗАНЯТ${NC}"
    echo "   Процесс:"
    sudo lsof -i :5433 | tail -n +2
    CONFLICT_5433=1
else
    echo -e "${GREEN}✅ СВОБОДЕН${NC}"
    CONFLICT_5433=0
fi
echo ""

# 3. СУЩЕСТВУЮЩИЕ ПОРТЫ из INFRASTRUCTURE.md
echo "=== 3. СУЩЕСТВУЮЩИЕ ПОРТЫ (из INFRASTRUCTURE.md) ==="
echo ""

declare -A EXISTING_PORTS=(
    [80]="nginx (HTTPS терминация)"
    [443]="nginx (HTTPS)"
    [3001]="frontend (production)"
    [3002]="frontend-appreview"
    [8082]="agent-service (backend API)"
    [7081]="creative-analyzer"
    [7080]="agent-brain"
    [3100]="loki (логирование)"
    [3000]="grafana (мониторинг)"
    [5678]="n8n (workflow automation)"
)

for port in "${!EXISTING_PORTS[@]}"; do
    echo -n "Порт $port (${EXISTING_PORTS[$port]}): "
    if sudo lsof -i :$port >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Работает${NC}"
    else
        echo -e "${YELLOW}⚠️  Не запущен${NC}"
    fi
done
echo ""

# 4. ПОЛНАЯ ТАБЛИЦА всех LISTEN портов
echo "=== 4. ВСЕ ЗАНЯТЫЕ ПОРТЫ НА СЕРВЕРЕ ==="
echo ""
sudo netstat -tulpn 2>/dev/null | grep LISTEN | awk '{print $4, $7}' | sed 's/.*://g' | sort -n | uniq || \
    ss -tulpn 2>/dev/null | grep LISTEN | awk '{print $5, $7}' | sed 's/.*://g' | sort -n | uniq
echo ""

# 5. Проверка Docker сетей
echo "=== 5. DOCKER СЕТИ ==="
echo ""
docker network ls 2>/dev/null | grep -E "agents-monorepo|root_default" || echo "Docker сети не найдены"
echo ""

# 6. Проверка n8n PostgreSQL (не должен конфликтовать с Evolution PostgreSQL)
echo "=== 6. N8N PostgreSQL ==="
echo -n "N8N PostgreSQL (внутренний порт 5432 в контейнере root-postgres-1): "
if docker exec root-postgres-1 psql -U n8n -d n8n -c "SELECT version();" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Работает${NC}"
    echo "   (Не конфликтует с Evolution PostgreSQL на порту 5433)"
else
    echo -e "${YELLOW}⚠️  Не работает или недоступен${NC}"
fi
echo ""

# ИТОГОВАЯ ОЦЕНКА
echo "================================================"
echo "ИТОГОВАЯ ОЦЕНКА"
echo "================================================"
echo ""

TOTAL_CONFLICTS=$((CONFLICT_8080 + CONFLICT_6380 + CONFLICT_5433))

if [ $TOTAL_CONFLICTS -eq 0 ]; then
    echo -e "${GREEN}✅ ВСЕ ПОРТЫ СВОБОДНЫ - МОЖНО ДЕПЛОИТЬ!${NC}"
    echo ""
    echo "Следующие шаги:"
    echo "1. Выполни миграции в Supabase (см. MIGRATION_INSTRUCTIONS.md)"
    echo "2. Добавь переменные окружения в .env.agent (см. EVOLUTION_API_ENV_SETUP.md)"
    echo "3. Запусти: docker-compose down && docker-compose up -d --build"
    exit 0
else
    echo -e "${RED}❌ ОБНАРУЖЕНЫ КОНФЛИКТЫ ПОРТОВ!${NC}"
    echo ""
    echo "Конфликтующие порты: $TOTAL_CONFLICTS"
    echo ""
    echo "РЕШЕНИЕ:"
    echo "1. Остановите процессы на занятых портах"
    echo "2. ИЛИ измените порты в docker-compose.yml"
    echo ""
    echo "Пример изменения портов в docker-compose.yml:"
    if [ $CONFLICT_8080 -eq 1 ]; then
        echo "  evolution-api:"
        echo "    ports:"
        echo "      - \"8081:8080\"  # Измените 8080 на 8081"
    fi
    if [ $CONFLICT_6380 -eq 1 ]; then
        echo "  evolution-redis:"
        echo "    ports:"
        echo "      - \"6381:6379\"  # Измените 6380 на 6381"
    fi
    if [ $CONFLICT_5433 -eq 1 ]; then
        echo "  evolution-postgres:"
        echo "    ports:"
        echo "      - \"5434:5432\"  # Измените 5433 на 5434"
    fi
    exit 1
fi
