# TikTok Integration

This document reflects the current state of TikTok Ads integration in the monorepo based on the
latest code (agent-service, agent-brain, frontend) and DB migrations.

## Status snapshot

### Implemented (current code)
- Platform separation: UI tabs for Instagram/TikTok and API filtering for directions, reports, and executions.
- TikTok campaign builder: auto/manual launch, create/list/pause/resume campaigns, report, available creatives, advertiser info.
- Direction model: platform column (facebook/tiktok), TikTok fields (objective, daily budget, target CPL, adgroup mode); `platform=both` creates two directions.
- TikTok creatives: video-only creation with `tiktok_video_id` or `media_url` upload fallback; KZT budgets for TikTok.
- Brain/batch: `/api/brain/run-tiktok` with `autopilot_tiktok` gating, platform-tagged reports/executions, Telegram message per platform.
- Dashboard/ROI tabs: platform separation; TikTok dashboard data loaded through proxy in `tiktokApi`.
- **Multi-account TikTok UI**: TikTok tab in AdAccountsManager with OAuth flow, connection status display, and `autopilot_tiktok` toggle in Brain Settings.
- **TikTok OAuth multi-account**: Backend supports saving TikTok credentials to `ad_accounts` table via `ad_account_id` in OAuth state. OAuth can be initiated from both Profile.tsx (with multi-account support) and AdAccountsManager.tsx.
- **Fixed OAuth redirect URI**: All TikTok OAuth flows use `https://performanteaiagency.com/oauth/callback` (configured in TikTok Developer Portal).
- **TikTok connection status**: Displayed in account cards (AdAccountsManager) showing Facebook and TikTok connection status.
- **Backend autopilot settings API**: `autopilot_tiktok` field in UpdateAdAccountSchema with detailed logging for all autopilot and TikTok credential updates.
- **Frontend error handling**: Try-catch error handling and console logging in TikTok OAuth flow (AdAccountsManager).
- DB migrations for TikTok: 112, 150, 152, 155, 157, 158, 159, 160.
- **TikTok Video Upload via TUS**: Direct video upload to TikTok Ads when direction platform is TikTok.
- **TikTok Instant Pages (Lead Forms)**: API endpoint to fetch Instant Pages for Lead Generation campaigns.
- **TikTok Lead Webhooks**: Webhook handler for receiving leads from TikTok Instant Forms.

### Phase 4: TikTok Video Upload & Lead Generation (Latest)

#### TikTok Video Upload
**Files**:
- `services/agent-service/src/routes/tusUpload.ts` - TUS upload handler
- `services/agent-service/src/adapters/tiktok.ts` - TikTok API adapter

**Features**:
- Direct upload to TikTok Ads API when direction.platform === 'tiktok'
- Video transcription with Whisper (same as Facebook)
- Creates `user_creatives` record with `tiktok_video_id`
- MD5 signature calculation for UPLOAD_BY_FILE (required by TikTok API)
- Dynamic timeout based on file size (min 5 min or 10sec/MB)

**Reliability & Error Handling**:
- ✅ Retry logic с exponential backoff (3 attempts: 2s, 5s, 10s)
- ✅ Timeout protection for transcription (2 minutes)
- ✅ Dynamic upload timeout for large files
- ✅ Path traversal protection (uploadId validation)
- ✅ Idempotency check (prevents duplicate processing)
- ✅ Optimistic locking при обновлении статуса с fallback на force update
- ✅ Graceful fallback для транскрипции
- ✅ MD5 hash computed from buffer directly (no double file read)

**Logging & Observability**:
- ✅ Correlation ID для сквозного трейсинга
- ✅ Structured logging с step-by-step progress
- ✅ Performance metrics (durationMs for each step)
- ✅ File size logging (bytes and MB)
- ✅ TikTok API response logging with full data
- ✅ Creative update status logging (success/force-update/failure)

#### TikTok Instant Pages API
**File**: `services/agent-service/src/routes/tiktokRoutes.ts`

**Endpoint**: `GET /tiktok/instant-pages`

**Features**:
- Fetch Instant Pages (Lead Forms) для TikTok аккаунта
- Multi-account mode support (via adAccountId)
- Legacy mode support (via userAccountId)

**Security**:
- ✅ Ownership validation (user can only access their own ad_accounts)
- ✅ UUID format validation
- ✅ Access control logging

#### TikTok Lead Webhooks
**File**: `services/agent-service/src/routes/tiktokWebhooks.ts`

**Endpoints**:
- `GET /tiktok/webhook` - Challenge verification
- `POST /tiktok/webhook` - Lead event processing

**Features**:
- Receives leads from TikTok Instant Forms
- Maps leads to directions by campaign_id, page_id, or advertiser_id
- Creates lead records in `leads` table with platform='tiktok'

**Security & Reliability**:
- ✅ HMAC-SHA256 signature verification (x-tiktok-signature)
- ✅ Explicit duplicate check before processing
- ✅ DB constraint fallback for duplicates
- ✅ PII masking in logs (phone, email)
- ✅ Correlation ID for tracing

**Environment Variables**:
- `TIKTOK_WEBHOOK_SECRET` - Webhook secret from TikTok Developer Portal

### Pending / not implemented yet
- Cross-platform creative sync via `creative_group_id`: schema support added (video.ts, image.ts), full UI/API implementation postponed.

### Phase 2 & 3: Metrics & CAPI (Completed)

#### TikTok Metrics Collector
**File**: `services/agent-brain/src/tiktokMetricsCollector.js`

**Features**:
- Fetches TikTok Report API at AUCTION_AD level
- Maps TikTok metrics to `creative_metrics_history` schema
- Supports multi-account mode via `account_id` parameter
- Saves with `platform = 'tiktok'`

**Reliability & Error Handling**:
- ✅ Retry logic с exponential backoff (3 attempts: 2s, 5s, 10s)
- ✅ Timeout protection (60s per API call)
- ✅ Input validation (advertiserId, accessToken, dates)
- ✅ Graceful error handling (continues if metrics collection fails)
- ✅ Detailed error logging with correlation ID for tracing

**Logging & Observability**:
- ✅ Correlation ID для сквозного трейсинга запросов
- ✅ Structured logging с action tags (collection_started, report_fetched, etc.)
- ✅ Performance metrics (reportDurationMs, adsDurationMs, totalDurationMs)
- ✅ Подробная статистика (metricsCollected, skippedRows, errorsCount)
- ✅ Debug logs для каждого этапа (validation, fetching, processing)

**Integration**:
- ✅ Called in `processUserTikTok()` (legacy batch)
- ✅ Called in `processAccountTikTok()` (multi-account hourly batch)
- ✅ Collects last 7 days of metrics after brain run
- ✅ Returns correlationId for end-to-end tracing
- ✅ Logs metricsCollected count in batch results

#### TikTok Events API Client
**File**: `services/chatbot-service/src/lib/tiktokEventsClient.ts`

**Features**:
- Analogous to Meta CAPI client
- Supports events: ViewContent (Interest), CompleteRegistration (Qualified), PlaceAnOrder (Scheduled)
- SHA256 hashing for phone/email (lowercase, trimmed)
- ttclid support for attribution (TikTok Click ID)
- Deterministic event ID generation для deduplication

**Reliability & Error Handling**:
- ✅ Circuit breaker (threshold: 5 failures, reset: 60s)
- ✅ Retry logic с exponential backoff (3 attempts: 1s, 2s, 4s)
- ✅ Timeout protection (30s per request)
- ✅ Atomic deduplication via `sendTikTokEventAtomic()`
- ✅ Database retry для логирования (2 retries with 500ms delay)

**Logging & Observability**:
- ✅ Correlation ID поддержка для трейсинга
- ✅ Structured logging с action tags (tiktok_event_send_start, success, failed, etc.)
- ✅ Circuit breaker state logging
- ✅ Performance metrics (requestDurationMs, retryCount)
- ✅ Request/response payload logging в `capi_events_log`
- ✅ Detailed timing: request_started_at, request_duration_ms

**Database Logging**:
- ✅ Logs to `capi_events_log` with `platform = 'tiktok'`
- ✅ Stores full request payload для debugging
- ✅ Correlation tracking across services
- ✅ Retry count tracking
- ✅ Error details и TikTok API responses

**Integration**:
- ✅ Integrated into `capiTools.ts` via platform detection
- ✅ Automatically selects TikTok or Meta client based on `account_directions.platform`
- ✅ Uses same qualification flow and CAPI tools as Meta
- ✅ Supports ttclid from `dialog_analysis` for lead attribution
- ✅ Gets pixel_code and access_token from direction via `getDirectionTikTokPixelInfo()`
- ✅ Unified error handling и logging across both platforms

## Platform separation (UI vs DB)
- UI uses `platform = instagram | tiktok` in `AppContext`.
- Backend uses `platform = facebook | tiktok` for directions, reports, and executions.
- Mapping: `instagram` in UI maps to `facebook` in DB/API.
- Legacy directions can have `platform = null`; code treats them as Facebook.
- Directions, reports, and executions are filtered by platform in API and UI.

## Architecture

### agent-service
- TikTok API wrapper and error mapping:
  - `services/agent-service/src/adapters/tiktok.ts`
  - `services/agent-service/src/lib/tiktokErrors.ts`
- TikTok settings and targeting conversion:
  - `services/agent-service/src/lib/tiktokSettings.ts`
  - `services/agent-service/src/lib/defaultSettings.ts`
  - `services/agent-service/src/lib/settingsHelpers.ts`
- Directions API (platform-aware creation and updates):
  - `services/agent-service/src/routes/directions.ts`
- TikTok campaign builder:
  - `services/agent-service/src/routes/tiktokCampaignBuilder.ts`
- OAuth exchange:
  - `services/agent-service/src/routes/tiktokOAuth.ts`
- TikTok workflows:
  - `services/agent-service/src/workflows/tiktok/createCampaignWithCreative.ts`
  - `services/agent-service/src/workflows/tiktok/createAdGroupInDirection.ts`

### agent-brain
- TikTok API wrapper for brain:
  - `services/agent-brain/src/chatAssistant/shared/tikTokGraph.js`
- TikTok metrics collector:
  - `services/agent-brain/src/tiktokMetricsCollector.js`
- Brain endpoint:
  - `services/agent-brain/src/server.js` (`POST /api/brain/run-tiktok`)
- MCP tool schemas and handlers:
  - `services/agent-brain/src/chatAssistant/agents/tiktok/toolDefs.js`
  - `services/agent-brain/src/chatAssistant/agents/tiktok/handlers.js`

### chatbot-service
- TikTok Events API client:
  - `services/chatbot-service/src/lib/tiktokEventsClient.ts`
- Meta CAPI client (Facebook):
  - `services/chatbot-service/src/lib/metaCapiClient.ts`

### frontend
- Platform selection (Instagram/TikTok tabs):
  - `services/frontend/src/pages/Dashboard.tsx`
  - `services/frontend/src/pages/ROIAnalytics.tsx`
- TikTok manual launch (KZT budgets, endpoint switch):
  - `services/frontend/src/services/manualLaunchApi.ts`
  - `services/frontend/src/pages/Creatives.tsx`
  - `services/frontend/src/components/VideoUpload.tsx`
- TikTok dashboard data (proxy):
  - `services/frontend/src/services/tiktokApi.ts`
  - `services/frontend/src/context/AppContext.tsx`
- ROI analytics:
  - `services/frontend/src/services/salesApi.ts`
  - `services/frontend/src/pages/ROIAnalytics.tsx`
- Reports and autopilot history filtered by platform:
  - `services/frontend/src/hooks/useReports.ts`
  - `services/frontend/src/components/AutopilotSection.tsx`
  - `services/frontend/src/components/AllAccountsExecutionsSection.tsx`

## Authentication and credentials

### OAuth Flow
- **Redirect URI**: `https://performanteaiagency.com/oauth/callback` (fixed, configured in TikTok Developer Portal)
- **Callback handler**: `services/frontend/src/pages/OAuthCallback.tsx`
  - Handles both `/oauth/callback` and `/oauth/tiktok/callback` routes
  - Decodes state to get `user_id` and `ad_account_id`
  - Calls backend exchange endpoint

### OAuth Entry Points
1. **Profile.tsx** (`services/frontend/src/pages/Profile.tsx`)
   - TikTok button in integrations section
   - Multi-account mode: includes `ad_account_id` in state when `multiAccountEnabled && currentAdAccountId`
   - Legacy mode: only `user_id` in state

2. **AdAccountsManager.tsx** (`services/frontend/src/components/ad-accounts/AdAccountsManager.tsx`)
   - TikTok tab in account settings
   - Always includes `ad_account_id` in state (requires saved account)

### Backend Exchange
- OAuth exchange endpoint: `POST /tiktok/oauth/exchange`
  - Exchanges `auth_code` for `access_token`
  - Fetches advertiser accounts and TT_USER identity
  - If `ad_account_id` in state: saves to `ad_accounts` table
  - Otherwise: saves to `user_accounts` table (legacy mode)

### Credential Resolution
- Multi-account mode: uses `ad_accounts` for TikTok credentials
- Legacy mode: uses `user_accounts`
- Frontend `tiktokApi` reads credentials from localStorage user object

### Environment Variables
- `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`
- `TIKTOK_API_VERSION` (default `v1.3`)
- `VITE_TIKTOK_PROXY_URL` (frontend proxy for dashboard)

### Feature Flags
- `FEATURES.SHOW_TIKTOK` hides TikTok UI in app review mode

## Data model and migrations

### account_directions
Relevant migrations:
- `migrations/112_create_direction_tiktok_adgroups_table.sql` adds:
  - `tiktok_campaign_id`, `tiktok_pixel_id`, `tiktok_identity_id`
- `migrations/152_add_platform_and_tiktok_fields_to_account_directions.sql` adds:
  - `platform` (facebook or tiktok, default facebook)
  - `tiktok_objective`, `tiktok_daily_budget`, `tiktok_target_cpl_kzt`, `tiktok_target_cpl`
  - `tiktok_adgroup_mode` (use_existing or create_new)
  - unique constraint `(user_account_id, name, platform)`

Notes:
- `platform = both` is a create-time option only. Backend creates two directions (`facebook` and `tiktok`) instead of storing `both`.
- For legacy rows, `platform` is treated as `facebook`.

### direction_tiktok_adgroups
Defined in `migrations/112_create_direction_tiktok_adgroups_table.sql`.
Key columns:
- `direction_id`, `tiktok_adgroup_id`, `adgroup_name`, `daily_budget`, `status`
- `ads_count`, `last_used_at`, `is_active`

### user_creatives
Relevant migrations:
- `migrations/150_tiktok_autopilot_platform_reports_creative_groups.sql`:
  - `creative_group_id` (link creatives across platforms)
- `migrations/155_add_tiktok_video_id_to_user_creatives.sql`:
  - `tiktok_video_id` (TikTok video identifier)

Notes:
- TikTok creatives are identified by `tiktok_video_id`.
- TikTok creation workflows accept `tiktok_video_id` or fall back to `media_url` (video upload).
- Image/carousel creation endpoints reject TikTok directions.

### user_accounts and ad_accounts
Relevant migration:
- `migrations/150_tiktok_autopilot_platform_reports_creative_groups.sql`:
  - `autopilot_tiktok` flag

### brain_executions and campaign_reports
Relevant migrations:
- `migrations/150_tiktok_autopilot_platform_reports_creative_groups.sql`:
  - `platform` column added to separate TikTok vs Facebook reports
- `migrations/157_add_platform_to_brain_executions.sql`:
  - `platform` column in `brain_executions` with index

### creative_metrics_history
Relevant migration:
- `migrations/158_add_platform_to_creative_metrics_history.sql`:
  - `platform` column (default 'facebook') for separating FB and TikTok metrics
  - Updated unique constraints to include platform

### capi_events_log, leads, dialog_analysis
Relevant migration:
- `migrations/159_add_platform_and_ttclid_to_capi.sql`:
  - `platform` column in `capi_events_log`
  - `ttclid` (TikTok Click ID) in `capi_events_log`, `leads`, `dialog_analysis`
  - Indexes for ttclid lookups

## API endpoints (agent-service)

### TikTok campaign builder
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
```

Manual launch specifics:
- Body: `daily_budget` (KZT), `objective`, `direction_id`, `creative_ids`.
- If `direction.tiktok_adgroup_mode = use_existing`, creates ads in existing ad groups.
- Otherwise creates a new campaign and ad group.

### Directions
```
GET  /api/directions?userAccountId=...&platform=facebook|tiktok&accountId=...
POST /api/directions
PATCH /api/directions/:id
DELETE /api/directions/:id
```

Create direction payload (TikTok):
- `platform: tiktok | both`
- `tiktok_objective`, `tiktok_daily_budget`, `tiktok_target_cpl_kzt`, `tiktok_adgroup_mode`
- `facebook_default_settings`, `tiktok_default_settings` (optional)
- `default_settings` (shared settings for single platform)

### Autopilot and reports
```
GET /api/autopilot/executions?userAccountId=...&platform=facebook|tiktok&accountId=...
GET /api/autopilot/reports?telegramId=...&platform=facebook|tiktok&accountId=...
```

### Actions
Supported TikTok actions via `POST /api/actions`:
- `TikTok.GetCampaignStatus`
- `TikTok.PauseCampaign` / `TikTok.ResumeCampaign`
- `TikTok.PauseAdGroup` / `TikTok.ResumeAdGroup`
- `TikTok.UpdateAdGroupBudget`
- `TikTok.PauseAd` / `TikTok.ResumeAd`
- `TikTok.Direction.CreateAdGroupWithCreatives`

### Ad Accounts (multi-account TikTok)
```
PATCH /api/ad-accounts/:adAccountId
```
Supported TikTok-related fields:
- `tiktok_account_id`: TT_USER identity ID (nullable for disconnect)
- `tiktok_business_id`: TikTok advertiser ID (nullable for disconnect)
- `autopilot_tiktok`: Enable/disable TikTok autopilot

Backend logs all TikTok credential updates with action type (connect/disconnect) and autopilot setting changes.

## Workflows

### Direction creation
- `platform = both` creates two directions: one Facebook, one TikTok.
- Each direction can have separate `default_ad_settings`:
  - `facebook_default_settings` for Facebook
  - `tiktok_default_settings` for TikTok
- If separate settings are not provided, `default_settings` is used as shared fallback.

### Create campaign with creatives
`workflowCreateTikTokCampaignWithCreative`:
- Validates creatives are video-only.
- Uses `tiktok_video_id` when present.
- If missing, uploads video from `media_url` and stores `tiktok_video_id`.
- Creates campaign -> ad group -> ads and persists mapping.

### Use existing ad groups
`workflowCreateAdInDirection`:
- Uses `direction_tiktok_adgroups` with `status = DISABLE` and `ads_count < 50`.
- Enables ad group when needed.
- Increments `ads_count` after ad creation.

### Create ad group inside a direction
`workflowCreateAdGroupWithCreatives`:
- Creates a new ad group under `direction.tiktok_campaign_id`.
- Stores it in `direction_tiktok_adgroups`.

## Brain and batch
`POST /api/brain/run-tiktok`:
- Loads TikTok credentials from `user_accounts` or `ad_accounts`.
- Fetches advertiser info, campaigns, ad groups, and reports.
- Computes leads based on objective and health score per ad group.
- Generates actions via LLM or deterministic fallback.
- Dispatches actions via `/api/actions` when enabled.
- Writes `campaign_reports` and `brain_executions` with `platform = tiktok`.
- Sends Telegram report messages separately from Facebook.

Batch scheduling:
- Legacy users: `processDailyBatchTikTok`
- Multi-account: `processDailyBatchByScheduleTikTok`
- Both use `autopilot_tiktok` to decide report-only vs action dispatch.

## UI behavior and constraints
- Dashboard and ROI pages show Instagram/TikTok tabs.
- Directions list is filtered by platform.
- TikTok uses KZT budgets; minimum daily budget is 2500 (KZT).
- TikTok objectives supported: `traffic`, `conversions`, `lead_generation`.
- TikTok creatives are video-only; image/carousel endpoints reject TikTok directions.
- Video upload for TikTok uses the webhook in `services/frontend/src/components/VideoUpload.tsx`.
- Quality metrics and CAPI sections are hidden for TikTok in UI.

## ROI analytics (current behavior)
`salesApi.getROIData`:
- Loads `user_creatives` and separates platforms by `tiktok_video_id`.
- Aggregates `creative_metrics_history` for spend, clicks, leads.
- Uses `leads`, `purchases`, and `capi_events_log` to compute revenue/conversions.
- Converts Facebook spend from USD to KZT using a fixed rate in code.
- TikTok spend uses raw values (KZT).

Platform support:
- TikTok metrics are populated by `tiktokMetricsCollector.js` in batch processes (legacy and multi-account).
- Metrics are stored in `creative_metrics_history` with `platform = 'tiktok'`.
- ROI analytics automatically includes both Facebook and TikTok data.

## Troubleshooting
- ROI 400 on `user_creatives` filter:
  - Apply `migrations/155_add_tiktok_video_id_to_user_creatives.sql`.
- Directions not showing:
  - Apply `migrations/112_create_direction_tiktok_adgroups_table.sql`.
  - Apply `migrations/152_add_platform_and_tiktok_fields_to_account_directions.sql`.
- TikTok dashboard shows mock data:
  - Check TikTok credentials in localStorage (`tiktok_access_token`, `tiktok_business_id`).
- TikTok ad creation fails:
  - Verify `tiktok_video_id` or `media_url` exists for the creative.
- Platform mismatch:
  - UI uses `instagram` but DB uses `facebook`. Confirm filters map correctly.
