# 🚀 Evolution API - Facebook Ad Metadata Patch

## ⚠️ Зачем обновляться на 2.3.7

В версии 2.3.6 был критический баг: **после переподключения WhatsApp (disconnect/reconnect) входящие сообщения переставали обрабатываться**. Это приводило к потере сообщений клиентов.

**Исправлено в 2.3.7:**
> "Fix incoming message events not working after reconnection - Added cleanup logic in mount() to prevent memory leaks from multiple subscriptions - Recreate messageSubject if it was completed during logout"

## ✅ Текущее состояние:

- ✅ Evolution API v2.3.7 с патчем для Facebook Ad metadata
- ✅ Функция `extractAdMetadata()` для извлечения метаданных рекламы
- ✅ Интегрирована в обработчик `messages.upsert`
- ✅ Патч использует динамическое определение номеров строк (работает с 2.3.6 и 2.3.7)

## 📦 Что извлекается:

- `sourceId` - Facebook Ad ID
- `sourceType` - тип источника ('ad')
- `sourceUrl` - URL рекламы
- `mediaUrl` - URL медиа из рекламы
- `showAdAttribution` - флаг атрибуции

## 🔧 Как применить патч на сервере:

### Рекомендуемый способ: Скрипт apply-evolution-patch.sh

```bash
# На сервере
ssh root@your-server

# Клонировать официальный Evolution API нужной версии
cd /root
git clone https://github.com/EvolutionAPI/evolution-api.git evolution-api-official
cd evolution-api-official
git checkout 2.3.7  # или нужная версия

# Скопировать скрипт патча из репозитория (или создать вручную)
# Скрипт находится в agents-monorepo/apply-evolution-patch.sh

# Применить патч
bash /root/agents-monorepo/apply-evolution-patch.sh /root/evolution-api-official

# Удалить backup файлы (иначе Docker build упадёт)
rm -f src/api/integrations/channel/whatsapp/*.backup*

# Пересобрать Docker образ
docker build -t atendai/evolution-api:2.3.7-patched .

# Обновить docker-compose.yml
cd /root/agents-monorepo
sed -i 's|atendai/evolution-api:[^"]*|atendai/evolution-api:2.3.7-patched|' docker-compose.yml

# Перезапустить Evolution API
docker-compose up -d evolution-api

# Проверить логи
docker-compose logs -f evolution-api
```

### Альтернатива: Inline скрипт

Если нужно применить патч без копирования файлов:

```bash
cd /root/evolution-api-official

BAILEYS_FILE="src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts"

# Найти строку с prepareMessage
PREPARE_LINE=$(grep -n "const messageRaw = this.prepareMessage(received);" "$BAILEYS_FILE" | head -1 | cut -d: -f1)
echo "Found prepareMessage at line $PREPARE_LINE"

# Добавить вызов extractAdMetadata после prepareMessage
sed -i "${PREPARE_LINE}a\\
\\
          // Extract Facebook Ad metadata and add to messageRaw.key\\
          const adMetadata = this.extractAdMetadata(received);\\
          if (adMetadata) {\\
            messageRaw.key.sourceId = adMetadata.sourceId;\\
            messageRaw.key.sourceType = adMetadata.sourceType;\\
            messageRaw.key.sourceUrl = adMetadata.sourceUrl;\\
            messageRaw.key.mediaUrl = adMetadata.mediaUrl;\\
            messageRaw.key.showAdAttribution = adMetadata.showAdAttribution;\\
            this.logger.info(\\\`Facebook Ad detected: sourceId=\${adMetadata.sourceId}, sourceUrl=\${adMetadata.sourceUrl}\\\`);\\
          }\\
" "$BAILEYS_FILE"

# Найти последнюю закрывающую скобку класса
LINE_NUM=$(grep -n '^}$' "$BAILEYS_FILE" | tail -1 | cut -d: -f1)

# Добавить функцию extractAdMetadata
# (см. полный код в apply-evolution-patch.sh)
```

## 🧪 Как протестировать:

1. Проверьте статус инстанса:
   ```bash
   docker exec evolution-api wget -qO- "http://localhost:8080/instance/connectionState/YOUR_INSTANCE" \
     -H "apikey: YOUR_API_KEY" | jq
   ```

2. Отправьте тестовое сообщение через Click-to-WhatsApp объявление

3. Проверьте логи Evolution API:
   ```bash
   docker-compose logs -f evolution-api | grep "Facebook Ad detected"
   ```

4. Проверьте вебхук в agent-service:
   ```bash
   docker logs agents-monorepo-agent-service-1 2>&1 | grep "sourceId"
   ```

## 💰 Результат:

- ✅ Evolution API теперь извлекает те же данные, что и GREEN-API
- ✅ Можно отключить GREEN-API и экономить $10-50/месяц
- ✅ Код в `evolutionWebhooks.ts` автоматически получает `sourceId`, `sourceType`, `sourceUrl`
- ✅ **Исправлена проблема с потерей сообщений после reconnect**

## 🔄 Откат изменений:

Если что-то пойдет не так:

```bash
cd /root/agents-monorepo

# Вернуться на официальный образ без патча
sed -i 's|atendai/evolution-api:2.3.7-patched|atendai/evolution-api:v2.3.7|' docker-compose.yml

# Или на предыдущую версию с патчем
# sed -i 's|atendai/evolution-api:2.3.7-patched|atendai/evolution-api:2.3.6-patched|' docker-compose.yml

docker-compose up -d evolution-api
docker-compose logs -f evolution-api
```

## 📝 Технические детали:

**Файл:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`

**Изменения:**
- Добавлена функция `extractAdMetadata()` (номер строки определяется динамически)
- Добавлен вызов после `prepareMessage()`
- Метаданные добавляются в `messageRaw.key` перед отправкой в webhook

**Совместимость:**
- Evolution API v2.3.6, v2.3.7
- Baileys 7.0.0-rc.6
- TypeScript без ошибок
- Обратно совместимо с существующим кодом

## 📅 История изменений:

- **2025-01-03**: Обновлено до v2.3.7 для исправления бага с потерей сообщений после reconnect
- **2024-xx-xx**: Первоначальный патч для v2.3.6
