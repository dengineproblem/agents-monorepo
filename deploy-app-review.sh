#!/bin/bash
# Скрипт деплоя файлов для Facebook App Review

set -e  # Остановить при ошибке

echo "🚀 Начинаем деплой файлов для Facebook App Review..."
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Шаг 1: Обновить код из Git
echo "${YELLOW}📥 Шаг 1: Обновление кода из Git...${NC}"
git pull origin main
if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Код успешно обновлен${NC}"
else
    echo "${RED}❌ Ошибка при обновлении кода${NC}"
    exit 1
fi
echo ""

# Шаг 2: Проверить наличие необходимых переменных окружения
echo "${YELLOW}🔍 Шаг 2: Проверка переменных окружения...${NC}"
if [ ! -f .env.agent ]; then
    echo "${RED}❌ Файл .env.agent не найден!${NC}"
    echo "Создайте файл .env.agent и добавьте необходимые переменные"
    exit 1
fi

# Проверить наличие FB_APP_SECRET
if ! grep -q "FB_APP_SECRET" .env.agent; then
    echo "${YELLOW}⚠️  FB_APP_SECRET не найден в .env.agent${NC}"
    echo ""
    echo "Добавьте в .env.agent следующие строки:"
    echo ""
    echo "FB_APP_ID=690472653668355"
    echo "FB_APP_SECRET=ваш_app_secret_из_facebook"
    echo "FB_API_VERSION=v21.0"
    echo "PUBLIC_URL=https://performanteaiagency.com"
    echo ""
    read -p "Добавили переменные? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "${RED}❌ Отменено${NC}"
        exit 1
    fi
fi
echo "${GREEN}✅ Переменные окружения проверены${NC}"
echo ""

# Шаг 3: Остановить контейнеры
echo "${YELLOW}🛑 Шаг 3: Остановка контейнеров...${NC}"
docker-compose down
echo "${GREEN}✅ Контейнеры остановлены${NC}"
echo ""

# Шаг 4: Пересобрать контейнеры
echo "${YELLOW}🔨 Шаг 4: Пересборка контейнеров (это может занять несколько минут)...${NC}"
docker-compose build --no-cache frontend agent-service
if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Контейнеры пересобраны${NC}"
else
    echo "${RED}❌ Ошибка при сборке контейнеров${NC}"
    exit 1
fi
echo ""

# Шаг 5: Запустить контейнеры
echo "${YELLOW}🚀 Шаг 5: Запуск контейнеров...${NC}"
docker-compose up -d
if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Контейнеры запущены${NC}"
else
    echo "${RED}❌ Ошибка при запуске контейнеров${NC}"
    exit 1
fi
echo ""

# Шаг 6: Подождать немного для запуска
echo "${YELLOW}⏳ Ждем 10 секунд для полного запуска сервисов...${NC}"
sleep 10
echo ""

# Шаг 7: Проверить статус контейнеров
echo "${YELLOW}📊 Шаг 7: Проверка статуса контейнеров...${NC}"
docker-compose ps
echo ""

# Шаг 8: Проверить логи
echo "${YELLOW}📝 Шаг 8: Последние логи сервисов...${NC}"
echo ""
echo "--- Frontend logs ---"
docker-compose logs frontend --tail 20
echo ""
echo "--- Agent-service logs ---"
docker-compose logs agent-service --tail 20
echo ""

# Шаг 9: Проверить доступность endpoints
echo "${YELLOW}🔍 Шаг 9: Проверка доступности endpoints...${NC}"
echo ""

# Privacy Policy
echo -n "Privacy Policy (/privacy): "
if curl -s -o /dev/null -w "%{http_code}" http://localhost/privacy | grep -q "200"; then
    echo "${GREEN}✅ 200 OK${NC}"
else
    echo "${RED}❌ Недоступен${NC}"
fi

# Terms
echo -n "Terms of Service (/terms): "
if curl -s -o /dev/null -w "%{http_code}" http://localhost/terms | grep -q "200"; then
    echo "${GREEN}✅ 200 OK${NC}"
else
    echo "${RED}❌ Недоступен${NC}"
fi

# Data Deletion endpoint
echo -n "Data Deletion endpoint (/api/facebook/data-deletion): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8082/api/facebook/data-deletion \
    -H "Content-Type: application/json" \
    -d '{"signed_request":"test"}')
if [ "$HTTP_CODE" = "400" ]; then
    echo "${GREEN}✅ 400 (endpoint работает)${NC}"
else
    echo "${YELLOW}⚠️  HTTP $HTTP_CODE (ожидается 400)${NC}"
fi

echo ""
echo "${GREEN}🎉 Деплой завершен!${NC}"
echo ""
echo "📋 Следующие шаги:"
echo "1. Откройте в браузере: https://performanteaiagency.com/privacy"
echo "2. Откройте в браузере: https://performanteaiagency.com/terms"
echo "3. Проверьте Facebook Debugger: https://developers.facebook.com/tools/debug/"
echo "4. Настройте Facebook App: https://developers.facebook.com/apps/690472653668355/settings/basic/"
echo ""
echo "📚 Подробная инструкция: DEPLOY_APP_REVIEW_FILES.md"

