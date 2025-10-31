#!/bin/bash

# Скрипт для тестирования работы Promtail с Docker логами
# Проверяет, что логи корректно собираются и отправляются в Loki

set -e

echo "🧪 Тестирование Promtail конфигурации..."
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для проверки доступности Loki
check_loki() {
    echo "📡 Проверка доступности Loki..."
    if curl -s http://localhost:3100/ready > /dev/null; then
        echo -e "${GREEN}✓ Loki доступен${NC}"
        return 0
    else
        echo -e "${RED}✗ Loki недоступен${NC}"
        return 1
    fi
}

# Функция для генерации тестового лога
generate_test_log() {
    local timestamp=$(date +%s)
    local test_endpoint="/test-promtail-${timestamp}"
    
    echo "📝 Генерация тестового лога..."
    echo "   Делаю HTTP запрос к agent-brain..."
    
    # Делаем HTTP запрос к несуществующему эндпоинту, чтобы создать реальный лог через Pino
    local response=$(curl -s "http://localhost:7080${test_endpoint}" 2>&1)
    
    echo "promtail_http_test"
}

# Функция для проверки наличия лога в Loki
check_log_in_loki() {
    local test_msg=$1
    local max_attempts=6
    local attempt=1
    
    echo ""
    echo "🔍 Поиск новых логов в Loki (может занять несколько секунд)..."
    
    while [ $attempt -le $max_attempts ]; do
        echo -n "   Попытка $attempt/$max_attempts... "
        
        # Используем range query для поиска логов за последние 30 секунд
        local start_time=$(python3 -c 'import time; print(int((time.time()-30)*1e9))')
        local end_time=$(python3 -c 'import time; print(int(time.time()*1e9))')
        local result=$(curl -s -G --data-urlencode 'query={container_name="agents-monorepo-agent-brain-1"}' \
            --data-urlencode "start=${start_time}" \
            --data-urlencode "end=${end_time}" \
            'http://localhost:3100/loki/api/v1/query_range' | jq -r '.data.result[0].values | length // 0')
        
        if [ "$result" != "0" ] && [ "$result" != "" ] && [ "$result" != "null" ]; then
            echo -e "${GREEN}✓ Найдено ${result} логов за последние 30 сек!${NC}"
            return 0
        fi
        
        echo "нет новых"
        sleep 3
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}✗ Новые логи не найдены в Loki после $max_attempts попыток${NC}"
    return 1
}

# Функция для проверки доступных лейблов
check_labels() {
    echo ""
    echo "🏷️  Проверка доступных лейблов в Loki..."
    
    local labels=$(curl -s 'http://localhost:3100/loki/api/v1/labels' | jq -r '.data[]' | sort)
    
    if [ -n "$labels" ]; then
        echo -e "${GREEN}Доступные лейблы:${NC}"
        echo "$labels" | sed 's/^/   - /'
        
        # Проверяем наличие ожидаемых лейблов
        local expected_labels=("level" "service" "msg" "userAccountName" "environment" "module")
        local missing_labels=()
        
        for label in "${expected_labels[@]}"; do
            if ! echo "$labels" | grep -q "^${label}$"; then
                missing_labels+=("$label")
            fi
        done
        
        if [ ${#missing_labels[@]} -eq 0 ]; then
            echo -e "${GREEN}✓ Все ожидаемые лейблы присутствуют${NC}"
        else
            echo -e "${YELLOW}⚠ Отсутствующие лейблы: ${missing_labels[*]}${NC}"
        fi
    else
        echo -e "${RED}✗ Не удалось получить лейблы${NC}"
        return 1
    fi
}

# Функция для вывода последних логов из Promtail
show_promtail_logs() {
    echo ""
    echo "📋 Последние логи Promtail (последние 20 строк):"
    docker-compose logs --tail=20 promtail
}

# Функция для вывода статистики
show_stats() {
    echo ""
    echo "📊 Статистика логов в Loki:"
    
    # Получаем количество логов по сервисам
    for service in "agent-brain" "agent-service"; do
        local count=$(curl -s "http://localhost:3100/loki/api/v1/query?query=count_over_time({service=\"${service}\"}[1h])" | jq -r '.data.result[0].value[1] // "0"')
        echo "   ${service}: ${count} логов за последний час"
    done
}

# Основной процесс тестирования
main() {
    echo "════════════════════════════════════════════════════════════"
    echo " Тестирование Promtail + Loki"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    
    # Проверка Loki
    if ! check_loki; then
        echo ""
        echo -e "${RED}Ошибка: Loki недоступен. Запустите docker-compose.${NC}"
        exit 1
    fi
    
    # Генерация тестового лога
    test_msg=$(generate_test_log)
    
    # Проверка наличия лога в Loki
    if check_log_in_loki "$test_msg"; then
        echo ""
        echo -e "${GREEN}✓ Тест пройден успешно!${NC}"
        
        # Показываем дополнительную информацию
        check_labels
        show_stats
        
        echo ""
        echo "════════════════════════════════════════════════════════════"
        echo -e "${GREEN} ✓ Promtail работает корректно${NC}"
        echo "════════════════════════════════════════════════════════════"
        
        return 0
    else
        echo ""
        echo -e "${RED}✗ Тест не пройден${NC}"
        echo ""
        echo "Рекомендуемые действия:"
        echo "1. Проверьте логи Promtail: docker-compose logs promtail"
        echo "2. Проверьте логи Loki: docker-compose logs loki"
        echo "3. Убедитесь, что контейнеры помечены лейблом logging=promtail"
        
        show_promtail_logs
        
        echo ""
        echo "════════════════════════════════════════════════════════════"
        echo -e "${RED} ✗ Promtail требует настройки${NC}"
        echo "════════════════════════════════════════════════════════════"
        
        return 1
    fi
}

# Запуск
main

