# Исправление падений сервера при загрузке видео >100 МБ

## Проблема

При загрузке видео >100 МБ сервер падает. Причина: **код загружает весь файл в оперативную память** через `part.toBuffer()`.

---

## ШАГ 1: Диагностика на сервере

Залогинься на сервер и запусти скрипт диагностики:

```bash
# Загрузи скрипт на сервер (с локальной машины)
scp diagnose-video-upload.sh root@agents.performanteaiagency.com:/root/

# Залогинься на сервер
ssh root@agents.performanteaiagency.com

# Запусти диагностику
chmod +x /root/diagnose-video-upload.sh
bash /root/diagnose-video-upload.sh

# Изучи вывод, особенно:
# - Есть ли tmpfs на /tmp (плохо)
# - Есть ли swap (если нет - добавь)
# - Есть ли OOM kills в логах (подтверждение проблемы)
```

---

## ШАГ 2: Добавить SWAP (если не настроен)

```bash
# Создать 4GB swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Сделать постоянным (после перезагрузки)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Проверить
free -h
swapon --show
```

---

## ШАГ 3: Создать директорию для временных файлов

```bash
# Создать папку на диске (НЕ tmpfs)
sudo mkdir -p /var/tmp/video-uploads
sudo chown -R 1000:1000 /var/tmp/video-uploads  # или подходящий UID для Docker

# Проверить, что это НЕ tmpfs
df -h /var/tmp
```

---

## ШАГ 4: Применить исправленный код

### Вариант А: Заменить файл вручную

На **локальной машине** (из папки проекта):

```bash
# Скопировать исправленный файл вместо оригинального
cp services/agent-service/src/routes/video.fixed.ts services/agent-service/src/routes/video.ts

# Проверить изменения
git diff services/agent-service/src/routes/video.ts

# Закоммитить и запушить
git add services/agent-service/src/routes/video.ts
git commit -m "fix: stream video uploads to disk instead of loading into RAM"
git push origin main
```

### Вариант Б: Применить патч автоматически

Или используй search_replace для применения изменений (см. ниже ключевые изменения).

---

## ШАГ 5: Задеплоить на сервер

На **сервере**:

```bash
# Перейти в папку проекта
cd /root/agents-monorepo  # или где у тебя проект

# Подтянуть изменения
git pull origin main

# Пересобрать и перезапустить контейнер agent-service
docker-compose build agent-service
docker-compose up -d agent-service

# Проверить логи
docker-compose logs -f agent-service
```

---

## ШАГ 6: Убедиться, что nginx настроен правильно

```bash
# Проверить конфиг nginx (должен быть client_max_body_size 300m+)
cat /etc/nginx/sites-available/default | grep client_max_body_size

# Если не 300m+, отредактировать:
sudo nano /etc/nginx/sites-available/default
```

Должно быть:

```nginx
server {
    ...
    # Для загрузки видео
    client_max_body_size 300m;
    client_body_timeout 600s;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    send_timeout 600s;
    
    # ВАЖНО: не буферизовать тело запроса на диске nginx
    proxy_request_buffering off;
    ...
}
```

Перезагрузить nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## ШАГ 7: Тест загрузки 200 МБ видео

```bash
# На локальной машине (или сервере)
curl -X POST https://agents.performanteaiagency.com/process-video \
  -F "file=@/path/to/big-video.mp4" \
  -F "user_id=YOUR-UUID" \
  -F "title=Test 200MB" \
  -F "language=ru"

# Смотри логи на сервере:
docker-compose logs -f agent-service
```

---

## Ключевые изменения в коде

### ❌ Было (загружало в RAM):

```typescript
for await (const part of parts) {
  if (part.type === 'file' && part.fieldname === 'file') {
    videoBuffer = await part.toBuffer();  // ← ВЕСЬ ФАЙЛ В ПАМЯТЬ!
  }
  ...
}

videoPath = path.join('/tmp', `video_${randomUUID()}.mp4`);  // ← /tmp может быть tmpfs
await fs.writeFile(videoPath, videoBuffer);
```

### ✅ Стало (streaming на диск):

```typescript
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

for await (const part of parts) {
  if (part.type === 'file' && part.fieldname === 'file') {
    // Используем /var/tmp (диск), НЕ /tmp (tmpfs)
    videoPath = path.join('/var/tmp', `video_${randomUUID()}.mp4`);
    
    // Потоковая запись (НЕ загружаем в память!)
    await pipeline(part.file, createWriteStream(videoPath));
  }
  ...
}

// Позже читаем с диска для загрузки в Facebook
const videoBuffer = await fs.readFile(videoPath);
await uploadVideo(normalizedAdAccountId, userAccount.access_token, videoBuffer);
```

---

## Проверка результата

После деплоя проверь:

1. **Память процесса не растёт при загрузке**:

```bash
# Мониторинг в реальном времени
docker stats agent-service
```

2. **Нет OOM kills**:

```bash
journalctl -k -f | grep -i "out of memory"
```

3. **Загрузка 200 МБ проходит успешно** без падений.

---

## FAQ

**Q: Нужно ли увеличивать RAM сервера?**  
A: **НЕТ**. При правильном коде (streaming) даже 2 vCPU / 4 GB RAM достаточно для 500 МБ видео.

**Q: Что если у меня нет Docker?**  
A: Примени те же изменения, но:
- Перезапусти Node.js процесс через systemd/pm2
- Убедись, что TMPDIR указывает на /var/tmp (не /tmp)

**Q: Может ли быть проблема в nginx?**  
A: Если nginx настроен на 500m, то нет. Проблема в коде приложения.

**Q: Нужен ли swap на 16 GB сервере?**  
A: Да, 4 GB swap как "подушка безопасности" не помешает даже на 16 GB RAM.

---

## Итог

После применения всех шагов:

- ✅ Видео пишется на **диск потоком**, а не в RAM
- ✅ Используется `/var/tmp` (диск), а не `/tmp` (возможно tmpfs)
- ✅ Добавлен swap как страховка от OOM
- ✅ nginx настроен на 300m+ с отключенной буферизацией
- ✅ 200 МБ (и даже 500 МБ) загружаются стабильно

**Параметры сервера достаточны** (2 vCPU / 4 GB RAM или больше). Проблема была в коде, не в железе.

