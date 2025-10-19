# 🎬 СЦЕНАРИИ СКРИНКАСТОВ ДЛЯ FACEBOOK APP REVIEW

**Важно:** Для каждого permission нужен ОТДЕЛЬНЫЙ скринкаст длительностью 2-3 минуты.

---

## 📋 ОБЩАЯ ПОДГОТОВКА ПЕРЕД ЗАПИСЬЮ

### ✅ Что нужно подготовить:

1. **Тестовый пользователь Facebook** (см. раздел "Создание тестового пользователя" ниже)
2. **Тестовый рекламный аккаунт** с активными кампаниями
3. **Очистить браузер:**
   - Закрыть все лишние вкладки
   - Отключить уведомления браузера
   - Скрыть закладки (Cmd+Shift+B на Mac)
4. **Переключить интерфейс на английский язык** (критически важно!)
5. **Подготовить активные кампании** с метриками (spend, impressions, leads)
6. **Инструмент для записи:** QuickTime (Mac), Loom, OBS Studio

### ⚠️ Что НЕ показывать:

- ❌ Автоматический cron (AI Autopilot)
- ❌ Telegram интеграцию
- ❌ Массовые действия (bulk operations)
- ❌ Brain Agent и автоматические решения
- ❌ TikTok интеграцию

### ✅ Что показывать:

- ✅ **Пользовательский контроль** - пользователь сам принимает решения
- ✅ **Одиночные действия** - pause, resume, budget change
- ✅ **Аналитику и метрики** - графики, таблицы
- ✅ **OAuth flow** - подключение Facebook

---

## 🎥 СКРИНКАСТ #1: `public_profile` (базовый профиль)

**Длительность:** 2 минуты  
**Цель:** Показать, что приложение получает базовую информацию профиля для идентификации пользователя.

### Сценарий по секундам:

#### 00:00-00:10 — Открытие приложения
```
1. Открыть https://performanteaiagency.com/login
2. Показать Login форму
```

**Комментарий (английский):**  
*"This is our Facebook Ads management platform. We request public_profile permission to identify the user."*

#### 00:10-00:40 — Логин через Facebook OAuth
```
3. Click "Connect with Facebook" button
4. Facebook OAuth dialog появляется
5. Показать список запрашиваемых разрешений
6. Особо выделить: "Access your public profile" ✓
7. Click "Continue" / "Продолжить"
```

**Комментарий:**  
*"When user clicks Connect with Facebook, we request access to their public profile including name and profile picture. This helps us personalize the user experience and identify the account owner."*

#### 00:40-01:00 — Возврат в приложение
```
8. Redirect обратно на https://performanteaiagency.com/profile
9. Показать модальное окно выбора Ad Account и Page
10. Select any Ad Account from dropdown
11. Select any Page from dropdown
12. Click "Save Selection"
```

**Комментарий:**  
*"After authorization, user returns to our app and selects their ad account and page to manage."*

#### 01:00-01:30 — Профиль пользователя
```
13. Перейти в Profile (если еще не там)
14. Показать секцию с информацией пользователя:
    - Name (из public_profile)
    - Email
    - Facebook Connected ✓
```

**Комментарий:**  
*"The app displays user's name from their public profile. This information is used only for account identification and personalization."*

#### 01:30-02:00 — Dashboard с именем пользователя
```
15. Перейти на Dashboard (/)
16. Показать Header с приветствием: "Welcome, [User Name]"
17. Показать, что имя пользователя отображается в интерфейсе
```

**Комментарий:**  
*"User's name from public profile is displayed in the dashboard header, making it easy to identify which account they're managing. This permission is used solely for user identification and does not access any sensitive data."*

---

## 🎥 СКРИНКАСТ #2: `business_management` (доступ к Business Manager)

**Длительность:** 2-3 минуты  
**Цель:** Показать, как приложение получает список Ad Accounts и Pages через Business Manager.

### Сценарий по секундам:

#### 00:00-00:15 — Контекст
```
1. Открыть https://performanteaiagency.com/login
2. Если уже залогинен - перейти в Profile
```

**Комментарий:**  
*"We request business_management permission to access the list of ad accounts and pages the user has access to through Facebook Business Manager."*

#### 00:15-00:45 — OAuth с business_management
```
3. Click "Connect with Facebook" (если еще не подключен)
4. В Facebook OAuth dialog показать запрашиваемое разрешение:
   - "Manage your business and its assets" ✓
5. Click "Continue"
```

**Комментарий:**  
*"This permission allows us to retrieve the list of ad accounts and pages that the user manages in their Business Manager. We do not modify any business settings - only read the list of available accounts."*

#### 00:45-01:30 — Модальное окно выбора Account
```
6. После redirect показать модальное окно
7. Показать dropdown "Select Ad Account"
8. Открыть dropdown - показать ВСЕ доступные Ad Accounts (должно быть несколько)
9. Показать что есть Search/Filter по названию account
10. Select один Ad Account
11. Показать dropdown "Select Facebook Page"
12. Открыть dropdown - показать ВСЕ доступные Pages
13. Select одну Page
14. Показать автоматическое определение Instagram (если есть иконка ✓ IG)
```

**Комментарий:**  
*"Using business_management permission, we fetch all ad accounts and pages the user has access to. The user can search and select which specific account they want to manage through our platform. If a page has an Instagram Business Account linked, we automatically detect it."*

#### 01:30-02:00 — Сохранение выбора
```
15. Click "Save Selection"
16. Показать успешное сообщение "Facebook account connected successfully"
17. Перейти на Dashboard
18. Показать что выбранный Ad Account теперь активен
```

**Комментарий:**  
*"After selecting their preferred ad account and page, the settings are saved. The user can change this selection at any time from their profile."*

#### 02:00-02:30 — Profile с подключенными аккаунтами
```
19. Перейти обратно в Profile
20. Показать секцию "Platform Connections"
21. Показать карточку "Facebook Ads" со статусом "Connected"
22. Показать информацию о подключенном аккаунте:
    - Ad Account ID
    - Page Name (если отображается)
```

**Комментарий:**  
*"The profile page shows which ad account and page are currently connected. This information is retrieved using business_management permission and allows users to see their active connection at a glance."*

---

## 🎥 СКРИНКАСТ #3: `pages_show_list` (список страниц)

**Длительность:** 2 минуты  
**Цель:** Показать получение списка Facebook Pages.

### Сценарий по секундам:

#### 00:00-00:20 — Зачем нужен pages_show_list
```
1. Открыть Profile страницу
2. Показать секцию "Platform Connections"
```

**Комментарий:**  
*"We request pages_show_list permission to retrieve the list of Facebook Pages the user manages. This is necessary because Facebook Ads campaigns can be linked to specific pages."*

#### 00:20-01:00 — OAuth flow
```
3. Click "Connect" на Facebook Ads карточке (если не подключен)
4. В Facebook OAuth показать:
   - "Show a list of the Pages you manage" ✓
5. Click "Continue"
```

**Комментарий:**  
*"When user authorizes our app, we request permission to see their list of pages. We only read the list - we don't post, modify, or manage the pages themselves."*

#### 01:00-01:40 — Выбор Page из списка
```
6. После redirect показать модальное окно
7. Сфокусироваться на "Select Facebook Page" dropdown
8. Открыть dropdown - показать список всех Pages с:
   - Page name
   - Page ID
   - Instagram indicator (✓ IG если есть)
9. Показать поиск по названию Page
10. Select одну Page
```

**Комментарий:**  
*"Using pages_show_list permission, we display all Facebook Pages the user manages. This allows them to select which page should be associated with their ad campaigns. We also detect if a page has Instagram Business Account linked."*

#### 01:40-02:00 — Подтверждение
```
11. Click "Save Selection"
12. Показать success message
13. Перейти на Dashboard
```

**Комментарий:**  
*"The selected page is saved and will be used when creating ad campaigns. Users can change their page selection anytime from the profile settings."*

---

## 🎥 СКРИНКАСТ #4: `pages_manage_ads` (управление рекламой на Pages)

**Длительность:** 2-3 минуты  
**Цель:** Показать создание рекламы, связанной с Facebook Page.

### Сценарий по секундам:

#### 00:00-00:20 — Контекст
```
1. Dashboard страница
2. Показать список кампаний
```

**Комментарий:**  
*"We request pages_manage_ads permission to create and manage ad campaigns that promote a Facebook Page or drive traffic to Instagram accounts linked to that page."*

#### 00:20-00:50 — OAuth с pages_manage_ads
```
3. Если еще не подключен Facebook - показать OAuth flow:
   - "Manage ads for Pages you manage" ✓
4. Click "Continue"
```

**Комментарий:**  
*"This permission allows us to create ads on behalf of the user's Facebook Page. All ad creation and modifications require explicit user action - nothing happens automatically."*

#### 00:50-01:30 — Просмотр существующей кампании
```
5. На Dashboard показать список кампаний
6. Click на любую ACTIVE кампанию
7. Открывается Campaign Detail страница
8. Показать:
   - Campaign Name
   - Objective (например: "Leads" или "Traffic")
   - Page ID (связанная Page)
   - Instagram Account ID (если есть)
   - Status: ACTIVE
```

**Комментарий:**  
*"This campaign is linked to the user's Facebook Page and Instagram account. Using pages_manage_ads permission, we can view campaign settings including which page is being promoted."*

#### 01:30-02:00 — Показать связь с Page
```
9. Scroll вниз на Campaign Detail
10. Показать секцию "Ad Sets" (если есть)
11. Click на любой Ad Set
12. Показать Targeting settings:
    - Audience
    - Placements (Facebook, Instagram)
    - Page ID
```

**Комментарий:**  
*"Each ad set in the campaign is configured to run ads on behalf of the connected Facebook Page. This permission ensures we can properly link campaigns to the user's page."*

#### 02:00-02:30 — Pause/Resume кампании
```
13. Вернуться на Dashboard
14. Найти ACTIVE кампанию
15. Toggle switch для Pause
16. Показать confirmation dialog: "Are you sure you want to pause this campaign?"
17. Click "Confirm"
18. Показать что статус изменился на PAUSED
```

**Комментарий:**  
*"Users can pause or resume campaigns running ads for their page. All actions require explicit user confirmation. The pages_manage_ads permission allows us to execute these changes on behalf of the user's page."*

---

## 🎥 СКРИНКАСТ #5: `ads_read` (чтение данных рекламы)

**Длительность:** 2-3 минуты  
**Цель:** Показать чтение метрик и статистики кампаний.

### Сценарий по секундам:

#### 00:00-00:15 — Dashboard Overview
```
1. Открыть https://performanteaiagency.com/
2. Показать Dashboard с Summary Stats
```

**Комментарий:**  
*"We request ads_read permission to retrieve campaign performance data from Facebook Marketing API. This allows us to display analytics and help users make informed decisions."*

#### 00:15-00:45 — Summary Statistics
```
3. Показать Summary Stats карточки на Dashboard:
   - Total Spend (общие затраты)
   - Total Impressions (показы)
   - Total Clicks (клики)
   - CPL (Cost Per Lead)
   - CTR (Click-Through Rate)
   - CPM (Cost Per 1000 Impressions)
```

**Комментарий:**  
*"Using ads_read permission, we fetch key metrics from the user's ad account. These metrics include spend, impressions, clicks, and cost per lead. All data is retrieved in real-time from Facebook API."*

#### 00:45-01:15 — Campaigns List с метриками
```
4. Scroll вниз к Campaign List
5. Показать таблицу кампаний с колонками:
   - Campaign Name
   - Status (ACTIVE/PAUSED)
   - Spend ($)
   - Leads
   - CPL ($)
6. Показать несколько кампаний с разными метриками
```

**Комментарий:**  
*"The dashboard displays a list of all campaigns with their performance metrics. This data is fetched using ads_read permission, which gives us read-only access to campaign statistics. We cannot modify campaigns - only view their performance."*

#### 01:15-02:00 — Campaign Detail Analytics
```
7. Click на одну кампанию
8. Открывается Campaign Detail страница
9. Показать детальную аналитику:
   - Campaign performance graph (если есть)
   - Spend over time
   - Leads/conversions chart
   - Detailed metrics breakdown:
     * Impressions
     * Reach
     * Frequency
     * Clicks
     * CPC (Cost Per Click)
     * CTR
     * Conversions
```

**Комментарий:**  
*"Campaign detail page shows in-depth analytics retrieved via ads_read permission. Users can see spend trends, conversion rates, and other performance indicators. This helps them understand which campaigns are performing well."*

#### 02:00-02:30 — Date Range Filter
```
10. Показать Date Range Picker (если есть)
11. Click на календарь
12. Select date range (например, "Last 7 days")
13. Click "Apply"
14. Показать как метрики обновляются
```

**Комментарий:**  
*"Users can filter metrics by date range. The app fetches historical data using ads_read permission, allowing analysis of campaign performance over different time periods."*

---

## 🎥 СКРИНКАСТ #6: `ads_management` (управление рекламой)

**Длительность:** 3 минуты  
**Цель:** Показать создание и управление кампаниями (pause, resume, budget change).

### Сценарий по секундам:

#### 00:00-00:20 — Контекст
```
1. Dashboard страница со списком кампаний
```

**Комментарий:**  
*"We request ads_management permission to allow users to manage their ad campaigns directly from our platform. All actions require explicit user confirmation - nothing happens automatically."*

#### 00:20-01:00 — Pause Campaign (основное действие)
```
2. Найти ACTIVE кампанию в списке
3. Показать toggle switch рядом с кампанией
4. Click toggle чтобы Pause
5. Показать confirmation dialog:
   "Are you sure you want to pause this campaign?"
6. Click "Confirm" / "Yes, Pause"
7. Показать loading spinner
8. Показать success message: "Campaign paused successfully"
9. Статус кампании изменился на PAUSED
```

**Комментарий:**  
*"Users can pause active campaigns by clicking the toggle switch. A confirmation dialog ensures the action is intentional. Once confirmed, we use ads_management permission to send a pause request to Facebook API. The campaign status updates in real-time."*

#### 01:00-01:30 — Resume Campaign
```
10. Найти PAUSED кампанию
11. Click toggle чтобы Resume
12. Confirmation: "Resume this campaign?"
13. Click "Confirm"
14. Статус: ACTIVE
15. Success message
```

**Комментарий:**  
*"Similarly, users can resume paused campaigns. This demonstrates how ads_management permission allows bidirectional control over campaign status."*

#### 01:30-02:20 — Change Ad Set Budget
```
16. Click на ACTIVE кампанию → Campaign Detail
17. Scroll к списку Ad Sets
18. Найти один Ad Set с текущим бюджетом (например "$10/day")
19. Click "Edit Budget" button (или аналогичную кнопку)
20. Показать Budget Change dialog:
    - Current Budget: $10/day
    - New Budget: [input field]
21. Ввести новое значение: $15
22. Click "Save Changes"
23. Confirmation: "Are you sure you want to change budget from $10 to $15?"
24. Click "Confirm"
25. Показать success: "Budget updated successfully"
26. Новый бюджет отображается: "$15/day"
```

**Комментарий:**  
*"Users can modify ad set budgets directly from the campaign detail page. The app shows current budget and allows editing. After user confirms the change, we use ads_management permission to update the daily budget via Facebook API. This gives users full control over their ad spend."*

#### 02:20-03:00 — Duplicate Campaign (опционально)
```
27. Вернуться на Dashboard
28. Click на Campaign с хорошими результатами
29. Click "Duplicate" button (если есть)
30. Показать Duplicate dialog:
    - New Campaign Name: "[Original Name] - Copy"
    - Copy settings: [checkboxes]
31. Click "Create Duplicate"
32. Показать loading
33. Success: "Campaign duplicated successfully"
34. Новая кампания появилась в списке
```

**Комментарий:**  
*"The app can duplicate successful campaigns to help users scale. This advanced feature uses ads_management permission to create a copy of all campaign settings, ad sets, and creatives. Users can then modify the duplicate independently."*

---

## 🎥 СКРИНКАСТ #7: `Ads Management Standard Access` (повышенный лимит)

**Длительность:** 2 минуты  
**Цель:** Объяснить зачем нужен Standard Access и показать работу с большим объемом данных.

### Сценарий по секундам:

#### 00:00-00:30 — Что такое Standard Access
```
1. Dashboard страница
2. Показать Summary Stats с большими цифрами
```

**Комментарий:**  
*"We request Ads Management Standard Access to increase API rate limits. This is necessary because our platform fetches data for multiple campaigns, ad sets, and ads simultaneously. Standard Access allows us to serve users with large ad accounts efficiently without hitting rate limits."*

#### 00:30-01:00 — Большое количество кампаний
```
3. Показать Campaign List с МНОЖЕСТВОМ кампаний (10+)
4. Scroll через весь список
5. Показать что данные загружаются быстро
```

**Комментарий:**  
*"For users managing many campaigns, Standard Access ensures smooth data loading. Without it, we would hit API rate limits and users would experience slow loading times or errors."*

#### 01:00-01:30 — Campaign Detail с Ad Sets и Ads
```
6. Click на кампанию
7. Campaign Detail показывает:
   - Overview metrics
   - Multiple Ad Sets (5+)
   - Each Ad Set has multiple Ads
8. Показать что все данные загружены корректно
```

**Комментарий:**  
*"Standard Access allows us to fetch detailed breakdowns including campaign, ad set, and individual ad performance. This level of detail requires multiple API calls, which would be restricted under basic access."*

#### 01:30-02:00 — Bulk Data Loading
```
9. Вернуться на Dashboard
10. Click на Date Range Picker
11. Select большой период: "Last 30 days"
12. Click "Apply"
13. Показать как все метрики обновляются без ошибок
```

**Комментарий:**  
*"When fetching historical data for extended periods, Standard Access ensures reliable performance. This permission level is essential for professional ad management tools serving agencies and businesses with substantial advertising budgets."*

---

## 📱 СОЗДАНИЕ ТЕСТОВОГО ПОЛЬЗОВАТЕЛЯ FACEBOOK

### Шаг 1: Перейти в Developer Console
```
https://developers.facebook.com/apps/
```

### Шаг 2: Открыть ваше приложение
```
App ID: 1441781603583445
```

### Шаг 3: Roles → Test Users
```
1. Click "Test Users" в левом меню
2. Click "Create Test Users" button
3. Настройки:
   - Number of test users: 2
   - Permissions: выбрать ВСЕ нужные permissions
   - Automatically install app: YES
   - Locale: en_US (English)
4. Click "Create"
```

### Шаг 4: Получить credentials
```
1. В списке Test Users найти созданных пользователей
2. Click "Edit" → "Change password"
3. Установить простой пароль: TestUser123!
4. Сохранить:
   - Email: test_user_xxx@tfbnw.net
   - Password: TestUser123!
```

### Шаг 5: Создать тестовый Ad Account для тестового пользователя
```
1. Залогиниться как тестовый пользователь на facebook.com
2. Перейти в Business Manager или Ads Manager
3. Создать новый Ad Account
4. Создать 2-3 тестовые кампании с метриками
```

**Важно:** Тестовый пользователь нужен для ревьюеров Facebook. Они будут логиниться через него и проверять ваше приложение.

---

## 🎬 ОБЩИЕ СОВЕТЫ ПО ЗАПИСИ

### Качество записи:
- **Разрешение:** Минимум 1280x720 (HD), оптимально 1920x1080 (Full HD)
- **FPS:** 30 fps минимум
- **Формат:** MP4 (H.264)
- **Размер:** Максимум 100 MB на видео

### Озвучка:
- **Микрофон:** Используйте качественный микрофон (не встроенный в ноутбук)
- **Тишина:** Запись в тихом помещении
- **Темп:** Говорите медленно и четко
- **Язык:** ТОЛЬКО английский (критично!)

### Курсор:
- Используйте крупный курсор (для видимости)
- Плавные движения мышью
- Делайте паузы после каждого клика

### Ошибки:
- Если допустили ошибку - начните запись сначала
- Не оставляйте длинные паузы без действий
- Не показывайте лишние окна/вкладки

### Текст на экране (опционально):
- Можно добавить субтитры (если есть акцент)
- Можно добавить аннотации со стрелками
- НЕ перегружайте экран текстом

---

## ✅ ЧЕКЛИСТ ПЕРЕД ОТПРАВКОЙ

После записи всех 7 скринкастов:

- [ ] Все видео длительностью 2-3 минуты
- [ ] Все видео на английском языке (речь и интерфейс)
- [ ] Качество видео: минимум 720p
- [ ] Звук четкий и разборчивый
- [ ] Нет лишних окон/уведомлений на экране
- [ ] Показан полный OAuth flow
- [ ] Показано модальное окно выбора Account/Page
- [ ] Показаны конкретные действия (pause, resume, budget change)
- [ ] Показаны метрики и аналитика
- [ ] Показаны confirmation dialogs перед действиями
- [ ] Не показаны: AI Autopilot, Telegram, cron, массовые действия
- [ ] Видео названы четко: `public_profile.mp4`, `ads_management.mp4` и т.д.

---

## 🎯 ИТОГОВЫЙ СПИСОК ВИДЕО

Вам нужно записать и загрузить 7 видео:

1. ✅ `public_profile.mp4` (2 мин)
2. ✅ `business_management.mp4` (2.5 мин)
3. ✅ `pages_show_list.mp4` (2 мин)
4. ✅ `pages_manage_ads.mp4` (2.5 мин)
5. ✅ `ads_read.mp4` (2.5 мин)
6. ✅ `ads_management.mp4` (3 мин) — САМЫЙ ВАЖНЫЙ!
7. ✅ `ads_management_standard_access.mp4` (2 мин)

**Общая длительность:** ~17 минут записи

---

## 📞 ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК

### Проблема: Facebook OAuth не работает
```
Решение:
- Проверить что FB_APP_ID правильный: 1441781603583445
- Проверить Valid OAuth Redirect URIs в настройках приложения
- Использовать Production URL: https://performanteaiagency.com
```

### Проблема: Нет активных кампаний для демонстрации
```
Решение:
- Создать 3-5 тестовых кампаний в тестовом Ad Account
- Запустить их с минимальным бюджетом ($1/day)
- Подождать 24 часа для накопления метрик
```

### Проблема: Интерфейс на русском языке
```
Решение:
- Изменить язык браузера на английский
- Очистить localStorage
- Перезагрузить приложение
- Может потребоваться обновить переводы в коде
```

---

## 🚀 ГОТОВО!

После записи всех 7 скринкастов переходите к заполнению App Review формы (см. `APP_REVIEW_TEXTS.md`).

Удачи! 🎬

