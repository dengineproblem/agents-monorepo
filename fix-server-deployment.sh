#!/bin/bash

echo "🔧 АВТОМАТИЧЕСКОЕ ИСПРАВЛЕНИЕ СЕРВЕРА"
echo "=================================="

# 1. ОСТАНОВКА ВСЕХ СЕРВИСОВ
echo "🛑 Останавливаем все сервисы..."
pkill -f "node.*server.js" 2>/dev/null
pkill -f "node.*analyzerService.js" 2>/dev/null
pkill -f "node.*dist/server.js" 2>/dev/null
sleep 3

# 2. ПРОВЕРКА ПОРТОВ
echo "🔍 Проверяем занятые порты..."
echo "Занятые порты:"
ss -tulpn | grep LISTEN | grep -E ":(8080|8081|8082|7080|7081)"

# 3. ПРОВЕРКА ENVIRONMENT
echo "📋 Проверяем environment variables..."
echo "Agent Service .env:"
if [ -f "services/agent-service/.env.agent" ]; then
    echo "✅ Файл существует"
    head -3 services/agent-service/.env.agent
else
    echo "❌ Файл не найден"
fi

echo "Agent Brain .env:"
if [ -f "services/agent-brain/.env.agent" ]; then
    echo "✅ Файл существует"
    head -3 services/agent-brain/.env.agent
else
    echo "❌ Файл не найден"
fi

# 4. ПРОВЕРКА NGINX
echo "🌐 Проверяем Nginx конфиг..."
if [ -f "/etc/nginx/sites-available/agents.performanteaiagency.com" ]; then
    echo "✅ Nginx конфиг существует"
    echo "Прокси на порт:"
    grep "proxy_pass" /etc/nginx/sites-available/agents.performanteaiagency.com
else
    echo "❌ Nginx конфиг не найден"
fi

# 5. ПРОВЕРКА СБОРКИ
echo "🔨 Проверяем сборку Agent Service..."
cd services/agent-service
if [ -d "dist" ]; then
    echo "✅ Директория dist существует"
    if [ -f "dist/actions/manifest.json" ]; then
        echo "✅ manifest.json существует"
    else
        echo "❌ manifest.json отсутствует - копируем..."
        cp src/actions/manifest.json dist/actions/ 2>/dev/null || echo "❌ Не удалось скопировать"
    fi
else
    echo "❌ Директория dist не найдена - собираем..."
    npm run build
fi

# 6. ИСПРАВЛЕНИЕ TIMEOUT В SUPABASE
echo "⏰ Исправляем timeout в Supabase..."
if [ -f "src/lib/supabase.ts" ]; then
    # Проверяем есть ли уже timeout
    if ! grep -q "AbortSignal.timeout" src/lib/supabase.ts; then
        echo "Добавляем timeout в Supabase..."
        sed -i 's/export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {/export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {\n  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(60000) }) },\n/' src/lib/supabase.ts
        echo "✅ Timeout добавлен"
    else
        echo "✅ Timeout уже настроен"
    fi
fi

# 7. ПРОВЕРКА CORS
echo "🌐 Проверяем CORS настройки..."
if grep -q "@fastify/cors" src/server.ts; then
    echo "✅ CORS плагин установлен"
else
    echo "❌ CORS плагин отсутствует"
fi

# 8. ПЕРЕСБОРКА
echo "🔨 Пересобираем Agent Service..."
npm run build

# 9. ЗАПУСК СЕРВИСОВ
echo "🚀 Запускаем сервисы..."

# Agent Service на порту 8082
echo "Запускаем Agent Service на порту 8082..."
nohup npm start > /var/log/agent-service.log 2>&1 &
AGENT_PID=$!

# Analyzer Service
echo "Запускаем Analyzer Service..."
cd ../agent-brain
nohup npm run start:analyzer > /var/log/analyzer-service.log 2>&1 &
ANALYZER_PID=$!

# 10. ПРОВЕРКА ЗАПУСКА
echo "⏳ Ждем запуска сервисов..."
sleep 5

echo "🔍 Проверяем статус сервисов..."
echo "Процессы:"
ps aux | grep -E "(node.*server|node.*analyzer)" | grep -v grep

echo "Health checks:"
echo "Agent Service:"
curl -s http://localhost:8082/health || echo "❌ Agent Service не отвечает"

echo "Analyzer Service:"
curl -s http://localhost:7081/health || echo "❌ Analyzer Service не отвечает"

echo "Домен:"
curl -s https://agents.performanteaiagency.com/health || echo "❌ Домен не отвечает"

# 11. ПРОВЕРКА ЛОГОВ
echo "📊 Последние логи Agent Service:"
tail -10 /var/log/agent-service.log

echo "📊 Последние логи Analyzer Service:"
tail -10 /var/log/analyzer-service.log

echo ""
echo "🎉 СКРИПТ ЗАВЕРШЕН!"
echo "Если есть ошибки - проверь логи выше"
echo "Для мониторинга логов: tail -f /var/log/agent-service.log"
