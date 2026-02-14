-- Add SendPulse as an alternative sending channel for WABA numbers
-- send_via: 'cloud_api' (direct Meta Cloud API) or 'sendpulse' (via SendPulse BSP)

ALTER TABLE whatsapp_phone_numbers
  ADD COLUMN IF NOT EXISTS send_via VARCHAR(20) DEFAULT 'cloud_api',
  ADD COLUMN IF NOT EXISTS sendpulse_bot_id TEXT,
  ADD COLUMN IF NOT EXISTS sendpulse_client_id TEXT,
  ADD COLUMN IF NOT EXISTS sendpulse_client_secret TEXT;

COMMENT ON COLUMN whatsapp_phone_numbers.send_via IS 'Sending channel: cloud_api (direct Meta) or sendpulse (via SendPulse BSP)';
COMMENT ON COLUMN whatsapp_phone_numbers.sendpulse_bot_id IS 'SendPulse bot ID for sending messages';
COMMENT ON COLUMN whatsapp_phone_numbers.sendpulse_client_id IS 'SendPulse OAuth2 client_id';
COMMENT ON COLUMN whatsapp_phone_numbers.sendpulse_client_secret IS 'SendPulse OAuth2 client_secret';
