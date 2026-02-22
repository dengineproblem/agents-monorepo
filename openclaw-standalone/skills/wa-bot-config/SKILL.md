# WhatsApp Bot Config — Настройка AI Чатбота

## Цель
Создать или обновить конфигурацию AI чатбота для WhatsApp инстанса.

## Предварительные требования
- WhatsApp инстанс подключён (wa-onboarding выполнен)
- SaaS pairing настроен

## Шаги

### 1. Получить SaaS credentials
```bash
SAAS_DB=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_db_url FROM config WHERE id = 1")
SAAS_ID=$(psql "postgresql://postgres:openclaw_local@postgres:5432/openclaw_{{SLUG}}" -t -A -c "SELECT saas_account_id FROM config WHERE id = 1")
```

### 2. Проверить существующего бота
```bash
psql "$SAAS_DB" -c "
  SELECT abc.id, abc.name, abc.is_active, abc.model, wi.instance_name
  FROM ai_bot_configurations abc
  LEFT JOIN whatsapp_instances wi ON wi.ai_bot_id = abc.id
  WHERE abc.user_account_id = '$SAAS_ID';
"
```

### 3. Спросить пользователя о настройках
Задай вопросы:
- **Имя бота** (например: "Ассистент клиники", "Менеджер продаж")
- **Системный промпт** — описание роли бота, стиль общения, информация о бизнесе
- **Расписание** — в какие часы бот работает (или 24/7)
- **Оператор** — включить ли паузу при вмешательстве оператора

### 4. Создать или обновить бота
```bash
psql "$SAAS_DB" <<'SQL'
INSERT INTO ai_bot_configurations (
  user_account_id,
  name,
  is_active,
  system_prompt,
  temperature,
  model,
  -- Operator control
  operator_pause_enabled,
  operator_pause_ignore_first_message,
  operator_auto_resume_hours,
  -- Schedule
  schedule_enabled,
  schedule_hours_start,
  schedule_hours_end,
  schedule_days,
  timezone,
  -- Message settings
  message_buffer_seconds,
  split_messages,
  clean_markdown,
  pass_current_datetime,
  -- Media
  voice_recognition_enabled,
  image_recognition_enabled
)
VALUES (
  '{SAAS_ID}',
  '{BOT_NAME}',
  true,
  '{SYSTEM_PROMPT}',
  0.24,
  'gpt-4o',
  true,
  true,
  0,
  {SCHEDULE_ENABLED},
  {HOURS_START},
  {HOURS_END},
  '{DAYS}',
  'Asia/Almaty',
  7,
  false,
  true,
  true,
  false,
  false
)
RETURNING id;
SQL
```

### 5. Привязать бота к инстансу
```bash
psql "$SAAS_DB" -c "
  UPDATE whatsapp_instances SET ai_bot_id = '{BOT_ID}'
  WHERE instance_name = '{{SLUG}}_bot' AND user_account_id = '$SAAS_ID';
"
```

### 6. Тестирование
Попроси пользователя отправить тестовое сообщение на WhatsApp номер инстанса.
Проверь лог:
```bash
psql "$SAAS_DB" -c "
  SELECT role, content, created_at
  FROM messages
  WHERE instance_id = (SELECT id FROM whatsapp_instances WHERE instance_name = '{{SLUG}}_bot')
  ORDER BY created_at DESC LIMIT 5;
"
```

## Параметры бота

| Параметр | По умолчанию | Описание |
|----------|-------------|----------|
| temperature | 0.24 | Креативность (0-1) |
| model | gpt-4o | Модель AI |
| message_buffer_seconds | 7 | Буфер для группировки сообщений |
| operator_pause_enabled | true | Пауза при вмешательстве оператора |
| schedule_enabled | false | Работа по расписанию |
| voice_recognition_enabled | false | Распознавание голосовых |
| image_recognition_enabled | false | Распознавание изображений |

## Результат
- AI бот создан и привязан к WhatsApp инстансу
- Бот автоматически отвечает на входящие сообщения
