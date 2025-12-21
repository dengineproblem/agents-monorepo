# Security Audit Report & Remediation Guide

> **Дата аудита:** 21.12.2024
> **Критических проблем:** 12 | **Высоких:** 8 | **Средних:** 6

---

## Краткая сводка

| Область | Критичные | Высокие | Средние |
|---------|-----------|---------|---------|
| Frontend | 5 | 3 | 2 |
| Backend | 4 | 3 | 2 |
| Database | 3 | 2 | 2 |

**Главные проблемы:**
1. Hardcoded Telegram Bot Token в коде (активный!)
2. Пароли хранятся в localStorage в открытом виде
3. Admin endpoints без авторизации
4. RLS политики с `USING(true)` - открывают доступ всем
5. CORS: `origin: true` разрешает любой домен

---

## PHASE 1: Критические исправления (СРОЧНО)

### 1.1 Ротация скомпрометированных токенов

**Telegram Bot Token** найден в коде:
```
8584683514:AAHMPrOyu4v_CT-Tf-k2exgEop-YQPRi3WM
```

**Шаги:**
1. Зайди в @BotFather в Telegram
2. Выбери бота, команда `/revoke` для отзыва токена
3. Получи новый токен
4. Обнови `.env` на сервере

**Facebook credentials тоже в коде:**
- `FB_APP_ID: 1441781603583445`
- `FB_WEBHOOK_VERIFY_TOKEN: performante_leadgen_webhook_2024`

Эти нужно считать скомпрометированными и обновить в Facebook Developer Console.

---

### 1.2 Удаление console.log из production

**Проблема:** 100+ console.log выводят sensitive данные в DevTools

**Решение:** Создай утилиту для логов

```typescript
// services/frontend/src/utils/logger.ts
const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: any[]) => isDev && console.log(...args),
  error: (...args: any[]) => isDev && console.error(...args),
  warn: (...args: any[]) => isDev && console.warn(...args),
};
```

**Быстрый фикс через Vite (без изменения кода):**

```typescript
// vite.config.ts - добавь в build секцию
export default defineConfig({
  // ... existing config
  esbuild: {
    drop: ['console', 'debugger'],  // Удаляет все console.* в production
  },
});
```

---

### 1.3 Удаление паролей из localStorage

**Проблема:** `services/frontend/src/pages/Signup.tsx:27-29`
```typescript
// ОПАСНО! Пароль в открытом виде
localStorage.setItem('signup_password', e.target.value);
```

**Также на строке 132 - DEBUG вывод пароля на экран!**

**Исправление:**

```typescript
// Signup.tsx - УДАЛИТЬ эти строки:
// localStorage.setItem('signup_password', e.target.value);
// localStorage.getItem('signup_password');

// УДАЛИТЬ debug блок (строка ~132):
// <div className="text-xs text-gray-500 mt-2">DEBUG:...

// Использовать только React state для формы:
const [formData, setFormData] = useState({
  username: '',
  password: '',
  phone: ''
});
```

---

### 1.4 Авторизация для Admin endpoints

**Проблема:** Все `/admin/*` endpoints доступны без авторизации

**Исправление - добавь middleware:**

```typescript
// services/agent-service/src/middleware/adminAuth.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase';

export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = request.headers['x-user-id'] as string;

  if (!userId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // Проверяем is_tech_admin в БД
  const { data: user } = await supabase
    .from('user_accounts')
    .select('is_tech_admin')
    .eq('id', userId)
    .single();

  if (!user?.is_tech_admin) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }
}
```

**Применение:**
```typescript
// services/agent-service/src/routes/adminUsers.ts
import { adminAuthMiddleware } from '../middleware/adminAuth';

app.addHook('preHandler', adminAuthMiddleware);
// Или для конкретных роутов:
app.get('/admin/users', { preHandler: adminAuthMiddleware }, async (req, res) => {
  // ...
});
```

---

### 1.5 Исправление CORS

**Проблема:** `origin: true` разрешает запросы с любого домена

**Исправление:**
```typescript
// services/agent-service/src/server.ts
app.register(cors, {
  origin: [
    'https://performanteaiagency.com',
    'https://app.performanteaiagency.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:8081' : '',
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
```

**Применить к файлам:**
- `services/agent-service/src/server.ts:76-81`
- `services/chatbot-service/src/server.ts:56-61`
- `services/crm-backend/src/server.ts:24-29`
- `services/creative-generation-service/src/server.ts:33-35`

---

## PHASE 2: Высокий приоритет (эта неделя)

### 2.1 Исправление RLS политик в Supabase

**Проблема:** 8 таблиц с `USING(true)` - разрешают всем доступ

**Миграция для исправления:**

```sql
-- migrations/110_fix_rls_policies.sql

-- 1. ai_conversations
DROP POLICY IF EXISTS "Service role full access" ON ai_conversations;
CREATE POLICY "Service role access" ON ai_conversations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "User access own conversations" ON ai_conversations
  FOR ALL
  USING (user_account_id = auth.uid())
  WITH CHECK (user_account_id = auth.uid());

-- 2. ai_messages
DROP POLICY IF EXISTS "Service role full access" ON ai_messages;
CREATE POLICY "Service role access" ON ai_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. ai_pending_plans
DROP POLICY IF EXISTS "Service role full access" ON ai_pending_plans;
CREATE POLICY "Service role access" ON ai_pending_plans
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. account_directions
DROP POLICY IF EXISTS "Service role full access" ON account_directions;
CREATE POLICY "Service role access" ON account_directions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "User access own directions" ON account_directions
  FOR SELECT
  USING (
    ad_account_id IN (
      SELECT id FROM ad_accounts WHERE user_account_id = auth.uid()
    )
  );

-- 5. creative_analysis
DROP POLICY IF EXISTS "Allow all" ON creative_analysis;
CREATE POLICY "Service role access" ON creative_analysis
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 6. telegram_onboarding_sessions
DROP POLICY IF EXISTS "Service role full access" ON telegram_onboarding_sessions;
CREATE POLICY "Service role access" ON telegram_onboarding_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 7. ai_idempotent_operations
DROP POLICY IF EXISTS "Service role full access" ON ai_idempotent_operations;
CREATE POLICY "Service role access" ON ai_idempotent_operations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 8. whatsapp_phone_numbers (RLS была закомментирована)
ALTER TABLE whatsapp_phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access" ON whatsapp_phone_numbers
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

---

### 2.2 Rate Limiting

**Установка:**
```bash
cd services/agent-service && npm install @fastify/rate-limit
```

**Применение:**
```typescript
// services/agent-service/src/server.ts
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  max: 100,           // Максимум запросов
  timeWindow: '1 minute',
  // Для auth endpoints более строгий лимит:
  keyGenerator: (req) => req.ip,
});

// Для login/signup ещё строже:
app.post('/login', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '5 minutes'
    }
  }
}, loginHandler);
```

---

### 2.3 Проверка владельца ресурса

**Проблема:** `adAccounts.ts:140` - можно получить чужие данные

**Исправление:**
```typescript
// services/agent-service/src/routes/adAccounts.ts
app.get('/ad-accounts/:userAccountId', async (req, reply) => {
  const { userAccountId } = req.params;
  const requesterId = req.headers['x-user-id'] as string;

  // ДОБАВИТЬ: Проверка что запрашивающий = владелец
  if (userAccountId !== requesterId) {
    // Если не совпадает, проверяем что это админ
    const { data: requester } = await supabase
      .from('user_accounts')
      .select('is_tech_admin')
      .eq('id', requesterId)
      .single();

    if (!requester?.is_tech_admin) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  }

  // Далее существующая логика...
});
```

---

### 2.4 Удаление hardcoded значений

**Файлы для исправления:**

| Файл | Строка | Что убрать | Заменить на |
|------|--------|-----------|-------------|
| `frontend/src/components/FacebookConnect.tsx` | 11 | `'690472653668355'` | `import.meta.env.VITE_FB_APP_ID` (без fallback!) |
| `frontend/src/pages/Signup.tsx` | 4-8 | FB_CLIENT_ID, WEBHOOK_URL | env variables |
| `frontend/src/components/profile/FacebookManualConnectModal.tsx` | 27 | `PARTNER_ID = '290181230529709'` | `import.meta.env.VITE_FB_PARTNER_ID` |
| `agent-service/src/routes/facebookWebhooks.ts` | 14-18 | FB_APP_ID, FB_WEBHOOK_VERIFY_TOKEN | `process.env.*` |
| `agent-service/src/lib/telegramNotifier.ts` | все | TELEGRAM_BOT_TOKEN | `process.env.TELEGRAM_BOT_TOKEN` |

**Шаблон .env для frontend:**
```bash
# .env.production
VITE_FB_APP_ID=your_fb_app_id
VITE_FB_PARTNER_ID=your_partner_id
VITE_FB_REDIRECT_URI=https://performanteaiagency.com/profile
VITE_API_URL=https://performanteaiagency.com/api
```

---

## PHASE 3: Средний приоритет (этот спринт)

### 3.1 XSS защита

**Проблема:** innerHTML с пользовательскими данными

**Файлы:**
- `frontend/src/components/profile/FacebookManualConnectModal.tsx:272`
- `frontend/src/components/knowledge-base/KBArticle.tsx:255`

**Исправление:**
```typescript
// Вместо innerHTML используй React компонент:

// БЫЛО:
onError={(e) => {
  e.target.parentElement.innerHTML = `<div>${alt}</div>`;
}}

// СТАЛО:
const [imageError, setImageError] = useState(false);

{imageError ? (
  <div className="p-8 border-dashed border-2 bg-muted/30 rounded-lg">
    <p className="text-sm text-center">{alt || 'Изображение'}</p>
  </div>
) : (
  <img src={src} alt={alt} onError={() => setImageError(true)} />
)}
```

---

### 3.2 Webhook HMAC верификация

**Проблема:** Webhooks принимают запросы без проверки подписи

**Исправление для Facebook:**
```typescript
// services/agent-service/src/routes/facebookWebhooks.ts
import crypto from 'crypto';

function verifyFacebookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(providedSignature)
  );
}

// В обработчике:
app.post('/webhooks/facebook', async (req, reply) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const payload = JSON.stringify(req.body);

  if (!verifyFacebookSignature(payload, signature, process.env.FB_APP_SECRET!)) {
    return reply.status(403).send({ error: 'Invalid signature' });
  }

  // Обработка webhook...
});
```

---

### 3.3 Удаление временных файлов

```bash
# Удалить:
rm services/frontend/temp_original_salesApi.ts
rm services/frontend/DEBUG_CHECKLIST.md  # Если не нужен
```

---

### 3.4 Шифрование токенов в БД

**Миграция:**
```sql
-- migrations/111_encrypt_sensitive_columns.sql

-- Создаём extension для шифрования
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Функция для шифрования
CREATE OR REPLACE FUNCTION encrypt_token(token TEXT, key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(pgp_sym_encrypt(token, key), 'base64');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция для дешифрования
CREATE OR REPLACE FUNCTION decrypt_token(encrypted TEXT, key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN pgp_sym_decrypt(decode(encrypted, 'base64'), key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Примечание: Применять постепенно, обновляя код на использование этих функций
```

**На уровне приложения (рекомендуется):**
```typescript
// services/agent-service/src/lib/crypto.ts
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY!; // 32 bytes
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
```

---

## Чеклист для проверки

### Критические (сегодня)
- [ ] Ротировать Telegram Bot Token
- [ ] Добавить `esbuild.drop: ['console']` в vite.config.ts
- [ ] Удалить пароли из localStorage в Signup.tsx
- [ ] Удалить DEBUG блок из Signup.tsx
- [ ] Добавить adminAuthMiddleware

### Высокие (эта неделя)
- [ ] Исправить CORS на всех сервисах
- [ ] Применить миграцию 110_fix_rls_policies.sql
- [ ] Добавить rate limiting
- [ ] Добавить проверку владельца в adAccounts.ts
- [ ] Убрать все hardcoded credentials

### Средние (этот спринт)
- [ ] Исправить XSS (innerHTML -> React)
- [ ] Добавить HMAC верификацию webhooks
- [ ] Удалить temp_original_salesApi.ts
- [ ] Настроить шифрование токенов

---

## Проверка после исправлений

```bash
# 1. Проверить что console.log не попадают в production build
npm run build
grep -r "console\." dist/  # Должно быть пусто

# 2. Проверить что hardcoded tokens удалены
grep -r "8584683514" services/  # Должно быть пусто
grep -r "690472653668355" services/frontend/src/  # Только в .env

# 3. Проверить RLS политики
# В Supabase Dashboard -> Authentication -> Policies
# Убедиться что нет USING(true)

# 4. Тест CORS
curl -H "Origin: https://evil.com" \
  -I https://performanteaiagency.com/api/health
# Должен вернуть 403 или без Access-Control-Allow-Origin
```

---

## Контакты

При вопросах по безопасности обращаться к техническому лиду.

**Не коммить этот файл с реальными токенами!**
