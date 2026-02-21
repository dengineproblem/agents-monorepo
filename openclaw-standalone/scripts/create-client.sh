#!/bin/bash
set -euo pipefail

SLUG="${1:-}"
GW_PORT="${2:-18789}"

if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug> [gateway_port]"
  echo "Example: $0 aliya 18790"
  echo ""
  echo "  slug          — client identifier (lowercase, a-z0-9_-)"
  echo "  gateway_port  — external port for gateway UI (default: 18789)"
  exit 1
fi

# Validate slug
if ! echo "$SLUG" | grep -qE '^[a-z0-9_-]+$'; then
  echo "Error: slug must contain only lowercase letters, numbers, underscores, hyphens"
  exit 1
fi

# Generate auth token for gateway
GW_TOKEN=$(openssl rand -hex 16)

DB_NAME="openclaw_${SLUG}"
CONTAINER_NAME="openclaw-${SLUG}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="${BASE_DIR}/db/schema.sql"
CLAUDE_TEMPLATE="${BASE_DIR}/templates/CLAUDE.md.template"
TOOLS_TEMPLATE="${BASE_DIR}/templates/TOOLS.md.template"
CONFIG_TEMPLATE="${BASE_DIR}/templates/openclaw.json.template"
CLIENT_DIR="/home/openclaw/clients/${SLUG}"
OPENCLAW_DIR="${CLIENT_DIR}/.openclaw"
WORKSPACE_DIR="${OPENCLAW_DIR}/workspace"

echo "=== Creating client: ${SLUG} ==="

# 1. Create database
echo "[1/5] Creating database ${DB_NAME}..."
if docker exec openclaw-postgres psql -U postgres -lqt | grep -qw "$DB_NAME"; then
  echo "  Database ${DB_NAME} already exists, skipping"
else
  docker exec openclaw-postgres createdb -U postgres "$DB_NAME"
  echo "  Database ${DB_NAME} created"
fi

# 2. Apply schema
echo "[2/5] Applying schema..."
docker exec -i openclaw-postgres psql -U postgres -d "$DB_NAME" < "$SCHEMA_FILE"
echo "  Schema applied (11 tables)"

# 3. Create workspace directories
echo "[3/5] Creating workspace at ${CLIENT_DIR}..."
mkdir -p "${WORKSPACE_DIR}"

# Copy skills into workspace (symlinks don't work — only .openclaw is mounted into container)
if [ -d "${BASE_DIR}/skills" ]; then
  rm -rf "${WORKSPACE_DIR}/skills"
  cp -r "${BASE_DIR}/skills" "${WORKSPACE_DIR}/skills"
  echo "  Skills copied ($(ls "${WORKSPACE_DIR}/skills" | wc -l) skills)"
fi

# 4. Generate CLAUDE.md + openclaw.json (port inside container is always 18789)
echo "[4/5] Generating workspace files..."
sed "s/{{SLUG}}/${SLUG}/g" "$CLAUDE_TEMPLATE" > "${WORKSPACE_DIR}/CLAUDE.md"
sed "s/{{SLUG}}/${SLUG}/g" "$TOOLS_TEMPLATE" > "${WORKSPACE_DIR}/TOOLS.md"
cp "$CONFIG_TEMPLATE" "${OPENCLAW_DIR}/openclaw.json"

# Fix permissions — container runs as openclaw (UID 1001, node:22-slim has 'node' at 1000)
chown -R 1001:1001 "${OPENCLAW_DIR}"
echo "  CLAUDE.md + TOOLS.md + openclaw.json generated"

# 5. Start container
echo "[5/5] Starting container ${CONTAINER_NAME}..."

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -qw "$CONTAINER_NAME"; then
  echo "  Stopping existing container..."
  docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi

# OpenClaw gateway binds to 127.0.0.1:18789 (hardcoded).
# entrypoint.sh runs socat on 0.0.0.0:18790 to forward external connections.
# We map host GW_PORT → container 18790 (socat) → 127.0.0.1:18789 (gateway).
docker run -d \
  --name "$CONTAINER_NAME" \
  --network openclaw-net \
  --restart unless-stopped \
  -p "${GW_PORT}:18790" \
  -e "OPENCLAW_GATEWAY_TOKEN=${GW_TOKEN}" \
  -v "${OPENCLAW_DIR}:/home/openclaw/.openclaw" \
  openclaw-runtime

echo "  Container ${CONTAINER_NAME} started (port ${GW_PORT} → gateway)"

echo ""
echo "=== Client ${SLUG} created ==="
echo ""
echo "Database:    ${DB_NAME}"
echo "Container:   ${CONTAINER_NAME}"
echo "Gateway:     https://${SLUG}.openclaw.performanteaiagency.com"
echo "Auth token:  ${GW_TOKEN}"
echo "Workspace:   ${WORKSPACE_DIR}"
echo ""
echo "Next steps:"
echo "  1. Open gateway UI: https://${SLUG}.openclaw.performanteaiagency.com"
echo "  2. Enter auth token: ${GW_TOKEN}"
echo "  3. Configure Facebook tokens in DB:"
echo "     docker exec -i openclaw-postgres psql -U postgres -d ${DB_NAME} <<< \"UPDATE config SET fb_access_token='...', fb_ad_account_id='act_...', fb_page_id='...' WHERE id=1;\""
echo "  4. Check logs: docker logs -f ${CONTAINER_NAME}"
