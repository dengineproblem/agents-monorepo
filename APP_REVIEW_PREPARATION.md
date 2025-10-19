# 🛠️ ПОДГОТОВКА К FACEBOOK APP REVIEW

Пошаговое руководство по подготовке всех необходимых компонентов перед записью скринкастов.

---

## 📋 QUICK CHECKLIST

```
□ Шаг 1: Настройка Facebook App (30 минут)
□ Шаг 2: Создание тестового пользователя (15 минут)
□ Шаг 3: Создание тестового Ad Account (20 минут)
□ Шаг 4: Создание тестовых кампаний (30 минут)
□ Шаг 5: Переключение интерфейса на английский (15 минут)
□ Шаг 6: Проверка всех URLs (10 минут)
□ Шаг 7: Тестовый прогон OAuth flow (10 минут)
□ Шаг 8: Запись скринкастов (2 часа)
□ Шаг 9: Заполнение App Review формы (30 минут)

Итого: ~4.5 часа
```

---

## ШАГ 1: НАСТРОЙКА FACEBOOK APP (30 минут)

### 1.1 Откройте Facebook Developer Console

```
https://developers.facebook.com/apps/1441781603583445
```

### 1.2 Settings → Basic

Заполните все поля:

| Поле | Значение |
|------|----------|
| App Name | PerformantAI Agency |
| App Icon | Загрузить 1024x1024 px (PNG) |
| Privacy Policy URL | https://performanteaiagency.com/privacy |
| Terms of Service URL | https://performanteaiagency.com/terms |
| User Data Deletion | https://performanteaiagency.com/api/facebook/data-deletion |
| Category | Business & Pages |
| App Domains | performanteaiagency.com |

**Важно:** Нажмите "Save Changes" внизу страницы!

### 1.3 Facebook Login → Settings

```
Valid OAuth Redirect URIs:
https://performanteaiagency.com/profile
```

**Удалите старые URLs** (если есть):
- ❌ https://ad-dash-telegram-bot.lovable.app/
- ❌ http://localhost:3000/

Нажмите "Save Changes".

### 1.4 App Review → Permissions and Features

Убедитесь что запрошены следующие permissions (если нет - Request Advanced Access):

- [ ] public_profile
- [ ] ads_read
- [ ] ads_management
- [ ] business_management
- [ ] pages_show_list
- [ ] pages_manage_ads

Для "Ads Management Standard Access":
- [ ] Request Standard Access (отдельная кнопка)

### 1.5 Проверка App ID и Secret

```bash
# В корне проекта
cat .env.agent | grep FB_APP

# Должно быть:
# FB_APP_ID=1441781603583445
# FB_APP_SECRET=your_secret_here
```

Если `FB_APP_SECRET` отсутствует:
1. Settings → Basic
2. App Secret → Show
3. Скопируйте и добавьте в `.env.agent`

---

## ШАГ 2: СОЗДАНИЕ ТЕСТОВОГО ПОЛЬЗОВАТЕЛЯ (15 минут)

### 2.1 Создание Test User в Developer Console

```
1. Откройте: https://developers.facebook.com/apps/1441781603583445/roles/test-users/
2. Click "Add" или "Create Test Users"
3. Настройки:
   - Number of test users: 2
   - Permissions: Select ALL (public_profile, ads_management, etc.)
   - Automatically install app: YES ✓
   - Language: English (US)
4. Click "Create"
```

### 2.2 Настройка пароля для Test User

```
1. В списке Test Users найдите созданного пользователя
2. Click на "Actions" → "Change password"
3. Установите запоминающийся пароль: TestUser2025!
4. Сохраните credentials:
   
   Test User #1:
   Email: test_xxxx@tfbnw.net
   Password: TestUser2025!
   
   Test User #2:
   Email: test_yyyy@tfbnw.net
   Password: TestUser2025!
```

### 2.3 Получение Access Token для Test User (опционально)

```
1. В списке Test Users click на "Actions" → "Get access token"
2. Select permissions: ads_management, ads_read, business_management
3. Click "Get Token"
4. Сохраните токен (понадобится для создания тестовых кампаний)
```

---

## ШАГ 3: СОЗДАНИЕ ТЕСТОВОГО AD ACCOUNT (20 минут)

### 3.1 Логин как Test User

```
1. Откройте Incognito/Private window в браузере
2. Перейдите на https://www.facebook.com
3. Залогиньтесь как Test User:
   Email: test_xxxx@tfbnw.net
   Password: TestUser2025!
```

### 3.2 Создание Business Manager (если нет)

```
1. Перейдите: https://business.facebook.com/
2. Click "Create Account"
3. Business Name: "Test Agency"
4. Your Name: "Test User"
5. Email: test_xxxx@tfbnw.net
6. Click "Submit"
```

### 3.3 Создание Ad Account

```
1. В Business Manager перейдите в: Settings → Ad Accounts
2. Click "+ Add" → "Create a New Ad Account"
3. Настройки:
   - Ad Account Name: "Test Ad Account"
   - Time Zone: (ваша временная зона)
   - Currency: USD
4. Click "Create"
5. Сохраните Ad Account ID (формат: act_123456789)
```

### 3.4 Создание Test Page

```
1. Откройте: https://www.facebook.com/pages/create
2. Page Name: "Test Business Page"
3. Category: "Business & Economy"
4. Click "Create Page"
5. Skip все setup шаги
6. Сохраните Page ID (найти в About → Page ID)
```

### 3.5 Привязка Page к Ad Account

```
1. Business Manager → Settings → Pages
2. Click "+ Add" → "Add a Page"
3. Enter Page Name: "Test Business Page"
4. Click "Add Page"
```

---

## ШАГ 4: СОЗДАНИЕ ТЕСТОВЫХ КАМПАНИЙ (30 минут)

### Вариант A: Через Facebook Ads Manager (UI)

```
1. Перейдите: https://adsmanager.facebook.com
2. Select Ad Account: "Test Ad Account"
3. Click "+ Create" → "Create Campaign"

Campaign #1 - ACTIVE Campaign (для демонстрации Pause):
---------------------------------------------------------
4. Objective: Leads
5. Campaign Name: "Test Lead Generation Campaign"
6. Budget & Schedule: Daily budget $10
7. Audience: Location (ваша страна), Age 25-45
8. Placements: Automatic
9. Create simple ad with text + image
10. Click "Publish"

Campaign #2 - PAUSED Campaign (для демонстрации Resume):
---------------------------------------------------------
11. Повторите шаги 3-10
12. Campaign Name: "Test Paused Campaign"
13. После создания:
    - Найдите кампанию в списке
    - Toggle switch OFF (pause)

Campaign #3 - Campaign with Multiple Ad Sets (для демонстрации Budget Change):
--------------------------------------------------------------------------------
14. Create Campaign: Objective "Traffic"
15. Campaign Name: "Test Traffic Campaign"
16. Create 3 Ad Sets:
    - Ad Set 1: Daily Budget $5
    - Ad Set 2: Daily Budget $10
    - Ad Set 3: Daily Budget $15
17. Publish
```

### Вариант B: Через Graph API (быстрее)

Используйте Access Token из Шага 2.3:

```bash
# Установить переменные
export ACCESS_TOKEN="your_test_user_token"
export AD_ACCOUNT_ID="act_123456789"
export PAGE_ID="123456789"

# Campaign #1 - ACTIVE
curl -X POST "https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/campaigns" \
  -d "name=Test Lead Generation Campaign" \
  -d "objective=OUTCOME_LEADS" \
  -d "status=ACTIVE" \
  -d "special_ad_categories=[]" \
  -d "access_token=${ACCESS_TOKEN}"

# Campaign #2 - PAUSED
curl -X POST "https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/campaigns" \
  -d "name=Test Paused Campaign" \
  -d "objective=OUTCOME_TRAFFIC" \
  -d "status=PAUSED" \
  -d "special_ad_categories=[]" \
  -d "access_token=${ACCESS_TOKEN}"

# Создать Ad Set для Campaign #1
curl -X POST "https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/adsets" \
  -d "name=Test Ad Set" \
  -d "campaign_id=<campaign_id_from_previous_call>" \
  -d "daily_budget=1000" \
  -d "billing_event=IMPRESSIONS" \
  -d "optimization_goal=LEAD_GENERATION" \
  -d "bid_amount=100" \
  -d "targeting={'geo_locations':{'countries':['US']}}" \
  -d "status=ACTIVE" \
  -d "access_token=${ACCESS_TOKEN}"
```

**Примечание:** Для полноценных кампаний нужны креативы (изображения/видео). Для демонстрации достаточно создать campaigns и ad sets - они будут видны в интерфейсе.

### 4.4 Добавление метрик (опционально)

Чтобы кампании показывали реальные метрики (spend, impressions):
- Запустите кампании с минимальным бюджетом ($1/day)
- Подождите 24-48 часов для накопления данных
- Или используйте уже существующие кампании с историей

---

## ШАГ 5: ПЕРЕКЛЮЧЕНИЕ ИНТЕРФЕЙСА НА АНГЛИЙСКИЙ (15 минут)

**КРИТИЧЕСКИ ВАЖНО:** Интерфейс приложения ДОЛЖЕН быть на английском для скринкастов!

### 5.1 Проверить текущий язык

Откройте https://performanteaiagency.com и проверьте:
- Кнопки (Connect, Disconnect, Save)
- Названия страниц (Dashboard, Profile, Campaigns)
- Сообщения (Success, Error)

### 5.2 Если интерфейс на русском - изменить

```bash
# Проверить файлы с переводами
cd services/frontend/src
find . -name "*locale*" -o -name "*i18n*" -o -name "*translation*"
```

**Временное решение для демонстрации:**

```bash
# Изменить язык браузера:
Chrome/Edge: Settings → Languages → English (move to top)
Firefox: Preferences → Language → English (move to top)
Safari: System Preferences → Language & Region → English

# Очистить localStorage:
Открыть DevTools (F12) → Application → Local Storage → 
Clear All или удалить ключи: lang, language, locale
```

**Или изменить код (если есть i18n):**

```typescript
// Найти файл с настройкой языка (например src/i18n.ts или src/locales/index.ts)
// Изменить default language на 'en':

const defaultLanguage = 'en'; // было 'ru'
```

Пересобрать и задеплоить:
```bash
cd ~/agents-monorepo
docker-compose down
docker-compose up -d --build frontend
```

---

## ШАГ 6: ПРОВЕРКА ВСЕХ URLs (10 минут)

### 6.1 Facebook Debugger

Используйте Facebook Sharing Debugger для проверки всех URLs:

```
https://developers.facebook.com/tools/debug/
```

Проверьте каждый URL:

**Privacy Policy:**
```
URL: https://performanteaiagency.com/privacy
Expected: 200 OK, HTML content visible
```

**Terms of Service:**
```
URL: https://performanteaiagency.com/terms
Expected: 200 OK, HTML content visible
```

**Data Deletion Callback:**
```
URL: https://performanteaiagency.com/api/facebook/data-deletion
Expected: POST request should return 200 or 400 (400 is OK for invalid request)
```

### 6.2 Manual Test

```bash
# Test Privacy Policy
curl -I https://performanteaiagency.com/privacy
# Expected: HTTP/2 200

# Test Terms
curl -I https://performanteaiagency.com/terms
# Expected: HTTP/2 200

# Test Data Deletion (POST)
curl -X POST https://performanteaiagency.com/api/facebook/data-deletion \
  -H "Content-Type: application/json" \
  -d '{"signed_request":"test.test"}'
# Expected: 400 Bad Request (это нормально - запрос невалидный, но эндпоинт работает)
```

### 6.3 Если URLs не работают

```bash
# Проверить что сервисы запущены
docker ps

# Проверить логи
docker logs agents-monorepo-agent-service-1 --tail 50
docker logs agents-monorepo-frontend-1 --tail 50

# Перезапустить
cd ~/agents-monorepo
docker-compose restart
```

---

## ШАГ 7: ТЕСТОВЫЙ ПРОГОН OAuth FLOW (10 минут)

Перед записью скринкастов обязательно протестируйте весь флоу:

### 7.1 Полный OAuth Flow Test

```
1. Откройте Incognito window
2. Перейдите: https://performanteaiagency.com/login
3. Залогиньтесь в приложение (если есть тестовый пользователь приложения)
   Или создайте аккаунт через /signup
4. Перейдите в Profile
5. Click "Connect" на Facebook Ads карточке
6. Должен открыться Facebook OAuth:
   - URL: https://www.facebook.com/v21.0/dialog/oauth?client_id=1441781603583445&...
7. Залогиньтесь как Test User (если не залогинены)
8. Facebook показывает список permissions:
   ✓ Access your public profile
   ✓ Manage your business and its assets
   ✓ Show a list of Pages you manage
   ✓ Manage ads for Pages you manage
9. Click "Continue"
10. Redirect обратно: https://performanteaiagency.com/profile?code=...
11. Модальное окно появляется с:
    - Select Ad Account dropdown
    - Select Facebook Page dropdown
12. Select "Test Ad Account" и "Test Business Page"
13. Click "Save Selection"
14. Success message: "Facebook account connected successfully"
15. Profile показывает "Facebook Ads: Connected ✓"
```

### 7.2 Если что-то пошло не так

**Проблема: Facebook OAuth не редиректит обратно**
```
Решение:
- Проверить Valid OAuth Redirect URIs в настройках приложения
- Убедиться что домен правильный: https://performanteaiagency.com/profile
```

**Проблема: Модальное окно не появляется**
```
Решение:
- Открыть DevTools (F12) → Console
- Искать ошибки JavaScript
- Проверить что backend endpoint работает:
  curl https://performanteaiagency.com/api/facebook/oauth/token
```

**Проблема: Список Ad Accounts пустой**
```
Решение:
- Test User должен иметь доступ к Ad Account в Business Manager
- Проверить что business_management permission одобрен
```

---

## ШАГ 8: ЗАПИСЬ СКРИНКАСТОВ (2 часа)

См. детальные сценарии в `SCREENCAST_SCENARIOS.md`

### Рекомендуемый порядок записи:

1. ✅ `public_profile.mp4` (простой, разогрев)
2. ✅ `business_management.mp4` (средний)
3. ✅ `pages_show_list.mp4` (простой)
4. ✅ `ads_read.mp4` (средний)
5. ✅ `pages_manage_ads.mp4` (средний)
6. ✅ `ads_management.mp4` (ВАЖНЫЙ, самый сложный)
7. ✅ `ads_management_standard_access.mp4` (простой)

### Чеклист перед каждой записью:

- [ ] Браузер в Incognito mode
- [ ] Закрыты все лишние вкладки
- [ ] Отключены уведомления браузера
- [ ] Скрыты закладки (Cmd+Shift+B)
- [ ] Язык интерфейса: английский
- [ ] Микрофон работает (проверить уровень звука)
- [ ] Подготовлен текст комментариев
- [ ] Залогинен как Test User в Facebook
- [ ] Кампании активны и видны

---

## ШАГ 9: ЗАПОЛНЕНИЕ APP REVIEW ФОРМЫ (30 минут)

См. полные тексты в `APP_REVIEW_TEXTS.md`

### 9.1 Откройте App Review

```
https://developers.facebook.com/apps/1441781603583445/app-review/
```

### 9.2 Request Permissions

Для каждого permission:

```
1. Click "Request" или "Request Advanced Access"
2. Вставить текст из APP_REVIEW_TEXTS.md секция "Tell us how your app uses this permission"
3. Вставить текст "Please provide step-by-step instructions"
4. Click "Add Screencast"
5. Загрузить соответствующее видео (.mp4)
6. Click "Save"
```

Повторить для всех 7 permissions.

### 9.3 Provide Test Credentials

В форме есть секция "Test User":

```
Email: test_xxxx@tfbnw.net
Password: TestUser2025!

Additional Notes:
- This test user has access to "Test Ad Account" with 3 active campaigns
- The account has ad spend data for demonstration purposes
- Please use this test user to verify all requested permissions
```

### 9.4 Submit for Review

```
1. Проверить что все 7 permissions заполнены
2. Проверить что все видео загружены
3. Click "Submit for Review"
4. Подтвердить submission
```

---

## 📊 ПРИМЕРЫ GRAPH API ЗАПРОСОВ (для демонстрации)

Если Facebook попросит показать использование API, используйте Graph API Explorer:

```
https://developers.facebook.com/tools/explorer/
```

### Запрос #1: Get User Profile (public_profile)

```
GET /me?fields=id,name,email
```

### Запрос #2: List Ad Accounts (business_management)

```
GET /me/adaccounts?fields=id,name,account_status
```

### Запрос #3: List Pages (pages_show_list)

```
GET /me/accounts?fields=id,name,category
```

### Запрос #4: Get Campaign Data (ads_read)

```
GET /act_{ad_account_id}/campaigns?fields=id,name,status,objective,spend
```

### Запрос #5: Get Campaign Insights (ads_read)

```
GET /{campaign_id}/insights?fields=spend,impressions,clicks,cpm,cpc,ctr
```

### Запрос #6: Pause Campaign (ads_management)

```
POST /{campaign_id}
Body: { "status": "PAUSED" }
```

### Запрос #7: Update Ad Set Budget (ads_management)

```
POST /{adset_id}
Body: { "daily_budget": 1500 }
```

---

## ⚠️ ВОЗМОЖНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ

### Проблема: "Your app is not approved for this permission"

```
Причина: Пытаетесь использовать permission до одобрения

Решение:
- Используйте Test Users (они имеют доступ ко всем permissions в Development Mode)
- Убедитесь что App в Development Mode, а не Production
```

### Проблема: "OAuth redirect_uri mismatch"

```
Причина: Redirect URI в коде не совпадает с настройками в App

Решение:
1. Facebook App → Facebook Login → Settings
2. Valid OAuth Redirect URIs должен содержать:
   https://performanteaiagency.com/profile
3. Проверить код:
   const FB_REDIRECT_URI = 'https://performanteaiagency.com/profile';
```

### Проблема: Видео слишком большое (>100 MB)

```
Решение:
- Уменьшить разрешение до 1280x720 (вместо 1920x1080)
- Использовать компрессию H.264
- Обрезать длительность до 2-3 минут строго
- Использовать FFmpeg для сжатия:
  
  ffmpeg -i input.mp4 -vcodec h264 -acodec aac -b:v 2000k output.mp4
```

### Проблема: Facebook отклонил App Review

```
Возможные причины:
1. Недостаточно детальный скринкаст
2. Интерфейс на неанглийском языке
3. Не показаны user confirmations
4. Показана автоматизация без user control
5. Test user не работает

Решение:
- Прочитать feedback от Facebook внимательно
- Исправить указанные проблемы
- Перезаписать скринкасты
- Подать повторно (можно подавать много раз)
```

---

## ✅ ФИНАЛЬНЫЙ ЧЕКЛИСТ ПЕРЕД SUBMISSION

```
□ Facebook App настроен (Icon, URLs, Domains)
□ Privacy Policy доступна и работает
□ Terms of Service доступны и работают
□ Data Deletion callback работает
□ OAuth Redirect URIs правильные
□ Test User создан с паролем
□ Test User имеет доступ к Ad Account
□ Test Ad Account имеет 3+ активные кампании
□ Кампании имеют метрики (spend, impressions)
□ Интерфейс приложения на английском языке
□ Все 7 видео записаны (2-3 минуты каждое)
□ Видео на английском (речь и интерфейс)
□ Видео качество 720p+ в формате MP4
□ Каждое видео <100 MB
□ Все текстовые описания подготовлены
□ Test credentials указаны в форме
□ Все URLs проверены через Facebook Debugger
□ Протестирован полный OAuth flow
□ App в Development Mode (не Production)
```

---

## 📞 ПОДДЕРЖКА

Если возникнут проблемы:

**Facebook Developer Support:**
- https://developers.facebook.com/support/

**Документация:**
- App Review: https://developers.facebook.com/docs/app-review
- Marketing API: https://developers.facebook.com/docs/marketing-apis
- OAuth: https://developers.facebook.com/docs/facebook-login

**Локальные проблемы:**
- Проверить логи: `docker logs agents-monorepo-agent-service-1`
- Перезапустить: `docker-compose restart`
- Проверить .env: `cat .env.agent | grep FB_`

---

## 🎉 ГОТОВО!

После завершения всех шагов вы готовы к отправке на App Review!

**Среднее время ответа Facebook:** 3-7 рабочих дней  
**Вероятность одобрения:** 90%+ если следовали всем инструкциям

Удачи! 🚀

