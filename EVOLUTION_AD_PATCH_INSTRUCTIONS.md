# 🚀 Evolution API - Facebook Ad Metadata Patch

## ✅ Что сделано локально:

1. ✅ Клонирован Evolution API v2.3.6
2. ✅ Добавлена функция `extractAdMetadata()` для извлечения Facebook Ad metadata
3. ✅ Интегрирована в обработчик `messages.upsert`
4. ✅ Проверена компиляция TypeScript - **без ошибок**
5. ✅ Патч протестирован локально

## 📦 Что извлекается:

- `sourceId` - Facebook Ad ID
- `sourceType` - тип источника ('ad')
- `sourceUrl` - URL рекламы
- `mediaUrl` - URL медиа из рекламы
- `showAdAttribution` - флаг атрибуции

## 🔧 Как применить на сервере:

### Вариант 1: Скопировать готовый файл (РЕКОМЕНДУЕТСЯ)

```bash
# На локальном Mac
scp ~/evolution-api/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts root@your-server:/tmp/

# На сервере
ssh root@your-server

cd /root/evolution-api

# Создать backup
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup-manual

# Скопировать новую версию
cp /tmp/whatsapp.baileys.service.ts src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts

# Добавить *.backup в .dockerignore
echo "*.backup" >> .dockerignore

# Пересобрать Docker образ
docker build -t atendai/evolution-api:2.3.6-ad-metadata .

# Обновить docker-compose.yml
cd /root/agents-monorepo
sed -i 's|image: atendai/evolution-api:2.3.6|image: atendai/evolution-api:2.3.6-ad-metadata|' docker-compose.yml

# Перезапустить Evolution API
docker-compose down evolution-api
docker-compose up -d evolution-api

# Проверить логи
docker-compose logs -f evolution-api
```

### Вариант 2: Применить через git patch

```bash
# На локальном Mac
scp ~/evolution-ad-metadata.patch root@your-server:/tmp/

# На сервере
ssh root@your-server
cd /root/evolution-api

# Создать backup
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup-manual

# Применить патч
git apply /tmp/evolution-ad-metadata.patch

# Далее как в Варианте 1 (сборка и перезапуск)
```

## 🧪 Как протестировать:

1. Отправьте тестовое сообщение через Click-to-WhatsApp объявление
2. Проверьте логи Evolution API:
   ```bash
   docker-compose logs -f evolution-api | grep "Facebook Ad detected"
   ```
3. Проверьте вебхук в agent-service:
   ```bash
   docker-compose logs -f agent-service | grep "sourceId"
   ```

## 💰 Результат:

✅ Evolution API теперь извлекает те же данные, что и GREEN-API
✅ Можно отключить GREEN-API и экономить $10-50/месяц
✅ Ваш код в `evolutionWebhooks.ts` автоматически получает `sourceId`, `sourceType`, `sourceUrl`

## 🔄 Откат изменений:

Если что-то пойдет не так:

```bash
cd /root/evolution-api
cp src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts.backup-manual src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts

cd /root/agents-monorepo
sed -i 's|image: atendai/evolution-api:2.3.6-ad-metadata|image: atendai/evolution-api:2.3.6|' docker-compose.yml
docker-compose down evolution-api
docker-compose pull evolution-api
docker-compose up -d evolution-api
```

## 📝 Технические детали:

**Файл:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`

**Изменения:**
- Добавлена функция `extractAdMetadata()` (строка ~4970)
- Добавлен вызов после `prepareMessage()` (строка ~1189)
- Метаданные добавляются в `messageRaw.key` перед отправкой в webhook

**Совместимость:**
- Evolution API v2.3.6
- Baileys 7.0.0-rc.6
- TypeScript без ошибок
- Обратно совместимо с существующим кодом

