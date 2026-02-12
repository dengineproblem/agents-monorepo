-- Drop unused capi_page_id column from account_directions
-- page_id now resolved dynamically: legacy → user_accounts.page_id, multi-account → ad_accounts.page_id
ALTER TABLE account_directions DROP COLUMN IF EXISTS capi_page_id;
