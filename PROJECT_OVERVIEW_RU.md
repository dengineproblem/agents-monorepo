## Агент по управлению рекламой — обзор проекта (RU)

Короткий конспект для передачи другому исполнителю: где что лежит, как работает, какие проблемы и как воспроизвести/исправить.

### Архитектура монорепо
- Два сервиса:
  - services/agent-brain — «мозг» (Node.js, Fastify, JS). Файл входа: src/server.js
  - services/agent-service — «исполнитель» (TypeScript, Fastify). Работает с Facebook Graph API и оркеструет workflow'ы
- docker-compose.yml поднимает оба сервиса и прокидывает окружение

### Agent Brain (services/agent-brain)
- Основные эндпоинты:
  - GET /api/brain/llm-ping — проверка доступности LLM
  - POST /api/brain/run — основной запуск анализа/плана (inputs.dispatch=false для dry-запуска)
  - POST /api/brain/cron/run-batch — ручной запуск batch-обработки всех активных пользователей
- Ключевые функции/логика в src/server.js:
  - **Cron-планировщик (новое!)**: автоматический запуск в 08:00 каждый день (Asia/Almaty)
    - Получает всех активных пользователей из Supabase (WHERE active = true)
    - Обрабатывает пользователей поочередно (не параллельно)
    - Для каждого: собирает данные → выполняет действия → отправляет отчет в Telegram
    - Логирует детальную статистику: успешно/неуспешно обработанных, время выполнения
  - Сбор данных: Supabase (учётка, токены, настройки), Facebook Graph Insights (adset/ad/campaign; вчера/сегодня/3/7/30 дней)
  - **Данные по объявлениям (ads)**: для каждого ad set загружаются ads (вчера) с метриками:
    - ad_id, ad_name, spend, impressions, actions
    - Передаются в LLM для анализа "пожирателей бюджета"
  - Подготовка Health Score (HS) на уровне ad set (от -100 до +100), диагностика CPL/QCPL, тренды, CTR/CPM/Frequency, стадия обучения, объём данных, компенсация «сегодня»
  - **Логика "пожирателей бюджета"**: если в ad set ≥2 объявлений:
    - Находит объявление с максимальными затратами (≥50% от total spend)
    - Если его CPL/QCPL > target × 1.3 → генерирует PauseAd action
    - LLM применяет эту логику автоматически для ad set с классами neutral/slightly_bad/bad
  - LLM — основной «decision maker»: формирует planNote, actions, reportText по строгому шаблону (JSON). Модель: gpt-5
  - Фолбэк: детерминированная логика, если LLM упал или USE_LLM=false
  - Ограничение действий за прогон: BRAIN_MAX_ACTIONS_PER_RUN
  - **Отправка отчётов в Telegram**: автоматическая отправка через Telegram Bot API
    - Использует telegram_id и telegram_bot_token из user_accounts
    - Формат: Markdown, простой язык без англицизмов
  - SYSTEM_PROMPT расширен спецификацией v1.2+, включая:
    - Правила бюджетов, HS, матрицу действий
    - Структуру данных по ads и логику определения "пожирателей"
    - Триггеры «Дублирования с LAL3 IG Engagers 365d»
    - Шаблон отчёта, self-check
    - Динамические бюджеты из Supabase (plan_daily_budget_cents, default_cpl_target_cents)
  - LLM-вызовы переведены на прямой OpenAI Responses API (в обход SDK), без max_tokens/max_output_tokens

Переменные окружения (основные):
- BRAIN_MODEL=gpt-5
- BRAIN_DRY_RUN, BRAIN_DEBUG_LLM, BRAIN_MAX_ACTIONS_PER_RUN, BRAIN_TEST_MODE
- AGENT_SERVICE_URL
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
- **CRON_ENABLED=true** — включить/выключить cron (по умолчанию включен)
- **CRON_SCHEDULE="0 8 * * *"** — расписание cron (по умолчанию 08:00 каждый день)

### Agent Service (services/agent-service)
- Принимает батчи действий от Brain: src/routes/actions.ts
- Поддерживаемые типы действий:
  - GetCampaignStatus, PauseCampaign, UpdateAdSetDailyBudget, PauseAd
  - Workflow.DuplicateAndPauseOriginal, Workflow.DuplicateKeepOriginalActive
  - Audience.DuplicateAdSetWithAudience (дубликат ad set с заменой аудитории)
- Адаптер Facebook (src/adapters/facebook.ts): FB_API_VERSION=v20.0; корректная передача execution_options=["validate_only"] при FB_VALIDATE_ONLY=true
- Workflow дублирования (src/workflows/campaignDuplicate.ts):
  - Учитывает validate_only (нет реальных id при создании кампании)
  - Копирует promoted_object, targeting (в т.ч. geo_locations), сохраняет Advantage+
  - Реализован Audience.DuplicateAdSetWithAudience

Переменные окружения (основные):
- AGENT_DRY_RUN, FB_VALIDATE_ONLY, FB_API_VERSION, SUPABASE_URL/KEY

### Supabase (схема — кратко)
- user_accounts: access_token, ad_account_id, page_id, instagram_id, телеграм поля, плановые бюджеты/лимиты
- account_directions: per-direction бюджеты/целевые CPL
- asset_directions: связи кампаний/ad set с направлениями

### Ключевая предметная логика
- Строгая матрица действий по HS и CPL/QCPL
- Жёсткое соблюдение дневного бюджета аккаунта и квот по направлениям
- Дублирование с изменением аудитории (LAL 3% от IG Engagers 365d):
  - Триггеры: CPL_ratio ≥ 2.0, достаточные показы, HS в [neutral|slightly_bad|bad]
  - Бюджет дубля: min(original_daily_budget, $10), но не ниже $3
  - Advantage+ сохраняется; имя дубля: <AS_NAME> — DUP LAL3 IG365 — <DATE>
  - Идемпотентность: не более 1 дубля на ad set в день для этого инструмента
  - Варианты: с остановкой оригинала или без — в зависимости от HS/истории

### Известные ошибки и исправления
1) Facebook: execution_options должен быть массивом
   - Исправлено: передаём ["validate_only"]
2) PauseAd: несовпадение имени параметра ad_id vs adId
   - Исправлено: роутер поддерживает оба, выставляет status='PAUSED'
3) validate_only и дублирование кампаний: нет id на create
   - Исправлено: workflow не требует реальный id при validate_only
4) План мог быть undefined при сохранении отчёта
   - Исправлено: всегда формируется объект plan
5) Телеграм: слишком длинные/много отчётов, неверный account_id
   - Исправлено: строгий постпроцессор finalizeReportText; отключены прошлые отчёты в сообщении
6) LLM пустые ответы/429/несовместимость SDK с gpt-5
   - Исправлено: смена ключа; переход на Responses API (прямой fetch), без max_tokens

### ✅ Решенная проблема с LLM (2025-09-30)

**Симптомы:** 
- GET /api/brain/llm-ping возвращал 400/500 с ошибками:
  - «Unsupported parameter: 'max_tokens'…»
  - «Invalid value: 'text'. Supported values are: 'input_text'...»
- Пустой ответ от LLM (raw:"")

**Найденные проблемы:**

1. **Docker-контейнер использовал старую версию кода**
   - Контейнер запущен 2 часа назад, изменения не попали в образ
   - Старая версия использовала SDK, который добавлял max_tokens

2. **Неправильный формат контента для Responses API**
   - Использовался `type: 'text'` вместо `type: 'input_text'`
   - Responses API требует специфичный формат для входных сообщений

3. **Неправильное извлечение текста из ответа**
   - Пытались получить `resp.output_text` (поле не существует)
   - Структура ответа: `output[type='message'].content[type='output_text'].text`

**Решение:**

```javascript
// 1. Исправлен формат контента
input: [
  { role: 'system', content: [ { type: 'input_text', text: '...' } ] },
  { role: 'user', content: [ { type: 'input_text', text: '...' } ] }
]

// 2. Правильное извлечение текста
const message = resp.output.find(o => o.type === 'message');
const textContent = message.content.find(c => c.type === 'output_text');
const text = textContent?.text || '';
```

**Команды для применения:**
```bash
# Пересобрать и перезапустить
docker-compose build --no-cache agent-brain && docker-compose up -d

# Проверить
curl localhost:7080/api/brain/llm-ping
# Ожидаемый ответ: {"ok":true,"model":"gpt-5","raw":"ok"}
```

**Диагностика (если проблема вернется):**
```bash
lsof -n -P -i :7080  # проверить, что слушает порт
docker logs agents-monorepo-agent-brain-1 --tail 50  # логи ошибок
docker-compose build --no-cache agent-brain && docker-compose up -d  # пересобрать
```

### Быстрые команды для проверки (локально)
```
# Проверить занятость порта 7080
lsof -n -P -i :7080

# Запустить локально brain на 7091
cd services/agent-brain
BRAIN_PORT=7091 BRAIN_MODEL=gpt-5 OPENAI_API_KEY=... node src/server.js

# Пинг
curl -sS localhost:7091/api/brain/llm-ping

# Пробный прогон без действий
curl -sS -X POST localhost:7091/api/brain/run \
  -H 'content-type: application/json' \
  -d '{"userAccountId":"<UUID>","inputs":{"dispatch":false}}'
```

### 🆕 Cron-планировщик и batch-обработка (2025-10-01)

**Автоматический запуск:**
- Cron запускается каждый день в 08:00 (Asia/Almaty)
- Получает всех пользователей с `active = true` из Supabase `user_accounts`
- Обрабатывает каждого пользователя поочередно:
  1. Собирает данные из рекламного кабинета
  2. Запускает Brain для анализа и генерации действий
  3. Выполняет действия через agent-service
  4. Отправляет отчет в Telegram

**Ручной запуск batch-обработки:**
```bash
curl -X POST localhost:7080/api/brain/cron/run-batch
```

**Настройка расписания:**
```bash
# В docker-compose.yml или .env
CRON_ENABLED=true                # включить/выключить
CRON_SCHEDULE="0 8 * * *"        # изменить расписание (cron syntax)
```

**Требования к user_accounts в Supabase:**
- `active = true` — пользователь будет обрабатываться
- `telegram_id` и `telegram_bot_token` — для отправки отчетов
- `plan_daily_budget_cents` и `default_cpl_target_cents` — динамические таргеты

### 🆕 Данные по объявлениям и "пожиратели бюджета" (2025-10-01)

**Новые возможности:**
- LLM теперь видит данные по каждому объявлению (ads) внутри ad set
- Автоматически находит "пожирателей бюджета":
  - Объявление тратит ≥50% бюджета ad set
  - Имеет CPL/QCPL выше целевого × 1.3
  - Генерирует action `PauseAd` для остановки неэффективного объявления

**Структура данных ads в llmInput:**
```json
{
  "adsets": [{
    "adset_id": "...",
    "name": "...",
    "ads": [
      {
        "ad_id": "...",
        "ad_name": "...",
        "spend": 12.50,
        "impressions": 1000,
        "actions": [...]
      }
    ]
  }]
}
```

### 🆕 Инструменты дублирования (2025-10-01)

**Полностью протестированы и работают:**

1. **Audience.DuplicateAdSetWithAudience** — дубль ad set с новой аудиторией
   - Используется для смены аудитории на LAL 3% IG Engagers 365d
   - Триггеры: CPL_ratio ≥ 2.0, достаточные показы, HS в [neutral|slightly_bad|bad]
   - Бюджет дубля: min(original_budget, $10), но не ниже $3
   - Сохраняет Advantage+ и все настройки

2. **Workflow.DuplicateAndPauseOriginal** — дубль кампании + пауза оригинала
   - Для "реанимации" неудачных кампаний

3. **Workflow.DuplicateKeepOriginalActive** — дубль кампании, оригинал активен
   - Для масштабирования успешных кампаний

**Валидация:**
- Все actions валидируются в agent-service через zod schemas
- В режиме `FB_VALIDATE_ONLY=true` Facebook API проверяет запросы без выполнения
- В режиме `BRAIN_TEST_MODE=true` можно тестировать с упрощенным промтом

### Что важно помнить при деплое/тестах
- **Cron включен по умолчанию** — запускается в 08:00 ежедневно
- **Для отключения cron**: установите `CRON_ENABLED=false`
- **Ручной запуск batch**: `POST /api/brain/cron/run-batch`
- Валидация FB: включайте FB_VALIDATE_ONLY=true до «боевого» запуска
- Для репорта в Telegram нужны telegram_bot_token/telegram_id в user_accounts
- Отчёт — строго по активным кампаниям с результатом, за предыдущий день, один блок
- **Активация пользователя**: установите `active = true` в Supabase user_accounts

### Тестирование системы

**Проверка cron (ручной запуск):**
```bash
curl -X POST localhost:7080/api/brain/cron/run-batch
```

**Проверка одного пользователя:**
```bash
curl -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"<UUID>","inputs":{"dispatch":false}}'
```

**Проверка данных по ads:**
```bash
curl -X POST localhost:7080/api/brain/run \
  -H 'Content-Type: application/json' \
  -d '{"userAccountId":"<UUID>","inputs":{"dispatch":false}}' \
  | jq '.llm.input.analysis.adsets[0].ads'
```

**Логи batch-обработки:**
```bash
docker logs agents-monorepo-agent-brain-1 --tail 100 | grep -i "batch\|processUser"
```

### Контакты и точки расширения
- SYSTEM_PROMPT (в brain) — центральное место для «поведения» медиабайера и формата JSON-ответа
- Новые инструменты действий добавляются в ALLOWED_TYPES и валидацию в brain, а также в routes/actions.ts + workflows в agent-service
- Cron-планировщик находится в конце src/server.js, легко настраивается через env-переменные

