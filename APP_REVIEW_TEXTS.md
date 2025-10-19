# 📝 ТЕКСТЫ ДЛЯ FACEBOOK APP REVIEW ФОРМЫ

Эти тексты нужно вставить в форму App Review для каждого запрашиваемого разрешения.

---

## 1️⃣ `public_profile` — Public Profile

### Tell us how your app uses this permission

```
Our app uses the public_profile permission to identify users and personalize their experience. 

Specifically, we use this permission to:
- Display the user's name in the app header and profile section
- Show the user's profile picture (optional)
- Identify which Facebook account is connected to our platform

This information is used solely for user identification and interface personalization. We do not share, sell, or use this data for any other purposes.

User value: Users can easily identify which Facebook account they're managing through our platform. This prevents confusion when managing multiple accounts.
```

### Please provide step-by-step instructions

```
1. Open the app at https://performanteaiagency.com/login
2. Click "Connect with Facebook" button
3. Facebook OAuth dialog appears requesting public_profile access
4. User clicks "Continue" to authorize
5. User is redirected back to the app
6. User selects their Ad Account and Facebook Page from dropdowns
7. User clicks "Save Selection"
8. User's name from public profile appears in the Dashboard header
9. User can view their connected account details in Profile page

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]
```

---

## 2️⃣ `business_management` — Business Management

### Tell us how your app uses this permission

```
Our app uses the business_management permission to retrieve the list of Ad Accounts and Facebook Pages that the user has access to through their Facebook Business Manager.

Specifically, we use this permission to:
- Fetch all Ad Accounts the user manages
- Retrieve all Facebook Pages the user has access to
- Allow users to select which specific account they want to manage through our platform
- Display account names and IDs for user selection

We only READ the list of available accounts. We do NOT modify, create, or delete any business assets, accounts, or settings. The user has full control over which specific account they want to connect to our platform.

User value: Users with access to multiple ad accounts can easily see all available options and choose which one to manage. This is essential for agencies and businesses managing multiple clients.
```

### Please provide step-by-step instructions

```
1. Login at https://performanteaiagency.com/login
2. Navigate to Profile page (menu: Profile)
3. Click "Connect" button on "Facebook Ads" card
4. Facebook OAuth dialog appears requesting business_management access
5. User clicks "Continue" to authorize
6. User is redirected back to Profile page
7. A modal window appears showing:
   - Dropdown with ALL Ad Accounts the user manages (fetched via business_management)
   - Dropdown with ALL Facebook Pages the user manages (fetched via business_management)
   - Search/filter functionality for easy account selection
8. User selects their preferred Ad Account from the list
9. User selects their preferred Facebook Page from the list
10. User clicks "Save Selection"
11. The connection is saved and the user can now manage that specific ad account

The app displays the selected account information in the Profile page, confirming which account is currently connected.

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test user should have access to at least 2-3 ad accounts to demonstrate the selection functionality.
```

---

## 3️⃣ `pages_show_list` — Show List of Pages

### Tell us how your app uses this permission

```
Our app uses the pages_show_list permission to retrieve the list of Facebook Pages that the user manages. This is necessary because Facebook Ads campaigns can be linked to specific Facebook Pages.

Specifically, we use this permission to:
- Display a list of all Facebook Pages the user manages
- Allow users to select which Page should be associated with their ad campaigns
- Detect if a Page has an Instagram Business Account linked (for Instagram campaign management)
- Show Page names and IDs in the account selection interface

We only READ the list of pages. We do NOT post to pages, modify page settings, or access page content. The permission is used exclusively for retrieving the list of available pages for ad campaign association.

User value: Users can see all their Facebook Pages in one place and select the correct page for their advertising campaigns. This is essential for businesses running ads that promote their Facebook Page or drive traffic to Instagram.
```

### Please provide step-by-step instructions

```
1. Login at https://performanteaiagency.com/login
2. Navigate to Profile page
3. In the "Platform Connections" section, click "Connect" on "Facebook Ads" card
4. Facebook OAuth dialog appears requesting pages_show_list permission
5. User clicks "Continue" to authorize
6. After authorization, a modal window displays:
   - "Select Facebook Page" dropdown
7. Click the dropdown to see ALL Facebook Pages retrieved via pages_show_list
8. The list shows:
   - Page name
   - Page ID
   - Instagram indicator (✓ IG) if the page has Instagram Business Account linked
9. User can use search/filter to find specific pages
10. User selects their preferred page
11. User clicks "Save Selection"
12. The selected page is saved and will be used for ad campaign management

The Profile page now shows the connected Facebook Page name and confirms the connection.

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test user should manage at least 2-3 Facebook Pages to demonstrate the list functionality.
```

---

## 4️⃣ `pages_manage_ads` — Manage Ads for Pages

### Tell us how your app uses this permission

```
Our app uses the pages_manage_ads permission to create and manage advertising campaigns that are associated with the user's Facebook Pages.

Specifically, we use this permission to:
- Create ad campaigns that promote a Facebook Page
- Manage ads that drive traffic to Instagram accounts linked to a Facebook Page
- Pause or resume campaigns running ads on behalf of a user's Page
- View which Page is associated with existing campaigns

All ad creation and management actions require explicit user confirmation. Users manually trigger each action (pause, resume, create) through the interface. Nothing happens automatically.

User value: Users can manage their page-based advertising campaigns from a single dashboard. This simplifies campaign management for businesses using Facebook and Instagram advertising.
```

### Please provide step-by-step instructions

```
1. Login at https://performanteaiagency.com/login
2. Complete Facebook connection (if not already connected) to authorize pages_manage_ads
3. Dashboard displays a list of existing campaigns linked to the user's Facebook Page
4. Click on any campaign to view details
5. Campaign detail page shows:
   - Campaign name and objective
   - Associated Facebook Page ID
   - Associated Instagram Account ID (if applicable)
   - Campaign status (ACTIVE/PAUSED)
   - Performance metrics
6. To pause a campaign:
   - Click the toggle switch next to the campaign
   - Confirmation dialog appears: "Are you sure you want to pause this campaign?"
   - Click "Confirm"
   - Campaign status changes to PAUSED via pages_manage_ads permission
7. To resume a campaign:
   - Find a paused campaign
   - Click the toggle switch
   - Confirm the action
   - Campaign status changes to ACTIVE

All actions require explicit user confirmation before execution.

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test account should have at least 1-2 active campaigns associated with a Facebook Page.
```

---

## 5️⃣ `ads_read` — Read Ad Campaign Data

### Tell us how your app uses this permission

```
Our app uses the ads_read permission to retrieve campaign performance data and display analytics to help users make informed advertising decisions.

Specifically, we use this permission to:
- Fetch campaign metrics: spend, impressions, clicks, conversions, CPL, CTR, CPM
- Display campaign performance over different time periods (daily, weekly, monthly)
- Show ad set level metrics and individual ad performance
- Generate charts and graphs showing spend trends and conversion rates
- Allow users to filter data by date ranges

This is a READ-ONLY permission. We do not modify any campaign settings or spend budgets. We only retrieve and display data to help users analyze their advertising performance.

User value: Users can see comprehensive analytics for their ad campaigns in an easy-to-understand dashboard. This helps them identify successful campaigns and make data-driven optimization decisions.
```

### Please provide step-by-step instructions

```
1. Login at https://performanteaiagency.com/login
2. Complete Facebook connection to authorize ads_read permission
3. Dashboard loads and displays Summary Statistics fetched via ads_read:
   - Total Spend (sum across all campaigns)
   - Total Impressions
   - Total Clicks
   - Cost Per Lead (CPL)
   - Click-Through Rate (CTR)
   - Cost Per 1000 Impressions (CPM)
4. Scroll down to view Campaign List showing:
   - Campaign names
   - Individual campaign spend
   - Leads/conversions
   - CPL per campaign
5. Click on any campaign to view detailed analytics:
   - Performance graphs (spend over time, conversions)
   - Detailed metrics breakdown
   - Ad set level performance
   - Individual ad performance (if applicable)
6. Use Date Range Picker to filter data:
   - Click calendar icon
   - Select date range (e.g., "Last 7 days", "Last 30 days")
   - Click "Apply"
   - All metrics refresh showing data for selected period
7. All data displayed is fetched in real-time using ads_read permission

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test account should have campaigns with performance data (spend, impressions, conversions) for proper demonstration.
```

---

## 6️⃣ `ads_management` — Manage Ad Campaigns

### Tell us how your app uses this permission

```
Our app uses the ads_management permission to allow users to manage their Facebook ad campaigns directly from our platform.

Specifically, we use this permission to:
- Pause active campaigns
- Resume paused campaigns
- Update ad set daily budgets
- Duplicate successful campaigns for scaling

🔴 IMPORTANT: All actions require explicit user confirmation. Nothing happens automatically. Users must:
1. Manually trigger each action (click pause button, edit budget, etc.)
2. Review the action in a confirmation dialog
3. Click "Confirm" to execute

We do NOT make any automated changes to campaigns. We do NOT use algorithms or AI to modify campaigns without user input. Every single action is user-initiated and requires explicit confirmation.

User value: Users can manage their campaigns efficiently from a single dashboard without switching to Facebook Ads Manager. This saves time and provides a streamlined workflow for campaign optimization.
```

### Please provide step-by-step instructions

```
IMPORTANT: This is the MOST CRITICAL permission. Please review the video demonstration carefully.

1. Login at https://performanteaiagency.com/login
2. Complete Facebook connection to authorize ads_management permission
3. Dashboard displays list of campaigns

ACTION #1 - PAUSE CAMPAIGN:
4. Find an ACTIVE campaign in the list
5. Click the toggle switch next to the campaign
6. Confirmation dialog appears: "Are you sure you want to pause this campaign?"
7. User clicks "Confirm"
8. App sends pause request to Facebook API using ads_management permission
9. Success message displays: "Campaign paused successfully"
10. Campaign status changes to PAUSED in the list

ACTION #2 - RESUME CAMPAIGN:
11. Find a PAUSED campaign
12. Click the toggle switch
13. Confirmation dialog: "Are you sure you want to resume this campaign?"
14. User clicks "Confirm"
15. Campaign status changes to ACTIVE
16. Success message confirms the action

ACTION #3 - CHANGE AD SET BUDGET:
17. Click on an ACTIVE campaign to view details
18. Navigate to Ad Sets section
19. Find an ad set showing current budget (e.g., "$10/day")
20. Click "Edit Budget" button
21. Budget edit dialog appears:
    - Current Budget: $10/day
    - New Budget: [input field]
22. User enters new value: $15
23. User clicks "Save Changes"
24. Confirmation dialog: "Change budget from $10 to $15?"
25. User clicks "Confirm"
26. App sends budget update to Facebook API using ads_management permission
27. Success message: "Budget updated successfully"
28. New budget "$15/day" is displayed

Every action above requires explicit user interaction and confirmation. No automatic changes are made.

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test account should have:
- At least 2 active campaigns (for pause demonstration)
- At least 1 paused campaign (for resume demonstration)
- At least 1 campaign with ad sets (for budget change demonstration)
```

---

## 7️⃣ `Ads Management Standard Access` — Standard API Access

### Tell us how your app uses this permission

```
Our app requests Ads Management Standard Access to increase API rate limits for serving users with large ad accounts and multiple campaigns.

Why Standard Access is necessary:

1. Multiple API Calls Per User Session:
   - Fetching 10+ campaigns simultaneously
   - Loading ad set breakdowns for each campaign (5-10 ad sets per campaign)
   - Retrieving individual ad performance (3-5 ads per ad set)
   - Historical data for 30+ days
   
   Total: 100+ API calls per user session

2. Real-Time Data Refresh:
   - Users expect up-to-date metrics
   - Dashboard refreshes data every 5-10 minutes
   - Multiple users accessing the platform simultaneously

3. Agency Use Case:
   - Marketing agencies manage 20+ client accounts
   - Each client has 5-10 active campaigns
   - Total API calls scale with number of clients

Without Standard Access, we would hit rate limits quickly, causing:
- Slow loading times
- Incomplete data
- Error messages
- Poor user experience

Standard Access ensures smooth, reliable operation for professional advertisers and agencies.
```

### Please provide step-by-step instructions

```
Standard Access is not a separate permission that requires UI demonstration. Instead, it's an access level that enables higher API rate limits.

To demonstrate why we need Standard Access:

1. Login at https://performanteaiagency.com/login
2. Complete Facebook connection
3. Dashboard loads - observe that data loads smoothly despite:
   - Multiple campaigns (10+)
   - Summary statistics requiring aggregation
   - Individual campaign metrics
   - Ad set breakdowns
   
4. Click on a campaign to view details
5. Campaign detail page loads quickly showing:
   - Campaign overview
   - Multiple ad sets (5+)
   - Individual ads under each ad set
   - Performance charts and graphs

6. Return to Dashboard
7. Click Date Range Picker
8. Select "Last 30 days"
9. Click "Apply"
10. All metrics refresh quickly without errors or timeouts

Without Standard Access, steps 3, 5, and 10 would fail or timeout due to rate limits.

Our app serves professional advertisers and agencies who need reliable, real-time access to their campaign data. Standard Access ensures we can provide this level of service.

Test Credentials:
Email: [insert your test user email]
Password: [insert test user password]

Note: Test account should have 10+ campaigns to demonstrate the need for higher API limits.
```

---

## 🎯 ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ ДЛЯ APP REVIEW

### App Details

**App Name:** PerformantAI Agency  
**App ID:** 1441781603583445  
**Category:** Business & Pages  
**Public URL:** https://performanteaiagency.com

**Privacy Policy URL:** https://performanteaiagency.com/privacy  
**Terms of Service URL:** https://performanteaiagency.com/terms  
**Data Deletion Callback URL:** https://performanteaiagency.com/api/facebook/data-deletion

### Business Use Case

**Category:** Advertising Management Platform

**Description:**
```
PerformantAI Agency is a Facebook Ads management platform designed for small businesses, entrepreneurs, and marketing agencies. 

Our platform helps users:
- Monitor campaign performance with real-time analytics
- Manage campaigns efficiently (pause, resume, adjust budgets)
- Make data-driven optimization decisions
- Save time by managing ads from a single dashboard

Target audience:
- Small business owners managing their own Facebook advertising
- Marketing agencies managing multiple client accounts
- E-commerce businesses running product ads
- Service providers generating leads through Facebook Ads

All actions are user-initiated and require explicit confirmation. We provide tools to help users make informed decisions, but users maintain full control over their advertising.
```

### Platform Details

**Technology Stack:**
- Frontend: React, TypeScript, Vite
- Backend: Node.js, Fastify
- Database: PostgreSQL (Supabase)
- Deployment: Docker, Nginx

**Security:**
- OAuth 2.0 for Facebook authorization
- Access tokens stored securely in database (encrypted)
- HTTPS/SSL for all connections
- User data deletion callback implemented

### Contact Information

**Business Name:** ИП A-ONE AGENCY  
**Country:** Kazakhstan  
**Support Email:** business@performanteaiagency.com  
**Website:** https://performanteaiagency.com

---

## ✅ ФИНАЛЬНЫЙ ЧЕКЛИСТ

Перед отправкой на App Review убедитесь:

- [ ] Все 7 видео записаны и загружены
- [ ] Все текстовые описания заполнены для каждого permission
- [ ] Тестовый пользователь создан и credentials предоставлены
- [ ] Тестовый Ad Account имеет активные кампании с данными
- [ ] Privacy Policy доступна и работает
- [ ] Terms of Service доступны и работают
- [ ] Data Deletion callback работает
- [ ] Facebook App настроен:
  - App Icon загружен (1024x1024)
  - App Domains настроены
  - Valid OAuth Redirect URIs обновлены
- [ ] Интерфейс приложения на английском языке
- [ ] Все URLs доступны публично (проверено через Facebook Debugger)

---

## 🚀 SUBMISSION

После завершения всех пунктов чеклиста:

1. Перейдите в **App Review → Permissions and Features**
2. Для каждого permission:
   - Нажмите "Request"
   - Вставьте соответствующий текст из этого документа
   - Загрузите соответствующее видео
3. После заполнения всех permissions нажмите **"Submit for Review"**
4. Ожидайте ответа: 3-7 рабочих дней

**Удачи! 🎉**

