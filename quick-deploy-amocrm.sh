#!/bin/bash
# Быстрый деплой исправленного файла amocrm-connect.html

set -e

echo "📦 Копирование amocrm-connect.html на сервер..."
scp amocrm-connect.html root@app.performanteaiagency.com:/var/www/html/amocrm-connect.html

echo ""
echo "✅ Файл скопирован!"
echo ""
echo "📋 Следующие шаги вручную на сервере:"
echo ""
echo "1. Проверить миграцию 030:"
echo "   ssh root@app.performanteaiagency.com"
echo "   cd ~/agents-monorepo"
echo "   docker-compose exec postgres psql -U postgres -d postgres -c \"SELECT column_name FROM information_schema.columns WHERE table_name = 'user_accounts' AND column_name IN ('amocrm_client_id', 'amocrm_client_secret');\""
echo ""
echo "2. Если миграция не применена:"
echo "   docker-compose exec -T postgres psql -U postgres -d postgres < migrations/030_add_amocrm_client_credentials.sql"
echo ""
echo "3. Отключить старое подключение:"
echo "   curl -X DELETE 'https://app.performanteaiagency.com/api/amocrm/disconnect?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b'"
echo ""
echo "4. Открыть в браузере:"
echo "   https://app.performanteaiagency.com/amocrm-connect.html?userAccountId=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b&subdomain=performanteaiagency"
echo ""
echo "📖 Полная инструкция: AMOCRM_RECONNECT_STEPS.md"






