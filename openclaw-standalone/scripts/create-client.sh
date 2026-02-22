#!/bin/bash
set -euo pipefail

SLUG="${1:-}"
GW_PORT="${2:-18789}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug> [gateway_port]"
  echo "Example: $0 aliya 18790"
  echo ""
  echo "  slug          — client identifier (lowercase, a-z0-9_-)"
  echo "  gateway_port  — external port for gateway UI (default: 18789)"
  exit 1
fi

# Validate slug (strict: only lowercase a-z, digits, underscore, hyphen; max 30 chars)
if ! echo "$SLUG" | grep -qE '^[a-z0-9_-]{1,30}$'; then
  echo "$(ts) Error: slug must contain only lowercase letters, numbers, underscores, hyphens (max 30 chars)"
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

# Load .env if exists
ENV_FILE="${BASE_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
TOTAL_STEPS=6
[ -n "$SUPABASE_DB_URL" ] && TOTAL_STEPS=7

echo "$(ts) === Creating client: ${SLUG} ==="

# 1. Create database
echo "[1/${TOTAL_STEPS}] Creating database ${DB_NAME}..."
if docker exec openclaw-postgres psql -U postgres -lqt | grep -qw "$DB_NAME"; then
  echo "  Database ${DB_NAME} already exists, skipping"
else
  docker exec openclaw-postgres createdb -U postgres "$DB_NAME"
  echo "  Database ${DB_NAME} created"
fi

# 2. Apply schema
echo "[2/${TOTAL_STEPS}] Applying schema..."
docker exec -i openclaw-postgres psql -U postgres -d "$DB_NAME" < "$SCHEMA_FILE"
echo "  Schema applied (38 tables)"

# 3. SaaS pairing (if SUPABASE_DB_URL is set)
if [ -n "$SUPABASE_DB_URL" ]; then
  echo "[3/${TOTAL_STEPS}] Creating SaaS account (pairing)..."

  # Generate password for SaaS account
  SAAS_PASSWORD=$(openssl rand -hex 16)

  # Create user_account in SaaS (dollar-quoting for password safety)
  SAAS_ACCOUNT_ID=$(psql "$SUPABASE_DB_URL" -t -A -c "
    INSERT INTO user_accounts (username, password, is_openclaw, openclaw_slug, onboarding_stage, is_active, multi_account_enabled)
    VALUES ('openclaw_${SLUG}', \$q\$${SAAS_PASSWORD}\$q\$, true, '${SLUG}', 'registered', true, true)
    ON CONFLICT (username) DO UPDATE SET openclaw_slug = '${SLUG}', is_openclaw = true
    RETURNING id;
  " 2>/dev/null || echo "")

  if [ -z "$SAAS_ACCOUNT_ID" ]; then
    echo "  WARNING: Failed to create SaaS account. Skipping pairing."
    echo "  You can pair manually later via: UPDATE config SET saas_account_id = '...' WHERE id = 1;"
  else
    # Create ad_account in SaaS
    SAAS_AD_ACCOUNT_ID=$(psql "$SUPABASE_DB_URL" -t -A -c "
      INSERT INTO ad_accounts (user_account_id, name, is_default, is_active, tarif)
      VALUES ('${SAAS_ACCOUNT_ID}', 'OpenClaw ${SLUG}', true, true, 'ai_target')
      ON CONFLICT DO NOTHING
      RETURNING id;
    " 2>/dev/null || echo "")

    # Save pairing info in local config (dollar-quoting for DB URL safety)
    docker exec -i openclaw-postgres psql -U postgres -d "$DB_NAME" -c "
      UPDATE config SET
        saas_account_id = '${SAAS_ACCOUNT_ID}',
        saas_ad_account_id = '${SAAS_AD_ACCOUNT_ID}',
        saas_db_url = \$q\$${SUPABASE_DB_URL}\$q\$
      WHERE id = 1;
    "
    echo "  SaaS account: ${SAAS_ACCOUNT_ID}"
    echo "  SaaS ad_account: ${SAAS_AD_ACCOUNT_ID}"
  fi
fi

# 4. Create workspace directories
STEP_WS=$((3 + (TOTAL_STEPS > 6 ? 1 : 0)))
echo "[${STEP_WS}/${TOTAL_STEPS}] Creating workspace at ${CLIENT_DIR}..."
mkdir -p "${WORKSPACE_DIR}"

# Copy skills into workspace (symlinks don't work — only .openclaw is mounted into container)
if [ -d "${BASE_DIR}/skills" ]; then
  rm -rf "${WORKSPACE_DIR}/skills"
  cp -r "${BASE_DIR}/skills" "${WORKSPACE_DIR}/skills"
  echo "  Skills copied ($(ls "${WORKSPACE_DIR}/skills" | wc -l) skills)"
fi

# 5. Generate CLAUDE.md + openclaw.json (port inside container is always 18789)
STEP_GEN=$((STEP_WS + 1))
echo "[${STEP_GEN}/${TOTAL_STEPS}] Generating workspace files..."
sed "s/{{SLUG}}/${SLUG}/g" "$CLAUDE_TEMPLATE" > "${WORKSPACE_DIR}/CLAUDE.md"
sed "s/{{SLUG}}/${SLUG}/g" "$TOOLS_TEMPLATE" > "${WORKSPACE_DIR}/TOOLS.md"
cp "$CONFIG_TEMPLATE" "${OPENCLAW_DIR}/openclaw.json"

# Fix permissions — container runs as openclaw (UID 1001, node:22-slim has 'node' at 1000)
chown -R 1001:1001 "${OPENCLAW_DIR}"
echo "  CLAUDE.md + TOOLS.md + openclaw.json generated"

# 6. Start container
STEP_START=$((STEP_GEN + 1))
echo "[${STEP_START}/${TOTAL_STEPS}] Starting container ${CONTAINER_NAME}..."

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
echo "$(ts) === Client ${SLUG} created ==="
echo ""
echo "Database:    ${DB_NAME}"
echo "Container:   ${CONTAINER_NAME}"
echo "Gateway:     https://${SLUG}.openclaw.performanteaiagency.com"
echo "Auth token:  ${GW_TOKEN}"
echo "Workspace:   ${WORKSPACE_DIR}"
if [ -n "${SAAS_ACCOUNT_ID:-}" ]; then
  echo "SaaS ID:     ${SAAS_ACCOUNT_ID}"
fi
echo ""
echo "Next steps:"
echo "  1. Open gateway UI: https://${SLUG}.openclaw.performanteaiagency.com"
echo "  2. Enter auth token: ${GW_TOKEN}"
echo "  3. Configure Facebook tokens in DB:"
echo "     docker exec -i openclaw-postgres psql -U postgres -d ${DB_NAME} <<< \"UPDATE config SET fb_access_token='...', fb_ad_account_id='act_...', fb_page_id='...' WHERE id=1;\""
echo "  4. Check logs: docker logs -f ${CONTAINER_NAME}"
