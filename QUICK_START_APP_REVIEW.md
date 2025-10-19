# ⚡ БЫСТРЫЙ СТАРТ: Facebook App Review

**Цель:** Пройти Facebook App Review для получения разрешений Marketing API

**Время:** ~4 часа (подготовка 1.5ч + запись 2ч + подача 0.5ч)

---

## 🎯 ЧТО НУЖНО СДЕЛАТЬ

### 1️⃣ Подготовка (1.5 часа)

```bash
# Откройте этот файл и следуйте инструкциям:
open APP_REVIEW_PREPARATION.md
```

**Кратко:**
- ✅ Настроить Facebook App (Icon, URLs, Domains)
- ✅ Создать тестового пользователя Facebook
- ✅ Создать тестовый Ad Account с 3 кампаниями
- ✅ Переключить интерфейс на английский язык
- ✅ Протестировать OAuth flow

### 2️⃣ Запись скринкастов (2 часа)

```bash
# Откройте детальные сценарии:
open SCREENCAST_SCENARIOS.md
```

**Записать 7 видео (2-3 мин каждое):**

1. `public_profile.mp4` - показать использование имени пользователя
2. `business_management.mp4` - показать выбор Ad Account из списка
3. `pages_show_list.mp4` - показать выбор Facebook Page
4. `pages_manage_ads.mp4` - показать pause/resume кампании
5. `ads_read.mp4` - показать Dashboard с метриками
6. `ads_management.mp4` - показать pause/resume и budget change ⚠️ **ВАЖНЕЙШЕЕ**
7. `ads_management_standard_access.mp4` - показать работу с большим объемом данных

**Требования:**
- Английский язык (речь и интерфейс)
- Качество: минимум 720p, формат MP4
- Показывать user confirmations (диалоги подтверждения)
- НЕ показывать: AI Autopilot, Telegram, автоматизацию

### 3️⃣ Подача на Review (30 минут)

```bash
# Откройте готовые тексты для формы:
open APP_REVIEW_TEXTS.md
```

**Действия:**
1. Перейти: https://developers.facebook.com/apps/1441781603583445/app-review/
2. Для каждого из 7 permissions:
   - Click "Request Advanced Access"
   - Скопировать текст из `APP_REVIEW_TEXTS.md`
   - Загрузить соответствующее видео
   - Save
3. Указать Test User credentials
4. Click "Submit for Review"

---

## 📚 ТРИ ГЛАВНЫХ ДОКУМЕНТА

| Файл | Когда использовать |
|------|-------------------|
| **APP_REVIEW_PREPARATION.md** | 🛠️ СЕЙЧАС - для подготовки Test User и кампаний |
| **SCREENCAST_SCENARIOS.md** | 🎬 При записи - детальные сценарии по секундам |
| **APP_REVIEW_TEXTS.md** | 📝 При заполнении формы - copy/paste тексты |

---

## ✅ ЧЕКЛИСТ

### Перед записью:
- [ ] Test User создан (email + password)
- [ ] Test Ad Account имеет 3+ кампании (1 ACTIVE, 1 PAUSED, 1 с ad sets)
- [ ] Facebook App настроен (Icon, URLs)
- [ ] Интерфейс на английском
- [ ] OAuth flow протестирован
- [ ] Микрофон работает
- [ ] Браузер в Incognito mode

### Во время записи:
- [ ] Говорить медленно и четко (английский)
- [ ] Показывать confirmation dialogs
- [ ] Уложиться в 2-3 минуты
- [ ] Качество 720p+, формат MP4

### Перед отправкой:
- [ ] Все 7 видео записаны
- [ ] Каждое видео <100 MB
- [ ] Все тексты подготовлены
- [ ] Test credentials готовы
- [ ] Privacy Policy/Terms доступны

---

## 🚨 КРИТИЧЕСКИЕ МОМЕНТЫ

### ⚠️ ads_management - САМЫЙ ВАЖНЫЙ!

Это permission, который Facebook проверяет особенно тщательно.

**Обязательно показать:**
1. ✅ User manually clicks "Pause" button
2. ✅ Confirmation dialog appears: "Are you sure?"
3. ✅ User clicks "Confirm"
4. ✅ Success message shows
5. ✅ Campaign status updates

**НЕ показывать:**
- ❌ Автоматическую паузу (cron, AI Autopilot)
- ❌ Массовые действия (pause all)
- ❌ Действия без confirmation

### ⚠️ Язык интерфейса

**КРИТИЧНО:** Интерфейс ДОЛЖЕН быть на английском!

Если интерфейс на русском:
```bash
# Временное решение:
1. Изменить язык браузера на English
2. Очистить localStorage (F12 → Application → Local Storage → Clear)
3. Перезагрузить страницу

# Постоянное решение (если есть i18n):
# Изменить defaultLanguage в коде на 'en'
```

### ⚠️ Test User credentials

В форме App Review ОБЯЗАТЕЛЬНО указать:
```
Email: test_xxxx@tfbnw.net
Password: [ваш пароль]

Note: This test user has access to "Test Ad Account" with active campaigns.
```

Без работающих test credentials Facebook **отклонит** заявку!

---

## 🎬 ПОРЯДОК ЗАПИСИ (рекомендуемый)

**От простого к сложному:**

1. ✅ `public_profile` (простой, 2 мин) - разогрев
2. ✅ `pages_show_list` (простой, 2 мин)
3. ✅ `business_management` (средний, 2.5 мин)
4. ✅ `ads_read` (средний, 2.5 мин)
5. ✅ `pages_manage_ads` (средний, 2.5 мин)
6. ✅ `ads_management_standard_access` (простой, 2 мин)
7. ✅ **`ads_management`** (сложный, 3 мин) - **САМЫЙ ВАЖНЫЙ**, оставить напоследок

**Почему такой порядок:**
- Простые видео сначала → набираетесь опыта
- ads_management в конце → когда уже уверенно записываете

---

## 📞 ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК

### "OAuth не работает"
```
Решение:
1. Проверить Valid OAuth Redirect URIs:
   https://developers.facebook.com/apps/1441781603583445/fb-login/settings/
   
2. Должно быть:
   https://performanteaiagency.com/profile
```

### "Test User не может залогиниться"
```
Решение:
1. Roles → Test Users
2. Click "Change password"
3. Установить простой пароль: TestUser2025!
4. Попробовать снова
```

### "Нет кампаний для демонстрации"
```
Решение:
1. Залогиниться как Test User на facebook.com
2. Перейти: https://adsmanager.facebook.com
3. Создать 3 простые кампании (можно без креативов)
4. Оставить минимальный бюджет $1/day
```

### "Видео слишком большое"
```
Решение:
ffmpeg -i input.mp4 -vcodec h264 -b:v 2000k output.mp4
```

### "Интерфейс на русском"
```
Решение:
1. Chrome Settings → Languages → English (move to top)
2. F12 → Application → Local Storage → Clear All
3. Перезагрузить страницу
```

---

## 🎯 ПОСЛЕ ОТПРАВКИ

**Что происходит:**
1. Facebook ревьюер получает вашу заявку
2. Смотрит все 7 видео
3. Тестирует приложение через Test User
4. Проверяет Privacy Policy, Terms, Data Deletion
5. Принимает решение: одобрить или отклонить

**Сроки:**
- ⏱️ Среднее время: 3-7 рабочих дней
- 📧 Ответ приходит на email привязанный к Facebook Developer Account

**Если одобрили:**
- ✅ Permissions получают "Advanced Access"
- ✅ Можно использовать API в production
- ✅ Лимиты API увеличены

**Если отклонили:**
- ❌ Придет письмо с объяснением причины
- ✅ Можно исправить и подать повторно (неограниченное количество раз)
- ✅ Обычно проблемы: недостаточно детальное видео, нет user confirmations, автоматизация

---

## 📊 СТАТИСТИКА

**Вероятность одобрения:**
- 🟢 90%+ если следовали инструкциям
- 🟡 70% если допустили мелкие ошибки (недостаточно детальное видео)
- 🔴 30% если показали автоматизацию без user control

**Типичные причины отклонения:**
1. Нет confirmation dialogs перед действиями
2. Показана автоматизация (AI, cron)
3. Интерфейс не на английском
4. Test User не работает
5. Видео слишком короткое/нечеткое

---

## ✅ ГОТОВЫ?

Если прочитали этот файл и понимаете что делать:

1. 📖 Откройте `APP_REVIEW_PREPARATION.md` - начните подготовку
2. 🎬 Запишите 7 видео по сценариям из `SCREENCAST_SCENARIOS.md`
3. 📝 Заполните форму текстами из `APP_REVIEW_TEXTS.md`
4. 🚀 Submit for Review!

**Удачи!** 🎉

---

## 📞 ПОДДЕРЖКА

**Документация Facebook:**
- App Review Guide: https://developers.facebook.com/docs/app-review
- Marketing API: https://developers.facebook.com/docs/marketing-apis

**Локальные файлы:**
- Детальная подготовка: `APP_REVIEW_PREPARATION.md`
- Сценарии видео: `SCREENCAST_SCENARIOS.md`
- Тексты для формы: `APP_REVIEW_TEXTS.md`
- Статус проекта: `FACEBOOK_APP_REVIEW_STATUS.md`

**Если нужна помощь:**
- Перечитайте соответствующий раздел в детальных документах
- Проверьте чеклисты
- Facebook Developer Support: https://developers.facebook.com/support/

---

**Время начать:** СЕЙЧАС! ⏰

**Ожидаемый результат:** Одобрение через 3-7 дней ✅

**Поехали! 🚀**

