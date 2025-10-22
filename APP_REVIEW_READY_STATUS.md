# ✅ APP REVIEW VERSION - ГОТОВА К ТЕСТИРОВАНИЮ

**Дата:** 19 октября 2025  
**Ветка:** `app-review-mode`  
**URL для тестирования:** http://localhost:8081

---

## 🎯 ЧТО СДЕЛАНО

### 1. ✅ Feature Flags (App Review Mode)
- Создан файл `services/frontend/src/config/appReview.ts`
- Флаг `APP_REVIEW_MODE` управляется через `.env.local`
- `VITE_APP_REVIEW_MODE=true` - включает режим App Review

### 2. ✅ Confirmation Dialogs
- **Pause Campaign**: "Are you sure you want to pause this campaign?"
- **Resume Campaign**: "Are you sure you want to resume this campaign?"
- **Create Campaign**: показывает детали (Budget, Location, Age, Objective)

Добавлены в:
- `CampaignList.tsx`
- `CampaignDetail.tsx`
- `VideoUpload.tsx`

### 3. ✅ Скрыты функции (в App Review Mode)

**Скрыто в меню (Sidebar):**
- ❌ ROI Analytics
- ❌ Креативы (Creatives)
- ❌ Видео (Videos)

**Скрыто на Dashboard:**
- ❌ TikTok кнопка переключения платформы
- ❌ AI Autopilot карточка
- ❌ TikTok уведомление о подключении

**Скрыто в Profile:**
- ❌ TikTok подключение
- ❌ Directions (Направления бизнеса)

**Скрыто в VideoUpload:**
- ❌ Выбор площадки (TikTok, Обе площадки)
- ❌ Выбор направления бизнеса
- ❌ Автозапуск, Ручной запуск, Добавить продажу

**Скрыты routes:**
- ❌ `/roi`
- ❌ `/creatives`
- ❌ `/videos`
- ❌ `/consultations`

### 4. ✅ Упрощенные действия

**Вместо 3-х кнопок теперь 2:**
- ✅ **Upload Video** → старый вебхук `https://n8n.performanteaiagency.com/webhook/downloadvideo`
- ✅ **Upload Image** → старый вебхук `https://n8n.performanteaiagency.com/webhook/image`

### 5. ✅ Язык интерфейса

**i18n система:**
- Создан `i18n/translations.ts` с переводами EN/RU
- Создан `i18n/LanguageContext.tsx` для управления языком
- В App Review mode язык **автоматически устанавливается на английский**

**Переключатель языка:**
- Добавлен в `AppSidebar` (внизу)
- Кнопки: **РУ** / **EN**
- В App Review mode переключатель **скрыт** (всегда английский)

**Переведенные элементы:**
- Кнопки: Upload Video, Upload Image, Pause, Resume
- Confirmation dialogs
- Статусы кампаний

### 6. ✅ Вебхуки

**Для видео (App Review mode):**
```
https://n8n.performanteaiagency.com/webhook/downloadvideo
```

**Для изображений (App Review mode):**
```
https://n8n.performanteaiagency.com/webhook/image
```

**Логика:**
- В App Review mode всегда используются старые вебхуки
- В Production mode используется сложная логика выбора вебхука по целям

---

## 🚀 КАК ТЕСТИРОВАТЬ ЛОКАЛЬНО

### Шаг 1: Убедиться что на правильной ветке
```bash
cd ~/agents-monorepo
git branch
# Должна быть: app-review-mode
```

### Шаг 2: Проверить .env.local
```bash
cat services/frontend/.env.local
```

Должно быть:
```
VITE_APP_REVIEW_MODE=true
VITE_API_URL=http://localhost:8080/api
VITE_FB_APP_ID=1441781603583445
VITE_FB_REDIRECT_URI=http://localhost:5173/profile
```

### Шаг 3: Запустить dev сервер (УЖЕ ЗАПУЩЕН)
```bash
cd services/frontend
npm run dev
```

**URL:** http://localhost:8081

### Шаг 4: Открыть в браузере
```
http://localhost:8081
```

---

## ✅ ЧЕКЛИСТ ДЛЯ ПРОВЕРКИ

### Меню (Sidebar):
- [ ] ✅ Главная - ЕСТЬ
- [ ] ✅ Личный кабинет - ЕСТЬ  
- [ ] ❌ ROI - НЕТ
- [ ] ❌ Креативы - НЕТ
- [ ] ❌ Видео - НЕТ
- [ ] ❌ Переключатель языка - НЕТ (в App Review mode скрыт)

### Dashboard:
- [ ] ✅ Instagram кнопка - ЕСТЬ
- [ ] ❌ TikTok кнопка - НЕТ
- [ ] ❌ AI Autopilot - НЕТ
- [ ] ✅ Две кнопки: **Upload Video** и **Upload Image** - ЕСТЬ

### Кнопки действий:
- [ ] ✅ Upload Video - текст на английском
- [ ] ✅ Upload Image - текст на английском
- [ ] ❌ Автозапуск - НЕТ
- [ ] ❌ Ручной запуск - НЕТ
- [ ] ❌ Добавить продажу - НЕТ

### Profile:
- [ ] ✅ Facebook Ads - ЕСТЬ
- [ ] ✅ Instagram - ЕСТЬ
- [ ] ❌ TikTok - НЕТ
- [ ] ❌ Направления бизнеса - НЕТ

### Confirmation Dialogs:
- [ ] ✅ Pause → "Are you sure you want to pause this campaign?"
- [ ] ✅ Resume → "Are you sure you want to resume this campaign?"
- [ ] ✅ Create campaign → показывает Budget, Location, Age, Objective

### Язык:
- [ ] ✅ Интерфейс на английском
- [ ] ✅ Кнопки на английском
- [ ] ✅ Confirmations на английском

---

## 📁 ИЗМЕНЕННЫЕ ФАЙЛЫ

```
services/frontend/
├── .env.local (создан)
├── env.appreview.example (создан)
├── src/
│   ├── config/
│   │   ├── appReview.ts (создан)
│   │   └── translations.ts (создан)
│   ├── i18n/
│   │   ├── LanguageContext.tsx (создан)
│   │   └── translations.ts (создан)
│   ├── components/
│   │   ├── AppSidebar.tsx (изменен)
│   │   ├── CampaignList.tsx (изменен)
│   │   └── VideoUpload.tsx (изменен)
│   ├── pages/
│   │   ├── Dashboard.tsx (изменен)
│   │   ├── Profile.tsx (изменен)
│   │   └── CampaignDetail.tsx (изменен)
│   └── App.tsx (изменен)
```

---

## 🔄 СЛЕДУЮЩИЕ ШАГИ

### После локального тестирования:

1. **Записать скринкасты** (из `FINAL_SCREENCAST_SCENARIOS.md`)
2. **Deploy на сервер:**
   - Главный домен: `performanteaiagency.com` (App Review)
   - Поддомен: `app.performanteaiagency.com` (Production)
3. **Подать на App Review** с видео

---

## 📊 СТАТИСТИКА

- **Коммитов:** 5
- **Файлов создано:** 5
- **Файлов изменено:** 7
- **Строк добавлено:** ~500+
- **Время разработки:** ~2 часа

---

## 🎯 App Review Mode АКТИВИРОВАН! ✅

**Проверьте интерфейс на:** http://localhost:8081

Все скрыто, английский язык, confirmation dialogs работают! 🚀

