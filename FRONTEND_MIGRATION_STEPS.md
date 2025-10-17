# 📦 Пошаговая миграция Frontend кода

Быстрая инструкция по переносу кода из GitHub в монорепо.

## ✅ Шаг 1: Клонирование кода (3 мин)

```bash
# Перейдите в корень проекта
cd /Users/anatolijstepanov/agents-monorepo

# Клонируйте frontend во временную папку
git clone -b test-deploy https://github.com/dengineproblem/ad-dash-telegram-bot-65.git /tmp/frontend-temp

# Проверьте, что клонирование прошло успешно
ls -la /tmp/frontend-temp
```

**Что должно быть:**
- ✅ `package.json` - зависимости проекта
- ✅ `next.config.js` или `next.config.mjs` - конфигурация Next.js
- ✅ `app/` или `pages/` - директория с страницами
- ✅ `public/` - статические файлы
- ✅ `.env.example` или `.env.local` - переменные окружения

---

## ✅ Шаг 2: Копирование в монорепо (2 мин)

```bash
# Создайте директорию для frontend (если её нет)
mkdir -p services/frontend

# Скопируйте все файлы (кроме .git)
rsync -av --exclude='.git' --exclude='node_modules' --exclude='.next' /tmp/frontend-temp/ services/frontend/

# Или используйте cp (альтернатива):
# cp -r /tmp/frontend-temp/* services/frontend/
# cp /tmp/frontend-temp/.env.example services/frontend/ 2>/dev/null || true
# cp /tmp/frontend-temp/.gitignore services/frontend/ 2>/dev/null || true

# Очистите временную папку
rm -rf /tmp/frontend-temp

# Проверьте результат
ls -la services/frontend/
```

---

## ✅ Шаг 3: Проверка package.json (2 мин)

```bash
# Откройте package.json
cat services/frontend/package.json
```

**Важно проверить:**

1. **Скрипты сборки:**
   ```json
   {
     "scripts": {
       "dev": "next dev",
       "build": "next build",
       "start": "next start"
     }
   }
   ```

2. **Если используется standalone output, проверьте next.config.js:**
   ```javascript
   // services/frontend/next.config.js
   module.exports = {
     output: 'standalone',  // ✅ Это должно быть для Docker
     // ... остальные настройки
   }
   ```

3. **Если `output: 'standalone'` отсутствует, добавьте его:**
   ```bash
   # Отредактируйте next.config.js
   nano services/frontend/next.config.js
   ```

---

## ✅ Шаг 4: Настройка переменных окружения (5 мин)

### 4.1 Скопируйте существующие переменные из Lovable

Если у вас есть `.env` файлы в Lovable проекте:

```bash
# Посмотрите пример переменных
cat services/frontend/.env.example 2>/dev/null || echo "Файл не найден"
cat services/frontend/.env.local 2>/dev/null || echo "Файл не найден"
```

### 4.2 Создайте .env.frontend в корне монорепо

```bash
# Скопируйте шаблон
cp env.frontend.example .env.frontend

# Отредактируйте файл
nano .env.frontend
```

### 4.3 Важные переменные для обновления

```bash
# .env.frontend

# ✅ URL backend API (для Docker сети)
NEXT_PUBLIC_API_URL=http://agent-service:8082

# ✅ Базовый URL приложения
NEXT_PUBLIC_APP_URL=http://localhost

# ✅ Скопируйте остальные переменные из вашего Lovable проекта
# Например:
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

**💡 Где найти переменные Lovable:**
1. Откройте ваш проект на Lovable
2. Settings → Environment Variables
3. Скопируйте все `NEXT_PUBLIC_*` переменные
4. Добавьте их в `.env.frontend`

---

## ✅ Шаг 5: Обновление next.config.js (3 мин)

Убедитесь, что Next.js настроен для Docker:

```bash
# Откройте конфигурацию
nano services/frontend/next.config.js
```

**Добавьте/проверьте:**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ ОБЯЗАТЕЛЬНО для Docker
  output: 'standalone',
  
  // ✅ Если используете внешние изображения
  images: {
    domains: ['your-image-domain.com'],
    // или
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  
  // ✅ Если нужен strict mode
  reactStrictMode: true,
  
  // ✅ Отключить telemetry
  telemetry: false,
}

module.exports = nextConfig
```

---

## ✅ Шаг 6: Проверка Dockerfile (1 мин)

Dockerfile уже создан! Проверьте его:

```bash
cat services/frontend/Dockerfile
```

**Если файл есть и выглядит корректно - переходите к следующему шагу.**

---

## ✅ Шаг 7: Локальная сборка и тест (5 мин)

### 7.1 Соберите только frontend

```bash
cd /Users/anatolijstepanov/agents-monorepo

# Соберите образ frontend
docker compose build frontend
```

**Возможные ошибки и решения:**

**Ошибка: `Cannot find module 'next'`**
```bash
# Решение: проверьте package.json, должен быть:
# "dependencies": { "next": "^14.0.0", ... }
```

**Ошибка: `output: 'standalone' not found`**
```bash
# Решение: добавьте в next.config.js:
# output: 'standalone'
```

### 7.2 Запустите frontend отдельно для теста

```bash
# Запустите только frontend (без nginx пока)
docker compose up frontend

# В другом терминале проверьте:
curl http://localhost:3001
```

**Ожидаемый результат:**
- ✅ Frontend запустился без ошибок
- ✅ Логи показывают `ready started server on [::]:3000`
- ✅ http://localhost:3001 отвечает HTML-страницей

---

## ✅ Шаг 8: Запуск полного стека (3 мин)

```bash
# Остановите предыдущий запуск
docker compose down

# Запустите весь стек (включая nginx)
docker compose up -d --build

# Проверьте статус
docker compose ps
```

**Должны быть запущены:**
- ✅ agent-brain
- ✅ agent-service
- ✅ creative-analyzer
- ✅ **frontend** (новый!)
- ✅ **nginx** (новый!)
- ✅ loki
- ✅ grafana
- ✅ promtail

---

## ✅ Шаг 9: Проверка работы (5 мин)

### 9.1 Откройте в браузере

- **Frontend через Nginx:** http://localhost
- **Frontend напрямую:** http://localhost:3001
- **Backend API:** http://localhost/api/health

### 9.2 Проверьте в DevTools

1. Откройте http://localhost
2. Нажмите F12 → вкладка Network
3. Обновите страницу
4. Проверьте:
   - ✅ Нет ошибок 404
   - ✅ API запросы идут на `/api/*`
   - ✅ Нет CORS ошибок

### 9.3 Проверьте логи

```bash
# Логи frontend
docker compose logs frontend --tail 50

# Логи nginx
docker compose logs nginx --tail 20

# Все логи вместе
docker compose logs --tail 100
```

**Что искать:**
- ✅ Нет ошибок `Error: ...`
- ✅ Frontend успешно запустился
- ✅ Nginx проксирует запросы

---

## 🎉 Готово!

Если все шаги пройдены успешно:

✅ Frontend код перенесен в монорепо
✅ Docker образ собирается без ошибок
✅ Приложение доступно через http://localhost
✅ API запросы работают через nginx

---

## 🔧 Отладка частых проблем

### Проблема: "Cannot find module"

```bash
# Войдите в контейнер
docker compose exec frontend sh

# Проверьте установленные пакеты
ls -la node_modules/

# Если пусто - пересоберите:
docker compose build --no-cache frontend
```

### Проблема: API запросы не работают (404)

```bash
# Проверьте переменные окружения в контейнере
docker compose exec frontend env | grep NEXT_PUBLIC

# Должно быть:
# NEXT_PUBLIC_API_URL=http://agent-service:8082
```

**Если переменные не видны:**
1. Проверьте `.env.frontend` в корне
2. Убедитесь, что он указан в `docker-compose.yml`
3. Пересоберите: `docker compose up -d --build frontend`

### Проблема: "ERR_EMPTY_RESPONSE" в браузере

```bash
# Проверьте логи nginx
docker compose logs nginx

# Проверьте, что frontend отвечает
curl http://localhost:3001

# Если не отвечает - проверьте логи frontend
docker compose logs frontend --tail 100
```

### Проблема: Сборка зависает на npm install

```bash
# Пересоберите без кеша
docker compose build --no-cache frontend --progress=plain

# Если долго - проверьте package-lock.json
cat services/frontend/package-lock.json | head -20
```

---

## 📋 Чек-лист завершения

- [ ] Код склонирован из GitHub
- [ ] Файлы скопированы в `services/frontend/`
- [ ] `next.config.js` имеет `output: 'standalone'`
- [ ] `.env.frontend` создан и заполнен
- [ ] Docker образ собирается без ошибок
- [ ] Frontend доступен на http://localhost:3001
- [ ] Frontend через nginx на http://localhost
- [ ] API запросы работают через `/api/*`
- [ ] Нет ошибок в логах
- [ ] DevTools показывает успешные запросы

---

## 🚀 Следующий шаг

После успешного локального тестирования переходите к деплою на сервер!

См. [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) → ШАГ 8: Деплой на продакшн

