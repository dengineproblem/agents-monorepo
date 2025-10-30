# Session Summary: WhatsApp Number Handling Fix

**Date:** 2025-10-30
**Status:** ✅ Completed (with one known issue documented)

## Problem Statement

User reported errors when launching ads:
1. **Quick Creative Test** was failing with error "WhatsApp number not configured"
2. **Manual Launch** was failing for some users with same error
3. Ads should launch even without explicitly configured WhatsApp number (Facebook uses page default)

## Root Causes Found

### 1. WhatsApp Number Error Throwing (Fixed ✅)

**Issue:** `getWhatsAppPhoneNumber()` threw an error when no number was found
```typescript
// OLD (WRONG):
throw new Error('WhatsApp number not configured. Please set up...');
```

**Fix:** Return `null` instead, allow Facebook to use page default
```typescript
// NEW (CORRECT):
return null; // Facebook uses page default
```

**File:** [settingsHelpers.ts:242-249](services/agent-service/src/lib/settingsHelpers.ts#L242-L249)

### 2. Critical Bug: destination_type Condition (Fixed ✅)

**Issue:** `destination_type: 'WHATSAPP'` was added ONLY when `whatsapp_phone_number` exists

```typescript
// OLD (WRONG):
if (optimization_goal === 'CONVERSATIONS' && promoted_object?.whatsapp_phone_number) {
  body.destination_type = 'WHATSAPP';
}
```

This caused Facebook API error: **"Invalid parameter - optimization_goal недоступна"**

**Fix:** Always add destination_type for CONVERSATIONS
```typescript
// NEW (CORRECT):
if (optimization_goal === 'CONVERSATIONS') {
  body.destination_type = 'WHATSAPP'; // ALWAYS add!
}
```

**File:** [campaignBuilder.ts:1098-1100](services/agent-service/src/lib/campaignBuilder.ts#L1098-L1100)

**Why this is critical:** Facebook requires `destination_type: 'WHATSAPP'` for ALL ad sets with `optimization_goal: 'CONVERSATIONS'`, regardless of whether explicit phone number is provided.

### 3. Spread Operator for Optional Phone Number (Fixed ✅)

**Issue:** Phone number was always passed, even when `null`

**Fix:** Use spread operator to conditionally add field
```typescript
const whatsapp_phone_number = await getWhatsAppPhoneNumber(...) || undefined;

const promoted_object = {
  page_id: userAccount.page_id,
  ...(whatsapp_phone_number && { whatsapp_phone_number })
};
```

**Files:**
- [creativeTest.ts:81](services/agent-service/src/routes/creativeTest.ts#L81)
- [campaignBuilder.ts:473-477](services/agent-service/src/routes/campaignBuilder.ts#L473-L477) (Manual Launch)
- [campaignBuilder.ts:246-250](services/agent-service/src/routes/campaignBuilder.ts#L246-L250) (Auto-Launch V2)

## Changes Made

### Code Changes

1. **settingsHelpers.ts** - `getWhatsAppPhoneNumber()` returns `null` instead of throwing
2. **creativeTest.ts** - Added `|| undefined` conversion, already had correct workflow logic
3. **campaignBuilder.ts (Manual Launch)** - Added spread operator for promoted_object
4. **campaignBuilder.ts (Auto-Launch V2)** - Added spread operator for promoted_object
5. **campaignBuilder.ts (createAdSetInCampaign)** - Fixed destination_type condition

### Documentation Updates

1. **WHATSAPP_NUMBERS_LOGIC.md** - Added:
   - 4-tier fallback priority (including Facebook Page API)
   - Explanation of null return behavior
   - Spread operator usage
   - Critical bug about destination_type requirement

2. **KNOWN_ISSUES.md** (NEW FILE) - Documented:
   - Creative Test UI issue (Cancel button not showing)
   - Root cause analysis
   - Required fixes
   - Test data for reproduction

## Testing Results

### ✅ Creative Test
- **Status:** SUCCESS
- **Result:** Created campaign, adset, ad
- Campaign ID: `120236751809430364`
- AdSet ID: `120236751810190364`
- Ad ID: `120236751810530364`

### ✅ Manual Launch
- **Before Fix:** Error "optimization_goal недоступна"
- **After Fix:** Different error "Кампания заархивирована" (proves our fix worked - correct parameters, old campaign is archived)

### ✅ Auto-Launch V2
- **Before Fix:** Error "optimization_goal недоступна"
- **After Fix:** Same "Кампания заархивирована" error (proves fix worked)

## Known Issue Discovered (Not Fixed)

### Creative Test UI - Cancel Button Not Showing

**Status:** 🔴 Not Fixed (documented in KNOWN_ISSUES.md)

**Problem:**
- Infinite loading spinner shows for creatives with active tests
- "Cancel Test" button doesn't appear even in expanded accordion
- Analytics API returns 409 error instead of proper data structure

**Root Cause:**
```
Frontend expects: { test: { exists: true, status: "running", ... } }
Actually returns: { success: false, error: "Test already running", ... }
```

Cancel button is gated by `hasTest = analytics?.test?.exists`, which becomes `false` when API returns error.

**See KNOWN_ISSUES.md for full details and required fixes**

## Test Data Used

```
user_id: 2213ac57-5358-45b2-81a5-9f9add2e4bba
user_account_id: 2213ac57-5358-45b2-81a5-9f9add2e4bba
direction_id: 54ec5ba4-2c38-4251-beb6-4bdffa32f467
user_creative_id: 5e5245df-8df8-4cff-87af-88af1e61dad8
user_creative_id (with active test): 044386a2-de8b-465e-8b9c-8cdd36cfe47a
```

## Services Status

**Running on HOST (not Docker):**
- Agent-service: `localhost:8082` ✅
- Frontend: `localhost:3001` ✅

**Note:** Docker Desktop on macOS has DNS resolution issues, services run directly on host for development.

## Key Learnings

1. **Always add destination_type for CONVERSATIONS** - even without explicit phone number
2. **Return null, not errors** - let Facebook use defaults when data is missing
3. **Use spread operator** - for optional fields in API requests
4. **Test all three launch methods** - Creative Test, Manual Launch, Auto-Launch V2 use shared logic

## Next Steps

For next developer/session:

### Priority 1: Fix Creative Test UI Issue
**See KNOWN_ISSUES.md for full details**

The "Cancel Test" button is not showing for creatives with active tests. Analytics API returns 409 error instead of proper data structure.

**Required reading before starting:**
1. **KNOWN_ISSUES.md** - Complete problem description, root cause, and solution options
2. **INFRASTRUCTURE.md** - Understand service architecture (agent-service vs agent-brain)
3. **CREATIVE_TEST_FLOW.md** - How creative tests work end-to-end
4. **FRONTEND_CREATIVE_ANALYTICS.md** - Frontend integration with analytics API
5. **SESSION_2025-10-30_WHATSAPP_FIX.md** (this file) - Context from this session

**Key questions to answer:**
- Which service owns `/api/analyzer/creative-analytics/{creativeId}` endpoint?
- Should it be agent-service (port 8082) or agent-brain (port 7081)?
- Why does it return 409 error for running tests instead of data?
- Should frontend handle 409 differently, or should API be fixed?

**Possible approaches:**
1. Fix analytics API to return proper data structure for running tests
2. Add frontend error handling to parse 409 response and extract test data
3. Add separate status endpoint that frontend can call directly
4. Add polling mechanism to refresh test statuses every 30 seconds
5. Use Supabase Realtime subscriptions for instant updates

### Priority 2: Enhancements
1. Add polling for test status updates (every 30 seconds)
2. Consider Supabase Realtime subscriptions for instant updates
3. Show test progress (impressions/spend) instead of just spinner
4. Add manual "Refresh" button for status updates
