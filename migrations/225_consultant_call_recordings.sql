-- Таблица записей звонков консультантов
-- Хранит аудиозаписи созвонов с транскрипцией и AI-анализом

CREATE TABLE IF NOT EXISTS consultant_call_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID REFERENCES consultants(id) ON DELETE CASCADE NOT NULL,
    lead_id UUID REFERENCES dialog_analysis(id) ON DELETE SET NULL,

    -- Файл
    file_url TEXT,
    file_path TEXT,
    file_size_bytes INTEGER,
    duration_seconds INTEGER,
    file_deleted_at TIMESTAMPTZ,

    -- Транскрипция
    transcription TEXT,
    transcription_status VARCHAR(20) DEFAULT 'pending' NOT NULL,

    -- AI-анализ
    analysis JSONB,
    analysis_status VARCHAR(20) DEFAULT 'pending' NOT NULL,

    -- Метаданные
    title VARCHAR(255),
    notes TEXT,
    recording_mode VARCHAR(20) DEFAULT 'tab' NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_call_rec_consultant
ON consultant_call_recordings(consultant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_rec_lead
ON consultant_call_recordings(lead_id) WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_rec_cleanup
ON consultant_call_recordings(created_at) WHERE file_deleted_at IS NULL;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION update_call_recordings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_call_recordings_updated_at
    ON consultant_call_recordings;
CREATE TRIGGER trigger_update_call_recordings_updated_at
BEFORE UPDATE ON consultant_call_recordings
FOR EACH ROW EXECUTE FUNCTION update_call_recordings_updated_at();
