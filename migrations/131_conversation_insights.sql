-- Migration 131: Conversation Insights with pgvector for semantic deduplication
-- Description: Store insights/objections/recommendations with embeddings for finding similar items
-- Date: 2025-12-28

-- ============================================
-- 1. Enable pgvector extension (if not enabled)
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 2. Create conversation_insights table
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,

  -- Category: insight, rejection_reason, objection, recommendation
  category TEXT NOT NULL CHECK (category IN ('insight', 'rejection_reason', 'objection', 'recommendation')),

  -- Content
  content TEXT NOT NULL,
  embedding vector(1536),  -- OpenAI text-embedding-3-small = 1536 dimensions

  -- Metadata for objections (suggested_response, etc.)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Statistics
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_report_id UUID REFERENCES conversation_reports(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. Create indexes
-- ============================================

-- Index for user filtering
CREATE INDEX IF NOT EXISTS idx_conversation_insights_user ON conversation_insights(user_account_id);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_conversation_insights_category ON conversation_insights(user_account_id, category);

-- Index for vector similarity search (IVFFlat)
-- Note: IVFFlat requires at least some data to build the index properly
-- For small datasets, use exact search; for large datasets (>1000), IVFFlat is faster
CREATE INDEX IF NOT EXISTS idx_conversation_insights_embedding ON conversation_insights
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- 4. Create function for finding similar insights
-- ============================================
CREATE OR REPLACE FUNCTION find_similar_insight(
  p_user_account_id UUID,
  p_category TEXT,
  p_embedding vector(1536),
  p_threshold FLOAT DEFAULT 0.85
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT,
  occurrence_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci.id,
    ci.content,
    (1 - (ci.embedding <=> p_embedding))::FLOAT as similarity,
    ci.occurrence_count
  FROM conversation_insights ci
  WHERE ci.user_account_id = p_user_account_id
    AND ci.category = p_category
    AND ci.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> p_embedding)) >= p_threshold
  ORDER BY similarity DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Comments
-- ============================================
COMMENT ON TABLE conversation_insights IS 'Stores unique insights/objections/recommendations with embeddings for semantic deduplication';
COMMENT ON COLUMN conversation_insights.category IS 'Type: insight, rejection_reason, objection, recommendation';
COMMENT ON COLUMN conversation_insights.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions)';
COMMENT ON COLUMN conversation_insights.metadata IS 'Additional data, e.g., suggested_response for objections';
COMMENT ON COLUMN conversation_insights.occurrence_count IS 'How many times this insight appeared in reports';
COMMENT ON FUNCTION find_similar_insight IS 'Find semantically similar insight using cosine similarity with pgvector';
