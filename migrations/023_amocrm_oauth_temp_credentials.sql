-- Migration 023: AmoCRM OAuth Temporary Credentials Storage
-- For auto-created integrations via AmoCRM button
-- 
-- When using AmoCRM button with auto-creation:
-- 1. AmoCRM sends POST to /api/amocrm/secrets with client_id, client_secret, state
-- 2. We store them temporarily here
-- 3. User authorizes and AmoCRM redirects to /api/amocrm/callback with code and state
-- 4. We retrieve credentials using state, exchange code for tokens
-- 5. We delete temporary credentials

-- Table for temporary OAuth credentials (expires in 10 minutes)
CREATE TABLE IF NOT EXISTS amocrm_oauth_temp_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
    integration_name TEXT,
    scopes TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast state lookup
CREATE INDEX IF NOT EXISTS idx_amocrm_oauth_temp_state ON amocrm_oauth_temp_credentials(state);

-- Index for cleanup of expired credentials
CREATE INDEX IF NOT EXISTS idx_amocrm_oauth_temp_expires ON amocrm_oauth_temp_credentials(expires_at);

-- Function to cleanup expired credentials (run via cron or trigger)
CREATE OR REPLACE FUNCTION cleanup_expired_amocrm_oauth_credentials()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM amocrm_oauth_temp_credentials
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comment on table
COMMENT ON TABLE amocrm_oauth_temp_credentials IS 'Temporary storage for AmoCRM OAuth credentials during auto-creation flow. Credentials expire in 10 minutes.';
COMMENT ON COLUMN amocrm_oauth_temp_credentials.state IS 'OAuth state parameter used to link secrets webhook with OAuth callback';
COMMENT ON COLUMN amocrm_oauth_temp_credentials.client_id IS 'AmoCRM integration client_id (sent by AmoCRM during auto-creation)';
COMMENT ON COLUMN amocrm_oauth_temp_credentials.client_secret IS 'AmoCRM integration client_secret (sent by AmoCRM during auto-creation)';
COMMENT ON COLUMN amocrm_oauth_temp_credentials.user_account_id IS 'Optional: user account ID if state contains it';
COMMENT ON COLUMN amocrm_oauth_temp_credentials.expires_at IS 'Expiration time (10 minutes from creation)';



