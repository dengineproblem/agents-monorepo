-- Migration: Add correlation tracking to capi_events_log for cross-service tracing

-- Add correlation_id for tracing events across agent-service and chatbot-service
ALTER TABLE capi_events_log
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

-- Add timing metrics
ALTER TABLE capi_events_log
  ADD COLUMN IF NOT EXISTS request_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Add request payload for debugging (without access_token)
ALTER TABLE capi_events_log
  ADD COLUMN IF NOT EXISTS request_payload JSONB;

-- Index for fast correlation lookups
CREATE INDEX IF NOT EXISTS idx_capi_events_log_correlation_id
  ON capi_events_log(correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN capi_events_log.correlation_id IS
  'Unique ID for tracing CAPI events across agent-service and chatbot-service';

COMMENT ON COLUMN capi_events_log.request_started_at IS
  'Timestamp when the Facebook CAPI request was initiated';

COMMENT ON COLUMN capi_events_log.request_duration_ms IS
  'Duration of the Facebook CAPI request in milliseconds';

COMMENT ON COLUMN capi_events_log.retry_count IS
  'Number of retry attempts for the CAPI request';

COMMENT ON COLUMN capi_events_log.request_payload IS
  'Request payload sent to Facebook CAPI (without access_token for security)';
