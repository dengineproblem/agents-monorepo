## Агент по управлению рекламой — обзор проекта (RU)

Короткий конспект для передачи другому исполнителю: где что лежит, как работает, какие проблемы и как воспроизвести/исправить.

### Архитектура монорепо
- Два сервиса:
  - services/agent-brain — «мозг» (Node.js, Fastify, JS). Файл входа: src/server.js
    - Scoring Agent (src/scoring.js) — предикшен и оценка рисков роста CPL
  - services/agent-service — «исполнитель» (TypeScript, Fastify). Работает с Facebook Graph API и оркеструет workflow'ы
- docker-compose.yml поднимает оба сервиса и прокидывает окружение

### Agent Brain (services/agent-brain)
- Основные эндпоинты:
  - GET /api/brain/llm-ping — проверка доступности LLM
  - POST /api/brain/run — основной запуск анализа/плана (inputs.dispatch=false для dry-запуска)
  - POST /api/brain/cron/run-batch — ручной запуск batch-обработки всех активных пользователей
- Ключевые функции/логика в src/server.js:
  - Cron-планировщик: автоматический запуск в 08:00 каждый день (Asia/Almaty)
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
- **SCORING_ENABLED=true** — включить scoring agent
- **SCORING_MIN_IMPRESSIONS=1000** — минимум показов для анализа
- **SCORING_PREDICTION_DAYS=3** — на сколько дней вперед предикшн
- **SCORING_MODEL=gpt-5** — модель LLM для scoring

### 🆕 Scoring Agent (services/agent-brain/src/scoring.js) — 2025-10-04

**Назначение**: Специализированный модуль для оценки рисков роста CPL и предикшена на ближайшие дни.

**Как работает:**
1. Запускается ПЕРЕД основным brain agent (первым шагом в `/api/brain/run`)
2. Собирает метрики из Facebook API:
   - Insights за 3d и 7d (CPM, CTR, Frequency)
   - Diagnostics rankings (quality, engagement, conversion) на уровне ad
   - История изменений бюджетов (для определения budget jump)
3. Вычисляет риск-скор (0-100) по формуле:
   ```
   risk = 30×(CPM3/CPM7-1) + 25×(1-CTR3/CTR7) + 20×(FREQ-1.9)/0.8 + 
          15×I[budget_jump] + 10×I[rank_drop]
   ```
4. Определяет risk level: Low (0-19), Medium (20-39), High (40+)
5. Использует LLM для:
   - Анализа трендов (improving/stable/declining)
   - Предикшена CPL на 3 дня
   - Генерации рекомендаций
   - Оценки активных креативов из `user_creatives`
6. Возвращает `scoring_output`, который попадает в `llmInput` для main brain

**Структура выходных данных:**
```json
{
  "summary": {
    "high_risk_count": 2,
    "medium_risk_count": 3,
    "low_risk_count": 5,
    "overall_trend": "declining",
    "alert_level": "warning"
  },
  "items": [
    {
      "level": "campaign|adset|ad",
      "id": "...",
      "name": "...",
      "risk_score": 52,
      "risk_level": "High",
      "trend": "declining",
      "prediction": {
        "days": 3,
        "cpl_current": 2.10,
        "cpl_predicted": 2.85,
        "change_pct": 35.7
      },
      "recommendations": ["Снизить бюджет", "Ротировать креативы"]
    }
  ],
  "active_creatives_ready": [
    {
      "user_creative_id": "uuid",
      "name": "Осенняя распродажа",
      "risk_score": 12,
      "suitable_for": ["whatsapp", "site_leads"]
    }
  ],
  "recommendations_for_brain": [
    "СРОЧНО: кампания X в High risk — снизить бюджет",
    "Включить креативы Y и Z"
  ]
}
```

**Таблицы Supabase (новые):**
- `creative_metrics_history` — история метрик по креативам/объявлениям
- `budget_audit` — история изменений бюджетов (для BUDGET_JUMP)
- `risk_scoring_config` — настраиваемые коэффициенты и пороги (global/user/campaign)
- `scoring_executions` — логи запусков scoring agent
- `creative_scores` — текущие скоры креативов

**Конфигурация:**
- Глобальные defaults в `risk_scoring_config` (scope='global')
- Per-user overrides (scope='user')
- Per-campaign overrides (scope='campaign')
- Наследование: global → user → campaign

**Интеграция с main brain:**
- Main brain получает `scoring_output` в `llmInput.scoring`
- SYSTEM_PROMPT обновлен с инструкциями по использованию scoring данных
- Приоритет: если scoring показывает High risk → превентивные действия даже при neutral HS
- Активные креативы: scoring подсказывает, какие креативы готовы к использованию

**Документация:**
- Полный план: [SCORING_AGENT_PLAN.md](./SCORING_AGENT_PLAN.md)
- Инструкция по установке: [SCORING_SETUP.md](./SCORING_SETUP.md)
- SQL миграции: [migrations/001_scoring_agent_tables.sql](./migrations/001_scoring_agent_tables.sql)

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
- Валидация FB: включайте `FB_VALIDATE_ONLY=true` до «боевого» запуска; для реальных креатив-тестов проверьте, что в прод `.env.agent` стоит `FB_VALIDATE_ONLY=false`
- Для репорта в Telegram нужны telegram_bot_token/telegram_id в user_accounts
- Отчёт — строго по активным кампаниям с результатом, за предыдущий день, один блок
- **Активация пользователя**: установите `active = true` в Supabase user_accounts
- Автозапуск игнорирует тестовые кампании и паузит только ad set'ы активных направлений.
- Креатив-тесты: `/api/creative-test/start` принимает `force: true`, а `DELETE /api/creative-test/:id?user_id` сбрасывает тест.

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

### 🆕 Scoring Agent (агент предикшена) — 2025-10-04

**Файл**: `services/agent-brain/src/scoring.js`

**Задача**: Анализировать активные ad sets и креативы, предсказывать риск роста CPL на 3 дня, давать рекомендации main brain.

**Как работает**:
1. Запускается ПЕРЕД основным brain LLM
2. Дергает метрики из FB API напрямую (всегда свежие!):
   - Активные adsets: last_7d и prev_7d для трендов
   - Готовые креативы из user_creatives: last_30d
3. LLM САМ оценивает risk_score (0-100) на основе всех факторов
4. Передает результат в main brain через `llmInput.scoring`

**Структура scoring_output**:
```json
{
  "summary": { high/medium/low counts, overall_trend, alert_level },
  "active_items": [
    { adset_id, risk_score, risk_level, prediction, recommendations }
  ],
  "ready_creatives": [
    { name, fb_creative_id, creative_score, performance }
  ],
  "recommendations_for_brain": ["HIGH RISK: adset X → снизить бюджет", ...]
}
```

**Новые таблицы Supabase**:
- `creative_metrics_history` - snapshot метрик для аудита
- `scoring_executions` - история запусков для мониторинга
- `creative_scores` - текущие скоры для быстрого доступа

**Переменные окружения**:
- `SCORING_ENABLED=true` - включить scoring agent
- `SCORING_MODEL=gpt-4o` - модель LLM для скоринга
- `SCORING_MIN_IMPRESSIONS=1000` - минимум показов для надежного скоринга
- `SCORING_PREDICTION_DAYS=3` - на сколько дней делать предикшн

**Интеграция с main brain**:
Main brain получает scoring данные и учитывает:
- При HIGH risk → приоритет на снижение бюджета
- ready_creatives → рекомендации для создания новых кампаний с хорошими креативами
- recommendations_for_brain → конкретные советы от scoring LLM

**Философия (упрощенная архитектура)**:
- ❌ НЕ храним историю для скоринга → ✅ всегда дергаем свежие данные из FB API
- ❌ НЕ считаем risk_score формулой → ✅ LLM сам оценивает риск
- ✅ creative_metrics_history - только snapshot для аудита

### Контакты и точки расширения
- SYSTEM_PROMPT (в brain) — центральное место для «поведения» медиабайера и формата JSON-ответа
- SCORING_SYSTEM_PROMPT (в scoring.js) — инструкции для scoring LLM по оценке рисков
- Новые инструменты действий добавляются в ALLOWED_TYPES и валидацию в brain, а также в routes/actions.ts + workflows в agent-service
- Cron-планировщик находится в конце src/server.js, легко настраивается через env-переменные

