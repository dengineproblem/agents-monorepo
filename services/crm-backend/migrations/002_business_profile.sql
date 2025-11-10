-- Migration: Create business_profile table for storing client brief
-- Date: 2025-11-10
-- Description: Stores user's business brief for personalized AI analysis prompts

-- ===== 1. Create business_profile table =====

CREATE TABLE IF NOT EXISTS business_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID UNIQUE NOT NULL,
  
  -- Brief questions
  business_industry TEXT NOT NULL,        -- Industry (medicine, infobusiness, etc.)
  business_description TEXT NOT NULL,     -- Business description
  target_audience TEXT NOT NULL,          -- Target audience
  main_challenges TEXT NOT NULL,          -- Main challenges/problems
  funnel_stages JSONB,                    -- Custom funnel stages (optional)
  
  -- New fields for personalization
  funnel_stages_description TEXT,         -- User's funnel stages description
  stage_transition_criteria TEXT,         -- Criteria for moving between stages
  positive_signals TEXT,                  -- Positive signals of interest
  negative_signals TEXT,                  -- Typical objections
  
  -- AI-generated personalized context
  personalized_context JSONB,             -- AI-generated context for analysis prompt
  
  -- Metadata
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_profile_user ON business_profile(user_account_id);

-- Comments
COMMENT ON TABLE business_profile IS 'Stores user business brief for personalized AI analysis';
COMMENT ON COLUMN business_profile.business_industry IS 'User industry/niche (e.g., dentistry, cosmetology, infobusiness)';
COMMENT ON COLUMN business_profile.business_description IS 'Description of main products or services';
COMMENT ON COLUMN business_profile.target_audience IS 'Description of target audience';
COMMENT ON COLUMN business_profile.main_challenges IS 'Main business challenges/goals';
COMMENT ON COLUMN business_profile.funnel_stages IS 'Custom funnel stages if needed (JSON array)';
COMMENT ON COLUMN business_profile.funnel_stages_description IS 'User description of their funnel stages';
COMMENT ON COLUMN business_profile.stage_transition_criteria IS 'Criteria for moving leads between funnel stages';
COMMENT ON COLUMN business_profile.positive_signals IS 'Phrases/signals indicating client interest';
COMMENT ON COLUMN business_profile.negative_signals IS 'Typical client objections';
COMMENT ON COLUMN business_profile.personalized_context IS 'AI-generated personalized context for analysis prompt';

