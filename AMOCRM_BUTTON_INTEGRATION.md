# Интеграция кнопки AmoCRM на сайт

Руководство по добавлению официальной кнопки "Подключить amoCRM" на ваш лендинг/веб-приложение.

## Содержание

1. [Обзор](#обзор)
2. [Вариант 1: Кнопка для существующей интеграции](#вариант-1-кнопка-для-существующей-интеграции)
3. [Вариант 2: Кнопка с автоматическим созданием интеграции](#вариант-2-кнопка-с-автоматическим-созданием-интеграции)
4. [Что происходит при клике](#что-происходит-при-клике)
5. [Интеграция с существующим бэкендом](#интеграция-с-существующим-бэкендом)
6. [React компонент](#react-компонент)
7. [Troubleshooting](#troubleshooting)

## Обзор

AmoCRM предоставляет готовую кнопку, которая:
- Открывает модальное окно выбора аккаунта AmoCRM
- Пользователь авторизуется и даёт доступ
- AmoCRM редиректит на ваш `redirect_uri` с authorization code
- Ваш бэкенд обменивает code на токены

**Преимущества:**
- ✅ Готовый UI от AmoCRM
- ✅ Автоматическая обработка авторизации
- ✅ Popup режим (не уходит со страницы)
- ✅ CSRF защита через `state` параметр

## Вариант 1: Кнопка для существующей интеграции

Используйте этот вариант, если вы **уже создали интеграцию** в AmoCRM и получили `client_id`.

### HTML код

```html
<!-- Контейнер для кнопки -->
<div id="amocrm-button"></div>

<!-- Скрипт кнопки -->
<script
  class="amocrm_oauth"
  charset="utf-8"
  data-client-id="ВАШ_CLIENT_ID"
  data-title="Подключить amoCRM"
  data-compact="false"
  data-class-name="amocrm-button"
  data-color="blue"
  data-state="{{RANDOM_STATE}}"
  data-mode="popup"
  data-error-callback="onAmoAuthError"
  src="https://www.amocrm.ru/auth/button.min.js">
</script>

<script>
  // Обработчик ошибок
  function onAmoAuthError({ client_id, error, error_description }) {
    console.error('AmoCRM auth error:', error, error_description);

    if (error === 'access_denied') {
      alert('Вы отменили авторизацию AmoCRM');
    } else {
      alert('Ошибка подключения AmoCRM. Попробуйте ещё раз.');
    }
  }
</script>
```

### Параметры кнопки

| Параметр | Описание | Значение |
|----------|----------|----------|
| `data-client-id` | Client ID вашей интеграции | Из настроек AmoCRM |
| `data-title` | Текст на кнопке | "Подключить amoCRM" |
| `data-compact` | Компактный вид | `false` |
| `data-class-name` | CSS класс для стилизации | `amocrm-button` |
| `data-color` | Цвет кнопки | `blue`, `default`, `green` |
| `data-state` | CSRF токен (генерируйте случайный) | UUID или JWT |
| `data-mode` | Режим работы | `popup` или `post_message` |
| `data-error-callback` | Функция обработки ошибок | `onAmoAuthError` |

### Генерация state токена

**JavaScript (на клиенте):**

```javascript
// Простой вариант с UUID
function generateState() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Сохраните state в sessionStorage или отправьте на сервер
const state = generateState();
sessionStorage.setItem('amocrm_state', state);

// Вставьте в атрибут кнопки
document.querySelector('.amocrm_oauth').setAttribute('data-state', state);
```

**Или серверный вариант (рекомендуется):**

```javascript
// Получите state с вашего бэкенда
fetch('/api/amocrm/generate-state', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userAccountId: 'YOUR_USER_ID' })
})
.then(res => res.json())
.then(data => {
  document.querySelector('.amocrm_oauth').setAttribute('data-state', data.state);
});
```

## Вариант 2: Кнопка с автоматическим созданием интеграции

Используйте этот вариант, если хотите, чтобы AmoCRM **автоматически создавал интеграцию** для каждого нового клиента.

### HTML код

```html
<div id="amocrm-button"></div>

<script
  class="amocrm_oauth"
  charset="utf-8"
  data-name="AI-таргетолог Performante"
  data-description="Автоматическая передача лидов с сайта и сквозная аналитика продаж"
  data-redirect_uri="https://app.performanteaiagency.com/api/amocrm/callback"
  data-secrets_uri="https://app.performanteaiagency.com/api/amocrm/secrets"
  data-logo="https://app.performanteaiagency.com/static/logo-amocrm.png"
  data-scopes="crm,notifications"
  data-title="Подключить amoCRM"
  data-state="{{RANDOM_STATE}}"
  data-mode="popup"
  data-error-callback="onAmoAuthError"
  src="https://www.amocrm.ru/auth/button.min.js">
</script>

<script>
  function onAmoAuthError({ error, error_description }) {
    console.error('AmoCRM auth error:', error, error_description);
    alert('Ошибка подключения AmoCRM. Попробуйте ещё раз.');
  }
</script>
```

### Дополнительные параметры

| Параметр | Описание | Значение |
|----------|----------|----------|
| `data-name` | Название интеграции | "AI-таргетолог Performante" |
| `data-description` | Описание | Короткое описание возможностей |
| `data-redirect_uri` | URL для редиректа | `https://app.../api/amocrm/callback` |
| `data-secrets_uri` | URL для получения секретов | `https://app.../api/amocrm/secrets` |
| `data-logo` | Логотип интеграции (200x200px) | URL изображения |
| `data-scopes` | Права доступа | `crm,notifications` |

### Дополнительный endpoint: `/api/amocrm/secrets`

При использовании варианта 2 нужно создать дополнительный endpoint для приёма секретов.

**Создайте файл:** `services/agent-service/src/routes/amocrmSecrets.ts`

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

const SecretsSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
  state: z.string(),
  name: z.string().optional(),
  scopes: z.string().optional()
});

export default async function amocrmSecretsRoutes(app: FastifyInstance) {
  /**
   * POST /api/amocrm/secrets
   *
   * Receives client_id and client_secret from AmoCRM when integration is auto-created
   */
  app.post('/api/amocrm/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = SecretsSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { client_id, client_secret, state } = parsed.data;

      app.log.info({ client_id, state }, 'Received AmoCRM secrets');

      // TODO: Verify state and save credentials
      // For now, just store in environment or database

      // Extract user account ID from state (if you encoded it there)
      // Or use a temporary storage to link state -> userAccountId

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error processing AmoCRM secrets');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}
```

**Зарегистрируйте роут в `server.ts`:**

```typescript
import amocrmSecretsRoutes from './routes/amocrmSecrets.js';
// ...
app.register(amocrmSecretsRoutes);
```

## Что происходит при клике

### Вариант 1 (существующая интеграция):

1. Пользователь кликает кнопку
2. Открывается popup с выбором аккаунта AmoCRM
3. Пользователь вводит логин/пароль и нажимает "Разрешить"
4. AmoCRM редиректит на `https://app.performanteaiagency.com/api/amocrm/callback?code=XXX&state=YYY`
5. Ваш бэкенд (уже реализован) обменивает `code` на токены
6. Popup закрывается, пользователь видит сообщение об успехе

### Вариант 2 (автосоздание интеграции):

1. Пользователь кликает кнопку
2. Открывается popup с выбором аккаунта AmoCRM
3. **Сначала** AmoCRM отправляет webhook на `data-secrets_uri` с `client_id` и `client_secret`
4. Пользователь авторизуется и нажимает "Разрешить"
5. **Затем** AmoCRM редиректит на `data-redirect_uri` с `code` и `state`
6. Ваш бэкенд обменивает `code` на токены (используя сохранённые `client_id`/`client_secret`)

## Интеграция с существующим бэкендом

Наш бэкенд уже поддерживает OAuth callback. Нужно лишь обновить frontend для генерации `state` токена.

### Обновление OAuth роута

Текущий роут `/api/amocrm/auth` генерирует authorization URL с `state`. Кнопка делает то же самое, но через официальный UI AmoCRM.

**Оба подхода работают параллельно:**

- **Прямая ссылка** (`GET /api/amocrm/auth`) - для API интеграций, мобильных приложений
- **Кнопка AmoCRM** - для веб-сайтов, более красивый UX

## React компонент

Если используете React/Next.js, вот готовый компонент:

```typescript
// components/AmoCRMConnectButton.tsx
import { useEffect, useState } from 'react';
import Script from 'next/script'; // Для Next.js

interface AmoCRMButtonProps {
  userAccountId: string;
  clientId: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function AmoCRMConnectButton({
  userAccountId,
  clientId,
  onSuccess,
  onError
}: AmoCRMButtonProps) {
  const [state, setState] = useState<string>('');
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    // Generate state token on mount
    const generateState = async () => {
      const response = await fetch('/api/amocrm/generate-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAccountId })
      });
      const data = await response.json();
      setState(data.state);
    };

    generateState();
  }, [userAccountId]);

  useEffect(() => {
    // Listen for success/error messages from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'amocrm_connected') {
        onSuccess?.();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  const handleError = (error: any) => {
    console.error('AmoCRM auth error:', error);
    onError?.(error.error || 'unknown_error');
  };

  // Expose error callback to global scope
  useEffect(() => {
    (window as any).onAmoCRMAuthError = handleError;
    return () => {
      delete (window as any).onAmoCRMAuthError;
    };
  }, []);

  if (!state || !scriptLoaded) {
    return (
      <div className="animate-pulse bg-gray-200 h-10 w-48 rounded"></div>
    );
  }

  return (
    <>
      <Script
        src="https://www.amocrm.ru/auth/button.min.js"
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
      />

      <div id="amocrm-button"></div>

      <script
        className="amocrm_oauth"
        data-client-id={clientId}
        data-title="Подключить amoCRM"
        data-compact="false"
        data-class-name="amocrm-button"
        data-color="blue"
        data-state={state}
        data-mode="popup"
        data-error-callback="onAmoCRMAuthError"
      />
    </>
  );
}
```

**Использование:**

```tsx
import { AmoCRMConnectButton } from '@/components/AmoCRMConnectButton';

export default function SettingsPage() {
  const userAccountId = 'your-uuid';
  const clientId = process.env.NEXT_PUBLIC_AMOCRM_CLIENT_ID!;

  return (
    <div>
      <h2>Интеграции</h2>

      <AmoCRMConnectButton
        userAccountId={userAccountId}
        clientId={clientId}
        onSuccess={() => {
          alert('AmoCRM успешно подключен!');
          window.location.reload();
        }}
        onError={(error) => {
          alert(`Ошибка: ${error}`);
        }}
      />
    </div>
  );
}
```

## Генерация state на бэкенде

Добавьте endpoint для генерации безопасного `state` токена:

**Создайте:** `services/agent-service/src/routes/amocrmState.ts`

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';

export default async function amocrmStateRoutes(app: FastifyInstance) {
  app.post('/api/amocrm/generate-state', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId } = request.body as { userAccountId: string };

      if (!userAccountId) {
        return reply.code(400).send({ error: 'userAccountId required' });
      }

      const state = randomUUID();

      // Save state temporarily (expires in 10 minutes)
      // Option 1: Redis
      // await redis.set(`amocrm_state:${state}`, userAccountId, 'EX', 600);

      // Option 2: Database with expiry
      await supabase.from('oauth_states').insert({
        state,
        user_account_id: userAccountId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });

      return reply.send({ state });

    } catch (error: any) {
      app.log.error({ error }, 'Error generating state');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
```

**Обновите callback для проверки state:**

В `services/agent-service/src/routes/amocrmOAuth.ts`, в функции callback добавьте проверку:

```typescript
// Verify state exists and get associated user
const { data: stateData } = await supabase
  .from('oauth_states')
  .select('user_account_id, expires_at')
  .eq('state', state)
  .single();

if (!stateData) {
  return reply.code(400).send({ error: 'Invalid state' });
}

if (new Date(stateData.expires_at) < new Date()) {
  return reply.code(400).send({ error: 'State expired' });
}

// Delete used state
await supabase.from('oauth_states').delete().eq('state', state);
```

## Стилизация кнопки

По умолчанию кнопка имеет стили AmoCRM, но вы можете кастомизировать через CSS:

```css
/* Переопределение стилей */
.amocrm-button {
  /* Ваши стили */
}

.amocrm-button:hover {
  /* Стили при наведении */
}
```

## Troubleshooting

### Кнопка не появляется

**Причины:**
1. Скрипт не загрузился - проверьте консоль браузера
2. `data-class-name` не совпадает с `id` контейнера
3. CSP блокирует загрузку скрипта

**Решение:**
```html
<!-- Добавьте в CSP -->
<meta http-equiv="Content-Security-Policy"
      content="script-src 'self' https://www.amocrm.ru;">
```

### После авторизации ничего не происходит

**Причины:**
1. `redirect_uri` не совпадает с настройками интеграции
2. Callback endpoint не отвечает или возвращает ошибку
3. State токен не валидируется

**Решение:**
- Проверьте логи бэкенда
- Убедитесь что `redirect_uri` точно совпадает (включая https/http)
- Проверьте таблицу `oauth_states`

### Ошибка "access_denied"

Пользователь закрыл окно или отказал в доступе. Это нормально - просто предложите попробовать снова.

### Popup блокируется браузером

Некоторые браузеры блокируют popup. Используйте режим `post_message` вместо `popup`:

```html
data-mode="post_message"
```

И добавьте обработчик:

```javascript
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://www.amocrm.ru') return;

  if (event.data.type === 'amocrm_oauth_success') {
    console.log('Auth success!', event.data);
    // Закройте окно вручную
  }
});
```

## Дополнительные ресурсы

- [Официальная документация кнопки AmoCRM](https://www.amocrm.ru/developers/content/oauth/button)
- [OAuth 2.0 в AmoCRM](https://www.amocrm.ru/developers/content/oauth/oauth)
- [Примеры интеграций](https://www.amocrm.ru/developers/content/oauth/step-by-step)
