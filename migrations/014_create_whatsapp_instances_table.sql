-- Migration 014: Create whatsapp_instances table for Evolution API
-- This table tracks WhatsApp instances connected via Evolution API
-- Each instance represents a WhatsApp number connected to the system

CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Instance identification
  instance_name TEXT NOT NULL UNIQUE,
  instance_id TEXT UNIQUE,
  phone_number TEXT, -- WhatsApp number after successful connection

  -- Connection status
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),

  -- Authentication
  qr_code TEXT, -- Base64 encoded QR code for initial auth
  last_connected_at TIMESTAMPTZ,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_user_account ON whatsapp_instances(user_account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_phone ON whatsapp_instances(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_status ON whatsapp_instances(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_instance_name ON whatsapp_instances(instance_name);

-- Add comments
COMMENT ON TABLE whatsapp_instances IS 'Evolution API WhatsApp instances - tracks connected WhatsApp numbers';
COMMENT ON COLUMN whatsapp_instances.instance_name IS 'Unique instance identifier for Evolution API';
COMMENT ON COLUMN whatsapp_instances.phone_number IS 'WhatsApp phone number after connection (format: +1234567890)';
COMMENT ON COLUMN whatsapp_instances.status IS 'Connection status: disconnected, connecting, connected, error';
COMMENT ON COLUMN whatsapp_instances.qr_code IS 'Base64 QR code for WhatsApp authentication';

-- Create trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_whatsapp_instances_updated_at ON whatsapp_instances;
CREATE TRIGGER trigger_whatsapp_instances_updated_at
BEFORE UPDATE ON whatsapp_instances
FOR EACH ROW
EXECUTE FUNCTION update_whatsapp_instances_updated_at();
