-- Migration: Create dialog_analysis table for WhatsApp dialog analysis
-- This table stores analyzed WhatsApp dialogs with AI-generated insights

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS dialog_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Instance and user identification
  instance_name TEXT NOT NULL,
  user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  
  -- Contact metadata
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  incoming_count INT NOT NULL DEFAULT 0,
  outgoing_count INT NOT NULL DEFAULT 0,
  first_message TIMESTAMPTZ,
  last_message TIMESTAMPTZ,
  
  -- LLM Analysis Results
  business_type TEXT,
  is_owner BOOLEAN,
  uses_ads_now BOOLEAN,
  has_sales_dept BOOLEAN,
  has_booking BOOLEAN,
  sent_instagram BOOLEAN,
  
  -- Interest and Intent
  interest_level TEXT CHECK (interest_level IN ('hot', 'warm', 'cold')),
  main_intent TEXT CHECK (main_intent IN ('purchase', 'inquiry', 'support', 'consultation', 'other')),

  -- CRM Funnel
  funnel_stage TEXT CHECK (funnel_stage IN ('new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost')) DEFAULT 'new_lead',
  qualification_complete BOOLEAN DEFAULT FALSE,

  -- Key insights
  objection TEXT,
  next_message TEXT,
  action TEXT CHECK (action IN ('want_call', 'want_work', 'reserve', 'none')),

  -- Scoring
  score INT CHECK (score >= 0 AND score <= 100),
  reasoning TEXT,
  custom_fields JSONB,
  
  -- Dialog history
  messages JSONB,
  
  -- Timestamps
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one analysis per contact per instance
  UNIQUE(instance_name, contact_phone)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_instance ON dialog_analysis(instance_name);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_user_account ON dialog_analysis(user_account_id);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_interest ON dialog_analysis(interest_level);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_score ON dialog_analysis(score DESC);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_last_message ON dialog_analysis(last_message DESC);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_analyzed_at ON dialog_analysis(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_funnel_stage ON dialog_analysis(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_qualification ON dialog_analysis(qualification_complete);
CREATE INDEX IF NOT EXISTS idx_dialog_analysis_custom_fields ON dialog_analysis USING GIN (custom_fields);

-- Comments
COMMENT ON TABLE dialog_analysis IS 'WhatsApp dialog analysis results with AI-generated insights';
COMMENT ON COLUMN dialog_analysis.instance_name IS 'Evolution API instance name';
COMMENT ON COLUMN dialog_analysis.contact_phone IS 'Client phone number (format: +1234567890)';
COMMENT ON COLUMN dialog_analysis.interest_level IS 'Lead temperature: hot, warm, or cold';
COMMENT ON COLUMN dialog_analysis.next_message IS 'AI-generated personalized reactivation message';
COMMENT ON COLUMN dialog_analysis.messages IS 'Full conversation history in JSONB format';
COMMENT ON COLUMN dialog_analysis.score IS 'Lead quality score (0-100)';

-- Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_dialog_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_dialog_analysis_updated_at ON dialog_analysis;
CREATE TRIGGER trigger_dialog_analysis_updated_at
BEFORE UPDATE ON dialog_analysis
FOR EACH ROW
EXECUTE FUNCTION update_dialog_analysis_updated_at();
