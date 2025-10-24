# 👥 СОЗДАНИЕ ТЕСТОВЫХ ПОЛЬЗОВАТЕЛЕЙ ДЛЯ APP REVIEW

**Время:** ~30 минут  
**Цель:** Создать Test Users для Facebook App Reviewers

---

## 🎯 ЧТО НУЖНО СОЗДАТЬ

1. **2 Test Users** в Facebook Developer Console
2. **1 Test Ad Account** с 3 тестовыми кампаниями
3. **Test credentials** для указания в App Review форме

---

## 📋 ШАГ 1: СОЗДАТЬ TEST USERS

### 1.1 Перейти в Developer Console

```
https://developers.facebook.com/apps/1441781603583445/roles/test-users/
```

### 1.2 Создать Test Users

1. Click кнопку **"Create Test Users"**
2. Заполнить форму:

```
Number of test users to create: 2
Permissions: [Выбрать ВСЕ нужные permissions]:
  ☑ ads_management
  ☑ ads_read  
  ☑ business_management
  ☑ pages_show_list
  ☑ pages_manage_ads
  ☑ public_profile

Automatically install this app for new test users: ☑ YES

Locale: en_US (English - United States)
```

3. Click **"Create"**

### 1.3 Установить пароли

Для каждого созданного Test User:

1. Найти пользователя в списке
2. Click **"Change password"** (иконка ключа)
3. Установить пароль: `Почему ты так считаешь? Мы же вообще не работали над этим файлом и ничего не меняли внутри. Или мы меняли этот файл? Я просто не понимаю, куда эта ошибка могла теоретически возникнуть. Что мы во время пуша трогали такого, что всё перестало работать?`
4. Click **"Submit"**

### 1.4 Записать credentials

Сохранить данные тестовых пользователей:

```
Test User 1:
Email: test_xxxxxx@tfbnw.net
Password: AppReview2025!

Test User 2:
Email: test_yyyyyy@tfbnw.net
Password: AppReview2025!
```

*(замените xxxxxx и yyyyyy на реальные ID из Developer Console)*

---

## 📋 ШАГ 2: СОЗДАТЬ TEST AD ACCOUNT

### 2.1 Залогиниться как Test User

1. Открыть **Incognito/Private window**
2. Перейти на `https://facebook.com`
3. Войти используя credentials Test User 1:
   ```
   Email: test_xxxxxx@tfbnw.net
   Password: AppReview2025!
   ```

### 2.2 Создать Business Manager (если нужно)

1. Перейти: `https://business.facebook.com`
2. Если Business Manager не создан:
   - Click **"Create Account"**
   - Business Name: `Test Business - App Review`
   - Your Name: `Test User`
   - Business Email: (email test user)
   - Click **"Submit"**

### 2.3 Создать Ad Account

1. В Business Manager → **Business Settings**
2. Accounts → **Ad Accounts**
3. Click **"Add"** → **"Create a New Ad Account"**
4. Заполнить:
   ```
   Ad Account Name: Test Ad Account - App Review
   Time Zone: (UTC) Coordinated Universal Time
   Currency: USD - US Dollar
   ```
5. Click **"Next"** → **"Create Ad Account"**

### 2.4 Создать Facebook Page (если нужна)

1. Перейти: `https://www.facebook.com/pages/create`
2. Заполнить:
   ```
   Page Name: Test Business Page
   Category: Business & Economy
   Bio: Test page for App Review demo
   ```
3. Click **"Create Page"**

---

## 📋 ШАГ 3: СОЗДАТЬ ТЕСТОВЫЕ КАМПАНИИ

### 3.1 Перейти в Ads Manager

```
https://adsmanager.facebook.com
```

Убедиться что выбран **Test Ad Account - App Review**

### 3.2 Создать Campaign #1 (ACTIVE)

1. Click **"+ Create"**
2. Campaign objective: **Leads**
3. Campaign name: `Test Campaign - Active`
4. Campaign budget: `$5/day` (Daily)
5. Click **"Next"**

**Ad Set settings:**
```
Ad Set Name: Ad Set 1 - Active
Daily Budget: $5
Location: United States
Age: 25-45
Gender: All
```

**Ad settings:**
```
Ad Name: Test Ad 1
Use existing post: [Select any post from your Page]

OR create simple ad:
Text: "Test ad for App Review demo"
Call to Action: Learn More
```

6. Click **"Publish"**

### 3.3 Создать Campaign #2 (PAUSED)

1. Повторить процесс создания
2. Настройки:
   ```
   Campaign name: Test Campaign - Paused
   Objective: Traffic
   Daily Budget: $10
   Location: United Kingdom
   Age: 18-65
   Gender: All
   ```
3. После публикации:
   - Перейти в Ads Manager
   - Найти эту кампанию
   - Toggle switch → **PAUSE**

### 3.4 Создать Campaign #3 (Multi Ad Sets)

1. Создать кампанию:
   ```
   Campaign name: Test Campaign - Multi Ad Sets
   Objective: Leads
   Campaign Budget: OFF (использовать Ad Set budgets)
   ```

2. Создать **3 Ad Sets** внутри:
   ```
   Ad Set 1: Budget $5/day, Location: USA
   Ad Set 2: Budget $8/day, Location: Canada  
   Ad Set 3: Budget $7/day, Location: Australia
   ```

3. Для каждого Ad Set создать простое объявление

---

## 📋 ШАГ 4: ПОДОЖДАТЬ МЕТРИКИ (опционально)

Если у вас есть 2-3 дня до записи скринкастов:

1. Оставить Campaign #1 и Campaign #3 в статусе **ACTIVE**
2. Установить минимальный бюджет ($1-2/day)
3. Подождать 48 часов
4. За это время накопятся метрики:
   - Impressions (показы)
   - Clicks (клики)
   - Spend (расход)
   - CPM, CTR, и т.д.

**Если времени нет:**
- Facebook App Reviewers понимают, что это demo
- Можно показывать кампании даже с нулевыми метриками
- Главное - показать **функциональность** (pause/resume, budget change)

---

## 📋 ШАГ 5: ПОДГОТОВИТЬ TEST CREDENTIALS ДЛЯ APP REVIEW ФОРМЫ

### Что указать при подаче App Review:

**Раздел "Test Account Credentials" в форме App Review:**

```
Username/Email: test_xxxxxx@tfbnw.net
Password: AppReview2025!

Additional notes for reviewers:
This test user has access to "Test Ad Account - App Review" (Ad Account ID: act_xxxxxxxxxx).

The account contains 3 demonstration campaigns:
1. "Test Campaign - Active" (ACTIVE status, Leads objective)
2. "Test Campaign - Paused" (PAUSED status, Traffic objective)
3. "Test Campaign - Multi Ad Sets" (ACTIVE, 3 ad sets with different budgets)

To test the app:
1. Login at https://performanteaiagency.com/login
   Username: testuser
   Password: TestUser123!

2. Connect Facebook:
   - Profile → "Connect" on Facebook Ads card
   - Login with test user credentials above
   - Select "Test Ad Account - App Review" from dropdown
   - Select "Test Business Page" from dropdown
   - Click "Save Selection"

3. Verify functionality:
   - View campaigns on Dashboard
   - Pause/resume campaigns (confirmation dialogs will appear)
   - View campaign details
   - Edit ad set budgets (Campaign Detail → Ad Sets → Edit Budget)

All campaigns have spend/impression data for demonstration purposes.
```

### Как найти Ad Account ID:

1. В Ads Manager
2. URL будет выглядеть так:
   ```
   https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1234567890
   ```
3. Число после `act=` — это ваш Ad Account ID
4. Полный ID: `act_1234567890`

---

## 📋 ШАГ 6: ПРОВЕРИТЬ ВСЁ РАБОТАЕТ

### Тест-прогон перед записью скринкастов:

1. **Открыть Incognito/Private window**

2. **Перейти:** `https://performanteaiagency.com`

3. **Login в приложение:**
   ```
   Username: testuser
   Password: TestUser123!
   ```

4. **Перейти в Profile**

5. **Click "Connect" на Facebook Ads card**

6. **Login через Facebook OAuth:**
   ```
   Email: test_xxxxxx@tfbnw.net
   Password: AppReview2025!
   ```

7. **В модальном окне выбрать:**
   - Ad Account: `Test Ad Account - App Review`
   - Page: `Test Business Page`

8. **Click "Save Selection"**

9. **Проверить Dashboard:**
   - Должны отобразиться 3 кампании
   - Метрики должны показываться (или 0 если нет spend)

10. **Протестировать Pause/Resume:**
    - Toggle switch на Active кампании
    - Должно появиться confirmation dialog
    - Click "Confirm"
    - Статус должен измениться

11. **Протестировать Budget Change:**
    - Click на кампанию с Ad Sets
    - Найти Ad Set
    - Click "Edit Budget"
    - Изменить значение
    - Должно появиться confirmation
    - Новый бюджет должен сохраниться

**Если всё работает — готовы к записи скринкастов! ✅**

---

## ⚠️ ВОЗМОЖНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ

### Проблема: Test User не может создать Ad Account

**Решение:**
```
Test Users имеют ограничения на создание Ad Accounts.
Используйте ваш личный аккаунт для создания Test Ad Account,
затем добавьте Test User как Admin:

1. Business Manager → Ad Accounts
2. Click на Test Ad Account
3. Ad Account Roles → Add People
4. Введите email Test User
5. Role: Admin
6. Save
```

### Проблема: OAuth не работает с Test User

**Решение:**
```
1. Проверить что Test User создан через Developer Console
2. Проверить что у Test User есть права на App (автоматически если создан через Console)
3. Проверить Valid OAuth Redirect URIs:
   https://developers.facebook.com/apps/1441781603583445/fb-login/settings/
   
   Должен быть:
   https://performanteaiagency.com/profile
```

### Проблема: Test User не видит Ad Account в приложении

**Решение:**
```
1. Убедиться что Test User добавлен как Admin в Ad Account
2. Перелогиниться (logout → login) в приложении
3. Reconnect Facebook (Profile → Disconnect → Connect)
4. В модальном окне должен появиться Test Ad Account
```

### Проблема: Кампании не отображаются

**Решение:**
```
1. Проверить что выбран правильный Ad Account в приложении
2. Проверить что кампании созданы в том же Ad Account
3. Проверить Network tab (F12) на ошибки API
4. Перезагрузить страницу (Ctrl+R)
```

---

## ✅ ЧЕКЛИСТ ГОТОВНОСТИ

Перед записью скринкастов убедиться:

- [ ] Создано минимум 2 Test Users
- [ ] Установлены пароли для Test Users
- [ ] Создан Test Ad Account
- [ ] Создана Test Facebook Page
- [ ] Созданы 3 тестовые кампании:
  - [ ] Campaign #1 - ACTIVE
  - [ ] Campaign #2 - PAUSED  
  - [ ] Campaign #3 - Multi Ad Sets (для budget demo)
- [ ] Test User может залогиниться на facebook.com
- [ ] OAuth работает (test user → приложение)
- [ ] Кампании отображаются в Dashboard
- [ ] Pause/Resume работает с confirmation
- [ ] Budget change работает
- [ ] Записаны test credentials для App Review формы

---

## 🚀 СЛЕДУЮЩИЙ ШАГ

После создания Test Users:

```bash
# Откройте финальный чеклист:
open APP_REVIEW_FINAL_CHECKLIST.md

# Начните запись скринкастов:
open SCREENCAST_SCENARIOS.md
```

**Удачи! 🎬**


