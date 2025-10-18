# 🚀 ДЕПЛОЙ ФАЙЛОВ ДЛЯ APP REVIEW

## ✅ ЧТО ГОТОВО

Все файлы созданы и настроены:
- Privacy Policy: `services/frontend/src/pages/Privacy.tsx`
- Terms of Service: `services/frontend/src/pages/Terms.tsx`
- Data Deletion webhook: `services/agent-service/src/routes/facebookWebhooks.ts`
- Роуты добавлены в App.tsx и server.ts

---

## 🔧 ШАГ 1: ДОБАВИТЬ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ

### В файл `.env.agent` (на сервере) добавьте:

```bash
# Facebook App Settings
FB_APP_ID=690472653668355
FB_APP_SECRET=ваш_app_secret_здесь
FB_API_VERSION=v21.0

# Public URL для Data Deletion callback
PUBLIC_URL=https://performanteaiagency.com
```

**❗ ВАЖНО:** Получите `FB_APP_SECRET` из Facebook Developer Console:
1. Перейдите: https://developers.facebook.com/apps/690472653668355/settings/basic/
2. Скопируйте "App Secret" (нажмите "Show")

---

## 📦 ШАГ 2: ПЕРЕСОБРАТЬ И ЗАДЕПЛОИТЬ

```bash
# 1. Убедитесь, что вы в корне проекта
cd /Users/anatolijstepanov/agents-monorepo

# 2. Пересоберите Docker контейнеры
docker-compose build --no-cache frontend agent-service

# 3. Перезапустите сервисы
docker-compose up -d

# 4. Проверьте логи
docker-compose logs frontend --tail 50
docker-compose logs agent-service --tail 50
```

---

## ✅ ШАГ 3: ПРОВЕРИТЬ ЧТО ВСЁ РАБОТАЕТ

### 3.1 Локально (если запущено локально)

```bash
# Privacy Policy
curl http://localhost/privacy
# Должен вернуть HTML с текстом "Performante AI" и "ИП A-ONE AGENCY"

# Terms of Service
curl http://localhost/terms
# Должен вернуть HTML

# Data Deletion endpoint
curl -X POST http://localhost:8082/api/facebook/data-deletion \
  -H "Content-Type: application/json" \
  -d '{"signed_request":"test.payload"}' -v
# Должен вернуть 400 Bad Request (это нормально - запрос невалидный)
```

### 3.2 На продакшн сервере

```bash
# Privacy Policy
curl https://performanteaiagency.com/privacy
# Должен вернуть 200 OK с HTML

# Terms
curl https://performanteaiagency.com/terms
# Должен вернуть 200 OK с HTML

# Data Deletion endpoint
curl -X POST https://performanteaiagency.com/api/facebook/data-deletion \
  -H "Content-Type: application/json" \
  -d '{"signed_request":"test"}' -v
# Должен вернуть 400 (это OK - значит endpoint работает)
```

### 3.3 Проверить в браузере

Откройте в браузере:
- https://performanteaiagency.com/privacy
- https://performanteaiagency.com/terms

Должны отображаться красиво оформленные страницы с вашими данными.

---

## 🔍 ШАГ 4: ПРОВЕРИТЬ С FACEBOOK DEBUGGER

Facebook проверит доступность ваших URLs перед одобрением.

### Используйте Facebook Sharing Debugger:

1. Перейдите: https://developers.facebook.com/tools/debug/
2. Введите URL: `https://performanteaiagency.com/privacy`
3. Нажмите "Debug"
4. Должно показать: ✅ 200 OK, без ошибок

Повторите для `/terms`

---

## 📝 ШАГ 5: НАСТРОИТЬ FACEBOOK APP

### 5.1 Basic Settings

https://developers.facebook.com/apps/690472653668355/settings/basic/

```
Display Name: Performante AI

App Icon: [загрузите лого 1024x1024 px]

Privacy Policy URL:
https://performanteaiagency.com/privacy

Terms of Service URL:
https://performanteaiagency.com/terms

User Data Deletion:
Callback URL: https://performanteaiagency.com/api/facebook/data-deletion

Category: Business & Pages

App Domains:
performanteaiagency.com
```

### 5.2 Facebook Login Settings

https://developers.facebook.com/apps/690472653668355/fb-login/settings/

```
Client OAuth Login: ON
Web OAuth Login: ON

Valid OAuth Redirect URIs:
https://performanteaiagency.com/auth/callback
https://performanteaiagency.com/
```

**❗ ВАЖНО:** Удалите старый redirect URI:
- ❌ https://ad-dash-telegram-bot.lovable.app/

---

## 🎬 ШАГ 6: ЗАПИСАТЬ DEMO ВИДЕО

Facebook требует видео, демонстрирующее использование permissions.

### Что показать в видео (2-3 минуты):

**Структура:**

```
00:00-00:30 | Вход через Facebook Login
  - Показать кнопку "Login with Facebook"
  - Процесс авторизации
  - Запрос permissions

00:30-01:00 | Выбор Ad Account
  - Список доступных ad accounts
  - Выбор одного

01:00-01:30 | Dashboard с метриками (ads_read)
  - Таблица кампаний
  - Метрики: spend, impressions, clicks

01:30-02:00 | Изменение бюджета (ads_management)
  - Открыть кампанию
  - Показать рекомендацию от AI
  - Изменить бюджет ad set
  - Показать, что изменение применилось

02:00-02:30 | Business Manager (business_management)
  - Показать, как отображаются Pages
  - Выбор Page для креативов
```

**Инструменты записи:**
- **macOS:** QuickTime Player (Cmd+Shift+5)
- **Web:** https://loom.com (бесплатно, 5 минут макс)
- **Desktop:** OBS Studio

**Требования к видео:**
- Формат: MP4 или MOV
- Разрешение: минимум 1280x720
- Длительность: 2-3 минуты
- Субтитры/комментарии на английском

---

## 👥 ШАГ 7: СОЗДАТЬ ТЕСТОВЫХ ПОЛЬЗОВАТЕЛЕЙ

Facebook ревьюеры будут тестировать ваше приложение.

### 7.1 В Developer Console

https://developers.facebook.com/apps/690472653668355/roles/test-users/

1. Нажмите "Create Test Users"
2. Создайте 2-3 тестовых пользователя
3. Для каждого:
   - Password: задайте простой (test123)
   - Name: Test User 1, Test User 2, etc.

### 7.2 Настройте тестовые Ad Accounts

Для каждого тестового пользователя создайте тестовый Ad Account:

**Через Graph API Explorer:**

https://developers.facebook.com/tools/explorer/

```
POST /{business_id}/adaccount
{
  "name": "Test Account for App Review",
  "currency": "USD",
  "timezone_id": 1
}
```

### 7.3 Предоставьте credentials ревьюерам

В форме App Review укажите:

```
Test User 1:
  Email: test_xxx@tfbnw.net (сгенерируется автоматически)
  Password: test123
  
Test User 2:
  Email: test_yyy@tfbnw.net
  Password: test123
```

---

## 📋 ШАГ 8: ЗАПОЛНИТЬ APP REVIEW ФОРМУ

https://developers.facebook.com/apps/690472653668355/app-review/

### 8.1 Запросить Permissions

Нажмите "Request" для каждого permission:

#### **ads_management**

**Tell us how your app uses this permission:**
```
Our app, Performante AI, helps advertisers automatically optimize their 
Facebook ad campaign budgets using AI analysis. We use ads_management to:

1. Adjust daily budgets of ad sets based on performance metrics
2. Pause underperforming campaigns and ads to prevent budget waste
3. Resume campaigns when conditions improve
4. Duplicate successful campaigns for scaling

Users review all AI recommendations and must approve changes before 
they are executed via the API. This gives users full control while 
benefiting from AI-powered insights.
```

**Step-by-step instructions:**
```
1. Visit https://performanteaiagency.com and click "Login with Facebook"
2. Authorize the requested permissions (ads_read, ads_management, etc.)
3. Select your Ad Account from the dropdown menu
4. Navigate to "Campaigns" page to see list of active campaigns
5. Click on any campaign to view detailed metrics and AI recommendations
6. Review suggested budget changes or pause recommendations
7. Click "Apply Changes" button to execute via ads_management API
8. Verify changes in Facebook Ads Manager
```

#### **ads_read**

**Tell us how your app uses this permission:**
```
We use ads_read to fetch campaign performance data including spend, 
impressions, clicks, conversions, CPM, CPC, and CTR. This data is 
displayed in our analytics dashboard and used by our AI to generate 
optimization recommendations.
```

**Step-by-step instructions:**
```
1. Login to https://performanteaiagency.com with Facebook
2. Dashboard automatically loads campaign metrics via ads_read API
3. View performance charts showing spend trends and ROI
4. Click on individual campaigns to see detailed ad set metrics
```

#### **business_management**

**Tell us how your app uses this permission:**
```
We use business_management to list ad accounts and pages that the user 
has access to in their Business Manager. This allows users to select 
which account they want to manage through our platform.
```

**Step-by-step instructions:**
```
1. Login with Facebook
2. App fetches list of ad accounts via business_management API
3. User selects which account to manage
4. App displays only data for selected account
```

#### **pages_show_list**

**Tell us how your app uses this permission:**
```
We use pages_show_list to display Facebook Pages that the user manages. 
This is needed for creating campaigns with page-based objectives 
(e.g., page likes, engagement) and for creative asset management.
```

**Step-by-step instructions:**
```
1. Navigate to Profile → Connected Accounts
2. App displays list of user's Facebook Pages
3. Select a page to use for campaign creation
```

#### **instagram_basic**

**Tell us how your app uses this permission:**
```
We use instagram_basic to access basic Instagram Business Account info 
for users who run Instagram ads. This allows us to show Instagram 
campaign metrics alongside Facebook metrics in a unified dashboard.
```

**Step-by-step instructions:**
```
1. If user has Instagram Business Account connected to Facebook Page
2. App displays Instagram metrics in the dashboard
3. User can manage both Facebook and Instagram campaigns
```

### 8.2 Загрузить Demo видео

В каждой секции permission есть поле "Upload Screencast".
Загрузите записанное видео.

### 8.3 Указать Platform

```
Platform: Web
URL: https://performanteaiagency.com
```

### 8.4 Предоставить Test User Credentials

В секции "App Reviewer Instructions":
```
Test User Credentials:
Email: test_xxx@tfbnw.net
Password: test123

The test user has a demo ad account with sample campaigns set up.

Notes:
- Privacy Policy: https://performanteaiagency.com/privacy
- Terms of Service: https://performanteaiagency.com/terms
- All data is encrypted and stored securely
- Users can revoke access at any time
```

---

## ✅ ФИНАЛЬНЫЙ ЧЕКЛИСТ

Перед нажатием "Submit for Review":

- [ ] ✅ Privacy Policy доступна по URL и содержит "Performante AI", "ИП A-ONE AGENCY"
- [ ] ✅ Terms of Service доступны по URL
- [ ] ✅ Data Deletion endpoint отвечает на POST запросы
- [ ] ✅ Facebook App настроен (Icon, URLs, Domains)
- [ ] ✅ OAuth Redirect URIs обновлены на performanteaiagency.com
- [ ] ✅ Старый lovable.app URL удален
- [ ] ✅ FB_APP_SECRET добавлен в .env.agent
- [ ] ✅ PUBLIC_URL=https://performanteaiagency.com в .env.agent
- [ ] ✅ Demo видео записано (2-3 мин, показывает все permissions)
- [ ] ✅ Тестовые пользователи созданы с Ad Accounts
- [ ] ✅ Все 5 permissions описаны детально
- [ ] ✅ Step-by-step instructions для каждого permission
- [ ] ✅ Facebook Debugger показывает 200 OK для privacy/terms
- [ ] ✅ App Icon загружен (1024x1024 px)
- [ ] ✅ App Display Name = "Performante AI"
- [ ] ✅ Category = "Business & Pages"

---

## 🎯 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

После отправки:
- **Время рассмотрения:** 3-7 рабочих дней
- **Статус:** Проверяйте в App Review Dashboard

### Если одобрят ✅
- Permissions станут доступны для всех пользователей
- Можно убрать App из Development Mode
- Приложение будет публичным

### Если отклонят ❌
- Внимательно прочитайте причину отказа
- Исправьте указанные проблемы
- Повторно отправьте на Review (можно сразу)

**Частые причины отказа:**
- "Insufficient details in permission description" → добавить больше текста
- "Demo video unclear" → переснять видео с комментариями
- "Test credentials don't work" → проверить тестовых пользователей
- "Privacy policy not accessible" → проверить URL

---

## 📞 ПОДДЕРЖКА

Если возникнут проблемы:
1. Проверьте логи: `docker-compose logs frontend agent-service`
2. Проверьте Facebook Debugger
3. Проверьте, что домен доступен из интернета (не localhost)

---

**Успехов с App Review! 🚀**

