# ✅ APP REVIEW - ФИНАЛЬНЫЙ ЧЕКЛИСТ

**Дата:** 24 октября 2025  
**Статус:** Готово к записи скринкастов  
**Домен:** https://performanteaiagency.com

---

## 🎯 ЧТО ГОТОВО (Последние обновления)

### ✅ 1. Переводы на английский (ЗАВЕРШЕНО)
- **Карточки кампаний:** "Spend", "Leads & Chats", "Cost per Lead" ✅
- **Статусы:** "Active", "Paused", "Error" ✅
- **Навигация:** "Dashboard", "Profile", "Videos" (скрыт в App Review) ✅
- **Confirmation dialogs:** Все на английском ✅
- **Форма VideoUpload:** Все поля на английском ✅
- **Profile:** Все секции на английском ✅

### ✅ 2. Скрыто в App Review Mode
**Меню (Desktop + Mobile):**
- ❌ ROI Analytics
- ❌ Creatives
- ❌ Videos (раздел скрыт полностью) ⚠️ **НОВОЕ!**
- ❌ Consultations
- ❌ Directions

**Dashboard:**
- ❌ TikTok кнопка
- ❌ AI Autopilot карточка
- ✅ Только Instagram + 2 кнопки (Upload Video/Image)

**Profile:**
- ❌ TikTok connection
- ❌ Directions card
- ❌ OpenAI API Key ⚠️ **НОВОЕ!**
- ✅ Только Facebook Ads и Instagram

**VideoUpload (упрощенная форма):**
- ❌ Выбор площадки (TikTok)
- ❌ Выбор цели объявления
- ❌ Выбор направления бизнеса
- ❌ Автозапуск, Ручной запуск
- ✅ Только 2 кнопки: **Upload Video** и **Upload Image**

### ✅ 3. Confirmation Dialogs
- **Pause Campaign:** "Are you sure you want to pause this campaign?" ✅
- **Resume Campaign:** "Are you sure you want to resume this campaign?" ✅
- **Budget Change:** Показывает старый/новый бюджет ✅
- Работают ТОЛЬКО в App Review Mode (проверено)

### ✅ 4. Язык интерфейса
- Автоматически **английский** при `VITE_APP_REVIEW_MODE=true`
- Переключатель языка **скрыт** в App Review
- Все тексты переведены (включая мобильную версию)

---

## 📋 ОБНОВЛЕНИЯ ДЛЯ СЦЕНАРИЕВ

### ⚠️ Что изменилось с момента написания сценариев:

#### 1. **Раздел "Видео" СКРЫТ**
В сценариях упоминается раздел "Videos" в меню — **ИГНОРИРОВАТЬ!**

В финальной версии App Review:
- В Desktop sidebar: нет раздела "Videos"
- В Mobile navigation: нет кнопки "Videos"
- **Демонстрировать:** только Dashboard и Profile

#### 2. **VideoUpload форма упрощена**
Если в сценариях есть шаги про выбор "Направления" или "Цели" — **ПРОПУСТИТЬ!**

Финальная форма содержит ТОЛЬКО:
- Ad Name
- Text under video
- Client Question
- Cities
- Age
- Gender
- WhatsApp number
- Budget
- Кнопки: "Upload Video" / "Upload Image"

#### 3. **Мобильная версия**
В мобильной навигации показываются ТОЛЬКО:
- 🏠 Dashboard
- 👤 Profile

(ROI, Creatives, Videos — все скрыты)

---

## 🎬 ОБНОВЛЕННЫЙ ПОРЯДОК ЗАПИСИ

### Рекомендуемая последовательность:

1. ✅ **public_profile** (2 мин) - без изменений
2. ✅ **business_management** (2.5 мин) - без изменений
3. ✅ **pages_show_list** (2 мин) - без изменений
4. ✅ **ads_read** (2.5 мин) - показывать только Dashboard метрики
5. ✅ **pages_manage_ads** (2.5 мин) - Pause/Resume на Dashboard
6. ✅ **ads_management** (3 мин) - **САМЫЙ ВАЖНЫЙ!** Pause/Resume + Budget
7. ✅ **ads_management_standard_access** (2 мин) - без изменений

### ⚠️ Изменения в скринкасте #6 (ads_management):

**Было (в старом сценарии):**
```
1. Dashboard → Upload Video → форма с выбором направления
2. Показывать Автозапуск/Ручной запуск
```

**Стало (финальная версия):**
```
1. Dashboard → Upload Video → УПРОЩЕННАЯ форма (только базовые поля)
2. Показывать ТОЛЬКО кнопки: "Upload Video" и "Upload Image"
3. НЕ показывать: выбор платформы, направления, автозапуск
```

**Фокус скринкаста #6:**
- ✅ Pause/Resume кампании (главное!)
- ✅ Budget Change для Ad Sets
- ⚠️ Upload Video — опционально (если останется время)

---

## 👥 СОЗДАНИЕ ТЕСТОВЫХ ПОЛЬЗОВАТЕЛЕЙ

### Шаг 1: Facebook Test Users (для App Reviewers)

```bash
# Перейти в Developer Console:
https://developers.facebook.com/apps/1441781603583445/roles/test-users/
```

**Действия:**
1. Click **"Create Test Users"**
2. Настройки:
   - **Number:** 2 пользователя
   - **Permissions:** Выбрать ВСЕ (ads_read, ads_management, pages_manage_ads, etc.)
   - **Auto-install app:** ✅ YES
   - **Locale:** `en_US` (English)
3. Click **"Create"**

### Шаг 2: Установить пароли

Для каждого Test User:
1. Click **"Change Password"**
2. Установить простой пароль: `AppReview2025!`
3. Сохранить credentials:
   ```
   Email: test_user_12345@tfbnw.net
   Password: AppReview2025!
   ```

### Шаг 3: Создать Test Ad Account

**Вариант A: Через Facebook Business Manager**
1. Залогиниться как Test User на `facebook.com`
2. Перейти: https://business.facebook.com
3. Create Business Manager (если нет)
4. Создать Ad Account:
   - Name: "Test Ad Account - App Review"
   - Currency: USD
   - Time zone: UTC
5. Добавить Test User как Admin

**Вариант B: Использовать Test Ad Account API (проще)**
```bash
# Использовать Graph API Explorer:
https://developers.facebook.com/tools/explorer/

# Запрос:
POST /act_<AD_ACCOUNT_ID>/test_accounts
{
  "name": "Test Ad Account for App Review",
  "currency": "USD",
  "timezone_id": 1,
  "end_advertiser": "Test User 12345"
}
```

### Шаг 4: Создать тестовые кампании

**Минимум 3 кампании:**

**Кампания 1: ACTIVE (с метриками)**
```
Name: "Test Campaign - Active"
Objective: OUTCOME_LEADS
Status: ACTIVE
Daily Budget: $5
Target: USA, Age 25-45, All genders
Created: 2-3 дня назад (чтобы были метрики)
```

**Кампания 2: PAUSED**
```
Name: "Test Campaign - Paused"
Objective: OUTCOME_TRAFFIC
Status: PAUSED
Daily Budget: $10
Target: UK, Age 18-65, All genders
```

**Кампания 3: ACTIVE (с Ad Sets для budget change demo)**
```
Name: "Test Campaign - Multi Ad Sets"
Objective: OUTCOME_LEADS
Status: ACTIVE
Daily Budget: $20

Ad Sets:
- Ad Set 1: Daily Budget $5
- Ad Set 2: Daily Budget $8
- Ad Set 3: Daily Budget $7
```

### Шаг 5: Подготовить Test User для App Review формы

**Что указать в App Review форме (при подаче):**

```
Test User Email: test_user_12345@tfbnw.net
Test User Password: AppReview2025!

Additional Notes:
This test user has access to "Test Ad Account - App Review" with 3 active/paused campaigns.
The account demonstrates pause/resume functionality and budget management.
All campaigns have historical data for the last 3 days.

Please use this test user to verify:
1. OAuth flow (Connect with Facebook)
2. Account/Page selection modal
3. Dashboard metrics display
4. Campaign pause/resume with confirmation dialogs
5. Ad Set budget editing
```

---

## 🎥 ПЕРЕД ЗАПИСЬЮ СКРИНКАСТОВ

### Чеклист подготовки:

#### Технические требования:
- [ ] Test User создан и имеет пароль
- [ ] Test Ad Account существует с 3+ кампаниями
- [ ] Кампании имеют метрики (spend, impressions, leads)
- [ ] OAuth работает на `https://performanteaiagency.com`
- [ ] Интерфейс на английском (проверить в браузере)

#### Инструменты для записи:
- [ ] QuickTime (Mac) или OBS Studio (Windows/Mac)
- [ ] Микрофон настроен и проверен
- [ ] Браузер: Chrome в **Incognito mode** (чистый профиль)
- [ ] Разрешение экрана: минимум 1280x720
- [ ] Закрыты все лишние вкладки и уведомления

#### Финальная проверка интерфейса:
- [ ] Dashboard открывается корректно
- [ ] Profile → Facebook Ads connection работает
- [ ] OAuth redirect работает
- [ ] Модальное окно Account/Page selection появляется
- [ ] Campaign List показывает кампании
- [ ] Pause/Resume показывает confirmation
- [ ] Budget Change работает на Campaign Detail

---

## 📝 ЧТО ПОКАЗЫВАТЬ В СКРИНКАСТАХ

### ✅ ОБЯЗАТЕЛЬНО показать:

1. **OAuth Flow:**
   - Click "Connect with Facebook"
   - Facebook dialog с permissions
   - Redirect обратно в приложение
   - Модальное окно Account/Page selection

2. **Dashboard:**
   - Summary Stats (Spend, Leads, CPL)
   - Campaign List с метриками
   - Кнопки: Upload Video, Upload Image

3. **Campaign Management:**
   - Toggle switch для Pause/Resume
   - **Confirmation dialog** (критично!)
   - Success message после действия
   - Обновление статуса в реальном времени

4. **Budget Change:**
   - Campaign Detail → Ad Sets list
   - Edit Budget button
   - Input с новым значением
   - **Confirmation dialog**
   - Новый бюджет отображается

5. **Profile:**
   - Facebook Ads connection status (Connected ✅)
   - User name из public_profile

### ❌ НЕ показывать:

- ❌ Раздел "Videos" (его нет в App Review)
- ❌ Раздел "ROI Analytics" (скрыт)
- ❌ Раздел "Creatives" (скрыт)
- ❌ TikTok кнопки/интеграцию
- ❌ AI Autopilot карточку
- ❌ Directions (Направления бизнеса)
- ❌ Автозапуск/Ручной запуск
- ❌ Массовые действия (bulk pause)
- ❌ Telegram интеграцию
- ❌ OpenAI API Key поле

---

## 🚀 ПОСЛЕ ЗАПИСИ

### Чеклист перед отправкой:

- [ ] Записаны все 7 видео
- [ ] Каждое видео 2-3 минуты
- [ ] Качество: минимум 720p, формат MP4
- [ ] Звук четкий, речь на английском
- [ ] Показаны confirmation dialogs
- [ ] Не показаны AI/автоматизация
- [ ] Видео названы четко:
  - `public_profile.mp4`
  - `business_management.mp4`
  - `pages_show_list.mp4`
  - `pages_manage_ads.mp4`
  - `ads_read.mp4`
  - `ads_management.mp4`
  - `ads_management_standard_access.mp4`

### Следующий шаг:

```bash
# Откройте готовые тексты для App Review формы:
open APP_REVIEW_TEXTS.md

# Перейдите к подаче заявки:
https://developers.facebook.com/apps/1441781603583445/app-review/
```

---

## ✅ ВСЁ ГОТОВО!

**Финальный статус:**
- ✅ Фронтенд App Review версия готова
- ✅ Все тексты на английском
- ✅ Confirmation dialogs работают
- ✅ Ненужные разделы скрыты
- ✅ Сценарии обновлены
- ⏳ Осталось: записать скринкасты + создать test users

**Удачи с записью! 🎬**


