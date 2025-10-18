# ✅ Facebook Login - Настройка и Деплой

## 📋 Что было сделано

### Backend (agent-service)
- ✅ Создан endpoint `/facebook/oauth/token` для обмена code на access_token
- ✅ Получение информации о пользователе, ad accounts и pages
- ✅ Все данные возвращаются frontend для сохранения

### Frontend
- ✅ Добавлен Facebook в `ConnectionsGrid` в Profile
- ✅ Добавлено уведомление на Dashboard, если Facebook не подключен
- ✅ Обработка OAuth callback в Profile.tsx
- ✅ Автоматическое сохранение данных в localStorage

---

## 🚀 Деплой на сервер

### 1. Коммит и пуш изменений

```bash
cd /Users/anatolijstepanov/agents-monorepo

git add .
git commit -m "feat: добавлена интеграция Facebook OAuth для подключения рекламных кабинетов"
git push origin main
```

### 2. На сервере - обновление кода

```bash
cd ~/agents-monorepo
git pull origin main
```

### 3. Добавить переменные окружения

Добавьте в `.env` файл (если еще нет):

```bash
# Facebook App Configuration
FB_APP_ID=690472653668355
FB_APP_SECRET=ваш_app_secret_от_facebook
FB_REDIRECT_URI=https://performanteaiagency.com/profile
```

**Где взять FB_APP_SECRET:**
1. Откройте https://developers.facebook.com/apps/690472653668355/settings/basic/
2. Найдите "App Secret" → нажмите "Show"
3. Скопируйте значение

### 4. Пересборка и перезапуск

```bash
# Пересоберите и перезапустите сервисы
docker-compose up -d --build

# Проверьте логи
docker-compose logs -f agent-service
docker-compose logs -f frontend
```

---

## ⚙️ Настройка Facebook App

### 1. Valid OAuth Redirect URIs

Откройте: https://developers.facebook.com/apps/690472653668355/fb-login/settings/

**Добавьте (если еще нет):**
```
https://performanteaiagency.com/profile
```

### 2. App Domains

Откройте: https://developers.facebook.com/apps/690472653668355/settings/basic/

**Убедитесь, что добавлен:**
```
performanteaiagency.com
```

### 3. Проверьте другие настройки

- ✅ **Privacy Policy URL**: https://performanteaiagency.com/privacy
- ✅ **Terms of Service URL**: https://performanteaiagency.com/terms
- ✅ **User Data Deletion**: https://performanteaiagency.com/api/facebook/data-deletion
- ✅ **App Icon**: загружен (1024x1024)

---

## 🧪 Тестирование

### 1. Проверьте backend endpoint

```bash
# Проверьте, что endpoint доступен
curl -I https://performanteaiagency.com/api/facebook/oauth/token

# Ожидается: 400 Bad Request (это нормально без параметров)
# Главное чтобы не было 404
```

### 2. Тестовый flow

1. **Войдите в приложение** обычным логином (username/password)
   - URL: https://performanteaiagency.com/login

2. **Перейдите в Profile**
   - URL: https://performanteaiagency.com/profile

3. **Найдите секцию "Подключения платформ"**
   - Должна быть карточка "Facebook Ads" со статусом "Not connected"

4. **Нажмите "Connect"**
   - Откроется окно Facebook OAuth
   - Выберите ad account и page
   - После подтверждения вернетесь в Profile
   - Статус должен измениться на "Connected"

5. **Проверьте Dashboard**
   - URL: https://performanteaiagency.com/
   - Если Facebook не подключен - должно быть синее уведомление с кнопкой "Подключить"
   - После подключения - уведомление исчезнет

---

## 📱 Как это работает для пользователя

### Сценарий 1: Новый пользователь

1. Регистрация через `/signup` (username/password)
2. Логин через `/login`
3. На Dashboard видит уведомление: "Для просмотра статистики требуется подключение Facebook Ads"
4. Нажимает "Подключить" → OAuth → возврат в Profile
5. Facebook подключен ✅

### Сценарий 2: Существующий пользователь

1. Логин через `/login`
2. Переходит в Profile
3. Видит секцию "Подключения" с Facebook, Instagram, TikTok
4. Нажимает "Connect" на Facebook → OAuth → готово ✅

### Сценарий 3: Отключение Facebook

1. В Profile нажимает на карточку Facebook
2. Кнопка "Disconnect" (если подключен)
3. Подтверждение → отключено
4. Можно подключить заново

---

## 🔐 Безопасность

- ✅ `code` обменивается на токен **через backend** (не на frontend)
- ✅ `client_secret` хранится только на сервере
- ✅ `access_token` сохраняется в localStorage (временно, до интеграции с Supabase)
- ✅ CSRF защита через `state` parameter

---

## 📝 Что нужно для App Review

После деплоя и тестирования:

1. **Запишите скринкаст** (2-3 минуты):
   - Логин в приложение
   - Dashboard с уведомлением
   - Подключение Facebook (полный OAuth flow)
   - Успешное подключение + отображение данных

2. **Используйте тексты из предыдущего ответа** для заполнения форм

3. **Подождите 1-24 часа** после выполнения тестовых API вызовов

4. **Загрузите скринкаст** и отправьте на Review

---

## ❓ Возможные проблемы

### Ошибка: "Redirect URI mismatch"
**Решение:** Проверьте, что в Facebook App добавлен точный redirect URI: `https://performanteaiagency.com/profile`

### Ошибка: "Invalid code"
**Решение:** Code может быть использован только один раз. Попробуйте заново начать OAuth flow.

### Ошибка: "No ad accounts found"
**Решение:** Убедитесь, что у тестового пользователя есть доступ хотя бы к одному ad account в Facebook Business Manager.

### Backend endpoint возвращает 404
**Решение:** Проверьте, что сервис `agent-service` запущен и переменные окружения установлены корректно.

---

## 🎯 Следующие шаги

После успешного деплоя и тестирования:

1. ✅ Убедитесь, что все работает на production
2. ✅ Запишите скринкаст для App Review
3. ✅ Заполните формы в Facebook Developer Console
4. ✅ Отправьте на Review
5. ⏳ Ждите одобрения (3-7 дней)

---

**Статус:** Готово к деплою! 🚀

