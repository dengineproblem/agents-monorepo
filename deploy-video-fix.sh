#!/bin/bash
# Скрипт для деплоя исправления загрузки видео >100 МБ

set -e  # Выходить при ошибках

echo "================================"
echo "ДЕПЛОЙ ИСПРАВЛЕНИЯ ЗАГРУЗКИ ВИДЕО"
echo "================================"
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для вывода с цветом
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверка, что мы на сервере или локально
if [ -f /etc/hostname ]; then
    HOSTNAME=$(cat /etc/hostname)
    info "Hostname: $HOSTNAME"
else
    info "Запуск на локальной машине"
fi

# Шаг 1: Проверка директории проекта
if [ ! -d "services/agent-service" ]; then
    error "Не найдена директория services/agent-service"
    error "Запусти скрипт из корня проекта agents-monorepo"
    exit 1
fi

info "Директория проекта найдена"

# Шаг 2: Создание /var/tmp/video-uploads (если на сервере)
if [ -d "/var/tmp" ]; then
    info "Создание директории для временных видео..."
    sudo mkdir -p /var/tmp || warn "Нет прав sudo, пропускаем mkdir"
    
    # Проверка UID контейнера (обычно 1000 для node)
    if command -v docker &> /dev/null; then
        info "Настройка прав для Docker..."
        sudo chown -R 1000:1000 /var/tmp 2>/dev/null || warn "Не удалось настроить права"
    fi
    
    info "Проверка /var/tmp:"
    df -h /var/tmp
    echo ""
else
    warn "/var/tmp не найден (локальная машина?)"
fi

# Шаг 3: Проверка swap (только на сервере)
if [ -f "/proc/swaps" ]; then
    info "Проверка SWAP..."
    if ! swapon --show &> /dev/null || [ -z "$(swapon --show)" ]; then
        warn "SWAP не настроен!"
        echo ""
        echo "Рекомендуется добавить swap:"
        echo "  sudo fallocate -l 4G /swapfile"
        echo "  sudo chmod 600 /swapfile"
        echo "  sudo mkswap /swapfile"
        echo "  sudo swapon /swapfile"
        echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
        echo ""
        read -p "Настроить swap автоматически? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            info "Создание swap 4GB..."
            sudo fallocate -l 4G /swapfile
            sudo chmod 600 /swapfile
            sudo mkswap /swapfile
            sudo swapon /swapfile
            echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
            info "Swap создан"
            free -h
        fi
    else
        info "SWAP уже настроен:"
        swapon --show
    fi
    echo ""
fi

# Шаг 4: Коммит изменений (если есть)
if [ -n "$(git status --porcelain services/agent-service/src/routes/video.ts)" ]; then
    info "Найдены несохранённые изменения в video.ts"
    read -p "Закоммитить изменения? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add services/agent-service/src/routes/video.ts
        git commit -m "fix: stream video uploads to disk instead of loading into RAM

- Changed to use streaming upload with pipeline() instead of toBuffer()
- Use /var/tmp instead of /tmp to avoid tmpfs memory issues
- Added logging for upload progress
- This fixes server crashes when uploading videos >100MB"
        info "Изменения закоммичены"
        
        read -p "Запушить в origin/main? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git push origin main
            info "Изменения запушены"
        fi
    fi
else
    info "Нет несохранённых изменений в video.ts"
fi

# Шаг 5: Деплой (если на сервере и есть docker)
if command -v docker &> /dev/null && [ -f "docker-compose.yml" ]; then
    info "Обнаружен Docker, начинаем деплой..."
    
    # Подтянуть изменения (если не на локальной машине)
    if [ -d ".git" ]; then
        info "Подтягивание изменений из git..."
        git pull origin main || warn "Не удалось подтянуть изменения"
    fi
    
    info "Пересборка agent-service..."
    docker-compose build agent-service
    
    info "Перезапуск agent-service..."
    docker-compose up -d agent-service
    
    info "Ожидание запуска (5 сек)..."
    sleep 5
    
    info "Проверка логов:"
    docker-compose logs --tail=50 agent-service
    
    echo ""
    info "✅ Деплой завершён!"
    echo ""
    info "Мониторинг логов: docker-compose logs -f agent-service"
    info "Проверка памяти: docker stats agent-service"
else
    warn "Docker не обнаружен или docker-compose.yml отсутствует"
    echo ""
    echo "Для деплоя на сервере:"
    echo "  1. git pull origin main"
    echo "  2. docker-compose build agent-service"
    echo "  3. docker-compose up -d agent-service"
fi

echo ""
info "Готово! Теперь можно тестировать загрузку 200 МБ видео."
echo ""
echo "Тест:"
echo "  curl -X POST https://agents.performanteaiagency.com/process-video \\"
echo "    -F 'file=@/path/to/big-video.mp4' \\"
echo "    -F 'user_id=YOUR-UUID' \\"
echo "    -F 'title=Test 200MB' \\"
echo "    -F 'language=ru'"
echo ""

