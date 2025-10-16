#!/bin/bash
# Диагностика авто-launch-v2 на сервере
set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <user_account_id>" >&2
  exit 1
fi

URL="http://localhost:8082/api/campaign-builder/auto-launch-v2"
DATA="{\"user_account_id\":\"$1\"}"

echo "# Проверяем, что сервис отвечает"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8082/health

echo "# Проверяем доступные маршруты"
docker compose exec agent-service node -e "import('fastify').then(({default: fastify})=>{});" 2>/dev/null || true

echo "# Запуск auto-launch-v2"
curl -s -X POST "$URL" -H "Content-Type: application/json" -d "$DATA" | jq
