# Facebook Marketing API - Error 2446885 "WhatsApp Business Required" - Inconsistent Behavior

## Problem Summary

We're getting error **2446885** ("Требуется Страница с аккаунтом WhatsApp Business" / "WhatsApp Business account required") when creating ad sets via API for one user, but the **EXACT SAME API request structure works perfectly for another user**.

**Critical:** Creating ad sets through Facebook Ads Manager UI works fine for the failing user. The error ONLY occurs via API.

---

## Error Details

**Error Response:**
```json
{
  "error": {
    "message": "Invalid parameter",
    "type": "OAuthException",
    "code": 100,
    "error_subcode": 2446885,
    "is_transient": false,
    "error_user_title": "Требуется Страница с аккаунтом WhatsApp Business",
    "error_user_msg": "Номер WhatsApp, связанный с вашей Страницей, относится к личному аккаунту. Подключите аккаунт WhatsApp Business, чтобы направить трафик в WhatsApp.",
    "fbtrace_id": "AsKfiEctM-vEtCOlrXGuwam"
  }
}
```

---

## API Request Parameters

### Endpoint
```
POST https://graph.facebook.com/v20.0/{ad_account_id}/adsets
```

### Request Body (for BOTH users)

```json
{
  "access_token": "{user_access_token}",
  "name": "Ad Set Name",
  "campaign_id": "{campaign_id}",
  "daily_budget": 1000,
  "billing_event": "IMPRESSIONS",
  "optimization_goal": "CONVERSATIONS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "targeting": {
    "geo_locations": {
      "countries": ["KZ"]
    },
    "age_min": 18,
    "age_max": 65
  },
  "status": "ACTIVE",
  "destination_type": "WHATSAPP",
  "promoted_object": {
    "page_id": "734116649781310",
    "whatsapp_phone_number": "+77006353580"
  }
}
```

---

## Comparison: Working vs Failing User

### ✅ WORKING USER (User A)

**Page ID:** `114323838439928`
**WhatsApp Number:** `+77074094375`
**Campaign ID:** `120235751835060463`

**API Request:**
```json
{
  "optimization_goal": "CONVERSATIONS",
  "destination_type": "WHATSAPP",
  "promoted_object": {
    "page_id": "114323838439928",
    "whatsapp_phone_number": "+77074094375"
  }
}
```

**Result:** ✅ **SUCCESS** - Ad set created successfully

---

### ❌ FAILING USER (User B)

**Page ID:** `734116649781310` (Select Phuket)
**WhatsApp Number:** `+77006353580`
**WhatsApp Business Account ID:** `792684993372941`
**Campaign ID:** `120234472620180097`

**API Request:**
```json
{
  "optimization_goal": "CONVERSATIONS",
  "destination_type": "WHATSAPP",
  "promoted_object": {
    "page_id": "734116649781310",
    "whatsapp_phone_number": "+77006353580"
  }
}
```

**Result:** ❌ **ERROR 2446885** - "WhatsApp Business account required"

---

## What We've Verified

### Facebook Business Manager Configuration (User B - Failing)

1. ✅ **WhatsApp Business Account exists:** ID `792684993372941`
2. ✅ **Phone number `+77006353580` is configured** in the WhatsApp Business Account
3. ✅ **Page `734116649781310` has WhatsApp connected** (visible in Page settings)
4. ✅ **WhatsApp number is set as PRIMARY** for the Page
5. ✅ **Creating ad sets through Facebook Ads Manager UI WORKS** with this exact page and phone number
6. ✅ **The number is WhatsApp Business, NOT personal account**

### API Implementation

1. ✅ Both users use **identical API request structure**
2. ✅ Both send `destination_type: "WHATSAPP"`
3. ✅ Both send `promoted_object` with `page_id` and `whatsapp_phone_number`
4. ✅ Both use `optimization_goal: "CONVERSATIONS"`
5. ✅ Campaigns are created with `objective: "OUTCOME_TRAFFIC"` and `special_ad_categories: []`

### Logs Verification

**Working User (logs):**
```json
{
  "phone_number": "+77074094375",
  "source": "direction",
  "promoted_object": {
    "page_id": "114323838439928",
    "whatsapp_phone_number": "+77074094375"
  },
  "message": "Ad set created successfully"
}
```

**Failing User (logs):**
```json
{
  "phone_number": "+77006353580",
  "source": "direction",
  "promoted_object": {
    "page_id": "734116649781310",
    "whatsapp_phone_number": "+77006353580"
  },
  "error_subcode": 2446885
}
```

---

## Questions for Facebook API Specialist

1. **Why does the EXACT SAME request structure work for User A but fail for User B?**

2. **What additional Page/WhatsApp Business Account permissions or configurations might be missing for User B that are present for User A?**

3. **Is there a required field we're missing in `promoted_object` for certain WhatsApp configurations?** For example:
   - Should we include `application_id` (WhatsApp Business Account ID)?
   - Is `whatsapp_business_account_id` required in some cases?

4. **Could this be related to:**
   - Page verification status?
   - WhatsApp Business Account verification status?
   - Business Manager configuration differences?
   - Page role permissions?
   - Ad Account permissions?

5. **How can we debug this further?** Is there a way to:
   - Check if the Page → WhatsApp Business Account connection is properly established via API?
   - Verify the WhatsApp Business Account status programmatically?
   - Get more detailed error information from Facebook?

6. **Why does Facebook Ads Manager UI succeed with the same Page/Number combination while API fails?**

---

## Additional Context

### Campaign Configuration (Both users)

```json
{
  "objective": "OUTCOME_TRAFFIC",
  "status": "ACTIVE",
  "special_ad_categories": []
}
```

### Graph API Version
`v20.0`

### Access Token Scope
User access token with permissions:
- `ads_management`
- `ads_read`
- `business_management`
- `pages_read_engagement`
- `pages_manage_ads`

---

## What We're NOT Looking For

- ❌ Alternative API request formats
- ❌ Workarounds using different parameters
- ❌ Suggestions to change the request structure

## What We NEED

- ✅ Understanding of **WHY** the same request works for one user but not another
- ✅ Identification of **WHAT specific configuration/permission** is different between the two users
- ✅ Clear steps to **diagnose and fix** the root cause for the failing user

---

## Reproduction

**Working Request (User A):**
```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/act_{ad_account_id}/adsets" \
  -d "access_token={token}" \
  -d "name=Test Ad Set" \
  -d "campaign_id=120235751835060463" \
  -d "daily_budget=1000" \
  -d "billing_event=IMPRESSIONS" \
  -d "optimization_goal=CONVERSATIONS" \
  -d "destination_type=WHATSAPP" \
  -d "promoted_object={\"page_id\":\"114323838439928\",\"whatsapp_phone_number\":\"+77074094375\"}" \
  -d "targeting={\"geo_locations\":{\"countries\":[\"KZ\"]}}" \
  -d "status=ACTIVE"
```
**Result:** ✅ Success

**Failing Request (User B):**
```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/act_{ad_account_id}/adsets" \
  -d "access_token={token}" \
  -d "name=Test Ad Set" \
  -d "campaign_id=120234472620180097" \
  -d "daily_budget=1000" \
  -d "billing_event=IMPRESSIONS" \
  -d "optimization_goal=CONVERSATIONS" \
  -d "destination_type=WHATSAPP" \
  -d "promoted_object={\"page_id\":\"734116649781310\",\"whatsapp_phone_number\":\"+77006353580\"}" \
  -d "targeting={\"geo_locations\":{\"countries\":[\"KZ\"]}}" \
  -d "status=ACTIVE"
```
**Result:** ❌ Error 2446885

---

## Facebook Trace IDs (Recent Failures)

- `AsKfiEctM-vEtCOlrXGuwam`
- `Ay7COK51Mrr64JCSfyohFdm`
- `A2T9GcvFT4w01-_Sjye2cos`

---

**Thank you for any insights into this inconsistent behavior!**
