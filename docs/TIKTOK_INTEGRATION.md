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
- Links leads to creatives via `ad_creative_mapping` (ad_id → user_creative_id) for ROI analytics

**Security & Reliability**:
- ✅ HMAC-SHA256 signature verification using raw body (NOT JSON.stringify)
- ✅ Explicit duplicate check before processing
- ✅ DB constraint fallback for duplicates (23505)
- ✅ PII masking in logs (phone, email)
- ✅ Correlation ID for end-to-end tracing
- ✅ Detailed logging at every stage (search, insert, creative mapping)
- ✅ Performance metrics (duration_ms for each step)

**Lead → Creative Linking**:
After saving a lead, the webhook looks up `ad_creative_mapping` by `ad_id` to set `leads.creative_id`.
This enables ROI analytics to attribute revenue to specific creatives.
If `ad_id` is missing or no mapping found — a warning is logged.

**Environment Variables**:
- `TIKTOK_WEBHOOK_SECRET` - Webhook secret from TikTok Developer Portal

**Setup**: See "TikTok Developer Portal — настройка webhook для лидов" section below.

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
- **Resolves identity info** via `identity/get/` API to get correct `identity_type` (`TT_USER` or `BC_AUTH_TT`) and `display_name`.
- **Uploads poster images** (video thumbnails) — required by TikTok for video ads. Downloads cover URL and uploads via `UPLOAD_BY_FILE` with MD5 signature.
- Creates campaign → ad group → ads with `image_ids` (poster) and `display_name`.
- Persists campaign/adgroup mapping.

### Use existing ad groups
`workflowCreateAdInDirection`:
- Uses `direction_tiktok_adgroups` with `status = DISABLE` and `ads_count < 50`.
- Enables ad group when needed.
- **Resolves identity and uploads poster images** via shared `resolveIdentityAndPosters` helper.
- Creates ad with `image_ids`, `display_name`, correct `identity_type`.
- Increments `ads_count` after ad creation.

### Create ad group inside a direction
`workflowCreateAdGroupWithCreatives`:
- Creates a new ad group under `direction.tiktok_campaign_id`.
- Uses `placement_type: PLACEMENT_TYPE_NORMAL` + `placements: ['PLACEMENT_TIKTOK']` (not AUTOMATIC).
- Includes `promotion_type` from direction objective config.
- **Resolves identity and uploads poster images** via shared `resolveIdentityAndPosters` helper.
- Creates ads with `image_ids`, `display_name`, correct `identity_type`.
- Stores adgroup in `direction_tiktok_adgroups`.

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

**CRITICAL: source filter for metrics**:
- Facebook metrics saved with `source = 'production'` (scoring.js)
- TikTok metrics saved with `source = 'tiktok_batch'` (tiktokMetricsCollector.js)
- `salesApi.getROIData()` uses platform-aware filter: `metricsSource = effectivePlatform === 'tiktok' ? 'tiktok_batch' : 'production'`
- `salesApi.getCreativeMetrics()` accepts `platform` parameter for the same purpose

**Leads → Creative linking (for revenue attribution)**:
- Facebook leads: `leads.creative_id` set by leads.ts via `creativeResolver.ts`
- TikTok Instant Form leads: `leads.creative_id` set by tiktokWebhooks.ts via `ad_creative_mapping` lookup
- TikTok Website leads (Tilda): `leads.creative_id` set by leads.ts via `creativeResolver.ts` (same as Facebook)
- Backfill migration 197: fills `creative_id` for existing TikTok leads without it

Platform support:
- TikTok metrics are populated by `tiktokMetricsCollector.js` in batch processes (legacy and multi-account).
- Metrics are stored in `creative_metrics_history` with `platform = 'tiktok'` and `source = 'tiktok_batch'`.
- ROI analytics automatically includes both Facebook and TikTok data when correct platform is selected.

## TikTok API — ключевые особенности

### Эндпоинты
- **Video info**: `GET file/video/ad/info/` — НЕ `file/video/ad/get/` (404).
- **Image upload**: `POST file/image/ad/upload/` — требует `image_signature` (MD5 hash файла) для `UPLOAD_BY_FILE`.
- **Identity info**: `GET identity/get/` — возвращает список identity с `identity_type` и `display_name`.
- **Ad creation (v1.3)**: требует обёртку `creatives: [{ ad_name, video_id, image_ids, ... }]`.

### Загрузка изображений
- `UPLOAD_BY_URL` НЕ работает с signed TikTok CDN URL (403 от TikTok серверов).
- Решение: всегда скачиваем URL → загружаем по `UPLOAD_BY_FILE` с MD5 `image_signature`.
- `image_ids` (poster/thumbnail) **обязателен** для видео-объявлений.

### Identity
- `identity_type` должен соответствовать реальному типу из `identity/get/` API.
- Возможные типы: `TT_USER`, `BC_AUTH_TT` — НЕ `CUSTOMIZED_USER`.
- `display_name` берётся из identity info.

### AdGroup параметры
- `schedule_start_time` — обязателен.
- `pacing: "PACING_MODE_SMOOTH"` — обязателен для `BID_TYPE_NO_BID`.
- `promotion_type` — обязателен (зависит от objective).
- `placement_type: "PLACEMENT_TYPE_NORMAL"` + `placements: ["PLACEMENT_TIKTOK"]` для Lead Gen (не AUTOMATIC).
- `location_ids` — должны быть строками, не числами.

### Location IDs (Казахстан)
- Страна KZ: `'1522867'`
- Города: см. `tiktokSettings.ts` → `KZ_CITY_LOCATION_IDS`

### Обработка ошибок
- Код `40002` — GENERIC validation error, НЕ "auth expired". Всегда передавать фактическое сообщение TikTok пользователю.
- Диапазон 40000-40999: валидационные ошибки — используем `meta.message` из ответа API.

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
  - Проверить, что poster image загружается (video → cover URL → upload → image_id).
  - Проверить `identity_type` через `identity/get/` API.
  - Убедиться, что `promotion_type` соответствует objective.
- "Invalid targeting countries":
  - Проверить `location_ids` в `tiktokSettings.ts` — должны быть реальные ID из TikTok API.
  - KZ = `'1522867'`, не `'6251999'`.
- "You must upload an image":
  - Объявления для видео требуют `image_ids` (thumbnail/poster). Загрузить cover видео.
- "Lead Generation agreement has not been signed":
  - Необходимо подписать соглашение в TikTok Ads Manager UI.
- Platform mismatch:
  - UI uses `instagram` but DB uses `facebook`. Confirm filters map correctly.
- TikTok ROI shows 0 spend/metrics:
  - Проверить что `creative_metrics_history` имеет записи с `source = 'tiktok_batch'`
  - salesApi фильтрует по `source`: `'tiktok_batch'` для TikTok, `'production'` для Facebook
- TikTok leads не видны в ROI:
  - Проверить `leads.creative_id` — если NULL, лид не привязан к креативу
  - Проверить `ad_creative_mapping` — должна быть запись для `ad_id` лида
  - Применить миграцию `197_backfill_tiktok_leads_creative_id.sql` для бэкфила

## Сквозная аналитика TikTok (End-to-End ROI)

### Два канала получения лидов

#### 1. TikTok Instant Forms (Lead Generation)
```
Пользователь → TikTok реклама → Instant Form → POST /api/tiktok/webhook
  → tiktokWebhooks.ts: парсинг полей → поиск direction → INSERT leads
  → ad_creative_mapping lookup (ad_id → creative_id) → UPDATE leads.creative_id
  → ROI: metrics (tiktok_batch) + leads.creative_id → выручка по креативам
```

**Настройка**: одноразовая в TikTok Developer Portal (см. инструкцию ниже).

#### 2. TikTok Website (Tilda)
```
Пользователь → TikTok реклама → Сайт на Tilda (с UTM: utm_medium=__CID__)
  → Заполняет форму → Tilda webhook → POST /api/leads/{userAccountId}
  → leads.ts: парсинг TILDAUTM cookie → извлечение ad_id из UTM-поля
  → creativeResolver.ts: ad_id → ad_creative_mapping → creative_id + direction_id
  → INSERT leads с creative_id, direction_id
  → ROI: metrics (tiktok_batch) + leads.creative_id → выручка по креативам
```

**Настройка**: пользователь добавляет UTM `utm_medium=__CID__` в TikTok Ads → URL Parameters.

### UTM-макросы TikTok

| Макрос | Значение | Аналог Facebook |
|--------|----------|-----------------|
| `__CID__` | **Ad ID** (объявление) | `{{ad.id}}` |
| `__AID__` | Ad Group ID | `{{adset.id}}` |
| `__CAMPAIGN_ID__` | Campaign ID | `{{campaign.id}}` |

Для ROI аналитики используется `__CID__` — передаёт `ad_id` объявления, который маппится на креатив через `ad_creative_mapping`.

### Цепочка данных для ROI

| Этап | Facebook | TikTok |
|------|----------|--------|
| Метрики (spend, clicks, impressions) | scoring.js → `source='production'` | tiktokMetricsCollector.js → `source='tiktok_batch'` |
| Маппинг ad→creative | `ad_creative_mapping` | `ad_creative_mapping` (заполняется при создании объявлений) |
| Лиды (Lead Forms) | subscribePageToLeadgen() → webhook | Developer Portal webhook → tiktokWebhooks.ts |
| Лиды (Website/Tilda) | leads.ts → UTM `{{ad.id}}` | leads.ts → UTM `__CID__` |
| creative_id на лидах | Автоматически через creativeResolver | Instant Forms: tiktokWebhooks.ts; Tilda: creativeResolver |
| ROI расчёт | salesApi → `source='production'` | salesApi → `source='tiktok_batch'` |

### Миграции для сквозной аналитики
- `038_add_user_creative_id_to_metrics_history.sql` — user_creative_id в метриках
- `039_auto_fill_user_creative_id_trigger.sql` — триггер автозаполнения (работает для TikTok)
- `077_add_tilda_utm_field.sql` — настройка UTM-поля для Tilda
- `197_backfill_tiktok_leads_creative_id.sql` — бэкфил creative_id для существующих TikTok лидов

## TikTok Developer Portal — настройка webhook для лидов

### Зачем это нужно
TikTok **не имеет API для программной подписки** на лиды (в отличие от Facebook `subscribePageToLeadgen()`).
Webhook настраивается **один раз** на уровне приложения в Developer Portal.
После настройки лиды от **всех рекламодателей**, авторизованных через наше приложение, будут приходить автоматически.

### Пошаговая инструкция

1. Зайти на https://developers.tiktok.com
2. **Manage Apps** → выбрать приложение (через которое OAuth авторизация)
3. В настройках приложения найти раздел **Events** (или **Webhooks**)
4. Добавить новый webhook:
   - **Event type**: Lead Generation (или Lead)
   - **Callback URL**: `https://performanteaiagency.com/api/tiktok/webhook`
5. TikTok отправит **GET запрос с challenge** на callback URL
   - Наш handler ([tiktokWebhooks.ts](../services/agent-service/src/routes/tiktokWebhooks.ts)) автоматически вернёт challenge → верификация пройдёт
6. Скопировать **Webhook Secret** (или App Secret) из настроек
7. Добавить в environment:
   ```
   TIKTOK_WEBHOOK_SECRET=<скопированный_secret>
   ```
8. Перезапустить agent-service
9. Готово — лиды будут приходить на webhook

### Проверка работоспособности
- Создать тестовую Lead Form кампанию в TikTok Ads Manager
- Отправить тестовый лид
- В логах agent-service должны появиться записи:
  ```
  [tiktokWebhooks] 📥 Received webhook event
  [tiktokWebhooks] 🔍 Starting lead processing
  [tiktokWebhooks] 🎯 Found direction for lead
  [tiktokWebhooks] 💾 Lead inserted into DB
  [tiktokWebhooks] 🔗 Lead linked to creative via ad_creative_mapping
  [tiktokWebhooks] ✅ Lead created successfully
  ```

### Отличия от Facebook

| | Facebook | TikTok |
|---|---|---|
| Подписка на лиды | `subscribePageToLeadgen()` — автоматически через API | Developer Portal — ручная одноразовая настройка |
| Уровень подписки | На уровне Facebook Page | На уровне приложения (все advertiser'ы) |
| Верификация | App Secret + challenge endpoint | Webhook Secret + HMAC-SHA256 + challenge |
| Данные в payload | `leadgen_id` (нужен доп. GET запрос) | Полные данные лида сразу (field_data, ad_id, campaign_id) |
