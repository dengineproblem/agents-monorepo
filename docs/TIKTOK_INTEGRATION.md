# TikTok Integration

This document describes the current TikTok Ads integration in the monorepo. It focuses on backend services,
data model, and the frontend ROI helper that are already implemented.

## Scope
- Campaign builder for TikTok (campaign, ad group, ad creation).
- Brain/autopilot reporting and action dispatch for TikTok.
- ROI analytics fetches via proxy in the frontend.

## Architecture
### agent-service
- TikTok API adapter and error handling live in `services/agent-service/src/adapters/tiktok.ts` and `services/agent-service/src/lib/tiktokErrors.ts`.
- TikTok settings, targeting conversion, and credentials helpers live in `services/agent-service/src/lib/tiktokSettings.ts`.
- Campaign builder endpoints are in `services/agent-service/src/routes/tiktokCampaignBuilder.ts`.
- OAuth exchange for TikTok credentials is in `services/agent-service/src/routes/tiktokOAuth.ts`.
- Workflows for creation live in `services/agent-service/src/workflows/tiktok/createCampaignWithCreative.ts` and `services/agent-service/src/workflows/tiktok/createAdGroupInDirection.ts`.

### agent-brain
- TikTok API wrapper for brain and tools lives in `services/agent-brain/src/chatAssistant/shared/tikTokGraph.js`.
- Brain endpoint for TikTok optimization is implemented in `services/agent-brain/src/server.js` (POST `/api/brain/run-tiktok`).
- MCP tool schemas and handlers are in `services/agent-brain/src/chatAssistant/agents/tiktok/toolDefs.js` and `services/agent-brain/src/chatAssistant/agents/tiktok/handlers.js`.

### frontend
- TikTok ROI analytics service uses a proxy in `services/frontend/src/services/tiktokApi.ts`.

## Authentication and credentials
- OAuth exchange endpoint: `POST /tiktok/oauth/exchange`.
  - Exchanges `auth_code` for `access_token`.
  - Fetches advertiser accounts and TT_USER identity.
  - Persists credentials to `user_accounts`.
- Multi-account mode uses `ad_accounts` as the source of TikTok credentials.
- Environment variables:
  - `TIKTOK_APP_ID` and `TIKTOK_APP_SECRET` for OAuth.
  - `TIKTOK_API_VERSION` for API versioning (defaults to `v1.3`).
  - `VITE_TIKTOK_PROXY_URL` (frontend) for ROI analytics proxy.

## Data model
### user_accounts
- `tiktok_access_token`, `tiktok_business_id`, `tiktok_account_id`
- `autopilot_tiktok`

### ad_accounts
- `tiktok_access_token`, `tiktok_business_id`, `tiktok_account_id`
- `autopilot_tiktok`

### account_directions
- Migration adds: `tiktok_campaign_id`, `tiktok_pixel_id`, `tiktok_identity_id` in `migrations/112_create_direction_tiktok_adgroups_table.sql`.
- Code also expects fields used by TikTok flows:
  - `platform` (facebook/tiktok/both)
  - `tiktok_objective`, `tiktok_daily_budget`
  - `tiktok_target_cpl_kzt` or `tiktok_target_cpl`
  - `tiktok_adgroup_mode` (e.g. `use_existing`)

### direction_tiktok_adgroups
- Table for pre-created TikTok ad groups used in `use_existing` mode.
- Defined in `migrations/112_create_direction_tiktok_adgroups_table.sql`.
- Key columns: `direction_id`, `tiktok_adgroup_id`, `adgroup_name`, `daily_budget`, `status`, `ads_count`, `last_used_at`, `is_active`.

### user_creatives
- `tiktok_video_id` is used to store uploaded video references.
- `creative_group_id` is used to link creatives across platforms in `migrations/150_tiktok_autopilot_platform_reports_creative_groups.sql`.

### campaign_reports and brain_executions
- `platform` column added in `migrations/150_tiktok_autopilot_platform_reports_creative_groups.sql` to separate TikTok vs Facebook reports.

## API endpoints (agent-service)
```
POST /api/tiktok-campaign-builder/auto-launch
POST /api/tiktok-campaign-builder/manual-launch
POST /api/tiktok-campaign-builder/create-campaign
GET  /api/tiktok-campaign-builder/campaigns
POST /api/tiktok-campaign-builder/pause-campaign
POST /api/tiktok-campaign-builder/resume-campaign
GET  /api/tiktok-campaign-builder/report
GET  /api/tiktok-campaign-builder/available-creatives
GET  /api/tiktok-campaign-builder/advertiser-info

POST /tiktok/oauth/exchange
```

## Actions (agent-service /api/actions)
Supported action types are routed through `services/agent-service/src/routes/actions.ts`:
- `TikTok.GetCampaignStatus`
- `TikTok.PauseCampaign` / `TikTok.ResumeCampaign`
- `TikTok.PauseAdGroup` / `TikTok.ResumeAdGroup`
- `TikTok.UpdateAdGroupBudget`
- `TikTok.PauseAd` / `TikTok.ResumeAd`
- `TikTok.Direction.CreateAdGroupWithCreatives`

## Workflows
### Create campaign with creatives
`workflowCreateTikTokCampaignWithCreative` in `services/agent-service/src/workflows/tiktok/createCampaignWithCreative.ts`:
- Loads creatives and uploads videos to TikTok if `tiktok_video_id` is missing.
- Creates Campaign -> AdGroup -> Ads.
- Saves creative mapping via `saveAdCreativeMappingBatch`.

### Use existing ad groups
`workflowCreateAdInDirection` in `services/agent-service/src/workflows/tiktok/createAdGroupInDirection.ts`:
- Uses `direction_tiktok_adgroups` with `status = DISABLE` and `ads_count < 50`.
- Activates ad group (ENABLE) when needed.
- Creates ads and increments `ads_count`.

### Create ad group inside a direction
`workflowCreateAdGroupWithCreatives` in `services/agent-service/src/workflows/tiktok/createAdGroupInDirection.ts`:
- Creates a new ad group under `direction.tiktok_campaign_id`.
- Adds ads and stores the ad group in `direction_tiktok_adgroups`.

## Brain and batch
### TikTok brain run
`POST /api/brain/run-tiktok` in `services/agent-brain/src/server.js`:
- Loads TikTok credentials from `user_accounts` or `ad_accounts`.
- Fetches advertiser info, campaigns, ad groups, and reports for multiple time windows.
- Computes leads based on objective and health score per ad group.
- Generates actions via LLM prompt or deterministic fallback.
- Dispatches actions via `/api/actions` when `inputs.dispatch = true`.
- Saves reports to `campaign_reports` and executions to `brain_executions` with `platform = 'tiktok'`.
- Sends Telegram report if dispatch is enabled.

### Batch scheduling
- Daily batch for legacy users: `processDailyBatchTikTok`.
- Hourly schedule for multi-account: `processDailyBatchByScheduleTikTok`.
- Both rely on `autopilot_tiktok` to decide between report-only vs action dispatch.

## Objectives, metrics, and budgets
- Objective mapping is defined in `services/agent-service/src/lib/tiktokSettings.ts`.
- Lead computation in brain:
  - `traffic` or `click` uses clicks.
  - `lead` or `conversion` uses conversions.
  - Otherwise uses conversions if present, else clicks.
- TikTok statuses: `ENABLE`, `DISABLE`, `DELETE` (API field is `operation_status`).
- Budgets are passed as raw numbers in account currency. Brain uses KZT defaults and converts USD
  defaults when explicit TikTok budgets are missing.

## Frontend ROI analytics
- `services/frontend/src/services/tiktokApi.ts` fetches TikTok metrics through a proxy endpoint.
- Reads credentials from localStorage `user` payload (`tiktok_access_token`, `tiktok_business_id`).
- Falls back to mock data if no credentials are available.

## Notes and checks
- MCP handlers in `services/agent-brain/src/chatAssistant/agents/tiktok/handlers.js` send `status`
  in update calls; TikTok API expects `operation_status`. Verify if this should be aligned.
- Several TikTok-specific direction fields are referenced in code but are not created by migrations in this repo.
  Ensure the database schema contains the required columns listed above.
