#!/bin/bash
set -euo pipefail

SLUG="${1:-}"
TG_BOT_TOKEN="${2:-}"

if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug> <telegram_bot_token>"
  echo "Example: $0 aliya 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
  exit 1
fi

if [ -z "$TG_BOT_TOKEN" ]; then
  echo "Error: telegram_bot_token is required (2nd argument)"
  echo "Create a bot via @BotFather in Telegram first"
  exit 1
fi

# Validate slug
if ! echo "$SLUG" | grep -qE '^[a-z0-9_-]+$'; then
  echo "Error: slug must contain only lowercase letters, numbers, underscores, hyphens"
  exit 1
fi

DB_NAME="openclaw_${SLUG}"
CONTAINER_NAME="openclaw-${SLUG}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="${BASE_DIR}/db/schema.sql"
CLAUDE_TEMPLATE="${BASE_DIR}/templates/CLAUDE.md.template"
CONFIG_TEMPLATE="${BASE_DIR}/templates/openclaw.json.template"
CLIENT_DIR="/home/openclaw/clients/${SLUG}"
OPENCLAW_DIR="${CLIENT_DIR}/.openclaw"
WORKSPACE_DIR="${OPENCLAW_DIR}/workspace"

# Generate random gateway auth token
GW_AUTH_TOKEN=$(head -c 24 /dev/urandom | xxd -p)
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "=== Creating client: ${SLUG} ==="

# 1. Create database
echo "[1/6] Creating database ${DB_NAME}..."
if docker exec openclaw-postgres psql -U postgres -lqt | grep -qw "$DB_NAME"; then
  echo "  Database ${DB_NAME} already exists, skipping"
else
  docker exec openclaw-postgres createdb -U postgres "$DB_NAME"
  echo "  Database ${DB_NAME} created"
fi

# 2. Apply schema
echo "[2/6] Applying schema..."
docker exec -i openclaw-postgres psql -U postgres -d "$DB_NAME" < "$SCHEMA_FILE"
echo "  Schema applied (11 tables)"

# 3. Create workspace directories
echo "[3/6] Creating workspace at ${CLIENT_DIR}..."
mkdir -p "${WORKSPACE_DIR}"

# Symlink skills into workspace
if [ -d "${BASE_DIR}/skills" ]; then
  rm -f "${WORKSPACE_DIR}/skills"
  ln -sf "${BASE_DIR}/skills" "${WORKSPACE_DIR}/skills"
  echo "  Skills symlinked"
fi

# 4. Generate CLAUDE.md
echo "[4/6] Generating CLAUDE.md..."
sed "s/{{SLUG}}/${SLUG}/g" "$CLAUDE_TEMPLATE" > "${WORKSPACE_DIR}/CLAUDE.md"
echo "  CLAUDE.md generated"

# 5. Generate openclaw.json
echo "[5/6] Generating openclaw.json..."
sed -e "s/{{TELEGRAM_BOT_TOKEN}}/${TG_BOT_TOKEN}/g" \
    -e "s/{{GATEWAY_AUTH_TOKEN}}/${GW_AUTH_TOKEN}/g" \
    -e "s/{{CREATED_AT}}/${CREATED_AT}/g" \
    "$CONFIG_TEMPLATE" > "${OPENCLAW_DIR}/openclaw.json"
echo "  openclaw.json generated"

# 6. Start container
echo "[6/6] Starting container ${CONTAINER_NAME}..."

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -qw "$CONTAINER_NAME"; then
  echo "  Stopping existing container..."
  docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi

# Check ANTHROPIC_API_KEY
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "  WARNING: ANTHROPIC_API_KEY not set in environment!"
  echo "  Set it before running: export ANTHROPIC_API_KEY=sk-ant-..."
  echo "  Container will start but gateway won't authenticate with Anthropic."
  echo ""
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --network openclaw-net \
  --restart unless-stopped \
  -e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}" \
  -v "${OPENCLAW_DIR}:/home/openclaw/.openclaw" \
  openclaw-runtime

echo "  Container ${CONTAINER_NAME} started"

echo ""
echo "=== Client ${SLUG} created ==="
echo ""
echo "Database:      ${DB_NAME}"
echo "Container:     ${CONTAINER_NAME}"
echo "Workspace:     ${WORKSPACE_DIR}"
echo "Webhook URL:   https://app.performanteaiagency.com/openclaw/webhook/${SLUG}"
echo "GW Auth Token: ${GW_AUTH_TOKEN}"
echo ""
echo "Next steps:"
echo "  1. Fill config:"
echo "     docker exec -i openclaw-postgres psql -U postgres -d ${DB_NAME} <<< \"UPDATE config SET fb_access_token='...', fb_ad_account_id='act_...', fb_page_id='...' WHERE id=1;\""
echo "  2. Set Facebook webhook URL: https://app.performanteaiagency.com/openclaw/webhook/${SLUG}"
echo "  3. Open Telegram bot and send /start to pair"
echo "  4. Check logs: docker logs -f ${CONTAINER_NAME}"
