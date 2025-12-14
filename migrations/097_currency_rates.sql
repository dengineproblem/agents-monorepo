-- Migration: Currency rates table for dynamic USD→KZT conversion
-- Purpose: Store exchange rates updated daily via CRON

-- Create currency_rates table
CREATE TABLE IF NOT EXISTS currency_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(12, 4) NOT NULL,
  source VARCHAR(50) DEFAULT 'exchangerate-api',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

-- Add comment
COMMENT ON TABLE currency_rates IS 'Exchange rates for currency conversion, updated daily via CRON';
COMMENT ON COLUMN currency_rates.rate IS 'Exchange rate: 1 from_currency = rate * to_currency';
COMMENT ON COLUMN currency_rates.source IS 'API source of the rate';

-- Insert default USD→KZT rate (will be updated by CRON)
INSERT INTO currency_rates (from_currency, to_currency, rate, source)
VALUES ('USD', 'KZT', 530.0, 'default')
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- Create index for common lookups
CREATE INDEX IF NOT EXISTS idx_currency_rates_pair
ON currency_rates (from_currency, to_currency);

-- RLS policies (allow read for all authenticated users)
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;

-- Public read access (no authentication required for currency rates)
CREATE POLICY "Currency rates are readable by all"
ON currency_rates FOR SELECT
USING (true);

-- Only service role can update rates
CREATE POLICY "Only service role can update currency rates"
ON currency_rates FOR ALL
USING (auth.role() = 'service_role');
