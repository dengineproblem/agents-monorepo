# ⚡ Быстрый деплой на домен

**Цель:** Заменить лендинг на `performanteaiagency.com` вашим frontend приложением

---

## 📋 Команды для копипаста

### 1️⃣ На локальной машине (прямо сейчас):

```bash
cd /Users/anatolijstepanov/agents-monorepo

# Закоммитить изменения
git add nginx-production.conf docker-compose.yml DEPLOY_DOMAIN.md QUICK_DOMAIN_DEPLOY.md
git commit -m "feat: configure nginx for performanteaiagency.com domain"
git push origin main
```

---

### 2️⃣ На сервере:

```bash
# Подключитесь к серверу
ssh root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01

# Перейдите в проект
cd /root/agents-monorepo

# Получите последние изменения
git pull origin main

# ВАЖНО: Проверьте наличие SSL сертификата
ls -la /etc/letsencrypt/live/performanteaiagency.com/

# Если сертификата НЕТ - получите его:
systemctl stop nginx || service nginx stop || docker compose stop nginx
certbot certonly --standalone -d performanteaiagency.com -d www.performanteaiagency.com
# (Следуйте инструкциям certbot)

# Примените изменения
docker compose down
docker compose up -d --build

# Проверьте статус
docker compose ps

# Проверьте логи (не должно быть ошибок)
docker compose logs nginx --tail 30
```

---

### 3️⃣ Проверка (в браузере):

Откройте: https://performanteaiagency.com

**Должно быть:**
- ✅ Открывается ваш frontend (не лендинг!)
- ✅ Зеленый замочек 🔒
- ✅ Нет ошибок в консоли (F12)

---

## 🆘 Если что-то не работает:

### Ошибка: "Cannot load certificate"
```bash
# На сервере получите сертификат:
systemctl stop nginx
certbot certonly --standalone -d performanteaiagency.com -d www.performanteaiagency.com
docker compose restart nginx
```

### Ошибка: "502 Bad Gateway"
```bash
docker compose ps
docker compose restart frontend nginx
```

### Frontend не обновляется
- Очистите кеш браузера (Ctrl+Shift+R или Cmd+Shift+R)
- Или откройте в режиме инкогнито

---

## ✅ Готово!

После выполнения команд выше:
- `performanteaiagency.com` → ваш frontend ✨
- `performanteaiagency.com/api/*` → backend API
- Старые поддомены работают как прежде

---

📖 **Подробная инструкция:** [DEPLOY_DOMAIN.md](./DEPLOY_DOMAIN.md)

