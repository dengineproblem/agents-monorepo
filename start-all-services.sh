#!/bin/bash

echo "🚀 Запуск всех сервисов для тестирования..."

# Останавливаем старые процессы
echo "🛑 Останавливаем старые процессы..."
lsof -ti:8080 | xargs kill -9 2>/dev/null
lsof -ti:7081 | xargs kill -9 2>/dev/null
sleep 1

# Запускаем Agent Service (с cron)
echo "📦 Запуск Agent Service (port 8080)..."
cd services/agent-service
npm start > /tmp/agent-service.log 2>&1 &
AGENT_PID=$!
echo "   Agent Service PID: $AGENT_PID"
cd ../..

# Запускаем Analyzer Service
echo "🧠 Запуск Analyzer Service (port 7081)..."
cd services/agent-brain
npm run start:analyzer > /tmp/analyzer-service.log 2>&1 &
ANALYZER_PID=$!
echo "   Analyzer Service PID: $ANALYZER_PID"
cd ../..

# Ждем запуска
echo "⏳ Ждем запуска сервисов..."
sleep 3

# Проверяем health
echo ""
echo "✅ Проверка здоровья сервисов:"
if curl -s http://localhost:8080/health | grep -q "ok"; then
  echo "   ✅ Agent Service (8080) работает"
else
  echo "   ❌ Agent Service (8080) не отвечает"
fi

if curl -s http://localhost:7081/health 2>/dev/null | grep -q "ok"; then
  echo "   ✅ Analyzer Service (7081) работает"
else
  echo "   ⚠️  Analyzer Service (7081) не отвечает (это нормально, если нет health endpoint)"
fi

echo ""
echo "📋 Логи:"
echo "   Agent Service:    tail -f /tmp/agent-service.log"
echo "   Analyzer Service: tail -f /tmp/analyzer-service.log"
echo ""
echo "🧪 Запуск теста:"
echo "   chmod +x test-creative-quick-test.sh && ./test-creative-quick-test.sh"
echo ""
echo "🛑 Остановка сервисов:"
echo "   kill $AGENT_PID $ANALYZER_PID"
echo ""
echo "✅ Готово!"

