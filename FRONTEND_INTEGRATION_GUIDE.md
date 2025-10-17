# 🎯 Руководство по интеграции Frontend в монорепо

## 📋 Обзор

Интегрируем Next.js frontend из репозитория `ad-dash-telegram-bot-65` в монорепозиторий `agents-monorepo`.

**Текущее состояние:**
- Frontend: Next.js + React
- Хостинг: Lovable
- Репозиторий: https://github.com/dengineproblem/ad-dash-telegram-bot-65/tree/test-deploy

**Целевое состояние:**
- Frontend в `services/frontend/`
- Запуск через Docker Compose
- Nginx как reverse proxy
- Единый деплой с backend

---

## 🚀 ШАГ 1: Подготовка локальной среды (10 мин)

### 1.1 Клонируйте frontend репозиторий

```bash
# Перейдите в корень agents-monorepo
cd /Users/anatolijstepanov/agents-monorepo

# Создайте директорию для frontend
mkdir -p services/frontend

# Клонируйте frontend код во временную папку
git clone -b test-deploy https://github.com/dengineproblem/ad-dash-telegram-bot-65.git /tmp/frontend-temp

# Скопируйте содержимое (без .git)
cp -r /tmp/frontend-temp/* services/frontend/
cp /tmp/frontend-temp/.env.example services/frontend/.env.example 2>/dev/null || true
cp /tmp/frontend-temp/.gitignore services/frontend/.gitignore 2>/dev/null || true

# Очистите временную папку
rm -rf /tmp/frontend-temp

# Проверьте, что файлы скопировались
ls -la services/frontend/
```

### 1.2 Изучите структуру frontend

```bash
cd services/frontend
ls -la
```

**Ожидаемые файлы:**
- `package.json` - зависимости
- `next.config.js` - конфигурация Next.js
- `app/` или `pages/` - страницы приложения
- `.env.example` - пример переменных окружения

---

## 🐳 ШАГ 2: Создание Dockerfile для Frontend (5 мин)

Создайте файл `services/frontend/Dockerfile`:

```dockerfile
# Dockerfile уже создан в репозитории
# Проверьте его содержимое ниже
```

**Файл создан автоматически, см. `services/frontend/Dockerfile`**

---

## 📝 ШАГ 3: Настройка переменных окружения (5 мин)

### 3.1 Создайте `.env.frontend` в корне монорепо

```bash
cd /Users/anatolijstepanov/agents-monorepo
# Файл создан автоматически, см. .env.frontend
```

### 3.2 Обновите переменные под ваш проект

Отредактируйте `.env.frontend`:
- Укажите правильный `NEXT_PUBLIC_API_URL`
- Добавьте другие переменные из вашего Lovable проекта

---

## 🔧 ШАГ 4: Обновление docker-compose.yml (5 мин)

**Файл обновлен автоматически!**

Добавлены сервисы:
- `frontend` - Next.js приложение (порт 3001)
- `nginx` - Reverse proxy (порт 80)

Проверьте изменения:
```bash
cat docker-compose.yml
```

---

## 🌐 ШАГ 5: Настройка Nginx (5 мин)

**Файл `nginx.conf` обновлен автоматически!**

Конфигурация:
- `/api/*` → agent-service (backend)
- `/` → frontend (Next.js)

Проверьте конфигурацию:
```bash
cat nginx.conf
```

---

## 🧪 ШАГ 6: Локальное тестирование (10 мин)

### 6.1 Остановите текущие контейнеры

```bash
cd /Users/anatolijstepanov/agents-monorepo
docker compose down
```

### 6.2 Пересоберите и запустите всё

```bash
docker compose up -d --build
```

### 6.3 Проверьте статус

```bash
# Проверьте, что все контейнеры запущены
docker compose ps

# Должны быть запущены:
# - agent-brain
# - agent-service
# - creative-analyzer
# - frontend (НОВЫЙ!)
# - nginx (НОВЫЙ!)
# - loki
# - grafana
# - promtail
```

### 6.4 Проверьте логи

```bash
# Логи frontend
docker compose logs frontend --tail 50

# Логи nginx
docker compose logs nginx --tail 20
```

### 6.5 Откройте в браузере

- **Frontend через Nginx:** http://localhost
- **Frontend напрямую:** http://localhost:3001
- **Backend API:** http://localhost/api/health
- **Grafana:** http://localhost:3000

---

## ✅ ШАГ 7: Проверка работоспособности (5 мин)

### 7.1 Чек-лист проверки

- [ ] Frontend открывается на http://localhost
- [ ] Страницы загружаются без ошибок
- [ ] API запросы к backend работают (проверьте в DevTools → Network)
- [ ] Нет ошибок CORS
- [ ] Логи frontend без критических ошибок
- [ ] Backend API отвечает: `curl http://localhost/api/health`

### 7.2 Отладка частых проблем

**Проблема: Frontend не запускается**
```bash
# Проверьте логи
docker compose logs frontend --tail 100

# Пересоберите без кеша
docker compose build --no-cache frontend
docker compose up -d frontend
```

**Проблема: API запросы не работают (CORS)**
```bash
# Проверьте nginx конфигурацию
docker compose logs nginx

# Убедитесь, что NEXT_PUBLIC_API_URL правильный
cat .env.frontend
```

**Проблема: Порт занят**
```bash
# Проверьте, что занимает порт 80
lsof -i :80

# Измените порт nginx в docker-compose.yml:
# ports:
#   - "8080:80"  # вместо "80:80"
```

---

## 🚀 ШАГ 8: Деплой на продакшн сервер (15 мин)

### 8.1 Подготовьте изменения для git

```bash
cd /Users/anatolijstepanov/agents-monorepo

# Проверьте статус
git status

# Добавьте новые файлы
git add services/frontend/
git add docker-compose.yml
git add nginx.conf
git add .env.frontend
git add FRONTEND_INTEGRATION_GUIDE.md

# Создайте коммит
git commit -m "feat: интеграция Next.js frontend в монорепо"
```

### 8.2 Отправьте на сервер

```bash
# Отправьте в репозиторий
git push origin main
```

### 8.3 Деплой на сервере

```bash
# Подключитесь к серверу
ssh root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01

# Перейдите в директорию проекта
cd /root/agents-monorepo

# Обновите код
git pull origin main

# Скопируйте .env файлы (если их нет на сервере)
# scp /Users/anatolijstepanov/agents-monorepo/.env.frontend root@SERVER_IP:/root/agents-monorepo/

# Остановите контейнеры
docker compose down

# Пересоберите и запустите
docker compose up -d --build

# Проверьте статус
docker compose ps
docker compose logs frontend --tail 50
docker compose logs nginx --tail 20
```

### 8.4 Настройка домена (опционально)

Если хотите использовать домен (например, `app.yourdomain.com`):

1. Добавьте A-запись в DNS на IP сервера
2. Обновите `nginx.conf` с доменом и SSL (Let's Encrypt)
3. Перезапустите nginx: `docker compose restart nginx`

---

## 📊 ШАГ 9: Мониторинг и проверка (5 мин)

### 9.1 Проверьте метрики в Grafana

1. Откройте http://SERVER_IP:3000
2. Проверьте дашборд с логами
3. Убедитесь, что frontend логи поступают

### 9.2 Проверьте Telegram алерты

Если настроены алерты - проверьте, что приходят уведомления.

---

## 🔄 Что делать с Lovable?

### Вариант 1: Полный переезд (рекомендуется)
1. Протестируйте новую версию 1-2 дня
2. Перенесите домен на ваш сервер
3. Удалите проект с Lovable
4. ✅ Экономия на хостинге

### Вариант 2: Параллельная работа (для подстраховки)
1. Оставьте Lovable работать параллельно
2. Используйте поддомен для нового деплоя (staging.yourdomain.com)
3. Через неделю переключите основной домен
4. Удалите Lovable

---

## 🆘 Поддержка и отладка

### Полезные команды

```bash
# Перезапуск только frontend
docker compose restart frontend

# Просмотр логов в реальном времени
docker compose logs -f frontend

# Войти в контейнер frontend
docker compose exec frontend sh

# Проверить переменные окружения
docker compose exec frontend env | grep NEXT_PUBLIC

# Полная пересборка
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Логи и диагностика

```bash
# Все логи
docker compose logs

# Только ошибки
docker compose logs | grep -i error

# Проверка nginx конфигурации
docker compose exec nginx nginx -t
```

---

## 📝 Чек-лист завершения

- [ ] Frontend код скопирован в `services/frontend/`
- [ ] `Dockerfile` создан для Next.js
- [ ] `docker-compose.yml` обновлен с сервисами frontend и nginx
- [ ] `nginx.conf` настроен как reverse proxy
- [ ] `.env.frontend` создан и настроен
- [ ] Локальное тестирование пройдено
- [ ] Все контейнеры запускаются без ошибок
- [ ] Frontend открывается в браузере
- [ ] API запросы к backend работают
- [ ] Изменения закоммичены в git
- [ ] Деплой на продакшн сервер выполнен
- [ ] Продакшн версия протестирована
- [ ] Мониторинг настроен
- [ ] Lovable проект удален (или в режиме ожидания)

---

## 🎉 Поздравляю!

Ваш frontend теперь интегрирован в монорепо! Теперь у вас:

✅ Единый деплой для всего проекта
✅ Экономия на хостинге Lovable
✅ Полный контроль над инфраструктурой
✅ Упрощенная разработка и отладка
✅ Единая версионность frontend и backend

---

## 🔗 Полезные ссылки

- [PROJECT_OVERVIEW_RU.md](./PROJECT_OVERVIEW_RU.md) - Обзор проекта
- [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) - Руководство по деплою
- [docker-compose.yml](./docker-compose.yml) - Конфигурация Docker
- [nginx.conf](./nginx.conf) - Конфигурация Nginx

---

**Нужна помощь?** Обращайтесь! 🚀

