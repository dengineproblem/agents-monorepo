-- Migration 015: Enhance messages_ai_target table with Evolution API support
-- Add fields for tracking source_id (Ad ID), creative attribution, and raw webhook data

-- Add new columns to messages_ai_target
ALTER TABLE messages_ai_target
ADD COLUMN IF NOT EXISTS instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS source_id VARCHAR(30), -- Facebook Ad ID from webhook metadata
ADD COLUMN IF NOT EXISTS creative_id UUID REFERENCES user_creatives(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS raw_data JSONB; -- Full Evolution API webhook payload

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_messages_source_id ON messages_ai_target(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_creative_id ON messages_ai_target(creative_id) WHERE creative_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_direction_id ON messages_ai_target(direction_id) WHERE direction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages_ai_target(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_instance_id ON messages_ai_target(instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages_ai_target(timestamp DESC);

-- Add GIN index for JSONB raw_data
CREATE INDEX IF NOT EXISTS idx_messages_raw_data_gin ON messages_ai_target USING gin(raw_data);

-- Add comments
COMMENT ON COLUMN messages_ai_target.instance_id IS 'References whatsapp_instances - which Evolution API instance received this message';
COMMENT ON COLUMN messages_ai_target.source_id IS 'Facebook Ad ID extracted from WhatsApp message metadata (contextInfo.stanzaId)';
COMMENT ON COLUMN messages_ai_target.creative_id IS 'References user_creatives - which creative this message is attributed to';
COMMENT ON COLUMN messages_ai_target.direction_id IS 'References account_directions - which marketing direction this message belongs to';
COMMENT ON COLUMN messages_ai_target.lead_id IS 'References leads - links message to lead record if created';
COMMENT ON COLUMN messages_ai_target.raw_data IS 'Full Evolution API webhook payload in JSONB format';
