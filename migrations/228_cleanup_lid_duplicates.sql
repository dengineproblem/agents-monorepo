-- Migration: 228_cleanup_lid_duplicates.sql
-- Description: Delete duplicate leads and dialog_analysis records created from @lid (Facebook Lead ID)
-- when remoteJidAlt was empty. These are duplicates — real phone leads already exist.
-- Affects only user cleanclinic (327f101b-0f82-4d9c-8b28-3fde3a749e8f)
-- Date: 2026-02-27

BEGIN;

-- Delete 13 leads with Facebook Lead ID as chat_id (not real phone numbers)
DELETE FROM public.leads
WHERE id IN (13099, 13081, 13077, 13050, 13044, 13038, 13031, 13021, 12983, 12969, 12965, 12925, 12903);

-- Delete 13 matching dialog_analysis records
DELETE FROM public.dialog_analysis
WHERE id IN (
  'e0c84014-8f46-4015-baf3-e56db2e00cb9',
  '213a17aa-70f1-48cf-99ec-63d03b9e02c6',
  '3f560b17-6b5d-41ca-b9f6-83a81511babc',
  '13fd75d0-76a1-444e-9dba-5fdd9a635227',
  '41dca9e7-2152-4b3c-bea7-602b78913430',
  '347d37df-b1af-45f5-aa43-72c9d5d595bb',
  'f7fc9bbc-01c3-4587-a73c-99b9d5edc315',
  'fdc5f921-e839-498e-a16a-0a1efcda1d17',
  '50a4137f-d862-48e1-a50b-7d496cf6ece3',
  'b9f8994e-ed81-4204-8d8b-3e6aa50c5500',
  '26bf1201-6227-4b45-b3fb-c79206e6f9d9',
  'b45b7d60-52d2-414b-a6b2-db8e1072a5f0',
  '033f221a-c5ea-41ce-9f2c-570fa9aa2aae'
);

COMMIT;
