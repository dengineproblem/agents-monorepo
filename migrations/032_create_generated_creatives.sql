-- Migration: Create generated_creatives table
-- Description: Stores AI-generated creatives (texts + image) before uploading to Facebook
-- This is separate from user_creatives which stores FB-published creatives

CREATE TABLE IF NOT EXISTS generated_creatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
    
    -- Generated texts
    offer TEXT NOT NULL,
    bullets TEXT NOT NULL,
    profits TEXT NOT NULL,
    cta TEXT NOT NULL,
    
    -- Generated image URL from Supabase Storage
    image_url TEXT NOT NULL,
    
    -- Metadata
    status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'uploaded_to_fb', 'archived')),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Indexes for common queries
    CONSTRAINT generated_creatives_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
    CONSTRAINT generated_creatives_direction_id_fkey FOREIGN KEY (direction_id) REFERENCES directions(id) ON DELETE SET NULL
);

-- Comments for documentation
COMMENT ON TABLE generated_creatives IS 
'AI-generated creatives (Gemini 3 Pro) - промежуточное хранение до загрузки на Facebook. После загрузки на FB креатив копируется в user_creatives с FB IDs.';

COMMENT ON COLUMN generated_creatives.id IS 'Unique identifier for the generated creative';
COMMENT ON COLUMN generated_creatives.user_id IS 'User who generated this creative';
COMMENT ON COLUMN generated_creatives.direction_id IS 'Optional: linked direction (campaign)';
COMMENT ON COLUMN generated_creatives.offer IS 'Generated headline/offer text';
COMMENT ON COLUMN generated_creatives.bullets IS 'Generated bullet points (3 bullets)';
COMMENT ON COLUMN generated_creatives.profits IS 'Generated benefit/profit text';
COMMENT ON COLUMN generated_creatives.cta IS 'Generated call-to-action button text';
COMMENT ON COLUMN generated_creatives.image_url IS 'Public URL of generated 1080x1920 image in Supabase Storage (bucket: public, path: creatives/{user_id}/{timestamp}.png)';
COMMENT ON COLUMN generated_creatives.status IS 'Status: generated (just created), uploaded_to_fb (published to FB), archived (deleted by user)';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_generated_creatives_user_id ON generated_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_creatives_direction_id ON generated_creatives(direction_id) WHERE direction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generated_creatives_created_at ON generated_creatives(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_creatives_status ON generated_creatives(status);
CREATE INDEX IF NOT EXISTS idx_generated_creatives_user_status ON generated_creatives(user_id, status);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_generated_creatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_generated_creatives_updated_at
    BEFORE UPDATE ON generated_creatives
    FOR EACH ROW
    EXECUTE FUNCTION update_generated_creatives_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE generated_creatives ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own generated creatives
CREATE POLICY "Users can view their own generated creatives"
    ON generated_creatives
    FOR SELECT
    USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own generated creatives
CREATE POLICY "Users can insert their own generated creatives"
    ON generated_creatives
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own generated creatives
CREATE POLICY "Users can update their own generated creatives"
    ON generated_creatives
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can delete their own generated creatives
CREATE POLICY "Users can delete their own generated creatives"
    ON generated_creatives
    FOR DELETE
    USING (auth.uid() = user_id);

