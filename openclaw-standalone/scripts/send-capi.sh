#!/bin/bash
# send-capi.sh — отправка CAPI события в Meta Graph API
# Использование: send-capi.sh <level> <phone>
#   level: 1 (LeadSubmitted), 2 (CompleteRegistration), 3 (Purchase)
#   phone: номер телефона (например 77001234567)
#
# Читает настройки из capi_settings, данные из wa_dialogs,
# отправляет событие через curl, логирует в capi_events_log.

set -euo pipefail

LEVEL="${1:-}"
PHONE="${2:-}"
DB_URL="${OPENCLAW_DB_URL:-}"

if [ -z "$LEVEL" ] || [ -z "$PHONE" ]; then
  echo "Usage: send-capi.sh <level> <phone>"
  echo "  level: 1, 2, 3"
  echo "  phone: 77001234567"
  exit 1
fi

if [ -z "$DB_URL" ]; then
  echo "Error: OPENCLAW_DB_URL not set"
  exit 1
fi

# --- Read CAPI settings ---

CAPI_ROW=$(psql "$DB_URL" -t -A -F'|' -c \
  "SELECT pixel_id, access_token, l1_event_name, l2_event_name, l3_event_name, l1_threshold
   FROM capi_settings WHERE is_active = true LIMIT 1;" 2>/dev/null)

if [ -z "$CAPI_ROW" ]; then
  echo "Error: No active capi_settings found. Run wa-capi-setup skill first."
  exit 1
fi

IFS='|' read -r PIXEL_ID ACCESS_TOKEN L1_EVENT L2_EVENT L3_EVENT L1_THRESHOLD <<< "$CAPI_ROW"

# --- Determine event name ---

case "$LEVEL" in
  1) EVENT_NAME="$L1_EVENT"; LEVEL_FLAG="l1" ;;
  2) EVENT_NAME="$L2_EVENT"; LEVEL_FLAG="l2" ;;
  3) EVENT_NAME="$L3_EVENT"; LEVEL_FLAG="l3" ;;
  *) echo "Error: level must be 1, 2, or 3"; exit 1 ;;
esac

# --- Check deduplication ---

ALREADY_SENT=$(psql "$DB_URL" -t -A -c \
  "SELECT ${LEVEL_FLAG}_sent FROM wa_dialogs WHERE phone = '$PHONE';" 2>/dev/null)

if [ "$ALREADY_SENT" = "t" ]; then
  echo "Skipped: L${LEVEL} already sent for $PHONE"
  exit 0
fi

# --- Read wa_dialogs for ctwa_clid ---

CTWA_CLID=$(psql "$DB_URL" -t -A -c \
  "SELECT COALESCE(ctwa_clid, '') FROM wa_dialogs WHERE phone = '$PHONE';" 2>/dev/null)

SOURCE_ID=$(psql "$DB_URL" -t -A -c \
  "SELECT COALESCE(source_id, '') FROM wa_dialogs WHERE phone = '$PHONE';" 2>/dev/null)

# --- Hash phone (SHA256) ---

HASHED_PHONE=$(echo -n "$PHONE" | sha256sum | cut -d' ' -f1)

# --- Generate event_id (UUID v4) ---

EVENT_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "evt-$(date +%s)-$$")

# --- Build CAPI payload ---

EVENT_TIME=$(date +%s)

# Determine action_source and messaging_channel
if [ -n "$CTWA_CLID" ]; then
  ACTION_SOURCE="messaging"
  MESSAGING_CHANNEL='"messaging_channel": "whatsapp",'
else
  ACTION_SOURCE="other"
  MESSAGING_CHANNEL=""
fi

PAYLOAD=$(cat <<EOJSON
{
  "data": [{
    "event_name": "$EVENT_NAME",
    "event_time": $EVENT_TIME,
    "event_id": "$EVENT_ID",
    "action_source": "$ACTION_SOURCE",
    $MESSAGING_CHANNEL
    "user_data": {
      "ph": ["$HASHED_PHONE"]
    },
    "custom_data": {
      "channel": "whatsapp_baileys",
      "level": $LEVEL
    }
  }]
}
EOJSON
)

# --- Send to Meta Graph API ---

echo "Sending L${LEVEL} ($EVENT_NAME) for $PHONE to pixel $PIXEL_ID..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# --- Determine status ---

if [ "$HTTP_CODE" = "200" ]; then
  STATUS="success"
  ERROR_TEXT=""
  echo "Success: L${LEVEL} event sent. Response: $BODY"
else
  STATUS="error"
  ERROR_TEXT="HTTP $HTTP_CODE: $BODY"
  echo "Error: HTTP $HTTP_CODE. Response: $BODY"
fi

# --- Log to capi_events_log ---

ESCAPED_BODY=$(echo "$BODY" | sed "s/'/''/g")
ESCAPED_ERROR=$(echo "$ERROR_TEXT" | sed "s/'/''/g")

psql "$DB_URL" -c "
  INSERT INTO capi_events_log (phone, event_name, event_level, ctwa_clid, source_id, pixel_id, event_id, fb_response, status, error_text)
  VALUES ('$PHONE', '$EVENT_NAME', $LEVEL, NULLIF('$CTWA_CLID',''), NULLIF('$SOURCE_ID',''), '$PIXEL_ID', '$EVENT_ID', '${ESCAPED_BODY}'::jsonb, '$STATUS', NULLIF('$ESCAPED_ERROR',''))
" 2>/dev/null || echo "Warning: Failed to log CAPI event"

# --- Update wa_dialogs flags ---

if [ "$STATUS" = "success" ]; then
  psql "$DB_URL" -c "
    UPDATE wa_dialogs SET
      ${LEVEL_FLAG}_sent = true,
      ${LEVEL_FLAG}_sent_at = NOW(),
      ${LEVEL_FLAG}_event_id = '$EVENT_ID',
      updated_at = NOW()
    WHERE phone = '$PHONE'
  " 2>/dev/null || echo "Warning: Failed to update wa_dialogs"
fi

exit 0
