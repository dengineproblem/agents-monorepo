# OpenClaw — AI Admin Assistant

## Обзор

OpenClaw — self-hosted AI-агент, работающий как персональный ассистент администратора платформы Performante. Общается через Telegram и Web Dashboard, имеет доступ к API сервисов и read-only доступ к БД.

## Сервер

- **Хост:** 147.182.186.15 (DigitalOcean, Ubuntu 24.10)
- **Linux юзер:** `openclaw` (без sudo, изолирован от проекта)
- **Node.js:** 22.x (через nvm, `/home/openclaw/.nvm/`)
- **Версия OpenClaw:** 2026.2.17
- **Gateway порт:** 18789 (localhost only)

## Расположение файлов

```
/home/openclaw/
├── .nvm/                          # Node Version Manager
├── .openclaw/
│   ├── openclaw.json              # Главный конфиг
│   ├── gateway.log                # Логи gateway
│   └── workspace/                 # Workspace агента
│       ├── IDENTITY.md            # Имя, роль, язык
│       ├── SOUL.md                # Персона, границы поведения
│       ├── AGENTS.md              # Порты сервисов, авторизация, DB connection
│       ├── TOOLS.md               # Список доступных инструментов
│       └── skills/                # Навыки (загружаются on-demand)
│           ├── analytics/SKILL.md # Дашборд, метрики, расходы, ROI
│           ├── crm/SKILL.md       # Лиды, консультанты, продажи
│           ├── messaging/SKILL.md # WhatsApp, бот, рассылки, редактирование промптов
│           ├── ads/SKILL.md       # Кампании, бюджеты, креативы
│           ├── database/SKILL.md  # SQL запросы + примеры
│           ├── schema/SKILL.md    # Справочник таблиц БД
│           └── call-analysis/SKILL.md # Анализ записей звонков консультантов
```

## Каналы доступа

### Telegram бот
- **Токен:** `8560311579:AAF2rVq4yJTKrzI1lUPax7LHN4ZEQJKYN-E`
- **Политика:** pairing (только одобренные пользователи)
- **Одобренный Telegram ID:** 313145981

### Web Dashboard
- Доступен через SSH туннель с Mac:
  ```bash
  ssh -L 18789:127.0.0.1:18789 root@147.182.186.15
  ```
- Получить URL: `openclaw dashboard --no-open` (от юзера openclaw)

## Связи с основным проектом

### API доступ (HTTP, localhost)

| Сервис | Порт | Что доступно |
|--------|------|-------------|
| agent-service | 8082 | Admin routes, directions, leads, notifications, campaign builder |
| chatbot-service | 8083 | Управление ботом, follow-up, кампании рассылок, CAPI |
| crm-backend | 8084 | Диалоги, консультанты, консультации, AI-боты, продажи, записи звонков |
| agent-brain | 7080 | Метрики рекламы, пауза/запуск, бюджеты, креативы |

### Авторизация API
- **Admin User ID:** `e1a3a32a-d141-407c-b92e-846e5869f63d`
- Заголовок: `x-user-id: e1a3a32a-d141-407c-b92e-846e5869f63d`
- Пользователь `openclaw_agent` в таблице `user_accounts` с `is_tech_admin = true`

### База данных (read-only через pooler)

- **Хост:** `aws-0-eu-north-1.pooler.supabase.com`
- **Порт:** 6543
- **Юзер:** `openclaw_reader.ikywuvtavpnjlrjtalqi`
- **Пароль:** хранится в workspace файлах на сервере
- **Доступ:** SELECT only, секретные колонки скрыты через VIEW

### VIEW для скрытия секретов

| VIEW | Вместо таблицы | Что скрыто |
|------|---------------|------------|
| `openclaw_ad_accounts` | `ad_accounts` | API ключи, токены FB/TikTok/OpenAI/Gemini/Anthropic |
| `openclaw_user_accounts` | `user_accounts` | Пароли, токены, API ключи |
| `openclaw_ai_bot_configurations` | `ai_bot_configurations` | custom_openai_api_key |

Создано миграцией: `migrations/223_create_openclaw_reader.sql`

## Управление gateway

### Запуск (от root)
```bash
su - openclaw -s /bin/bash -c "source ~/.nvm/nvm.sh && nohup openclaw gateway > ~/.openclaw/gateway.log 2>&1 &"
```

### Остановка (от root)
```bash
su - openclaw -s /bin/bash -c "source ~/.nvm/nvm.sh && openclaw gateway stop"
```

### Проверка логов
```bash
cat /home/openclaw/.openclaw/gateway.log
```

### Проверка процесса
```bash
ps aux | grep openclaw
```

## Модель

- **Провайдер:** Anthropic (setup-token)
- **Модель:** Claude Opus 4.6

## Безопасность

- Юзер `openclaw` — без sudo, не имеет доступа к коду проекта, .env, Docker
- БД — только SELECT, секреты скрыты
- API — через admin user с `is_tech_admin = true`
- Telegram — только одобренные пользователи (pairing)
- Sandbox — off (агент выполняет команды напрямую на сервере)
- Gateway — привязан к localhost (не доступен извне)

## Что может делать

### READ (без подтверждения)
- Смотреть лидов, их температуру и воронку
- Метрики рекламы (CPL, ROI, расходы)
- Статистику консультантов и продаж
- Промпты AI-ботов
- Конкурентов и их креативы
- Любые SQL запросы к БД

### WRITE (с подтверждением)
- Менять бюджеты кампаний
- Ставить на паузу / запускать рекламу
- Отправлять сообщения в WhatsApp
- Редактировать промпты AI-ботов
- Создавать направления и кампании
- Запускать AI-оптимизацию

### CRON (автоматически)
- Анализ записей звонков консультантов (каждые 5 мин)

## Анализ записей звонков

Консультанты записывают звонки через CRM. crm-backend транскрибирует через Whisper, OpenClaw анализирует по крону.

### Схема
```
Консультант записал → Whisper транскрипция → БД (analysis_status=pending)
→ OpenClaw крон (*/5) → GET pending-analysis → анализ → PATCH результат
→ Фронтенд polling подхватывает
```

### API эндпоинты (crm-backend, порт 8084)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/admin/call-recordings/pending-analysis` | Записи с готовой транскрипцией, ожидающие анализа |
| PATCH | `/admin/call-recordings/:id/analysis` | Сохранить результат анализа |

### Крон-скрипт

Расположение: `/home/openclaw/check-recordings.sh`
Расписание: `*/5 * * * *` (каждые 5 минут)
Лог: `/home/openclaw/check-recordings.log`

Скрипт проверяет `pending-analysis`, если есть — запускает `openclaw chat` с задачей на анализ.

### Skill файл

`skills/call-analysis/SKILL.md` — содержит бизнес-контекст, структуры JSON для summary и review, API вызовы.
Исходник в репо: `openclaw-skills/call-analysis/SKILL.md`

## DNS

На сервере настроен Google DNS (`8.8.8.8`) в `/etc/systemd/resolved.conf.d/google.conf` для резолва Supabase pooler.

Прямой хост `db.ikywuvtavpnjlrjtalqi.supabase.co` — только IPv6, сервер не поддерживает. Поэтому используется pooler (IPv4).
