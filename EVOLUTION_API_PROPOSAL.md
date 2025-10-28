# 📱 Evolution API Integration - Proposal for Approval

> **Статус:** Требует утверждения перед реализацией
> **Цель:** Интеграция WhatsApp через Evolution API с QR-кодом авторизацией

---

## 🎯 Что мы делаем

Добавляем возможность:
1. **В профиле** - кнопка "Подключить WhatsApp" (как Telegram ID)
2. **В модалке** - отображается QR-код для сканирования
3. **После подключения** - можно отправлять сообщения через API
4. **Сохранение сообщений** - все входящие/исходящие сообщения в базу для анализа

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Profile Page)                                     │
│  ├─ "Connect WhatsApp" button (рядом с Telegram ID)         │
│  └─ Modal с QR-кодом                                        │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  NGINX → /api/whatsapp/* → agent-service:8082               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT-SERVICE (новые endpoints)                            │
│  └─ Проксирует запросы в Evolution API                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  EVOLUTION API (Docker контейнер)                           │
│  ├─ Redis (кэш)                                            │
│  └─ PostgreSQL (внутренняя БД Evolution)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Структура данных

### Новая таблица: `whatsapp_instances`

```sql
CREATE TABLE whatsapp_instances (
  id UUID PRIMARY KEY,
  user_account_id UUID REFERENCES user_accounts(id),

  -- Evolution API данные
  instance_name VARCHAR(255) UNIQUE NOT NULL,
  instance_id VARCHAR(255) UNIQUE NOT NULL,

  -- Статус подключения
  status VARCHAR(50) DEFAULT 'disconnected', -- disconnected, connecting, connected
  connection_state JSONB, -- данные о подключении

  -- После подключения
  phone_number VARCHAR(50), -- номер WhatsApp после авторизации
  profile_name VARCHAR(255), -- имя профиля
  profile_picture_url TEXT, -- аватар

  -- Временные метки
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,

  -- Метаданные
  metadata JSONB DEFAULT '{}'
);
```

### Новая таблица: `whatsapp_messages`

```sql
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY,
  instance_id UUID REFERENCES whatsapp_instances(id),

  -- Данные сообщения
  remote_jid VARCHAR(255) NOT NULL, -- ID получателя/отправителя
  message_text TEXT,
  message_type VARCHAR(50), -- text, image, video, etc.

  -- Направление
  direction VARCHAR(20) NOT NULL, -- incoming, outgoing

  -- Статус
  status VARCHAR(50), -- sent, delivered, read, failed

  -- Временные метки
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Полные данные от Evolution API
  raw_data JSONB,

  -- Для AI анализа
  analyzed BOOLEAN DEFAULT FALSE,
  analysis_result JSONB
);
```

**Важно:** Таблица `whatsapp_phone_numbers` остается как есть - это разные вещи:
- `whatsapp_phone_numbers` - номера для **отправки** в Facebook Ads (Click to WhatsApp)
- `whatsapp_instances` - подключенные аккаунты WhatsApp для **реальной отправки сообщений**

---

## 🔌 API Endpoints

### 1. Создать WhatsApp инстанс и получить QR-код

**Endpoint:** `POST /api/whatsapp/connect`

**Request:**
```json
{
  "user_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "instance": {
    "id": "uuid",
    "instance_name": "instance_abc123",
    "status": "connecting"
  },
  "qrcode": {
    "base64": "data:image/png;base64,...",
    "code": "2@xxxxx..." // для отображения через qrcode.react
  }
}
```

**Логика:**
1. Проверить, нет ли у пользователя уже подключенного инстанса
2. Если есть - вернуть его статус
3. Если нет - создать инстанс в Evolution API
4. Получить QR-код
5. Сохранить в базу `whatsapp_instances`
6. Вернуть QR-код клиенту

---

### 2. Получить статус подключения

**Endpoint:** `GET /api/whatsapp/status?user_id=uuid`

**Response:**
```json
{
  "success": true,
  "instance": {
    "id": "uuid",
    "status": "connected", // disconnected, connecting, connected
    "phone_number": "+1234567890",
    "profile_name": "John Doe",
    "connected_at": "2025-10-28T10:00:00Z"
  }
}
```

**Логика:**
1. Найти инстанс пользователя в базе
2. Проверить статус в Evolution API
3. Обновить статус в базе
4. Вернуть данные

---

### 3. Отключить WhatsApp

**Endpoint:** `DELETE /api/whatsapp/disconnect?user_id=uuid`

**Response:**
```json
{
  "success": true
}
```

**Логика:**
1. Найти инстанс
2. Удалить инстанс в Evolution API
3. Обновить статус в базе на 'disconnected'

---

### 4. Отправить сообщение

**Endpoint:** `POST /api/whatsapp/send`

**Request:**
```json
{
  "user_id": "uuid",
  "phone": "+1234567890",
  "message": "Hello from Evolution API!"
}
```

**Response:**
```json
{
  "success": true,
  "message_id": "uuid",
  "status": "sent"
}
```

**Логика:**
1. Проверить что инстанс подключен
2. Отправить через Evolution API
3. Сохранить в `whatsapp_messages`
4. Вернуть результат

---

### 5. Получить историю сообщений

**Endpoint:** `GET /api/whatsapp/messages?user_id=uuid&limit=50&phone=+123...`

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "phone": "+1234567890",
      "message": "Hello!",
      "direction": "incoming",
      "timestamp": "2025-10-28T10:00:00Z"
    }
  ]
}
```

---

### 6. Webhook для входящих событий

**Endpoint:** `POST /api/webhooks/evolution`

**Автоматически вызывается Evolution API когда:**
- Получено новое сообщение
- Изменился статус подключения
- Обновился QR-код

**Логика:**
1. Принять событие от Evolution API
2. Обработать в зависимости от типа:
   - `messages.upsert` → сохранить в `whatsapp_messages`
   - `connection.update` → обновить статус в `whatsapp_instances`
   - `qrcode.updated` → обновить QR-код (для WebSocket обновления UI)

---

## 🎨 Frontend Integration

### В Profile.tsx добавить секцию (после Telegram ID):

```tsx
{/* WhatsApp Connection */}
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <MessageSquare className="h-5 w-5" />
      {t('profile.whatsapp.title')} {/* "WhatsApp" */}
    </CardTitle>
  </CardHeader>
  <CardContent>
    {whatsappStatus === 'connected' ? (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">
          {t('profile.whatsapp.connected')}: <strong>{whatsappPhone}</strong>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWhatsappModal(true)}
        >
          {t('profile.whatsapp.manage')} {/* "Manage" */}
        </Button>
      </div>
    ) : (
      <Button
        onClick={() => connectWhatsApp()}
        disabled={isConnectingWhatsApp}
      >
        {isConnectingWhatsApp
          ? t('profile.whatsapp.connecting')
          : t('profile.whatsapp.connect') /* "Connect WhatsApp" */
        }
      </Button>
    )}
  </CardContent>
</Card>
```

### Modal с QR-кодом:

```tsx
<Dialog open={whatsappModal} onOpenChange={setWhatsappModal}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>{t('profile.whatsapp.scanQR')}</DialogTitle>
      <DialogDescription>
        {t('profile.whatsapp.scanInstructions')}
      </DialogDescription>
    </DialogHeader>

    {qrCode ? (
      <div className="flex justify-center p-4">
        <QRCodeSVG value={qrCode} size={256} />
      </div>
    ) : whatsappStatus === 'connected' ? (
      <div className="text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <p>{t('profile.whatsapp.connectedSuccess')}</p>
        <p className="text-sm text-gray-600 mt-2">
          {whatsappPhone}
        </p>
        <Button
          variant="destructive"
          className="mt-4"
          onClick={() => disconnectWhatsApp()}
        >
          {t('profile.whatsapp.disconnect')}
        </Button>
      </div>
    ) : (
      <div className="text-center py-8">
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
        <p className="mt-2">{t('profile.whatsapp.loading')}</p>
      </div>
    )}
  </DialogContent>
</Dialog>
```

---

## 🔒 Безопасность

1. **API Key для Evolution API**
   - Генерируем сильный случайный ключ
   - Храним в `.env.agent`
   - НЕ коммитим в git

2. **Проверка прав доступа**
   - В каждом endpoint проверяем что `user_id` соответствует авторизованному пользователю
   - Только владелец может управлять своим инстансом

3. **Webhook валидация**
   - Проверяем что запрос пришел от Evolution API
   - Можно добавить IP whitelist или подпись

4. **Изоляция данных**
   - Каждый пользователь видит только свои сообщения
   - RLS в Supabase (опционально)

---

## 🚀 Процесс деплоя

### 1. Локально:
```bash
git pull origin main
# Вносим изменения
git add .
git commit -m "Add Evolution API integration for WhatsApp"
git push origin main
```

### 2. На сервере:
```bash
cd ~/agents-monorepo
git pull origin main

# Добавить переменные в .env.agent:
# EVOLUTION_API_KEY=xxx
# EVOLUTION_DB_PASSWORD=xxx

# Применить миграцию в Supabase Dashboard

# Пересобрать контейнеры
docker-compose build --no-cache agent-service frontend frontend-appreview
docker-compose up -d

# Проверить статус
docker ps
docker logs agents-monorepo-evolution-api-1
```

---

## ❓ ВОПРОСЫ ДЛЯ УТВЕРЖДЕНИЯ

### 1. Множественные инстансы WhatsApp

**Вопрос:** Пользователь может подключить только **один** WhatsApp аккаунт или несколько?

**Варианты:**
- **A) Один инстанс** (проще, дешевле, достаточно для большинства)
- **B) Несколько инстансов** (для работы с разными номерами, сложнее)

**Моя рекомендация:** **Вариант A** - один инстанс на пользователя. Если нужно больше - добавим позже.

---

### 2. Где хранить QR-код в UI?

**Вопрос:** Где показывать статус подключения и кнопку?

**Варианты:**
- **A) В Profile после Telegram ID** (логично, все интеграции в одном месте)
- **B) В отдельной секции "Integrations"** (если планируются еще интеграции)
- **C) В отдельной странице /whatsapp** (если нужен расширенный функционал)

**Моя рекомендация:** **Вариант A** - в Profile после Telegram ID, как вы и хотели.

---

### 3. Автоматическое переподключение

**Вопрос:** Что делать если WhatsApp отключился (например, телефон выключен)?

**Варианты:**
- **A) Показать уведомление и требовать новый QR-код**
- **B) Автоматически пытаться переподключиться**
- **C) Ничего не делать, пока пользователь не зайдет в профиль**

**Моя рекомендация:** **Вариант A** - показать уведомление. Evolution API может автоматически переподключаться, но лучше информировать пользователя.

---

### 4. Лимиты сообщений

**Вопрос:** Нужно ли ограничивать количество отправляемых сообщений?

**Варианты:**
- **A) Нет лимитов** (простота)
- **B) Лимит по тарифу** (например, 1000 сообщений/месяц)
- **C) Rate limiting** (например, 10 сообщений/минуту)

**Моя рекомендация:** **Вариант C** - rate limiting (10/минуту) для защиты от спама. Лимиты по тарифу добавим позже если нужно.

---

### 5. AI Анализ сообщений

**Вопрос:** Нужно ли автоматически анализировать входящие сообщения через LLM?

**Варианты:**
- **A) Да, автоматически** (классификация intent, sentiment, urgency)
- **B) Нет, только хранение** (анализ по требованию)
- **C) Опция в настройках** (пользователь выбирает)

**Моя рекомендация:** **Вариант B** - сначала только хранение. AI анализ добавим как отдельную фичу позже.

---

### 6. Уведомления о новых сообщениях

**Вопрос:** Нужно ли отправлять уведомления о входящих WhatsApp сообщениях?

**Варианты:**
- **A) В Telegram** (уже есть интеграция)
- **B) Email** (нужно добавлять)
- **C) Push в браузере** (сложно)
- **D) Не нужно** (пользователь сам проверяет)

**Моя рекомендация:** **Вариант A** - в Telegram, если у пользователя указан telegram_id.

---

### 7. Интеграция с existing campaigns

**Вопрос:** Нужно ли интегрировать с вашими Facebook Ads кампаниями?

**Сценарий:**
- У вас есть Click to WhatsApp кампании
- Когда пользователь кликает на объявление → он пишет в WhatsApp
- Можно отслеживать эти сообщения и связывать с кампаниями

**Варианты:**
- **A) Да, отслеживать** (нужно матчить номера из ads с входящими)
- **B) Нет, просто мессенджер** (без связи с ads)

**Моя рекомендация:** **Вариант B** - сначала базовый мессенджер. Аналитику добавим позже.

---

### 8. Шаблоны сообщений

**Вопрос:** Нужна ли функция сохранения шаблонов сообщений?

**Примеры:**
- "Здравствуйте! Спасибо за интерес к..."
- "Ваша заявка принята. Мы свяжемся..."

**Варианты:**
- **A) Да, добавить таблицу message_templates**
- **B) Нет, пользователь сам копирует**

**Моя рекомендация:** **Вариант B** - не сейчас. Добавим если будет запрос.

---

## ✅ Что утвердить

Пожалуйста, ответьте на вопросы 1-8 или скажите "используй рекомендации" и я буду реализовывать с моими рекомендованными вариантами.

**После утверждения я:**
1. Добавлю Evolution API в docker-compose.yml
2. Создам миграцию для whatsapp_instances и whatsapp_messages
3. Реализую все API endpoints в agent-service
4. Добавлю UI компоненты в Profile.tsx
5. Обновлю nginx-production.conf
6. Протестирую локально
7. Подготовлю к деплою

**Безопасность гарантирую:**
- Все конфиги будут работать after git pull
- Переменные окружения в .env (не в git)
- Тестирую локально перед коммитом
- Rollback plan если что-то сломается

---

## 📝 Примерная оценка времени

- Настройка Docker: 30 минут
- Миграция БД: 15 минут
- API endpoints: 1.5 часа
- Frontend UI: 1 час
- Тестирование: 45 минут
- Документация: 30 минут

**Итого:** ~4-5 часов работы

---

**Жду ваших ответов на вопросы или одобрение с рекомендациями!** 🚀
