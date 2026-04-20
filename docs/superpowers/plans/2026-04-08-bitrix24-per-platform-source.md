# Bitrix24 Per-Platform Source Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to choose separate Bitrix24 SOURCE_ID for Facebook Lead Forms and TikTok Instant Forms leads, replacing the single shared source dropdown.

**Architecture:** Add two new DB columns (`bitrix24_facebook_source_id`, `bitrix24_tiktok_source_id`) to both `user_accounts` and `ad_accounts`. Old `bitrix24_default_source_id` stays as fallback for backward compat. Backend `/bitrix24/default-stage` GET/PATCH endpoints get new fields. `getDefaultStageSettings()` returns both IDs. `pushLeadToBitrix24Direct()` and `syncLeadToBitrix24()` pick the right source based on `utm_source` / `source_description`. Profile UI replaces single "Источник" dropdown with two: "Источник Facebook" and "Источник TikTok".

**Tech Stack:** TypeScript, Fastify, Supabase (PostgreSQL), React, Zod

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `migrations/249_bitrix24_per_platform_source.sql` | Create | Add 2 columns to `user_accounts` + `ad_accounts` |
| `services/agent-service/src/workflows/bitrix24Sync.ts` | Modify | `getDefaultStageSettings()` returns `facebookSourceId` + `tiktokSourceId`; `pushLeadToBitrix24Direct()` picks source by `utm_source`; `syncLeadToBitrix24()` picks source by `lead.utm_source` |
| `services/agent-service/src/routes/bitrix24Pipelines.ts` | Modify | GET `/bitrix24/default-stage` returns new fields; PATCH accepts + saves them |
| `services/frontend/src/services/bitrix24Api.ts` | Modify | `DefaultStageSetting` interface + `setBitrix24DefaultStage` payload type gets `facebookSourceId`, `tiktokSourceId` |
| `services/frontend/src/pages/Profile.tsx` | Modify | State + handlers + UI: replace single source dropdown with two |

---

## Task 1: Database migration

**Files:**
- Create: `migrations/249_bitrix24_per_platform_source.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 249: Separate Bitrix24 source IDs per ad platform
-- Allows configuring different SOURCE_ID for Facebook and TikTok leads

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_facebook_source_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_tiktok_source_id TEXT;

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS bitrix24_facebook_source_id TEXT,
  ADD COLUMN IF NOT EXISTS bitrix24_tiktok_source_id TEXT;

COMMENT ON COLUMN user_accounts.bitrix24_facebook_source_id IS 'Bitrix24 SOURCE_ID for Facebook Lead Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN user_accounts.bitrix24_tiktok_source_id IS 'Bitrix24 SOURCE_ID for TikTok Instant Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN ad_accounts.bitrix24_facebook_source_id IS 'Bitrix24 SOURCE_ID for Facebook Lead Form leads (overrides bitrix24_default_source_id)';
COMMENT ON COLUMN ad_accounts.bitrix24_tiktok_source_id IS 'Bitrix24 SOURCE_ID for TikTok Instant Form leads (overrides bitrix24_default_source_id)';
```

- [ ] **Step 2: Verify file exists**

```bash
cat migrations/249_bitrix24_per_platform_source.sql
```

Expected: file content printed without errors.

> ⚠️ Do NOT apply this migration — the user applies migrations manually on Supabase.

- [ ] **Step 3: Commit**

```bash
git add migrations/249_bitrix24_per_platform_source.sql
git commit -m "feat: add bitrix24_facebook_source_id and bitrix24_tiktok_source_id columns (migration 249)"
```

---

## Task 2: Backend — `getDefaultStageSettings()` returns per-platform sources

**Files:**
- Modify: `services/agent-service/src/workflows/bitrix24Sync.ts`

The function `getDefaultStageSettings()` currently returns `{ leadStatus, dealCategory, dealStage, sourceId }`. Add `facebookSourceId` and `tiktokSourceId`.

- [ ] **Step 1: Update the return type interface (lines ~116-125)**

Find the block:
```typescript
  sourceId: string | null;
```
and the full return type at the top of `getDefaultStageSettings`. Replace the entire return type and all return statements so the function returns:

```typescript
// Return type (replace existing inline type)
{
  leadStatus: string | null;
  dealCategory: number | null;
  dealStage: string | null;
  sourceId: string | null;          // legacy fallback
  facebookSourceId: string | null;  // NEW
  tiktokSourceId: string | null;    // NEW
}
```

- [ ] **Step 2: Update SELECT queries to include new columns**

In the multi-account branch (around line 143), find:
```typescript
.select('bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id')
```
Replace with:
```typescript
.select('bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id, bitrix24_facebook_source_id, bitrix24_tiktok_source_id')
```

In the legacy branch (around line 129), find:
```typescript
.select('multi_account_enabled, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id')
```
Replace with:
```typescript
.select('multi_account_enabled, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id, bitrix24_facebook_source_id, bitrix24_tiktok_source_id')
```

- [ ] **Step 3: Update all return statements in `getDefaultStageSettings()`**

Every `return { ... sourceId: ... }` in that function needs two new fields. There are 3 return statements (error cases + success paths). For the error/fallback returns:
```typescript
return { leadStatus: null, dealCategory: null, dealStage: null, sourceId: null, facebookSourceId: null, tiktokSourceId: null };
```

For the multi-account success return (around line 156):
```typescript
return {
  leadStatus: adAccount.bitrix24_default_lead_status ?? null,
  dealCategory: adAccount.bitrix24_default_deal_category ?? null,
  dealStage: adAccount.bitrix24_default_deal_stage ?? null,
  sourceId: adAccount.bitrix24_default_source_id ?? null,
  facebookSourceId: (adAccount as any).bitrix24_facebook_source_id ?? null,
  tiktokSourceId: (adAccount as any).bitrix24_tiktok_source_id ?? null,
};
```

For the legacy success return (around line 165):
```typescript
return {
  leadStatus: userAccount.bitrix24_default_lead_status ?? null,
  dealCategory: userAccount.bitrix24_default_deal_category ?? null,
  dealStage: userAccount.bitrix24_default_deal_stage ?? null,
  sourceId: userAccount.bitrix24_default_source_id ?? null,
  facebookSourceId: (userAccount as any).bitrix24_facebook_source_id ?? null,
  tiktokSourceId: (userAccount as any).bitrix24_tiktok_source_id ?? null,
};
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
cd services/agent-service && npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/agent-service/src/workflows/bitrix24Sync.ts
git commit -m "feat: getDefaultStageSettings returns facebookSourceId and tiktokSourceId"
```

---

## Task 3: Backend — use correct source in `pushLeadToBitrix24Direct()` and `syncLeadToBitrix24()`

**Files:**
- Modify: `services/agent-service/src/workflows/bitrix24Sync.ts`

Logic: `facebookSourceId` → use for FB leads (`utm_source = 'facebook_lead_form'`); `tiktokSourceId` → use for TikTok leads (`utm_source = 'tiktok_instant_form'`); fall back to `sourceId` (legacy), then `'WEB'`.

- [ ] **Step 1: Add a helper to pick the correct source ID**

Add this function right after `getDefaultStageSettings()` (around line 172, before `extractName`):

```typescript
/**
 * Pick the correct Bitrix24 SOURCE_ID based on lead platform.
 * Priority: platform-specific → default → 'WEB'
 */
function pickSourceId(
  settings: { sourceId: string | null; facebookSourceId: string | null; tiktokSourceId: string | null },
  utmSource: string | null | undefined
): string {
  if (utmSource === 'tiktok_instant_form' && settings.tiktokSourceId) {
    return settings.tiktokSourceId;
  }
  if (utmSource === 'facebook_lead_form' && settings.facebookSourceId) {
    return settings.facebookSourceId;
  }
  return settings.sourceId || 'WEB';
}
```

- [ ] **Step 2: Use `pickSourceId` in `pushLeadToBitrix24Direct()`**

In `pushLeadToBitrix24Direct()`, after loading `defaultStageSettings` (around line 239), add:

```typescript
const resolvedSourceId = pickSourceId(defaultStageSettings, leadData.utm_source);
```

Then replace all occurrences of `defaultStageSettings.sourceId || 'WEB'` in this function with `resolvedSourceId`. There are 3 occurrences (lines ~300, ~338, ~367). Also update the `sourceIdToSet` variable near the re-apply delay:

```typescript
// Before (line ~386):
const sourceIdToSet = defaultStageSettings.sourceId || 'WEB';
// After:
const sourceIdToSet = resolvedSourceId;
```

- [ ] **Step 3: Use `pickSourceId` in `syncLeadToBitrix24()` (legacy function)**

In `syncLeadToBitrix24()`, after loading `defaultStageSettings`, add:

```typescript
const resolvedSourceId = pickSourceId(defaultStageSettings, lead.utm_source);
```

Then replace all `defaultStageSettings.sourceId || 'WEB'` in this function with `resolvedSourceId`. There are 4 occurrences (lines ~624, ~672, ~705, ~735-related). Also update `sourceIdToSet` and `sourceIdToSet2` variables:

```typescript
const sourceIdToSet = resolvedSourceId;
// ...
const sourceIdToSet2 = resolvedSourceId;
```

- [ ] **Step 4: Build to verify**

```bash
cd services/agent-service && npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/agent-service/src/workflows/bitrix24Sync.ts
git commit -m "feat: pick Bitrix24 SOURCE_ID per platform (facebook vs tiktok) with fallback to default"
```

---

## Task 4: Backend — `/bitrix24/default-stage` GET and PATCH with new fields

**Files:**
- Modify: `services/agent-service/src/routes/bitrix24Pipelines.ts`

- [ ] **Step 1: Update GET `/bitrix24/default-stage` response**

In the GET handler (around line 1683), find where the response is sent. In multi-account path (around line 1733) and legacy path (around line 1743), add `facebookSourceId` and `tiktokSourceId` to the response object.

Multi-account return (replace existing):
```typescript
return reply.send({
  entityType: adAccount.bitrix24_entity_type || 'lead',
  leadStatus: adAccount.bitrix24_default_lead_status ?? null,
  dealCategory: adAccount.bitrix24_default_deal_category ?? null,
  dealStage: adAccount.bitrix24_default_deal_stage ?? null,
  sourceId: adAccount.bitrix24_default_source_id ?? null,
  facebookSourceId: (adAccount as any).bitrix24_facebook_source_id ?? null,
  tiktokSourceId: (adAccount as any).bitrix24_tiktok_source_id ?? null,
});
```

Legacy return (replace existing):
```typescript
return reply.send({
  entityType: userAccount.bitrix24_entity_type || 'lead',
  leadStatus: userAccount.bitrix24_default_lead_status ?? null,
  dealCategory: userAccount.bitrix24_default_deal_category ?? null,
  dealStage: userAccount.bitrix24_default_deal_stage ?? null,
  sourceId: userAccount.bitrix24_default_source_id ?? null,
  facebookSourceId: (userAccount as any).bitrix24_facebook_source_id ?? null,
  tiktokSourceId: (userAccount as any).bitrix24_tiktok_source_id ?? null,
});
```

- [ ] **Step 2: Update PATCH `/bitrix24/default-stage` to accept and save new fields**

Find the Zod schema for the PATCH body (search for `z.object` near line 1757). Add two optional fields:

```typescript
facebookSourceId: z.string().nullable().optional(),
tiktokSourceId: z.string().nullable().optional(),
```

Find the destructuring of `parsed.data` (around line 1782):
```typescript
const { userAccountId, accountId, leadStatus, dealCategory, dealStage, sourceId } = parsed.data;
```
Add the new fields:
```typescript
const { userAccountId, accountId, leadStatus, dealCategory, dealStage, sourceId, facebookSourceId, tiktokSourceId } = parsed.data;
```

In the `updateData` builder block (after line 1811), add:
```typescript
if (facebookSourceId !== undefined) {
  updateData.bitrix24_facebook_source_id = facebookSourceId;
}
if (tiktokSourceId !== undefined) {
  updateData.bitrix24_tiktok_source_id = tiktokSourceId;
}
```

- [ ] **Step 3: Also update the SELECT queries in the GET handler to include new columns**

Find the multi-account SELECT (around line 1716):
```typescript
.select('bitrix24_entity_type, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id')
```
Replace with:
```typescript
.select('bitrix24_entity_type, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id, bitrix24_facebook_source_id, bitrix24_tiktok_source_id')
```

Find the legacy SELECT (around line 1699):
```typescript
.select('multi_account_enabled, bitrix24_entity_type, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id')
```
Replace with:
```typescript
.select('multi_account_enabled, bitrix24_entity_type, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage, bitrix24_default_source_id, bitrix24_facebook_source_id, bitrix24_tiktok_source_id')
```

- [ ] **Step 4: Build**

```bash
cd services/agent-service && npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/agent-service/src/routes/bitrix24Pipelines.ts
git commit -m "feat: /bitrix24/default-stage GET/PATCH support facebookSourceId and tiktokSourceId"
```

---

## Task 5: Frontend — API client types

**Files:**
- Modify: `services/frontend/src/services/bitrix24Api.ts`

- [ ] **Step 1: Update `DefaultStageSetting` interface (around line 618)**

```typescript
export interface DefaultStageSetting {
  entityType: 'lead' | 'deal' | 'both';
  leadStatus: string | null;
  dealCategory: number | null;
  dealStage: string | null;
  sourceId: string | null;
  facebookSourceId: string | null;  // NEW
  tiktokSourceId: string | null;    // NEW
}
```

- [ ] **Step 2: Update the PATCH payload type in `setBitrix24DefaultStage` (around line 731)**

Find the inline type or interface for the settings parameter:
```typescript
sourceId?: string | null;
```
Add after it:
```typescript
facebookSourceId?: string | null;
tiktokSourceId?: string | null;
```

- [ ] **Step 3: TypeScript check**

```bash
cd services/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors related to `DefaultStageSetting`.

- [ ] **Step 4: Commit**

```bash
git add services/frontend/src/services/bitrix24Api.ts
git commit -m "feat: add facebookSourceId and tiktokSourceId to Bitrix24 API client types"
```

---

## Task 6: Frontend — Profile UI: two source dropdowns

**Files:**
- Modify: `services/frontend/src/pages/Profile.tsx`

- [ ] **Step 1: Add state variables (around line 240, after `defaultSourceId` state)**

Find:
```typescript
const [defaultSourceId, setDefaultSourceId] = useState<string | null>(null);
```
Add after it:
```typescript
const [facebookSourceId, setFacebookSourceId] = useState<string | null>(null);
const [tiktokSourceId, setTiktokSourceId] = useState<string | null>(null);
```

- [ ] **Step 2: Load new values from API response (around line 1140)**

Find:
```typescript
setDefaultSourceId(defaults.sourceId);
```
Add after it:
```typescript
setFacebookSourceId(defaults.facebookSourceId ?? null);
setTiktokSourceId(defaults.tiktokSourceId ?? null);
```

- [ ] **Step 3: Add handlers (after `handleSourceIdChange` around line 1202)**

```typescript
const handleFacebookSourceIdChange = (value: string) => {
  setFacebookSourceId(value || null);
  setDefaultStagesDirty(true);
};

const handleTiktokSourceIdChange = (value: string) => {
  setTiktokSourceId(value || null);
  setDefaultStagesDirty(true);
};
```

- [ ] **Step 4: Include new fields in save (around line 1236)**

Find:
```typescript
updateData.sourceId = defaultSourceId;
```
Add after it:
```typescript
updateData.facebookSourceId = facebookSourceId;
updateData.tiktokSourceId = tiktokSourceId;
```

Also update the TypeScript type annotation for `updateData` on line ~1225:
```typescript
const updateData: {
  leadStatus?: string | null;
  dealCategory?: number | null;
  dealStage?: string | null;
  sourceId?: string | null;
  facebookSourceId?: string | null;
  tiktokSourceId?: string | null;
} = {};
```

- [ ] **Step 5: Replace the single source dropdown with two (around line 2488)**

Replace the entire `{/* Источник в Bitrix24 */}` block (lines 2487-2508):

```tsx
{/* Источники в Bitrix24 по платформам */}
{bitrix24Sources.length > 0 && (
  <div className="space-y-3">
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Источник Facebook</Label>
      <Select
        value={facebookSourceId || ''}
        onValueChange={handleFacebookSourceIdChange}
        disabled={loadingPipelines}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Не задан (WEB)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Не задан (WEB)</SelectItem>
          {bitrix24Sources.map((source) => (
            <SelectItem key={source.statusId} value={source.statusId}>
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Источник TikTok</Label>
      <Select
        value={tiktokSourceId || ''}
        onValueChange={handleTiktokSourceIdChange}
        disabled={loadingPipelines}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Не задан (WEB)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Не задан (WEB)</SelectItem>
          {bitrix24Sources.map((source) => (
            <SelectItem key={source.statusId} value={source.statusId}>
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
)}
```

- [ ] **Step 6: TypeScript check**

```bash
cd services/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add services/frontend/src/pages/Profile.tsx
git commit -m "feat: separate Bitrix24 source dropdowns for Facebook and TikTok in Profile UI"
```

---

## Task 7: Build, Docker rebuild, smoke test

- [ ] **Step 1: Build backend**

```bash
cd services/agent-service && npm run build
```

Expected: no errors.

- [ ] **Step 2: Build frontend**

```bash
cd services/frontend && npm run build
```

Expected: no errors, `dist/` updated.

- [ ] **Step 3: Docker rebuild**

```bash
cd /path/to/monorepo && docker-compose build agent-service frontend && docker-compose up -d agent-service frontend
```

- [ ] **Step 4: Smoke test — GET default-stage returns new fields**

```bash
# Replace UUID with a real userAccountId from the DB
curl -s "http://localhost:8082/bitrix24/default-stage?userAccountId=36f011b1-0ae7-4b9d-aaee-c979a295ed11&accountId=91454447-2906-4d89-892b-12c817584b0f" | jq .
```

Expected response includes:
```json
{
  "sourceId": "...",
  "facebookSourceId": null,
  "tiktokSourceId": null,
  ...
}
```

- [ ] **Step 5: Smoke test — PATCH saves new fields**

```bash
curl -s -X PATCH http://localhost:8082/bitrix24/default-stage \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "36f011b1-0ae7-4b9d-aaee-c979a295ed11",
    "accountId": "91454447-2906-4d89-892b-12c817584b0f",
    "facebookSourceId": "UC_8NJU8B",
    "tiktokSourceId": "WEB"
  }' | jq .
```

Expected: `{ "success": true }` (or similar success response).

- [ ] **Step 6: Verify GET returns saved values**

```bash
curl -s "http://localhost:8082/bitrix24/default-stage?userAccountId=36f011b1-0ae7-4b9d-aaee-c979a295ed11&accountId=91454447-2906-4d89-892b-12c817584b0f" | jq '{facebookSourceId: .facebookSourceId, tiktokSourceId: .tiktokSourceId}'
```

Expected:
```json
{
  "facebookSourceId": "UC_8NJU8B",
  "tiktokSourceId": "WEB"
}
```

> ⚠️ This smoke test works fully only AFTER migration 249 is applied on the DB. Before that, new fields return `null` (columns don't exist yet). You can still verify the API shape.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete per-platform Bitrix24 source selection (FB + TikTok)"
```

---

## Notes for the implementer

**Migration must be applied first** — tasks 2–6 can be implemented and tested locally before the migration is applied (new columns return `null` gracefully). The UI will show the dropdowns but saving will silently do nothing until the DB has the columns. Tell the user to apply `migrations/249_bitrix24_per_platform_source.sql` in Supabase before testing end-to-end.

**Backward compatibility** — `bitrix24_default_source_id` is preserved as fallback. If a user never sets `facebookSourceId` or `tiktokSourceId`, the old single source still works exactly as before.

**`(adAccount as any)`** — used because Supabase's generated types won't know about the new columns until the migration is applied and types regenerated. This is intentional and safe here.
