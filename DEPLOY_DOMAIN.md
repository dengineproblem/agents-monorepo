# 🌐 Деплой на домен performanteaiagency.com

Пошаговая инструкция по замене лендинга на frontend приложение.

---

## 📋 Что произойдет:

**БЫЛО:**
- `performanteaiagency.com` → лендинг сайт
- `agents.performanteaiagency.com` → backend API
- `brain2.performanteaiagency.com` → brain agent

**СТАНЕТ:**
- `performanteaiagency.com` → **ваш frontend приложение** 🎉
- `performanteaiagency.com/api/*` → backend API (проксируется)
- `agents.performanteaiagency.com` → backend API (старый, сохранен)
- `brain2.performanteaiagency.com` → brain agent (без изменений)

---

## 🚀 ШАГ 1: Получите SSL сертификат для главного домена

**На сервере выполните:**

```bash
# Подключитесь к серверу
ssh root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01

# Проверьте, есть ли уже сертификат
ls -la /etc/letsencrypt/live/performanteaiagency.com/

# Если сертификата нет - получите его
# ВАЖНО: Сначала остановите старый nginx (если он запущен вне Docker)
systemctl stop nginx  # или service nginx stop

# Получите сертификат
certbot certonly --standalone \
  -d performanteaiagency.com \
  -d www.performanteaiagency.com \
  --email your-email@example.com \
  --agree-tos
```

**Ожидаемый результат:**
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/performanteaiagency.com/fullchain.pem
Key is saved at: /etc/letsencrypt/live/performanteaiagency.com/privkey.pem
```

---

## 📦 ШАГ 2: Отправьте изменения на сервер

**На локальной машине:**

```bash
cd /Users/anatolijstepanov/agents-monorepo

# Закоммитьте изменения
git add nginx-production.conf docker-compose.yml DEPLOY_DOMAIN.md
git commit -m "feat: add production nginx config for performanteaiagency.com domain"
git push origin main
```

---

## 🔧 ШАГ 3: Примените изменения на сервере

**На сервере:**

```bash
# Перейдите в директорию проекта
cd /root/agents-monorepo

# Обновите код
git pull origin main

# Проверьте, что новые файлы появились
ls -la nginx-production.conf

# Остановите старые контейнеры
docker compose down

# Запустите с новой конфигурацией
docker compose up -d --build

# Проверьте статус
docker compose ps
```

---

## ✅ ШАГ 4: Проверка

### 4.1 Проверьте контейнеры

```bash
docker compose ps
```

Все должны быть `Up`:
- ✅ agent-brain
- ✅ agent-service
- ✅ creative-analyzer
- ✅ frontend
- ✅ nginx
- ✅ loki, grafana, promtail

### 4.2 Проверьте логи nginx

```bash
docker compose logs nginx --tail 50
```

Не должно быть ошибок вроде:
- ❌ `nginx: [emerg] cannot load certificate`
- ❌ `nginx: [emerg] SSL_CTX_use_PrivateKey_file() failed`

### 4.3 Проверьте в браузере

**Откройте:**
- ✅ https://performanteaiagency.com - должен открыться frontend приложение
- ✅ Зеленый замочек 🔒 в адресной строке
- ✅ Нет предупреждений о сертификате

### 4.4 Проверьте API

```bash
# На сервере или локально
curl https://performanteaiagency.com/api/health

# Должен вернуть ответ от backend
```

### 4.5 Проверьте редирект HTTP → HTTPS

```bash
curl -I http://performanteaiagency.com

# Должно быть:
# HTTP/1.1 301 Moved Permanently
# Location: https://performanteaiagency.com/
```

---

## 🔄 ШАГ 5: Обновите переменные окружения frontend (если нужно)

Если frontend использует жестко заданный API URL, обновите его:

**В `services/frontend/src/config/api.ts`:**

Убедитесь, что используются относительные пути:
```typescript
export const API_BASE_URL = 
  import.meta.env.VITE_API_BASE_URL || 
  '/api';  // Относительный путь - nginx проксирует
```

Если нужно изменить - пересоберите frontend:
```bash
docker compose build frontend
docker compose up -d frontend
```

---

## 🆘 Решение проблем

### Проблема 1: "Cannot load certificate"

**Причина:** Сертификат не найден

**Решение:**
```bash
# Проверьте наличие сертификата
ls -la /etc/letsencrypt/live/performanteaiagency.com/

# Если нет - получите его (см. ШАГ 1)
```

### Проблема 2: "502 Bad Gateway"

**Причина:** Frontend контейнер не запущен

**Решение:**
```bash
docker compose ps
docker compose logs frontend

# Перезапустите
docker compose restart frontend
```

### Проблема 3: "Your connection is not private"

**Причина:** Nginx не может прочитать сертификаты

**Решение:**
```bash
# Проверьте права доступа
ls -la /etc/letsencrypt/live/performanteaiagency.com/

# Nginx контейнер должен иметь доступ
docker compose exec nginx ls -la /etc/letsencrypt/live/
```

### Проблема 4: API запросы не работают (CORS)

**Причина:** Неправильная конфигурация proxy

**Решение:**
```bash
# Проверьте логи nginx
docker compose logs nginx | grep -i error

# Проверьте логи backend
docker compose logs agent-service | grep -i error
```

### Проблема 5: Frontend не обновляется

**Причина:** Кеш браузера

**Решение:**
- Откройте DevTools (F12)
- Правый клик на кнопке обновления → "Empty Cache and Hard Reload"
- Или используйте режим инкогнито

---

## 🎯 Что делать со старым лендингом?

У вас есть несколько вариантов:

### Вариант А: Переместить на поддомен
```
landing.performanteaiagency.com → старый лендинг
performanteaiagency.com → новый frontend
```

Добавьте в `nginx-production.conf`:
```nginx
server {
    listen 443 ssl http2;
    server_name landing.performanteaiagency.com;
    
    ssl_certificate /etc/letsencrypt/live/landing.performanteaiagency.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/landing.performanteaiagency.com/privkey.pem;
    
    root /var/www/landing;  # Путь к статическим файлам лендинга
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Вариант Б: Удалить совсем
Если лендинг больше не нужен - просто удалите его файлы с сервера.

### Вариант В: Интегрировать в приложение
Сделать лендинг частью frontend приложения (как отдельный роут `/landing` или главная страница).

---

## 🔐 ШАГ 6: Настройте автообновление сертификатов

SSL сертификаты действуют 90 дней. Настройте автообновление:

```bash
# На сервере
crontab -e

# Добавьте строку (проверка каждый день в 3:00)
0 3 * * * certbot renew --quiet --deploy-hook "cd /root/agents-monorepo && docker compose restart nginx"
```

Проверьте работу:
```bash
# Тестовый запуск обновления (не обновит, если не нужно)
certbot renew --dry-run
```

---

## 📊 Итоговая архитектура:

```
Пользователь
    ↓
https://performanteaiagency.com
    ↓
Nginx (Docker) - SSL терминация
    ↓
   /api/*  →  agent-service:8082  (Backend API)
   /*      →  frontend:80          (Vite Frontend)
```

**Поддомены (без изменений):**
```
agents.performanteaiagency.com → agent-service:8082
brain2.performanteaiagency.com → agent-brain:7080
```

---

## ✅ Чек-лист завершения:

- [ ] SSL сертификат получен для `performanteaiagency.com`
- [ ] Код отправлен на GitHub
- [ ] Изменения применены на сервере
- [ ] Все контейнеры запущены (`docker compose ps`)
- [ ] Нет ошибок в логах nginx
- [ ] Frontend открывается на https://performanteaiagency.com
- [ ] Зеленый замочек 🔒 в браузере
- [ ] API работает через `/api/*`
- [ ] Редирект HTTP → HTTPS работает
- [ ] Автообновление сертификатов настроено

---

## 🎉 Готово!

После выполнения всех шагов:
- ✅ Ваш frontend доступен на главном домене
- ✅ Защищен SSL сертификатом
- ✅ API работает через тот же домен
- ✅ Старые поддомены продолжают работать

**Наслаждайтесь! 🚀**

---

## 📞 Дальнейшие улучшения:

1. Настройте CDN (Cloudflare) для ускорения
2. Добавьте мониторинг uptime
3. Настройте backup'ы
4. Добавьте rate limiting в nginx
5. Настройте WAF (Web Application Firewall)

