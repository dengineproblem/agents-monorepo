# 🚀 ПЕРЕНОС PRODUCTION НА ПОДДОМЕН app.performanteaiagency.com

**Цель:** Перенести рабочую версию с `performanteaiagency.com` на `app.performanteaiagency.com`

---

## 📋 ЭТАП 1: DNS НАСТРОЙКА

### Шаг 1.1: Добавить A-запись для поддомена

В панели управления доменом (Cloudflare/Namecheap/etc):

```
Тип: A
Имя: app
Значение: <IP вашего сервера>
TTL: Auto или 300
```

### Шаг 1.2: Проверить DNS

```bash
# Подождать 5-10 минут, затем проверить:
ping app.performanteaiagency.com
nslookup app.performanteaiagency.com
```

---

## 📋 ЭТАП 2: NGINX КОНФИГУРАЦИЯ

### Шаг 2.1: Подключиться к серверу

```bash
ssh user@your-server-ip
# Или через ваш метод подключения
```

### Шаг 2.2: Создать nginx конфиг для поддомена

```bash
sudo nano /etc/nginx/sites-available/app.performanteaiagency.com
```

**Вставить:**

```nginx
# Production version - subdomain
server {
    listen 80;
    server_name app.performanteaiagency.com;
    
    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS headers
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
    }
}
```

### Шаг 2.3: Активировать конфиг

```bash
# Создать symlink
sudo ln -s /etc/nginx/sites-available/app.performanteaiagency.com /etc/nginx/sites-enabled/

# Проверить конфигурацию
sudo nginx -t

# Если OK, перезагрузить nginx
sudo systemctl reload nginx
```

---

## 📋 ЭТАП 3: SSL СЕРТИФИКАТ

### Шаг 3.1: Получить SSL для поддомена

```bash
sudo certbot --nginx -d app.performanteaiagency.com
```

**Следовать инструкциям certbot:**
- Ввести email (если первый раз)
- Согласиться с условиями
- Выбрать "2" (Redirect HTTP to HTTPS)

### Шаг 3.2: Проверить сертификаты

```bash
sudo certbot certificates
```

Должны быть сертификаты для обоих доменов:
- `performanteaiagency.com`
- `app.performanteaiagency.com`

---

## 📋 ЭТАП 4: ОБНОВИТЬ FRONTEND ENV

### Шаг 4.1: Обновить .env для frontend на сервере

```bash
cd ~/agents-monorepo/services/frontend
nano .env.production
```

**Изменить URLs на поддомен:**

```env
VITE_API_URL=https://app.performanteaiagency.com/api
VITE_FB_REDIRECT_URI=https://app.performanteaiagency.com/profile
VITE_FB_APP_ID=1441781603583445
```

### Шаг 4.2: Пересобрать frontend

```bash
cd ~/agents-monorepo/services/frontend
npm run build
```

---

## 📋 ЭТАП 5: ОБНОВИТЬ FACEBOOK APP SETTINGS

### Шаг 5.1: Добавить OAuth Redirect URI

Перейти: https://developers.facebook.com/apps/1441781603583445/fb-login/settings/

**Valid OAuth Redirect URIs (добавить поддомен):**
```
https://performanteaiagency.com/profile
https://app.performanteaiagency.com/profile
```

### Шаг 5.2: Обновить другие URLs (если нужно)

**App Domains:**
```
performanteaiagency.com
app.performanteaiagency.com
```

---

## 📋 ЭТАП 6: RESTART DOCKER

### Шаг 6.1: Перезапустить контейнеры

```bash
cd ~/agents-monorepo

# Остановить
docker-compose down

# Запустить заново
docker-compose up -d --build
```

### Шаг 6.2: Проверить логи

```bash
docker-compose logs -f frontend
docker-compose logs -f agent-service
```

---

## 📋 ЭТАП 7: ПРОВЕРКА

### Шаг 7.1: Проверить поддомен

Открыть в браузере: **https://app.performanteaiagency.com**

**Проверить:**
- [ ] ✅ Страница загружается
- [ ] ✅ SSL работает (зеленый замочек)
- [ ] ✅ Login работает
- [ ] ✅ Facebook OAuth работает
- [ ] ✅ Кампании загружаются
- [ ] ✅ API запросы работают

### Шаг 7.2: Проверить главный домен (пока старая версия)

Открыть: **https://performanteaiagency.com**

Должна быть та же версия (пока).

---

## 📋 ЭТАП 8: ОБНОВИТЬ DNS ДЛЯ ПОЛЬЗОВАТЕЛЕЙ

### Опция A: Оставить оба домена работать

Оба домена указывают на один сервер, nginx раздает одинаково.

**Плюсы:**
- Пользователи могут использовать любой
- Плавный переход

**Минусы:**
- Нужно поддерживать оба

### Опция B: Редирект с главного на поддомен

**Обновить nginx для главного домена:**

```nginx
server {
    listen 80;
    server_name performanteaiagency.com;
    return 301 https://app.performanteaiagency.com$request_uri;
}

server {
    listen 443 ssl;
    server_name performanteaiagency.com;
    
    ssl_certificate /etc/letsencrypt/live/performanteaiagency.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/performanteaiagency.com/privkey.pem;
    
    return 301 https://app.performanteaiagency.com$request_uri;
}
```

---

## 🎯 ПОСЛЕ ПЕРЕНОСА

Теперь можно развернуть App Review версию на главном домене:
```
app.performanteaiagency.com    → Production (full version)
performanteaiagency.com         → App Review (simplified version)
```

---

## 🔧 TROUBLESHOOTING

### Проблема: DNS не обновляется

**Решение:**
```bash
# Очистить DNS кэш локально
sudo dscacheutil -flushcache  # macOS
sudo systemd-resolve --flush-caches  # Linux

# Проверить через разные DNS серверы
nslookup app.performanteaiagency.com 8.8.8.8
nslookup app.performanteaiagency.com 1.1.1.1
```

### Проблема: SSL не работает

**Решение:**
```bash
# Пересоздать сертификат
sudo certbot delete --cert-name app.performanteaiagency.com
sudo certbot --nginx -d app.performanteaiagency.com
```

### Проблема: 502 Bad Gateway

**Решение:**
```bash
# Проверить что backend запущен
docker ps
docker-compose logs agent-service

# Проверить порты
sudo lsof -i :8080
sudo lsof -i :3000
```

---

## ✅ ГОТОВО!

Production версия работает на `app.performanteaiagency.com` ✨

