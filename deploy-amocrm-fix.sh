#!/bin/bash
set -e

USER_ID="0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
SUBDOMAIN="performanteaiagency"

echo "🚀 Деплой исправления AmoCRM connect"
echo "======================================"
echo ""

echo "📦 1. Копирование обновленного файла на сервер..."
scp amocrm-connect.html root@app.performanteaiagency.com:/var/www/html/amocrm-connect.html
echo "✅ Файл скопирован"
echo ""

echo "🔍 2. Проверка миграции 030..."
ssh root@app.performanteaiagency.com << 'EOF'
cd ~/agents-monorepo

# Проверяем, применена ли миграция
RESULT=$(docker-compose exec -T postgres psql -U postgres -d postgres -tAc "
SELECT COUNT(*) 
FROM information_schema.columns 
WHERE table_name = 'user_accounts' 
  AND column_name IN ('amocrm_client_id', 'amocrm_client_secret');
")

if [ "$RESULT" = "2" ]; then
  echo "✅ Миграция 030 уже применена"
else
  echo "⚙️ Применяем миграцию 030..."
  docker-compose exec -T postgres psql -U postgres -d postgres < migrations/030_add_amocrm_client_credentials.sql
  echo "✅ Миграция 030 применена"
fi
EOF
echo ""

echo "🧹 3. Отключение старого подключения AmoCRM..."
curl -X DELETE "https://app.performanteaiagency.com/api/amocrm/disconnect?userAccountId=${USER_ID}"
echo ""
echo "✅ Старое подключение отключено"
echo ""

echo "======================================"
echo "✅ Деплой завершен!"
echo ""
echo "📋 Следующие шаги:"
echo ""
echo "1. Откройте в браузере:"
echo "   https://app.performanteaiagency.com/amocrm-connect.html?userAccountId=${USER_ID}&subdomain=${SUBDOMAIN}"
echo ""
echo "2. Нажмите кнопку 'Подключить amoCRM'"
echo ""
echo "3. После подключения проверьте:"
echo "   curl 'https://app.performanteaiagency.com/api/amocrm/status?userAccountId=${USER_ID}'"
echo ""
echo "4. Синхронизируйте воронки:"
echo "   curl -X POST 'https://app.performanteaiagency.com/api/amocrm/sync-pipelines?userAccountId=${USER_ID}'"
echo ""


