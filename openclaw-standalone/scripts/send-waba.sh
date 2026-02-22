#!/bin/bash
# send-waba.sh — отправка WABA сообщения через Meta Cloud API
# Использование: send-waba.sh <phone> <message>
# Читает waba_phone_id и waba_access_token из config таблицы (per-tenant DB).

set -euo pipefail

PHONE="${1:-}"
MESSAGE="${2:-}"
DB_URL="${OPENCLAW_DB_URL:-}"

log() {
  echo "[$(date -Iseconds)] [send-waba] $*"
}

if [ -z "$PHONE" ] || [ -z "$MESSAGE" ]; then
  echo "Usage: send-waba.sh <phone> <message>"
  echo "Example: send-waba.sh +77001234567 \"Привет! Это тест.\""
  exit 1
fi

if [ -z "$DB_URL" ]; then
  log "ERROR: OPENCLAW_DB_URL not set"
  exit 1
fi

# Sanitize PHONE for SQL — digits and + only, then escape quotes
SAFE_PHONE=$(echo "$PHONE" | tr -cd '0-9+' | sed "s/'/''/g")

log "Sending to ${PHONE}"

# Read WABA config
WABA_ROW=$(psql "$DB_URL" -t -A -F'|' -c \
  "SELECT waba_phone_id, waba_access_token FROM config WHERE id = 1 AND waba_enabled = true;" 2>/dev/null)

if [ -z "$WABA_ROW" ]; then
  log "ERROR: WABA not enabled or config missing"
  echo "Run wa-waba-setup skill to configure WABA"
  exit 1
fi

IFS='|' read -r WABA_PHONE_ID ACCESS_TOKEN <<< "$WABA_ROW"

if [ -z "$WABA_PHONE_ID" ] || [ -z "$ACCESS_TOKEN" ]; then
  log "ERROR: waba_phone_id or waba_access_token is empty"
  exit 1
fi

log "WABA config loaded: phone_id=${WABA_PHONE_ID}"

# Strip + prefix — WABA API expects digits only
TO_PHONE=$(echo "$PHONE" | sed 's/^+//')

# Escape message for JSON
MESSAGE_JSON=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))' <<< "$MESSAGE")

log "Message prepared: ${#MESSAGE} chars"

# Check 24h window
WINDOW_CHECK=$(psql "$DB_URL" -t -A -c \
  "SELECT CASE WHEN waba_window_expires_at > NOW() THEN 'open' ELSE 'closed' END
   FROM wa_dialogs WHERE phone = '${SAFE_PHONE}' LIMIT 1;" 2>/dev/null || echo "unknown")

log "Window status: ${WINDOW_CHECK}"

if [ "$WINDOW_CHECK" = "closed" ]; then
  log "ERROR: WABA 24h conversation window is closed for ${PHONE}"
  echo "Message Templates are required (not implemented yet)"
  exit 1
fi

# Send via Meta Cloud API
log "Sending via Meta Cloud API..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://graph.facebook.com/v23.0/${WABA_PHONE_ID}/messages" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"messaging_product\": \"whatsapp\",
    \"recipient_type\": \"individual\",
    \"to\": \"${TO_PHONE}\",
    \"type\": \"text\",
    \"text\": { \"body\": ${MESSAGE_JSON} }
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  MESSAGE_ID=$(echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("messages",[{}])[0].get("id",""))' 2>/dev/null || echo "")
  log "SUCCESS: Message sent (waba_message_id: ${MESSAGE_ID})"
  echo "Message sent to ${PHONE} (waba_message_id: ${MESSAGE_ID})"

  # Sanitize MESSAGE_ID for SQL (strip non-alphanumeric except dash/underscore)
  SAFE_MSG_ID=$(echo "$MESSAGE_ID" | tr -cd 'a-zA-Z0-9_-')

  # Log outbound message
  psql "$DB_URL" -q -c "
    INSERT INTO wa_messages (phone, direction, channel, message_text, message_type, waba_message_id)
    VALUES ('${SAFE_PHONE}', 'outbound', 'waba', ${MESSAGE_JSON}, 'text', '${SAFE_MSG_ID}');
    UPDATE wa_dialogs SET outgoing_count = outgoing_count + 1, updated_at = NOW()
    WHERE phone = '${SAFE_PHONE}';
  " 2>/dev/null || log "WARN: Failed to log message to DB"

  log "Message logged to wa_messages"
else
  log "ERROR: HTTP ${HTTP_CODE}. Response: ${BODY}"
  echo "Error: HTTP ${HTTP_CODE}"
  echo "$BODY"
  exit 1
fi
