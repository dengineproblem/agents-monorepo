# WABA Chatbot Channel

## Purpose

This document describes how WABA is now supported as a first-class chatbot channel (similar to Evolution) for:

- AI bot auto replies
- manual operator replies from CRM chats
- chat history and search in CRM chats
- bot linking in bot editor

## Main Components

- `services/agent-service/src/routes/wabaWebhooks.ts`
- `services/chatbot-service/src/lib/evolutionApi.ts`
- `services/crm-backend/src/lib/evolutionApi.ts`
- `services/crm-backend/src/routes/aiBotConfigurations.ts`
- `services/crm-backend/src/routes/chats.ts`
- `services/crm-frontend/src/services/aiBotApi.ts`
- `services/crm-frontend/src/pages/BotEditor.tsx`
- `services/crm-frontend/src/pages/ChatsPage.tsx`

## End-to-End Flow

### 1) Incoming WABA message

1. Meta webhook hits `POST /webhooks/waba`.
2. Message is deduplicated by `message.id` in a short in-memory TTL window.
3. Agent resolves WhatsApp number by:
   - `waba_phone_id` first
   - then fallback by `phone_number`
4. Agent ensures a logical `whatsapp_instances` row exists for that WABA channel.
5. Agent updates/upserts `dialog_analysis`.
6. If bot is configured, agent calls chatbot `/process-message`.

Notes:

- Ad referral messages still run lead attribution and CAPI counters.
- Empty non-audio ad referral messages skip bot call (to avoid useless retries on invalid payloads).

### 2) Outgoing chatbot message

`sendWhatsAppMessage` now resolves delivery channel dynamically:

- `connection_type='waba'` -> send via Meta Cloud API
- otherwise -> send via Evolution API

If WABA metadata/token is missing, code falls back to Evolution path and logs warning.

### 3) CRM manual operator send

CRM backend uses the same channel resolution logic as chatbot-service:

- WABA instance -> send via Meta Cloud API
- Evolution instance -> send via Evolution API

For WABA channel, manual outgoing message is also appended to `dialog_analysis.messages` so history stays consistent.

### 4) CRM chats list/history/search

CRM chats route resolves channel type per `instanceName`:

- `evolution` -> read from Evolution DB (`Message` table), existing behavior
- `waba` -> read from `dialog_analysis.messages`

This enables viewing and searching WABA chats in the same CRM page.

## Bot Linking and Instances API

`GET /whatsapp-instances` now supports `includeWaba=true`:

- loads active WABA phone numbers
- syncs logical instance names (`instance_name`, fallback `waba_<waba_phone_id>`)
- upserts logical rows to `whatsapp_instances`
- returns `connectionType` in each instance record

Frontend pages that need WABA visibility call:

- `aiBotApi.getWhatsAppInstances(userId, { includeWaba: true })`

## Logging and Observability

### Key log markers

- Agent WABA inbound:
  - `WABA: Incoming message received`
  - `WABA: Duplicate webhook message skipped`
  - `WABA: Chatbot call succeeded`
  - `WABA: Chatbot call failed after retries`
- Delivery channel resolution:
  - `Delivery channel resolved to WABA`
  - `Delivery channel resolved to Evolution ...`
- CRM chats:
  - logs include `channelType` to show which backend path was used

### Correlation

WABA -> chatbot `/process-message` calls include `X-Correlation-ID`.

## Hardening Improvements Included

- Message dedup by WABA `message.id` (TTL cache).
- Non-retriable chatbot 4xx errors are no longer retried (except 408 and 429).
- Sensitive token data is sanitized in error payload logs.
- Empty non-audio ad lead messages skip bot call to avoid invalid request loops.
- Reduced unnecessary DB writes when syncing WABA phone status.

## Data and Config Requirements

### Database

Required fields in `whatsapp_phone_numbers`:

- `connection_type`
- `waba_phone_id`
- `instance_name`
- `connection_status`
- `is_active`

`whatsapp_instances` must contain `instance_name` and `ai_bot_id` for bot linking.

### Environment

Common variables used by this flow:

- `WABA_WEBHOOK_ENABLED`
- `WABA_VERIFY_TOKEN`
- `WABA_APP_SECRET`
- `CHATBOT_SERVICE_URL`
- `META_GRAPH_API_VERSION` (optional, defaults to `v21.0`)
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`

## Manual QA Checklist

1. Configure a WABA number with `connection_type='waba'` and valid `waba_phone_id`.
2. Open bot editor and verify WABA instance is visible and can be linked to bot.
3. Send inbound text from customer to WABA:
   - bot should reply
   - chat appears in CRM chats page
4. Send manual reply from CRM chats page:
   - message should be delivered via WABA
   - outgoing message should appear in chat history
5. Send duplicate webhook payload with same `message.id`:
   - should be skipped
6. Verify logs for channel resolution and correlation id propagation.

## Current Known Limitations

- WABA webhook dedup cache is in-memory (per process). For multi-instance deployments, external dedup store may be needed.
- WABA typing presence is skipped because Meta Cloud API does not support Evolution presence endpoint behavior.
- If WABA token source is missing/invalid, fallback goes to Evolution path and may still fail for pure-WABA channels (this is logged clearly).
