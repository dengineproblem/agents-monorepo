-- Migration: Add ui_json column to ai_messages
-- Purpose: Support structured UI components (cards, tables, buttons, charts)

-- Add ui_json column for structured UI components
ALTER TABLE ai_messages
ADD COLUMN IF NOT EXISTS ui_json JSONB DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN ai_messages.ui_json IS
'Structured UI components for rich message rendering. Schema:
[
  {
    "type": "card" | "table" | "button" | "chart" | "copy_field",
    "data": { ... type-specific data ... }
  }
]

CardData: { title, subtitle?, metrics?: [{label, value, delta?, trend?}], actions?: [{label, action, params}] }
TableData: { headers: [], rows: [][], sortable?: boolean }
CopyFieldData: { label, value, icon?: "phone" | "id" | "link" }
ButtonData: { label, action, params, variant?: "primary" | "secondary" | "danger" }
ChartData: { type: "bar" | "line" | "pie", data: [], labels?: [] }
';

-- Create index for queries that filter by ui_json presence
CREATE INDEX IF NOT EXISTS idx_ai_messages_has_ui
ON ai_messages ((ui_json IS NOT NULL))
WHERE ui_json IS NOT NULL;
