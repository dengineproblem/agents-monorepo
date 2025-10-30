# Known Issues

## 1. Creative Test UI - Cancel Button Not Showing

**Status:** 🟢 Partially Fixed (2025-10-30)
**Priority:** High
**Date Reported:** 2025-10-30
**Date Fixed:** 2025-10-30 (Partial)
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

**✅ FIXED:** Added Supabase Realtime subscription (2025-10-30)
- Real-time updates when test status changes
- No page refresh needed
- See `SESSION_2025-10-30_UI_IMPROVEMENTS.md` for details

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

**Additional Improvements (ALL IMPLEMENTED 2025-10-30):**
1. ✅ Add polling to refresh test statuses every 30 seconds - **DONE**
2. ✅ Use Supabase Realtime subscriptions for instant updates - **DONE**
3. ✅ Show test progress (impressions, spend) instead of just spinner - **DONE** (shows "450/1,000")
4. ✅ Add manual "Refresh" button for status updates - **DONE**

See `SESSION_2025-10-30_UI_IMPROVEMENTS.md` for complete implementation details.

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

## 2. Mobile Layout Broken by Long Creative Names

**Status:** 🟢 Fixed (2025-10-30)
**Priority:** Medium
**Date Reported:** 2025-10-30
**Date Fixed:** 2025-10-30
**Affected:** Mobile/responsive layout on Creatives page

### Symptom

1. Long creative names (e.g., `copy_7FC6DB56-FB49-49D4-97CD-D6710EC839B5.mov`) pushed other elements off screen
2. Direction badges took too much horizontal space on mobile
3. Test status indicators and date overlapped or disappeared
4. Layout became completely unusable on screens < 640px

### Root Cause

```tsx
<AccordionTrigger className="flex-shrink-0">  // ❌ Never shrinks!
  <div className="font-medium">{it.title}</div>  // ❌ No truncation!
</AccordionTrigger>
```

- AccordionTrigger had `flex-shrink-0` preventing compression
- Title div had no `truncate` or `max-width` limiting
- Direction badges showed full text on all screen sizes
- No responsive design considerations

### Fix Implemented

**A) Title truncation with responsive max-width:**
```tsx
<AccordionTrigger className="min-w-0">
  <div className="truncate max-w-[200px] sm:max-w-none" title={it.title}>
    {it.title}
  </div>
</AccordionTrigger>
```
- Mobile: max 200px then "..."
- Desktop: unlimited
- Tooltip shows full name on hover

**B) Direction badges → Color dots on mobile:**
```tsx
{/* Mobile */}
<div className="sm:hidden w-3 h-3 rounded-full"
     style={{ backgroundColor: getDirectionDotColor(dir.id) }}
     title={dir.name} />

{/* Desktop */}
<Badge className="hidden sm:inline-flex">{dir.name}</Badge>
```
- Mobile: 12px colored circle (saves ~80px per row)
- Desktop: full badge with text
- Consistent colors using hex values

**C) Flex-shrink protection for indicators:**
```tsx
<div className="flex-shrink-0">
  <TestStatusIndicator ... />
</div>
<div className="flex-shrink-0">
  <DirectionBadge ... />
</div>
```

### Result

✅ Mobile layout compact and functional
✅ All information visible without horizontal scroll
✅ Direction colors preserved (dots match badge colors)
✅ Desktop layout unchanged (full information)

### Related Files

- `/services/frontend/src/pages/Creatives.tsx` - Layout fixes
- `/services/frontend/src/components/TestStatusIndicator.tsx` - Responsive props
- `SESSION_2025-10-30_UI_IMPROVEMENTS.md` - Full documentation

---

## Future Issues

Add new issues below with the same format:
- Status (🔴 Not Fixed / 🟡 In Progress / 🟢 Fixed)
- Priority (Low/Medium/High/Critical)
- Date, Symptom, Root Cause, Workaround, Required Fix
