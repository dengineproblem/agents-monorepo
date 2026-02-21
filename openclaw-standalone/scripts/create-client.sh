#!/bin/bash
set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug>"
  echo "Example: $0 aliya"
  exit 1
fi

# Validate slug: only lowercase letters, numbers, underscores, hyphens
if ! echo "$SLUG" | grep -qE '^[a-z0-9_-]+$'; then
  echo "Error: slug must contain only lowercase letters, numbers, underscores, hyphens"
  exit 1
fi

DB_NAME="openclaw_${SLUG}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="${BASE_DIR}/db/schema.sql"
TEMPLATE_FILE="${BASE_DIR}/templates/CLAUDE.md.template"
CLIENTS_DIR="/home/openclaw/clients/${SLUG}"

echo "=== Creating client: ${SLUG} ==="

# 1. Create database
echo "[1/4] Creating database ${DB_NAME}..."
if docker exec openclaw-postgres psql -U postgres -lqt | grep -qw "$DB_NAME"; then
  echo "  Database ${DB_NAME} already exists, skipping"
else
  docker exec openclaw-postgres createdb -U postgres "$DB_NAME"
  echo "  Database ${DB_NAME} created"
fi

# 2. Apply schema
echo "[2/4] Applying schema..."
docker exec -i openclaw-postgres psql -U postgres -d "$DB_NAME" < "$SCHEMA_FILE"
echo "  Schema applied (11 tables)"

# 3. Create workspace
echo "[3/4] Creating workspace at ${CLIENTS_DIR}..."
mkdir -p "${CLIENTS_DIR}"

# Symlink skills
if [ -d "${BASE_DIR}/skills" ]; then
  rm -f "${CLIENTS_DIR}/skills"
  ln -sf "${BASE_DIR}/skills" "${CLIENTS_DIR}/skills"
  echo "  Skills symlinked"
fi

# 4. Generate CLAUDE.md from template
echo "[4/4] Generating CLAUDE.md..."
if [ -f "$TEMPLATE_FILE" ]; then
  sed "s/{{SLUG}}/${SLUG}/g" "$TEMPLATE_FILE" > "${CLIENTS_DIR}/CLAUDE.md"
  echo "  CLAUDE.md generated"
else
  echo "  Warning: template not found at ${TEMPLATE_FILE}"
fi

echo ""
echo "=== Client ${SLUG} created ==="
echo ""
echo "Database:    ${DB_NAME}"
echo "Workspace:   ${CLIENTS_DIR}"
echo "Webhook URL: https://app.performanteaiagency.com/openclaw/webhook/${SLUG}"
echo "DB command:  docker exec -i openclaw-postgres psql -U postgres -d ${DB_NAME}"
echo ""
echo "Next steps:"
echo "  1. Fill config: echo \"UPDATE config SET fb_access_token='...', fb_ad_account_id='act_...', fb_page_id='...' WHERE id=1\" | docker exec -i openclaw-postgres psql -U postgres -d ${DB_NAME}"
echo "  2. Set up Facebook webhook URL in App Dashboard"
echo "  3. Point OpenClaw instance workspace to ${CLIENTS_DIR}"
