# 🚀 Деплой фикса для process-video endpoint

**Дата**: 2025-11-07  
**Коммит**: `a22a460`  
**Проблема**: 404 Not Found на `https://agents.performanteaiagency.com/api/process-video`

---

## 📋 Что было исправлено

### Проблема
`creativesApi.ts` использовал устаревшие переменные окружения с жестко зашитыми URL:
```typescript
// ❌ БЫЛО
const videoEndpoint = (import.meta as any).env?.VITE_N8N_CREATIVE_WEBHOOK_URL 
  || 'http://localhost:8082/api/process-video';
```

Это нарушало правила из `FRONTEND_API_CONVENTIONS.md` и приводило к:
- Дублированию `/api/api/` на некоторых доменах
- 404 ошибкам на `agents.performanteaiagency.com`
- Несогласованности между API сервисами

### Решение
Теперь `creativesApi.ts` использует единый `API_BASE_URL`:
```typescript
// ✅ СТАЛО
import { API_BASE_URL } from '@/config/api';
const videoEndpoint = `${API_BASE_URL}/process-video`;
```

---

## 🔧 Инструкция по деплою

### Шаг 1: Запушить изменения (локально)
```bash
cd ~/agents-monorepo
git push origin main
```

### Шаг 2: На сервере - подтянуть код
```bash
ssh root@your-server

cd ~/agents-monorepo
git pull origin main
```

### Шаг 3: Пересобрать фронтенд контейнеры
```bash
# Production версия (app.performanteaiagency.com)
docker-compose build --no-cache frontend
docker-compose up -d frontend

# App Review версия (performanteaiagency.com)
docker-compose build --no-cache frontend-appreview
docker-compose up -d frontend-appreview
```

**Почему `--no-cache`?**  
Чтобы гарантировать пересборку с новым кодом, без использования старых layers.

### Шаг 4: Проверить статус
```bash
docker ps | grep frontend
```

Оба контейнера должны быть `Up`:
- `agents-monorepo-frontend-1`
- `agents-monorepo-frontend-appreview-1`

### Шаг 5: Проверить логи (опционально)
```bash
docker-compose logs -f frontend --tail 50
docker-compose logs -f frontend-appreview --tail 50
```

---

## ✅ Проверка работоспособности

### 1. Проверить через браузер
Открыть:
- Production: https://app.performanteaiagency.com
- App Review: https://performanteaiagency.com

Загрузить видео через Actions → Upload Video

### 2. Проверить в DevTools Console
Должен быть запрос:
```
POST https://app.performanteaiagency.com/api/process-video
```

**НЕ должно быть:**
- ❌ `/api/api/process-video` (дублирование)
- ❌ `404 Not Found`

### 3. Проверить через curl (на сервере)
```bash
# Тест endpoint напрямую (должен быть 404 для GET, но endpoint существует)
curl -v https://app.performanteaiagency.com/api/process-video

# Должен вернуть:
# < HTTP/2 404
# {"message":"Route GET:/process-video not found","error":"Not Found","statusCode":404}

# Это нормально! Endpoint принимает только POST запросы.
# Главное что не "404 page not found" от nginx.
```

---

## 📊 Что изменилось на уровне URL

| Среда | Старый URL (не работал) | Новый URL (работает) |
|-------|------------------------|---------------------|
| **Локальная разработка** | `http://localhost:8082/api/process-video` | `http://localhost:8082/api/process-video` ✅ |
| **Production (app.performanteaiagency.com)** | `https://app.../api/process-video` | `https://app.../api/process-video` ✅ |
| **App Review (performanteaiagency.com)** | `https://performanteaiagency.com/api/process-video` | `https://performanteaiagency.com/api/process-video` ✅ |

**Технически URL не изменились, но теперь они формируются ПРАВИЛЬНО:**
- Из единого `API_BASE_URL` 
- Без жестко зашитых значений
- Следуя правилам документа `FRONTEND_API_CONVENTIONS.md`

---

## 🎯 Что это решает

✅ Унификация всех API endpoints  
✅ Исчезновение дублирования `/api/api/`  
✅ Решение 404 на process-video  
✅ Следование единому стандарту  
✅ Упрощение поддержки кода  

**Теперь ВСЕ API сервисы работают по одним правилам!** 🎉

---

## 📝 Примечания

- Backend (`agent-service`) **НЕ требует** изменений
- Nginx конфигурация **НЕ требует** изменений
- Изменения **полностью обратно совместимы**
- Все остальные API endpoints продолжают работать как и раньше

---

## 🐛 Если что-то пошло не так

### Проблема: Контейнер не запускается
```bash
# Проверить логи сборки
docker-compose logs frontend

# Пересобрать с нуля
docker-compose down frontend
docker rmi agents-monorepo-frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

### Проблема: Изменения не применяются
```bash
# Очистить кэш Docker
docker system prune -f

# Пересобрать
docker-compose build --no-cache frontend frontend-appreview
docker-compose up -d
```

### Проблема: 502 Bad Gateway
```bash
# Проверить backend
docker ps | grep agent-service

# Перезапустить agent-service
docker-compose restart agent-service
```

---

**После деплоя можно удалить этот файл.**







