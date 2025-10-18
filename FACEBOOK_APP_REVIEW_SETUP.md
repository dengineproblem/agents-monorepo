# 🚀 НАСТРОЙКА ДЛЯ FACEBOOK APP REVIEW

Все необходимые файлы созданы! Теперь нужно их настроить.

---

## ✅ ЧТО УЖЕ СДЕЛАНО

- ✅ Privacy Policy страница создана (`services/frontend/src/pages/Privacy.tsx`)
- ✅ Terms of Service страница создана (`services/frontend/src/pages/Terms.tsx`)
- ✅ Data Deletion webhook создан (`services/agent-service/src/routes/facebookWebhooks.ts`)
- ✅ Роуты добавлены в App.tsx
- ✅ Webhook зарегистрирован в server.ts

---

## 📝 ШАГ 1: ЗАПОЛНИТЬ ИНФОРМАЦИЮ О КОМПАНИИ

Замените плейсхолдеры в файлах на свои данные:

### Какую информацию нужно заменить:

| Плейсхолдер | Что указать | Пример |
|-------------|-------------|---------|
| `[APP_NAME]` | Название приложения | "Meta Ads Automation" |
| `[COMPANY_NAME]` | Название компании | "PerformantAI Agency" |
| `[SUPPORT_EMAIL]` | Email поддержки | "support@performanteai.com" |
| `[DOMAIN]` | Домен приложения | "ads.performanteai.com" |
| `[YOUR_COUNTRY/STATE]` | Страна/штат | "Kazakhstan" или "California, USA" |

### Как заменить:

**Вариант 1 (через редактор):**
1. Откройте `services/frontend/src/pages/Privacy.tsx`
2. Найдите и замените все `[APP_NAME]`, `[COMPANY_NAME]`, `[SUPPORT_EMAIL]`, `[DOMAIN]`
3. Повторите для `services/frontend/src/pages/Terms.tsx`

**Вариант 2 (через команду):**
```bash
cd /Users/anatolijstepanov/agents-monorepo

# Замените значения на свои
APP_NAME="Meta Ads Automation"
COMPANY_NAME="PerformantAI Agency"
SUPPORT_EMAIL="support@performanteai.com"
DOMAIN="ads.performanteai.com"

# Автоматическая замена в файлах
find services/frontend/src/pages -name "*.tsx" -type f -exec sed -i '' \
  -e "s/\[APP_NAME\]/$APP_NAME/g" \
  -e "s/\[COMPANY_NAME\]/$COMPANY_NAME/g" \
  -e "s/\[SUPPORT_EMAIL\]/$SUPPORT_EMAIL/g" \
  -e "s/\[DOMAIN\]/$DOMAIN/g" \
  {} +
```

---

## 🚀 ШАГ 2: ЗАДЕПЛОИТЬ НА СЕРВЕР

### 2.1 Пересобрать и запустить

```bash
# В корне проекта
docker-compose build --no-cache
docker-compose up -d
```

### 2.2 Проверить, что страницы доступны

```bash
# Проверить Privacy Policy
curl http://localhost/privacy
# Должен вернуть HTML страницу

# Проверить Terms
curl http://localhost/terms
# Должен вернуть HTML страницу

# Проверить Data Deletion endpoint
curl -X POST http://localhost:8082/api/facebook/data-deletion \
  -H "Content-Type: application/json" \
  -d '{"signed_request":"test.test"}'
# Должен вернуть 400 (это нормально - запрос невалидный, но эндпоинт работает)
```

### 2.3 Настроить Nginx (если используется)

Убедитесь, что в `nginx.conf` есть проксирование для agent-service:

```nginx
location /api/facebook/ {
    proxy_pass http://agent-service:8082;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

---

## 🔧 ШАГ 3: НАСТРОИТЬ FACEBOOK APP

### 3.1 Перейти в Developer Console

https://developers.facebook.com/apps/

### 3.2 Открыть ваше приложение (App ID: 690472653668355)

Или создать новое, если нужно.

### 3.3 Заполнить Basic Settings

**Settings → Basic:**

```
App Name: [ваше название]
App Icon: [загрузить 1024x1024 px]
Privacy Policy URL: https://[DOMAIN]/privacy
Terms of Service URL: https://[DOMAIN]/terms
User Data Deletion: https://[DOMAIN]/api/facebook/data-deletion
Category: Business & Pages
App Domains: [DOMAIN]
```

**❗ ВАЖНО:** 
- URLs должны быть доступны публично (не localhost!)
- Facebook проверит эти URLs перед одобрением

### 3.4 Настроить OAuth Redirect URLs

**Facebook Login → Settings:**

```
Valid OAuth Redirect URIs:
  https://[DOMAIN]/auth/callback
  https://[DOMAIN]/
```

Удалите старый URL: `https://ad-dash-telegram-bot.lovable.app/`

### 3.5 Добавить переменные окружения

В `.env.agent` (на сервере) добавьте:

```bash
# Facebook App
FB_APP_ID=690472653668355
FB_APP_SECRET=ваш_app_secret
FB_API_VERSION=v21.0

# Public URL для Data Deletion callback
PUBLIC_URL=https://[DOMAIN]
```

---

## ✅ ШАГ 4: ПРОВЕРИТЬ ВСЕ URLS

Используйте этот чеклист перед отправкой на App Review:

### Проверка с Facebook Debugger

1. Перейдите на: https://developers.facebook.com/tools/debug/

2. Проверьте каждый URL:

```
Privacy Policy:
https://[DOMAIN]/privacy

Terms of Service:
https://[DOMAIN]/terms

Data Deletion Callback:
https://[DOMAIN]/api/facebook/data-deletion
```

3. Facebook Debugger должен показать:
   - ✅ URL доступен (200 OK)
   - ✅ Без ошибок SSL
   - ✅ Контент загружается

---

## 📋 ШАГ 5: ЗАПОЛНИТЬ APP REVIEW ФОРМУ

После того как все URLs работают:

### 5.1 App Review → Permissions and Features

Запросите разрешения:

**ads_management:**
```
Tell us how your app uses this permission:
"Our app helps users automatically optimize their Facebook ad campaign budgets. 
We use ads_management to:
- Adjust daily budgets of ad sets
- Pause underperforming campaigns and ads
- Duplicate successful campaigns

Users can review and approve/reject all changes before they are applied."

Please provide step-by-step instructions:
1. Login at https://[DOMAIN] with Facebook Login
2. Grant requested permissions
3. Select your Ad Account from dropdown
4. Go to "Campaigns" page
5. Click on any campaign to see AI recommendations
6. Review suggested budget changes
7. Click "Apply" to execute via ads_management API
```

**ads_read:**
```
Tell us how your app uses this permission:
"We read campaign performance metrics (spend, impressions, clicks, CPM, CPC, 
conversions) to display analytics dashboard and generate AI-powered optimization 
recommendations for users."

Please provide step-by-step instructions:
1. Login with Facebook
2. Dashboard shows metrics from ads_read API
3. Charts display spend, impressions, and conversions
```

**business_management:**
```
Tell us how your app uses this permission:
"We need access to Business Manager to list user's ad accounts and pages that 
they can manage through our platform."

Please provide step-by-step instructions:
1. Login with Facebook
2. App reads list of ad accounts via business_management
3. User selects which account to manage
```

### 5.2 Загрузить Demo видео

Запишите 2-3 минутное видео, показывающее:
- Процесс логина через Facebook (0:00-0:30)
- Выбор Ad Account (0:30-1:00)
- Дашборд с метриками (1:00-1:30)
- Изменение бюджета кампании (1:30-2:00)
- Подтверждение действия (2:00-2:30)

**Инструменты для записи:**
- macOS: QuickTime (Cmd+Shift+5)
- Loom: https://loom.com (бесплатно)
- OBS Studio

### 5.3 Создать тестовые пользователи

**Roles → Test Users → Create Test Users**

Создайте 2-3 тестовых пользователя и предоставьте credentials ревьюерам.

---

## 🔍 TROUBLESHOOTING

### Privacy Policy не загружается

```bash
# Проверить логи frontend
docker-compose logs frontend --tail 50

# Проверить, что роут добавлен
grep -r "Privacy" services/frontend/src/App.tsx
```

### Data Deletion endpoint не работает

```bash
# Проверить логи agent-service
docker-compose logs agent-service --tail 50

# Проверить регистрацию роута
grep -r "facebookWebhooks" services/agent-service/src/server.ts

# Тестовый запрос
curl -X POST http://localhost:8082/api/facebook/data-deletion \
  -H "Content-Type: application/json" \
  -d '{"signed_request":"test.payload"}' -v
```

### Facebook не может получить доступ к URLs

- ✅ Убедитесь, что домен доступен из интернета (не localhost!)
- ✅ Проверьте SSL сертификат
- ✅ Проверьте firewall/security groups
- ✅ Используйте Facebook Debugger для проверки

---

## 📚 ПОЛЕЗНЫЕ ССЫЛКИ

- **Facebook Developer Console:** https://developers.facebook.com/apps/
- **App Review Documentation:** https://developers.facebook.com/docs/app-review
- **Platform Policies:** https://developers.facebook.com/policy/
- **Data Deletion Callback:** https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
- **Facebook Debugger:** https://developers.facebook.com/tools/debug/

---

## ✅ ФИНАЛЬНЫЙ ЧЕКЛИСТ

Перед отправкой на App Review убедитесь:

- [ ] Все плейсхолдеры заменены на реальные данные
- [ ] Privacy Policy доступна по URL
- [ ] Terms of Service доступны по URL
- [ ] Data Deletion endpoint отвечает
- [ ] Facebook App настроен (Icon, URLs, Domains)
- [ ] OAuth Redirect URLs обновлены
- [ ] Старый Lovable URL удален
- [ ] FB_APP_SECRET добавлен в .env.agent
- [ ] PUBLIC_URL настроен в .env.agent
- [ ] Demo видео записано
- [ ] Тестовые пользователи созданы
- [ ] Все permissions описаны детально
- [ ] Facebook Debugger показывает OK для всех URLs

---

## 🎉 ГОТОВО!

Теперь можно отправлять на App Review! 

**Ожидаемое время рассмотрения:** 3-7 рабочих дней

Если возникнут вопросы - обращайтесь! 🚀

