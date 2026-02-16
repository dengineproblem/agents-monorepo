-- Bitrix24 stage IDs are strings (e.g. "C17:PREPAYMENT_INVOIC", "PREPARATION", "UC_2806GU")
-- but current_status_id was INTEGER, causing UPDATE failures for non-default pipelines.
-- This blocked CRM CAPI sync for all deals outside pipeline 0.

ALTER TABLE leads ALTER COLUMN current_status_id TYPE text USING current_status_id::text;
