# 📱 ИНТЕГРАЦИЯ EVOLUTION API - ПЛАН УСТАНОВКИ

> **Цель:** Интегрировать Evolution API для работы с WhatsApp - авторизация через QR-код на фронтенде, сохранение и отправка сообщений через backend.

---

## 📋 ОГЛАВЛЕНИЕ

1. [Архитектура интеграции](#архитектура-интеграции)
2. [Установка Evolution API](#установка-evolution-api)
3. [Настройка Nginx](#настройка-nginx)
4. [Backend API (agent-service)](#backend-api-agent-service)
5. [Frontend компоненты](#frontend-компоненты)
6. [База данных (Supabase)](#база-данных-supabase)
7. [Процесс деплоя](#процесс-деплоя)
8. [Тестирование](#тестирование)

---

## 🏗️ АРХИТЕКТУРА ИНТЕГРАЦИИ

### Схема работы:

```
┌─────────────────────────────────────────────────────────────┐
│                     ПОЛЬЗОВАТЕЛЬ                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React/Vite)                                       │
│  ├─ WhatsApp Auth Page (QR-код)                             │
│  ├─ Messages Dashboard                                      │
│  └─ Send Message UI                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  NGINX (Docker контейнер)                                    │
│  ├─ /api/whatsapp/* → agent-service:8082                    │
│  └─ /evolution/*     → evolution-api:8080                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────────┐         ┌──────────────────┐
│  AGENT-SERVICE   │         │  EVOLUTION API   │
│  Port: 8082      │◄────────┤  Port: 8080      │
│                  │  HTTP   │                  │
│  Endpoints:      │         │  Services:       │
│  - /whatsapp/qr  │         │  - Redis         │
│  - /whatsapp/send│         │  - PostgreSQL    │
│  - /whatsapp/msg │         │                  │
└────────┬─────────┘         └──────────────────┘
         │
         ▼
┌──────────────────┐
│  SUPABASE        │
│  (PostgreSQL)    │
│                  │
│  Tables:         │
│  - whatsapp_     │
│    instances     │
│  - whatsapp_     │
│    messages      │
└──────────────────┘
```

### Преимущества этого подхода:

1. **Изоляция:** Evolution API работает в отдельном Docker контейнере
2. **Безопасность:** Все запросы проходят через agent-service (единая точка контроля)
3. **Масштабируемость:** Можно легко добавить несколько инстансов WhatsApp
4. **Единый API:** Frontend общается только с agent-service
5. **Webhook:** Evolution API может отправлять события напрямую в agent-service

---

## 🐳 УСТАНОВКА EVOLUTION API

### Шаг 1: Добавить Evolution API в docker-compose.yml

Добавьте следующие сервисы в файл `/root/agents-monorepo/docker-compose.yml`:

```yaml
  # Evolution API - WhatsApp Integration
  evolution-api:
    image: evoapicloud/evolution-api:latest
    ports:
      - "8080:8080"
    environment:
      # Server
      - SERVER_URL=https://app.performanteaiagency.com
      - SERVER_PORT=8080

      # Authentication
      - AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

      # Database
      - DATABASE_ENABLED=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://evolution:${EVOLUTION_DB_PASSWORD}@evolution-postgres:5432/evolution
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true

      # Redis Cache
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://evolution-redis:6379/0
      - CACHE_REDIS_PREFIX_KEY=evolution
      - CACHE_REDIS_SAVE_INSTANCES=true

      # Webhook (отправка событий в agent-service)
      - WEBHOOK_GLOBAL_ENABLED=true
      - WEBHOOK_GLOBAL_URL=http://agent-service:8082/webhooks/evolution
      - WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
      - WEBHOOK_EVENTS_APPLICATION_STARTUP=false
      - WEBHOOK_EVENTS_QRCODE_UPDATED=true
      - WEBHOOK_EVENTS_MESSAGES_SET=true
      - WEBHOOK_EVENTS_MESSAGES_UPSERT=true
      - WEBHOOK_EVENTS_MESSAGES_UPDATE=true
      - WEBHOOK_EVENTS_MESSAGES_DELETE=true
      - WEBHOOK_EVENTS_SEND_MESSAGE=true
      - WEBHOOK_EVENTS_CONNECTION_UPDATE=true

      # Logs
      - LOG_LEVEL=ERROR,WARN,DEBUG,INFO,LOG,VERBOSE
      - LOG_COLOR=true

      # Client Config
      - CONFIG_SESSION_PHONE_CLIENT=Chrome
      - CONFIG_SESSION_PHONE_NAME=Evolution API
      - QRCODE_LIMIT=30

    depends_on:
      - evolution-redis
      - evolution-postgres
    restart: unless-stopped
    networks:
      - default

  # Redis для Evolution API
  evolution-redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6380:6379"
    volumes:
      - evolution-redis-data:/data
    restart: unless-stopped
    networks:
      - default

  # PostgreSQL для Evolution API
  evolution-postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=evolution
      - POSTGRES_PASSWORD=${EVOLUTION_DB_PASSWORD}
      - POSTGRES_DB=evolution
      - POSTGRES_MAX_CONNECTIONS=1000
    ports:
      - "5433:5432"
    volumes:
      - evolution-postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - default

volumes:
  evolution-redis-data:
  evolution-postgres-data:
```

### Шаг 2: Добавить переменные окружения

Добавьте в `.env.agent` (или создайте `.env.evolution`):

```bash
# Evolution API
EVOLUTION_API_KEY=your-secure-api-key-here-change-this
EVOLUTION_DB_PASSWORD=your-secure-db-password-here
EVOLUTION_API_URL=http://evolution-api:8080
```

**ВАЖНО:** Замените `your-secure-api-key-here-change-this` на сильный случайный ключ!

---

## ⚙️ НАСТРОЙКА NGINX

### Добавить маршруты Evolution API в nginx-production.conf

В файле `/root/agents-monorepo/nginx-production.conf` добавьте в оба блока `server` (для `performanteaiagency.com` и `app.performanteaiagency.com`):

```nginx
# Evolution API (для прямого доступа, если нужно)
location /evolution/ {
    # Убираем /evolution из пути
    rewrite ^/evolution/(.*)$ /$1 break;
    proxy_pass http://evolution-api:8080;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Для WebSocket (QR-код обновления в реальном времени)
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Таймауты
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
}
```

**Примечание:** Основной доступ к Evolution API будет через agent-service (`/api/whatsapp/*`), но `/evolution/*` полезен для отладки.

---

## 🔧 BACKEND API (AGENT-SERVICE)

### Создать новый модуль для работы с WhatsApp

#### Файл: `services/agent-service/src/routes/whatsapp.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Schemas
const CreateInstanceSchema = z.object({
  user_id: z.string().uuid(),
  instance_name: z.string().optional(),
});

const SendMessageSchema = z.object({
  instance_id: z.string(),
  phone: z.string(),
  message: z.string(),
});

export default async function whatsappRoutes(fastify: FastifyInstance) {
  // Создать инстанс WhatsApp
  fastify.post('/whatsapp/instance/create', async (request, reply) => {
    const { user_id, instance_name } = CreateInstanceSchema.parse(request.body);

    const instanceNameFinal = instance_name || `instance_${user_id.slice(0, 8)}`;

    try {
      // Создать инстанс в Evolution API
      const response = await axios.post(
        `${EVOLUTION_API_URL}/instance/create`,
        {
          instanceName: instanceNameFinal,
          qrcode: true,
        },
        {
          headers: {
            'apikey': EVOLUTION_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      // Сохранить в Supabase
      const { data, error } = await supabase
        .from('whatsapp_instances')
        .insert({
          user_account_id: user_id,
          instance_name: instanceNameFinal,
          instance_id: response.data.instance.instanceName,
          status: 'disconnected',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        instance: data,
        evolution_data: response.data,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Получить QR-код для авторизации
  fastify.get('/whatsapp/instance/:instanceName/qr', async (request, reply) => {
    const { instanceName } = request.params as { instanceName: string };

    try {
      // Подключиться к инстансу (генерирует QR)
      const response = await axios.get(
        `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY,
          },
        }
      );

      return {
        success: true,
        qrcode: response.data,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Отправить сообщение
  fastify.post('/whatsapp/send', async (request, reply) => {
    const { instance_id, phone, message } = SendMessageSchema.parse(request.body);

    try {
      // Получить инстанс из базы
      const { data: instance, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_id', instance_id)
        .single();

      if (error || !instance) {
        return reply.status(404).send({
          success: false,
          error: 'Instance not found',
        });
      }

      if (instance.status !== 'connected') {
        return reply.status(400).send({
          success: false,
          error: 'Instance is not connected',
        });
      }

      // Отправить сообщение через Evolution API
      const response = await axios.post(
        `${EVOLUTION_API_URL}/message/sendText/${instance.instance_name}`,
        {
          number: phone,
          text: message,
        },
        {
          headers: {
            'apikey': EVOLUTION_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      // Сохранить в базу
      await supabase.from('whatsapp_messages').insert({
        instance_id: instance.id,
        phone,
        message,
        direction: 'outgoing',
        status: 'sent',
        created_at: new Date().toISOString(),
        metadata: response.data,
      });

      return {
        success: true,
        message_data: response.data,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Получить список инстансов пользователя
  fastify.get('/whatsapp/instances/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    try {
      const { data, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('user_account_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return {
        success: true,
        instances: data,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  // Получить историю сообщений
  fastify.get('/whatsapp/messages/:instanceId', async (request, reply) => {
    const { instanceId } = request.params as { instanceId: string };
    const { limit = '50', phone } = request.query as { limit?: string; phone?: string };

    try {
      let query = supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('instance_id', instanceId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (phone) {
        query = query.eq('phone', phone);
      }

      const { data, error } = await query;

      if (error) throw error;

      return {
        success: true,
        messages: data,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}
```

#### Файл: `services/agent-service/src/routes/webhooks.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function webhookRoutes(fastify: FastifyInstance) {
  // Webhook для получения событий от Evolution API
  fastify.post('/webhooks/evolution', async (request, reply) => {
    const event = request.body as any;

    fastify.log.info({ event }, 'Received Evolution API webhook');

    try {
      // Обработка разных типов событий
      switch (event.event) {
        case 'messages.upsert':
          // Новое входящее сообщение
          await handleIncomingMessage(event);
          break;

        case 'qrcode.updated':
          // QR-код обновился
          await handleQRCodeUpdate(event);
          break;

        case 'connection.update':
          // Статус подключения изменился
          await handleConnectionUpdate(event);
          break;

        default:
          fastify.log.warn({ event: event.event }, 'Unknown event type');
      }

      return { success: true };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}

async function handleIncomingMessage(event: any) {
  const { instance, data } = event;
  const message = data.messages?.[0];

  if (!message) return;

  // Получить instance_id из базы
  const { data: instanceData } = await supabase
    .from('whatsapp_instances')
    .select('id')
    .eq('instance_name', instance)
    .single();

  if (!instanceData) return;

  // Сохранить сообщение
  await supabase.from('whatsapp_messages').insert({
    instance_id: instanceData.id,
    phone: message.key.remoteJid,
    message: message.message?.conversation || message.message?.extendedTextMessage?.text || '',
    direction: 'incoming',
    status: 'received',
    created_at: new Date(message.messageTimestamp * 1000).toISOString(),
    metadata: message,
  });
}

async function handleQRCodeUpdate(event: any) {
  const { instance, data } = event;

  // Обновить QR-код в базе (опционально)
  await supabase
    .from('whatsapp_instances')
    .update({
      qr_code: data.qrcode?.base64,
      updated_at: new Date().toISOString(),
    })
    .eq('instance_name', instance);
}

async function handleConnectionUpdate(event: any) {
  const { instance, data } = event;

  // Обновить статус подключения
  const status = data.state === 'open' ? 'connected' : 'disconnected';

  await supabase
    .from('whatsapp_instances')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('instance_name', instance);
}
```

#### Регистрация роутов в `services/agent-service/src/server.ts`

Добавьте в файл импорты и регистрацию:

```typescript
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhooks.js';

// После других регистраций роутов
await fastify.register(whatsappRoutes);
await fastify.register(webhookRoutes);
```

---

## 🎨 FRONTEND КОМПОНЕНТЫ

### 1. Страница авторизации WhatsApp

#### Файл: `services/frontend/src/pages/WhatsAppAuth.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export default function WhatsAppAuth() {
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string>('');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Получить userId из контекста/localStorage
  const userId = localStorage.getItem('user_id'); // Замените на ваш способ получения userId

  const createInstance = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API_URL}/whatsapp/instance/create`, {
        user_id: userId,
      });

      if (response.data.success) {
        setInstanceName(response.data.instance.instance_name);
        await getQRCode(response.data.instance.instance_name);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create instance');
    } finally {
      setLoading(false);
    }
  };

  const getQRCode = async (name: string) => {
    try {
      setStatus('connecting');
      const response = await axios.get(`${API_URL}/whatsapp/instance/${name}/qr`);

      if (response.data.success && response.data.qrcode) {
        setQrCode(response.data.qrcode.base64 || response.data.qrcode.code);

        // Проверять статус каждые 5 секунд
        const interval = setInterval(async () => {
          const statusResponse = await axios.get(`${API_URL}/whatsapp/instances/${userId}`);
          const instance = statusResponse.data.instances.find((i: any) => i.instance_name === name);

          if (instance?.status === 'connected') {
            setStatus('connected');
            setQrCode(null);
            clearInterval(interval);
          }
        }, 5000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to get QR code');
    }
  };

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6">WhatsApp Authorization</h1>

        {status === 'disconnected' && !qrCode && (
          <button
            onClick={createInstance}
            disabled={loading}
            className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Connect WhatsApp'}
          </button>
        )}

        {status === 'connecting' && qrCode && (
          <div className="text-center">
            <p className="mb-4">Scan this QR code with WhatsApp:</p>
            <div className="flex justify-center mb-4">
              <QRCodeSVG value={qrCode} size={256} />
            </div>
            <p className="text-sm text-gray-600">
              Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
            </p>
          </div>
        )}

        {status === 'connected' && (
          <div className="text-center">
            <div className="text-green-600 text-6xl mb-4">✓</div>
            <h2 className="text-xl font-semibold mb-2">Connected!</h2>
            <p className="text-gray-600">Your WhatsApp is now connected</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 2. Компонент отправки сообщений

#### Файл: `services/frontend/src/components/WhatsAppSend.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

export default function WhatsAppSend() {
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = localStorage.getItem('user_id');

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      const response = await axios.get(`${API_URL}/whatsapp/instances/${userId}`);
      const connected = response.data.instances.filter((i: any) => i.status === 'connected');
      setInstances(connected);
      if (connected.length > 0) {
        setSelectedInstance(connected[0].instance_id);
      }
    } catch (err) {
      console.error('Failed to load instances:', err);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setError(null);

    try {
      await axios.post(`${API_URL}/whatsapp/send`, {
        instance_id: selectedInstance,
        phone: phone.replace(/\D/g, ''), // Убрать не-цифры
        message,
      });

      setSuccess(true);
      setMessage('');
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  if (instances.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800">No connected WhatsApp instances. Please connect first.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold mb-4">Send WhatsApp Message</h2>

      <form onSubmit={sendMessage}>
        {instances.length > 1 && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">WhatsApp Instance</label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="w-full border rounded-lg p-2"
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.instance_id}>
                  {instance.instance_name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Phone Number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1234567890"
            className="w-full border rounded-lg p-2"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            rows={4}
            className="w-full border rounded-lg p-2"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send Message'}
        </button>
      </form>

      {success && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-600">Message sent successfully!</p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
```

### 3. Установить зависимости

```bash
cd services/frontend
npm install qrcode.react axios
```

---

## 💾 БАЗА ДАННЫХ (SUPABASE)

### SQL Миграция

Создайте файл `migrations/005_whatsapp_integration.sql`:

```sql
-- WhatsApp Instances (подключенные аккаунты WhatsApp)
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  instance_name VARCHAR(255) NOT NULL UNIQUE,
  instance_id VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) DEFAULT 'disconnected', -- disconnected, connecting, connected
  qr_code TEXT, -- Base64 QR-код (опционально)
  phone_number VARCHAR(50), -- Номер телефона после подключения
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_connected_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_user ON whatsapp_instances(user_account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_status ON whatsapp_instances(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_name ON whatsapp_instances(instance_name);

-- WhatsApp Messages (история сообщений)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  phone VARCHAR(50) NOT NULL, -- Номер собеседника
  message TEXT NOT NULL,
  direction VARCHAR(20) NOT NULL, -- incoming, outgoing
  status VARCHAR(50) DEFAULT 'sent', -- sent, delivered, read, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb, -- Полные данные от Evolution API
  analyzed BOOLEAN DEFAULT FALSE, -- Флаг для AI анализа
  analyzed_at TIMESTAMPTZ,
  analysis_result JSONB -- Результаты AI анализа (опционально)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_instance ON whatsapp_messages(instance_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction ON whatsapp_messages(direction);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_analyzed ON whatsapp_messages(analyzed) WHERE analyzed = FALSE;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON whatsapp_messages(created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Политики доступа для whatsapp_instances
CREATE POLICY "Users can view their own instances"
  ON whatsapp_instances FOR SELECT
  USING (user_account_id = auth.uid());

CREATE POLICY "Users can create their own instances"
  ON whatsapp_instances FOR INSERT
  WITH CHECK (user_account_id = auth.uid());

CREATE POLICY "Users can update their own instances"
  ON whatsapp_instances FOR UPDATE
  USING (user_account_id = auth.uid());

-- Политики доступа для whatsapp_messages
CREATE POLICY "Users can view messages from their instances"
  ON whatsapp_messages FOR SELECT
  USING (instance_id IN (
    SELECT id FROM whatsapp_instances WHERE user_account_id = auth.uid()
  ));

CREATE POLICY "System can insert messages"
  ON whatsapp_messages FOR INSERT
  WITH CHECK (true); -- Service role может вставлять

-- Функция для автообновления updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER whatsapp_instances_updated_at
  BEFORE UPDATE ON whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_instances_updated_at();

-- Комментарии
COMMENT ON TABLE whatsapp_instances IS 'WhatsApp instances connected by users';
COMMENT ON TABLE whatsapp_messages IS 'WhatsApp messages history for analysis and storage';
COMMENT ON COLUMN whatsapp_messages.analyzed IS 'Flag indicating if message has been analyzed by AI';
```

Примените миграцию в Supabase Dashboard:
1. Зайдите в SQL Editor
2. Вставьте SQL код
3. Нажмите "Run"

---

## 🚀 ПРОЦЕСС ДЕПЛОЯ

### Шаг 1: Локальная подготовка

```bash
# На локальной машине
cd ~/agents-monorepo

# Добавить новые файлы
git add docker-compose.yml
git add nginx-production.conf
git add services/agent-service/src/routes/whatsapp.ts
git add services/agent-service/src/routes/webhooks.ts
git add services/frontend/src/pages/WhatsAppAuth.tsx
git add services/frontend/src/components/WhatsAppSend.tsx
git add migrations/005_whatsapp_integration.sql
git add EVOLUTION_API_INTEGRATION.md

# Коммит
git commit -m "Add Evolution API integration for WhatsApp

- Add Evolution API, Redis, PostgreSQL to docker-compose
- Configure nginx routes for Evolution API
- Add WhatsApp routes in agent-service
- Add webhook handler for Evolution API events
- Add frontend components for QR auth and messaging
- Add Supabase migration for WhatsApp tables"

# Пуш в main
git push origin main
```

### Шаг 2: На сервере

```bash
# SSH на сервер
ssh root@your-server

cd ~/agents-monorepo

# Подтянуть изменения
git pull origin main

# Создать .env.evolution (или добавить в .env.agent)
nano .env.agent
# Добавьте:
# EVOLUTION_API_KEY=your-secure-api-key-here
# EVOLUTION_DB_PASSWORD=your-secure-db-password-here
# EVOLUTION_API_URL=http://evolution-api:8080

# Пересобрать контейнеры
docker-compose build --no-cache agent-service frontend frontend-appreview

# Запустить новые сервисы
docker-compose up -d

# Проверить статус
docker ps | grep evolution
```

### Шаг 3: Применить миграцию в Supabase

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Вставьте содержимое `migrations/005_whatsapp_integration.sql`
4. Нажмите "Run"

### Шаг 4: Настроить SSL (если нужен отдельный домен)

Если хотите отдельный домен для Evolution API (опционально):

```bash
# Получить SSL сертификат
sudo certbot certonly --standalone -d whatsapp.performanteaiagency.com

# Добавить домен в nginx-production.conf (аналогично другим доменам)
# Перезапустить nginx
docker-compose restart nginx
```

---

## 🧪 ТЕСТИРОВАНИЕ

### 1. Проверка контейнеров

```bash
# Все контейнеры должны быть запущены
docker ps | grep evolution

# Проверить логи
docker logs agents-monorepo-evolution-api-1
docker logs agents-monorepo-evolution-redis-1
docker logs agents-monorepo-evolution-postgres-1
```

### 2. Проверка Evolution API

```bash
# Healthcheck
curl -H "apikey: YOUR_API_KEY" http://localhost:8080/

# Должен вернуть информацию об API
```

### 3. Проверка agent-service endpoints

```bash
# Создать инстанс
curl -X POST https://app.performanteaiagency.com/api/whatsapp/instance/create \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "your-user-uuid"
  }'

# Получить QR-код
curl https://app.performanteaiagency.com/api/whatsapp/instance/YOUR_INSTANCE_NAME/qr
```

### 4. Тестирование на фронтенде

1. Откройте `https://app.performanteaiagency.com/whatsapp-auth`
2. Нажмите "Connect WhatsApp"
3. Отсканируйте QR-код в WhatsApp
4. Проверьте, что статус изменился на "Connected"
5. Откройте страницу отправки сообщений
6. Отправьте тестовое сообщение

### 5. Проверка webhook

```bash
# Отправить сообщение на свой WhatsApp
# Проверить, что оно сохранилось в базе
curl https://app.performanteaiagency.com/api/whatsapp/messages/YOUR_INSTANCE_ID
```

---

## 📊 МОНИТОРИНГ И ЛОГИ

### Просмотр логов

```bash
# Evolution API
docker logs -f agents-monorepo-evolution-api-1

# agent-service (webhook события)
docker logs -f agents-monorepo-agent-service-1 | grep evolution

# Все сервисы
docker-compose logs -f evolution-api evolution-redis evolution-postgres
```

### Grafana Dashboard

В Grafana (порт 3000) добавьте панели для мониторинга:
- Количество подключенных инстансов WhatsApp
- Количество отправленных/полученных сообщений
- Ошибки webhook

---

## 🔒 БЕЗОПАСНОСТЬ

### Важные моменты:

1. **API Key:** Используйте сильный случайный ключ для `EVOLUTION_API_KEY`
2. **Пароль БД:** Сильный пароль для `EVOLUTION_DB_PASSWORD`
3. **Webhook:** Валидируйте source IP для webhook endpoint
4. **RLS:** Row Level Security в Supabase защищает данные пользователей
5. **HTTPS:** Все запросы идут через HTTPS (nginx SSL)

### Рекомендации:

```bash
# Сгенерировать надежный API ключ
openssl rand -base64 32

# Сгенерировать надежный пароль БД
openssl rand -base64 24
```

---

## 📝 ДОПОЛНИТЕЛЬНЫЕ ВОЗМОЖНОСТИ

### 1. AI Анализ сообщений

Добавьте в agent-brain новый модуль для анализа входящих сообщений:

```javascript
// services/agent-brain/src/whatsappAnalyzer.js

async function analyzeMessage(message, phone) {
  const prompt = `
    Analyze this WhatsApp message from customer:
    Phone: ${phone}
    Message: ${message}

    Classify:
    - Intent (question, complaint, order, etc.)
    - Sentiment (positive, negative, neutral)
    - Urgency (low, medium, high)
    - Suggested action
  `;

  const result = await callOpenAI(prompt);

  // Сохранить результат в whatsapp_messages.analysis_result
  await supabase
    .from('whatsapp_messages')
    .update({
      analyzed: true,
      analyzed_at: new Date().toISOString(),
      analysis_result: result,
    })
    .eq('id', messageId);
}
```

### 2. Автоответы

Настройте автоматические ответы на основе AI анализа:

```typescript
// В webhook handler
if (analysis.intent === 'question' && analysis.urgency === 'high') {
  await sendAutoReply(instanceId, phone,
    "Thank you for your message! We'll respond within 1 hour."
  );
}
```

### 3. Dashboard для сообщений

Создайте страницу в frontend для просмотра всех сообщений:
- Фильтр по дате
- Поиск по номеру телефона
- Статистика (всего сообщений, по направлениям)
- Export в CSV

### 4. Уведомления в Telegram

Отправляйте важные сообщения WhatsApp в Telegram:

```typescript
if (analysis.urgency === 'high') {
  await sendTelegramNotification(
    userTelegramId,
    `🚨 Urgent message from ${phone}: ${message}`
  );
}
```

---

## 🆘 TROUBLESHOOTING

### Проблема: Evolution API не запускается

```bash
# Проверить логи
docker logs agents-monorepo-evolution-api-1

# Проверить переменные окружения
docker exec agents-monorepo-evolution-api-1 env | grep EVOLUTION

# Пересоздать контейнер
docker-compose up -d --force-recreate evolution-api
```

### Проблема: QR-код не генерируется

```bash
# Проверить доступность Evolution API
curl -H "apikey: YOUR_KEY" http://localhost:8080/

# Проверить Redis
docker exec agents-monorepo-evolution-redis-1 redis-cli ping

# Должен вернуть PONG
```

### Проблема: Webhook не работает

```bash
# Проверить, что agent-service доступен из evolution-api
docker exec agents-monorepo-evolution-api-1 curl http://agent-service:8082/health

# Проверить логи webhook в agent-service
docker logs -f agents-monorepo-agent-service-1 | grep webhook
```

### Проблема: Сообщения не сохраняются в базу

```bash
# Проверить RLS политики в Supabase
# Проверить логи agent-service
docker logs agents-monorepo-agent-service-1 | grep -i error

# Проверить подключение к Supabase
docker exec agents-monorepo-agent-service-1 env | grep SUPABASE
```

---

## ✅ ЧЕКЛИСТ ИНТЕГРАЦИИ

- [ ] Evolution API добавлен в docker-compose.yml
- [ ] Redis и PostgreSQL для Evolution API настроены
- [ ] Переменные окружения (.env.agent) настроены
- [ ] Nginx маршруты добавлены
- [ ] WhatsApp роуты в agent-service созданы
- [ ] Webhook handler реализован
- [ ] Frontend компоненты добавлены
- [ ] Supabase миграция применена
- [ ] Все контейнеры запущены (`docker ps`)
- [ ] Evolution API доступен (`curl localhost:8080`)
- [ ] QR-код генерируется на фронтенде
- [ ] WhatsApp успешно подключен
- [ ] Отправка сообщений работает
- [ ] Входящие сообщения сохраняются в базу
- [ ] Webhook получает события от Evolution API
- [ ] SSL сертификаты настроены (если нужен отдельный домен)
- [ ] Логи проверены на ошибки

---

## 🎯 ИТОГ

После выполнения всех шагов у вас будет:

1. ✅ **Evolution API** запущен в Docker
2. ✅ **Frontend** с QR-кодом авторизации WhatsApp
3. ✅ **Backend API** для управления инстансами и отправки сообщений
4. ✅ **Webhook** для получения входящих сообщений
5. ✅ **База данных** для хранения истории сообщений
6. ✅ **Готово к расширению:** AI анализ, автоответы, dashboard

### Архитектура работает так:

```
User → Frontend (QR) → agent-service → Evolution API → WhatsApp
                            ↓
                        Supabase (сообщения)
                            ↑
Evolution API (webhook) → agent-service → Supabase
```

### Следующие шаги:

1. Протестировать интеграцию
2. Добавить AI анализ сообщений
3. Настроить автоответы
4. Создать dashboard для управления
5. Добавить уведомления в Telegram

---

**Успешной интеграции! 🚀**
