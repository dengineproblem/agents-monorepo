# 🚀 БЫСТРЫЙ СТАРТ: Интеграция Frontend

Самая краткая инструкция для быстрого старта. Для детальной информации см. [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md)

---

## ⚡ За 5 минут (если всё уже готово)

```bash
# 1. Клонируйте код
git clone -b test-deploy https://github.com/dengineproblem/ad-dash-telegram-bot-65.git /tmp/frontend-temp
rsync -av --exclude='.git' --exclude='node_modules' /tmp/frontend-temp/ services/frontend/
rm -rf /tmp/frontend-temp

# 2. Создайте .env файл
cp env.frontend.example .env.frontend
# Отредактируйте .env.frontend и добавьте свои переменные

# 3. Убедитесь, что next.config.js имеет output: 'standalone'
# Откройте services/frontend/next.config.js и добавьте если нет:
# output: 'standalone'

# 4. Запустите
docker compose up -d --build

# 5. Проверьте
open http://localhost
```

---

## 📋 Пошаговый план (если нужны детали)

### Этап 1: Подготовка (10 мин)
1. ✅ Склонируйте frontend код → [FRONTEND_MIGRATION_STEPS.md](./FRONTEND_MIGRATION_STEPS.md) (Шаг 1-2)
2. ✅ Проверьте package.json → [FRONTEND_MIGRATION_STEPS.md](./FRONTEND_MIGRATION_STEPS.md) (Шаг 3)
3. ✅ Настройте переменные → [FRONTEND_MIGRATION_STEPS.md](./FRONTEND_MIGRATION_STEPS.md) (Шаг 4)

### Этап 2: Docker (5 мин)
4. ✅ Файлы уже созданы:
   - `services/frontend/Dockerfile` ✅
   - `docker-compose.yml` обновлен ✅
   - `nginx.conf` настроен ✅

### Этап 3: Тестирование (10 мин)
5. ✅ Запустите: `docker compose up -d --build`
6. ✅ Проверьте: [FRONTEND_TESTING_CHECKLIST.md](./FRONTEND_TESTING_CHECKLIST.md)

### Этап 4: Деплой (15 мин)
7. ✅ Следуйте: [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) (Шаг 8)

---

## 🆘 Проблемы?

### "Cannot find module 'next'"
```bash
docker compose build --no-cache frontend
```

### "API запросы не работают"
```bash
# Проверьте .env.frontend:
cat .env.frontend | grep NEXT_PUBLIC_API_URL
# Должно быть: NEXT_PUBLIC_API_URL=http://agent-service:8082
```

### "Frontend не запускается"
```bash
# Проверьте логи:
docker compose logs frontend --tail 100

# Проверьте next.config.js:
grep "output" services/frontend/next.config.js
# Должно быть: output: 'standalone'
```

---

## 📚 Документация

| Файл | Описание |
|------|----------|
| [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) | 📖 Полное руководство (9 шагов) |
| [FRONTEND_MIGRATION_STEPS.md](./FRONTEND_MIGRATION_STEPS.md) | 📦 Миграция кода из GitHub |
| [FRONTEND_TESTING_CHECKLIST.md](./FRONTEND_TESTING_CHECKLIST.md) | ✅ Чек-лист тестирования |
| [QUICK_START_FRONTEND.md](./QUICK_START_FRONTEND.md) | ⚡ Этот файл (быстрый старт) |

---

## ✅ Следующие шаги

После успешной интеграции:

1. ✅ Протестируйте локально → [FRONTEND_TESTING_CHECKLIST.md](./FRONTEND_TESTING_CHECKLIST.md)
2. ✅ Задеплойте на сервер → [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) (Шаг 8)
3. ✅ Настройте домен (опционально)
4. ✅ Удалите проект с Lovable

**Готово! 🎉**

