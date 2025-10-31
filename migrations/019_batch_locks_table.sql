-- Migration: Create batch_locks table for leader lock mechanism
-- Purpose: Prevent multiple agent-brain instances from running daily batch simultaneously
-- Date: 2025-10-31

-- Create the table in public schema
CREATE TABLE IF NOT EXISTS public.batch_locks (
  lock_key TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for checking expired locks
CREATE INDEX IF NOT EXISTS idx_batch_locks_expires_at ON public.batch_locks(expires_at);

-- Add comments to table
COMMENT ON TABLE public.batch_locks IS 'Distributed lock mechanism to ensure only one agent-brain instance processes daily batch at a time';
COMMENT ON COLUMN public.batch_locks.lock_key IS 'Unique identifier for the lock (e.g., "daily_batch_lock")';
COMMENT ON COLUMN public.batch_locks.instance_id IS 'Identifier of the instance holding the lock (e.g., hostname)';
COMMENT ON COLUMN public.batch_locks.expires_at IS 'When the lock expires (typically 1 hour from acquisition)';

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_batch_locks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS trigger_update_batch_locks_updated_at ON public.batch_locks;
CREATE TRIGGER trigger_update_batch_locks_updated_at
  BEFORE UPDATE ON public.batch_locks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_batch_locks_updated_at();

-- Optional: Function to clean up expired locks automatically
CREATE OR REPLACE FUNCTION public.cleanup_expired_batch_locks()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.batch_locks
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Note: You can set up a cron job to call cleanup_expired_batch_locks() periodically,
-- or the application will handle it automatically when checking locks

