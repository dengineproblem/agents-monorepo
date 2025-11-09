# CRM Deployment Guide

Инструкция по развертыванию WhatsApp CRM в production.

## Предварительные требования

✅ Docker и Docker Compose установлены
✅ Nginx с SSL сертификатами (Let's Encrypt)
✅ Доступ к серверу через SSH
✅ Git репозиторий настроен
✅ Supabase проект создан
✅ Evolution API работает
✅ OpenAI API key есть

## 1. Подготовка сервера

### Обновить код

```bash
cd ~/agents-monorepo
git pull origin main
```

### Создать .env.crm

```bash
cd ~/agents-monorepo
cp .env.crm.example .env.crm
nano .env.crm
```

Заполнить:
```bash
PORT=8084
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_NAME=evolution
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_PASSWORD=your-evolution-db-password
OPENAI_API_KEY=sk-your-openai-key
```

## 2. Сборка Docker образов

### Backend

```bash
docker-compose build crm-backend
```

Проверка:
```bash
docker images | grep crm-backend
```

### Frontend

```bash
docker-compose build crm-frontend
```

Проверка:
```bash
docker images | grep crm-frontend
```

## 3. Запуск сервисов

### Запустить backend

```bash
docker-compose up -d crm-backend
```

Проверить логи:
```bash
docker-compose logs -f crm-backend
```

Проверить health:
```bash
curl http://localhost:8084/health
# Должно вернуть: {"ok":true,"service":"crm-backend"}
```

### Запустить frontend

```bash
docker-compose up -d crm-frontend
```

Проверить:
```bash
docker-compose ps | grep crm
curl http://localhost:3003
```

## 4. Обновить nginx

```bash
docker-compose restart nginx
```

Проверить конфигурацию:
```bash
docker exec nginx nginx -t
```

Проверить логи nginx:
```bash
docker-compose logs nginx | grep crm
```

## 5. Проверка работы

### Backend API

```bash
# Health check
curl https://app.performanteaiagency.com/api/crm/health

# Get analysis (замените UUID)
curl "https://app.performanteaiagency.com/api/crm/dialogs/analysis?userAccountId=YOUR-UUID"
```

### Frontend

Открыть в браузере:
- https://app.performanteaiagency.com/crm/

Проверить:
- ✅ Sidebar отображается
- ✅ Навигация между страницами работает
- ✅ Нет ошибок в консоли браузера

## 6. Обновить Evolution webhook (ВАЖНО!)

Webhook должен указывать на crm-backend вместо agent-service.

```bash
curl -X POST https://evolution.performanteaiagency.com/webhook/set/YOUR_INSTANCE_NAME \
  -H "apikey: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://crm-backend:8084/webhooks/evolution",
    "webhook_by_events": false,
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
  }'
```

Проверить webhook:
```bash
curl https://evolution.performanteaiagency.com/webhook/find/YOUR_INSTANCE_NAME \
  -H "apikey: YOUR_API_KEY"
```

## 7. Мониторинг

### Логи через Docker

```bash
# Все логи crm-backend
docker-compose logs -f crm-backend

# Последние 100 строк
docker-compose logs --tail=100 crm-backend

# Логи с timestamp
docker-compose logs -t crm-backend
```

### Логи через Grafana

1. Открыть Grafana: http://your-server:3000
2. Перейти в Explore
3. Выбрать Loki data source
4. Запрос:
   ```
   {container_name="crm-backend"}
   ```

### Метрики

Проверить:
- Количество запросов к API
- Время ответа endpoints
- Ошибки (4xx, 5xx)
- Использование памяти/CPU

## 8. Troubleshooting

### Backend не запускается

```bash
# Проверить логи
docker-compose logs crm-backend | tail -50

# Проверить зависимости
docker-compose ps evolution-postgres
docker exec evolution-postgres pg_isready

# Перезапустить
docker-compose restart crm-backend
```

### Frontend показывает 502

```bash
# Проверить что frontend запущен
docker-compose ps crm-frontend

# Проверить логи nginx
docker-compose logs nginx | grep crm-frontend

# Проверить внутренний порт
docker exec crm-frontend wget -O- http://localhost:80 || echo "Failed"
```

### API не работает

```bash
# Проверить proxy в nginx
docker exec nginx cat /etc/nginx/nginx.conf | grep -A 10 "api/crm"

# Проверить связь между контейнерами
docker exec nginx ping -c 3 crm-backend

# Проверить endpoint напрямую
docker exec nginx curl http://crm-backend:8084/health
```

### Supabase ошибки

```bash
# Проверить переменные
docker exec crm-backend env | grep SUPABASE

# Тест подключения (нужен npm install node-fetch)
docker exec crm-backend node -e "
const fetch = require('node-fetch');
fetch(process.env.SUPABASE_URL + '/rest/v1/', {
  headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY }
}).then(r => console.log('OK:', r.status)).catch(e => console.error('Error:', e));
"
```

### OpenAI API ошибки

```bash
# Проверить квоту
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_KEY" | jq .

# Проверить ключ в контейнере
docker exec crm-backend env | grep OPENAI
```

## 9. Rollback

Если что-то пошло не так:

```bash
# Остановить новые сервисы
docker-compose stop crm-backend crm-frontend

# Вернуть предыдущую версию кода
git reset --hard HEAD^

# Пересобрать
docker-compose build
docker-compose up -d

# Восстановить nginx
docker-compose restart nginx
```

## 10. Обновление (после первого деплоя)

```bash
cd ~/agents-monorepo
git pull origin main
docker-compose build crm-backend crm-frontend
docker-compose up -d crm-backend crm-frontend
docker-compose restart nginx

# Проверить
curl https://app.performanteaiagency.com/api/crm/health
```

## 11. Масштабирование

### Запустить несколько инстансов backend

```yaml
# В docker-compose.yml
crm-backend:
  deploy:
    replicas: 3
```

### Load balancing (nginx)

```nginx
upstream crm_backend {
    server crm-backend:8084 max_fails=3 fail_timeout=30s;
    server crm-backend-2:8084 max_fails=3 fail_timeout=30s;
    server crm-backend-3:8084 max_fails=3 fail_timeout=30s;
}

location /api/crm/ {
    proxy_pass http://crm_backend;
}
```

## 12. Backup

### База данных (Supabase)

Автоматические бэкапы настроены в Supabase Dashboard.

Ручной бэкап:
```bash
# Экспорт таблицы dialog_analysis
curl https://your-project.supabase.co/rest/v1/dialog_analysis \
  -H "apikey: YOUR_KEY" > dialog_analysis_backup.json
```

### Evolution DB

```bash
docker exec evolution-postgres pg_dump -U evolution evolution > backup.sql
```

## 13. Security Checklist

- ✅ SSL сертификаты установлены
- ✅ .env файлы не в git
- ✅ API keys не в логах
- ✅ CORS настроен правильно
- ✅ Rate limiting включен (nginx)
- ✅ Firewall настроен (только 80, 443, 22)
- ✅ Supabase Row Level Security (RLS) включен

## 14. Post-Deployment Checklist

- [ ] Backend health check работает
- [ ] Frontend открывается
- [ ] API endpoints отвечают
- [ ] Evolution webhook обновлен
- [ ] Логи мониторятся в Grafana
- [ ] Alerts настроены
- [ ] Backup расписание проверено
- [ ] Documentation обновлена

## Контакты для поддержки

- Grafana: http://your-server:3000
- Supabase: https://app.supabase.com
- Evolution API: https://evolution.performanteaiagency.com

---

**Готово!** 🚀 CRM развернута и работает.
