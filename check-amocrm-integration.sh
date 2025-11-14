#!/bin/bash

# 🔍 Скрипт диагностики AmoCRM интеграции на production сервере
# Дата: 2025-11-12

echo "=========================================="
echo "🔍 ДИАГНОСТИКА AMOCRM ИНТЕГРАЦИИ"
echo "=========================================="
echo ""

echo "1️⃣ Проверка запущенных контейнеров..."
echo "------------------------------------------"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAMES|agent-service|frontend"
echo ""

echo "2️⃣ Проверка статуса agent-service (AmoCRM backend)..."
echo "------------------------------------------"
docker ps -a | grep agent-service
echo ""

echo "3️⃣ Последние 50 строк логов agent-service..."
echo "------------------------------------------"
docker logs agents-monorepo-agent-service-1 --tail 50
echo ""

echo "4️⃣ Фильтр логов: AmoCRM errors (последние 100 строк)..."
echo "------------------------------------------"
docker logs agents-monorepo-agent-service-1 --tail 100 | grep -i "amocrm\|oauth\|callback" || echo "Нет упоминаний AmoCRM в логах"
echo ""

echo "5️⃣ Проверка роутов AmoCRM в server.ts..."
echo "------------------------------------------"
docker exec agents-monorepo-agent-service-1 grep -A 2 "amocrm" /app/dist/server.js | head -20 || echo "Не удалось прочитать server.js"
echo ""

echo "6️⃣ Проверка доступности AmoCRM endpoints..."
echo "------------------------------------------"
echo "Тест: GET /amocrm/auth"
curl -I http://localhost:8082/amocrm/auth 2>&1 | head -5
echo ""
echo "Тест: GET /amocrm/callback"
curl -I http://localhost:8082/amocrm/callback 2>&1 | head -5
echo ""

echo "7️⃣ Проверка переменных окружения AmoCRM..."
echo "------------------------------------------"
docker exec agents-monorepo-agent-service-1 sh -c 'echo "AMOCRM_CLIENT_ID: ${AMOCRM_CLIENT_ID:0:10}..."'
docker exec agents-monorepo-agent-service-1 sh -c 'echo "AMOCRM_CLIENT_SECRET: ${AMOCRM_CLIENT_SECRET:0:10}..."'
docker exec agents-monorepo-agent-service-1 sh -c 'echo "AMOCRM_REDIRECT_URI: $AMOCRM_REDIRECT_URI"'
echo ""

echo "8️⃣ Проверка nginx конфигурации для AmoCRM..."
echo "------------------------------------------"
docker exec agents-monorepo-nginx-1 grep -A 5 "amocrm" /etc/nginx/nginx.conf || echo "Нет специальной конфигурации для AmoCRM в nginx"
echo ""

echo "9️⃣ Проверка через nginx (production URL)..."
echo "------------------------------------------"
echo "Тест: GET https://app.performanteaiagency.com/amocrm/auth"
curl -I https://app.performanteaiagency.com/amocrm/auth 2>&1 | head -5
echo ""

echo "🔟 Проверка ошибок в логах за последний час..."
echo "------------------------------------------"
docker logs agents-monorepo-agent-service-1 --since 1h | grep -i "error\|fail\|exception" | grep -i "amocrm" || echo "Нет ошибок AmoCRM за последний час"
echo ""

echo "=========================================="
echo "✅ ДИАГНОСТИКА ЗАВЕРШЕНА"
echo "=========================================="
echo ""
echo "📋 СЛЕДУЮЩИЕ ШАГИ:"
echo "1. Проверить вывод выше на наличие ошибок"
echo "2. Если контейнер не запущен - запустить: docker-compose up -d agent-service"
echo "3. Если роуты не найдены - проверить services/agent-service/src/server.ts"
echo "4. Если переменные окружения пустые - проверить .env.agent на сервере"
echo "5. Если 404 через nginx - проверить nginx-production.conf"
echo ""
