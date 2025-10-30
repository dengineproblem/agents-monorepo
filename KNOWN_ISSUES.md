# Known Issues

## 1. Creative Test UI - Cancel Button Not Showing

**Status:** 🔴 Not Fixed
**Priority:** High
**Date Reported:** 2025-10-30
**Affected:** Frontend UI for creative tests

### Symptom

1. Infinite loading spinner shows for creatives with active tests in the table view
2. "Cancel Test" / "Остановить тест" button doesn't appear even when accordion is expanded
3. Notification "Test already running for this creative" appears when trying to create new test
4. User cannot stop running tests from UI

### Root Cause

**Problem:** Analytics API endpoint returns 409 error instead of proper data structure

Frontend component `Creatives.tsx` (lines 615-634) renders Cancel button only if:
```typescript
const hasTest = analytics?.test?.exists || false;

{hasTest && (
  <Button onClick={handleStopTest}>
    Остановить тест
  </Button>
)}
```

The `analytics` object is loaded from API:
```
GET /api/analyzer/creative-analytics/{creativeId}?user_id={userId}
```

**Expected Response:**
```json
{
  "test": {
    "exists": true,
    "status": "running",
    "started_at": "2025-10-30T12:21:13.628+00:00",
    "metrics": {...}
  },
  "production": {...},
  "analysis": {...}
}
```

**Actual Response (when test is running):**
```json
{
  "success": false,
  "error": "Test already running for this creative",
  "tests": [{
    "id": "uuid",
    "status": "running",
    "adset_id": "...",
    "ad_id": "...",
    "started_at": "..."
  }],
  "can_force": true
}
```

**Impact:**
- Frontend receives 409 error
- Error is caught and `analytics` becomes `null` (see Creatives.tsx lines 260-292)
- `hasTest` evaluates to `false`
- Cancel button doesn't render
- User is stuck with running test and no way to stop it from UI

### Secondary Issue: No Status Refresh

Test statuses are loaded **once** on page mount via `useUserCreatives` hook and never updated:

```typescript
// useUserCreatives.ts lines 14-19
if (data.length > 0) {
  const creativeIds = data.map(c => c.id);
  const statuses = await creativesApi.getCreativeTestStatuses(creativeIds);
  setTestStatuses(statuses); // Frozen! Never updates
}
```

**Result:**
- Loading spinner keeps spinning even after test completes
- User must refresh page to see status updates
- No polling or real-time subscription mechanism

### Workaround

Currently **NO WORKAROUND** available in UI. User must:
1. Manually query database to find test ID
2. Make direct API call to stop test: `DELETE /api/creative-test/{creativeId}?user_id={userId}`

### Required Fix

**Option A: Fix Analytics API (Recommended)**
- Analytics API endpoint should return proper `CreativeAnalytics` object even for running tests
- Include `test: { exists: true, status: "running", ... }` in response
- Don't return 409 error for analytics requests

**Option B: Fix Frontend Error Handling**
- Parse 409 error response and extract test data
- Set `analytics.test` from error response `tests` array
- Allow Cancel button to show even when analytics fetch fails

**Option C: Add Direct Status Check**
- Add separate endpoint: `GET /api/creative-test/status/{creativeId}`
- Frontend loads test status independently from analytics
- Show Cancel button based on this status, not analytics

**Additional Improvements:**
1. Add polling to refresh test statuses every 30 seconds
2. Use Supabase Realtime subscriptions for instant updates
3. Show test progress (impressions, spend) instead of just spinner
4. Add manual "Refresh" button for status updates

### Related Files

**Frontend:**
- `/services/frontend/src/pages/Creatives.tsx` (lines 615-634: Cancel button, line 509: hasTest condition)
- `/services/frontend/src/hooks/useUserCreatives.ts` (lines 14-19: status loading, no polling)
- `/services/frontend/src/services/creativeAnalyticsApi.ts` (lines 84-109: API call)

**Backend:**
- `/services/agent-service/src/routes/creativeTest.ts` (Creative test endpoints)
- Analytics API endpoint implementation (needs investigation - may be in agent-brain service)

### Test Data for Reproduction

```
user_id: 2213ac57-5358-45b2-81a5-9f9add2e4bba
user_creative_id (with active test): 044386a2-de8b-465e-8b9c-8cdd36cfe47a
direction_id: 54ec5ba4-2c38-4251-beb6-4bdffa32f467
```

**API Call to Reproduce:**
```bash
curl 'http://localhost:3001/api/analyzer/creative-analytics/044386a2-de8b-465e-8b9c-8cdd36cfe47a?user_id=2213ac57-5358-45b2-81a5-9f9add2e4bba'
```

**Supabase Query:**
```sql
SELECT * FROM creative_tests
WHERE user_creative_id = '044386a2-de8b-465e-8b9c-8cdd36cfe47a'
ORDER BY created_at DESC;
```

---

## Future Issues

Add new issues below with the same format:
- Status (🔴 Not Fixed / 🟡 In Progress / 🟢 Fixed)
- Priority (Low/Medium/High/Critical)
- Date, Symptom, Root Cause, Workaround, Required Fix
