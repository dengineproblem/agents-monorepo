# ✅ Facebook App Review - Текущий Статус

## 📋 Что уже реализовано

### 1. **Обязательные страницы**
- ✅ Privacy Policy: `https://performanteaiagency.com/privacy`
- ✅ Terms of Service: `https://performanteaiagency.com/terms`
- ✅ Data Deletion Callback: `https://performanteaiagency.com/api/facebook/data-deletion`

### 2. **Facebook OAuth интеграция**
- ✅ Полный OAuth flow (authorization code → access token)
- ✅ Endpoint: `/facebook/oauth/token` - обмен code на токен
- ✅ Endpoint: `/facebook/save-selection` - сохранение выбранных данных
- ✅ Пагинация для получения ВСЕХ ad accounts и pages (не только первых 25)

### 3. **UI для выбора данных**
- ✅ Модальное окно после успешного OAuth
- ✅ Поиск по Ad Accounts (по названию и ID)
- ✅ Поиск по Facebook Pages (по названию и ID)
- ✅ Автоматическое определение Instagram Business Account из выбранной Page
- ✅ Визуальная индикация (✓ IG) для Pages с Instagram
- ✅ Счетчики "Показано X из Y"

### 4. **Supabase интеграция**
- ✅ Исправлен API ключ (новый формат: `sb_secret_...`)
- ✅ Сохранение выбранных данных в таблицу `user_accounts`:
  - `access_token`
  - `ad_account_id`
  - `page_id`
  - `instagram_id` (автоматически из Page)
- ✅ Логин без обязательного Facebook токена (токен опционален)

---

## 🔑 Запрошенные разрешения (Permissions)

### В Use Case "Manage Business Assets":
1. ✅ **ads_read** - чтение рекламных кампаний, статистики
2. ✅ **ads_management** - создание/управление рекламными кампаниями
3. ✅ **business_management** - доступ к бизнес-менеджеру
4. ✅ **pages_show_list** - список Facebook Pages
5. ✅ **pages_manage_ads** - управление рекламой на Pages
6. ✅ **public_profile** - базовая информация профиля
7. ✅ **Ads Management Standard Access** - повышенный лимит API

❌ НЕ запрошены (не нужны):
- `leads_retrieval` - мы не работаем с лидами
- `pages_read_engagement` - не анализируем вовлеченность постов
- Instagram Basic Display API - не нужен (работаем через Page)

---

## 🎯 Как работает приложение

### Флоу пользователя:
1. **Логин** через username/password (Supabase Auth)
2. **Переход в Profile** → нажать "Connect" на карточке Facebook Ads
3. **OAuth через Facebook** → выбор разрешений
4. **Возврат в приложение** → модальное окно с выбором:
   - Ad Account (из всех доступных)
   - Facebook Page (из всех доступных)
   - Instagram автоматически подключается (если привязан к Page)
5. **Сохранение выбора** в Supabase
6. **Использование данных** для создания рекламных кампаний

### Технический стек:
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Backend**: Node.js, Fastify, TypeScript
- **Database**: Supabase (PostgreSQL)
- **Deploy**: Docker Compose, Nginx
- **Domain**: `performanteaiagency.com`

---

## 📝 Что нужно для App Review

### ✅ 1. Текстовые описания — ГОТОВЫ!
Для каждого разрешения подготовлены тексты в `APP_REVIEW_TEXTS.md`:
- ✅ **public_profile** — готов
- ✅ **business_management** — готов
- ✅ **pages_show_list** — готов
- ✅ **pages_manage_ads** — готов
- ✅ **ads_read** — готов
- ✅ **ads_management** — готов
- ✅ **Ads Management Standard Access** — готов

### 📹 2. Записать скринкасты (7 видео)
**Длительность**: 2-3 минуты каждое  
**Детальные сценарии**: См. `SCREENCAST_SCENARIOS.md`

**Список видео для записи:**
1. [ ] `public_profile.mp4` (2 мин)
2. [ ] `business_management.mp4` (2.5 мин)
3. [ ] `pages_show_list.mp4` (2 мин)
4. [ ] `pages_manage_ads.mp4` (2.5 мин)
5. [ ] `ads_read.mp4` (2.5 мин)
6. [ ] `ads_management.mp4` (3 мин) — **САМЫЙ ВАЖНЫЙ!**
7. [ ] `ads_management_standard_access.mp4` (2 мин)

**Перед записью:**
- [ ] Создать тестового пользователя Facebook
- [ ] Создать тестовый Ad Account с кампаниями
- [ ] Переключить интерфейс на английский язык
- [ ] См. полный чеклист: `APP_REVIEW_PREPARATION.md`

### ✅ 3. Тестовые запросы Graph API — ГОТОВЫ!
Примеры запросов подготовлены в `APP_REVIEW_PREPARATION.md`

---

## 🚀 Конфигурация Facebook App

### App Settings (Basic):
- **App ID**: `1441781603583445`
- **App Domains**: `performanteaiagency.com`
- **Privacy Policy URL**: `https://performanteaiagency.com/privacy`
- **Terms of Service URL**: `https://performanteaiagency.com/terms`
- **User Data Deletion**: `https://performanteaiagency.com/api/facebook/data-deletion`

### Facebook Login Settings:
- **Valid OAuth Redirect URIs**:
  - `https://performanteaiagency.com/profile`

### Use Case:
- **Type**: "Manage Business Assets" или аналогичный для Marketing API
- **НЕ**: "Mobile App Ads" (там нет Marketing API)

---

## ✅ Текущий статус

- [x] Privacy Policy создан
- [x] Terms of Service создан
- [x] Data Deletion Callback работает
- [x] Facebook OAuth интеграция работает
- [x] UI для выбора Ad Account/Page работает
- [x] Пагинация для получения всех данных работает
- [x] Instagram автоматически подключается
- [x] Сохранение в Supabase работает
- [x] **Написать тексты для App Review** ✅ Готовы (см. `APP_REVIEW_TEXTS.md`)
- [x] **Подготовить сценарии скринкастов** ✅ Готовы (см. `SCREENCAST_SCENARIOS.md`)
- [x] **Подготовить инструкции** ✅ Готовы (см. `APP_REVIEW_PREPARATION.md`)
- [ ] **Создать тестового пользователя Facebook**
- [ ] **Создать тестовые кампании**
- [ ] **Записать 7 скринкастов** (2-3 мин каждый)
- [ ] **Подать на App Review**

---

## 📂 Ключевые файлы

### Backend:
- `services/agent-service/src/routes/facebookWebhooks.ts` - OAuth endpoints
- `services/agent-service/src/lib/supabase.ts` - Supabase client

### Frontend:
- `services/frontend/src/pages/Profile.tsx` - Facebook connection UI
- `services/frontend/src/pages/Privacy.tsx` - Privacy Policy
- `services/frontend/src/pages/Terms.tsx` - Terms of Service
- `services/frontend/src/pages/Dashboard.tsx` - Main dashboard with notification

### Environment:
- `.env.agent` на сервере - содержит:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE` (новый формат: `sb_secret_...`)
  - `FB_APP_ID=1441781603583445`
  - `FB_APP_SECRET`
  - `FB_REDIRECT_URI=https://performanteaiagency.com/profile`

---

## 🔧 Команды для деплоя

```bash
cd ~/agents-monorepo
git pull origin main
docker-compose down
docker-compose up -d --build
```

---

## 📞 Контакты

- **Email**: business@performanteaiagency.com
- **Company**: ИП A-ONE AGENCY
- **Country**: Казахстан
- **Domain**: performanteaiagency.com

---

## 🎯 Следующие шаги

### 📚 Документация подготовлена (100% готово):

✅ **SCREENCAST_SCENARIOS.md** - Детальные сценарии для каждого из 7 видео  
✅ **APP_REVIEW_TEXTS.md** - Готовые тексты для формы App Review  
✅ **APP_REVIEW_PREPARATION.md** - Пошаговая инструкция подготовки

### 🎬 Ваши действия:

1. **Подготовка (1.5 часа):**
   - [ ] Следовать инструкциям в `APP_REVIEW_PREPARATION.md`
   - [ ] Создать тестового пользователя Facebook (15 мин)
   - [ ] Создать тестовый Ad Account с кампаниями (30 мин)
   - [ ] Переключить интерфейс на английский (15 мин)
   - [ ] Протестировать OAuth flow (10 мин)

2. **Запись скринкастов (2 часа):**
   - [ ] Записать 7 видео по сценариям из `SCREENCAST_SCENARIOS.md`
   - [ ] Каждое видео 2-3 минуты, английский язык
   - [ ] Сохранить в формате MP4 (720p+)

3. **Подача на App Review (30 мин):**
   - [ ] Заполнить форму текстами из `APP_REVIEW_TEXTS.md`
   - [ ] Загрузить все 7 видео
   - [ ] Submit for Review

**Ожидаемое время ответа:** 3-7 рабочих дней

---

## 📋 БЫСТРАЯ НАВИГАЦИЯ

| Документ | Назначение |
|----------|------------|
| `SCREENCAST_SCENARIOS.md` | 🎬 Сценарии для записи 7 видео (что говорить, что показывать) |
| `APP_REVIEW_TEXTS.md` | 📝 Готовые тексты для копирования в форму App Review |
| `APP_REVIEW_PREPARATION.md` | 🛠️ Пошаговая подготовка (Test User, кампании, проверки) |

**ВСЁ ГОТОВО К ЗАПИСИ!** 🚀

