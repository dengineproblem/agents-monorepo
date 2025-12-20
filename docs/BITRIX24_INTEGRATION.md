# Интеграция Bitrix24 CRM

## Обзор

Интеграция с Bitrix24 CRM реализована по аналогии с AmoCRM, но с учётом ключевых различий:

| Параметр | AmoCRM | Bitrix24 |
|----------|--------|----------|
| Лиды и сделки | Одна сущность | Раздельные сущности |
| Rate limit | 7 req/sec | 2 req/sec |
| Токен lifetime | 24 часа | 1 час |
| Поиск по телефону | Фильтр | `crm.duplicate.findbycomm` |
| Batch запросы | Нет | До 50 методов |

## Созданные файлы

### Backend (services/agent-service)

```
src/
├── adapters/
│   └── bitrix24.ts              # API адаптер с rate limiting
├── lib/
│   └── bitrix24Tokens.ts        # Управление OAuth токенами
└── routes/
    ├── bitrix24OAuth.ts         # OAuth авторизация
    ├── bitrix24Pipelines.ts     # Воронки и квалификация
    └── bitrix24Webhooks.ts      # Обработка вебхуков
```

### Frontend (services/frontend)

```
src/
├── services/
│   └── bitrix24Api.ts           # API клиент
├── components/
│   └── bitrix24/
│       ├── index.ts
│       ├── Bitrix24QualificationFieldModal.tsx
│       ├── Bitrix24KeyStageSelector.tsx
│       └── Bitrix24KeyStageSettings.tsx
└── pages/
    └── Profile.tsx              # Обновлён с интеграцией Bitrix24
```

### Миграция БД

```
migrations/
└── 102_add_bitrix24_integration.sql
```

## Архитектура

### OAuth Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────>│ /bitrix24/   │────>│  Bitrix24   │
│   Profile   │     │   connect    │     │   OAuth     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                    ┌──────────────┐             │
                    │ /bitrix24/   │<────────────┘
                    │   callback   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Save tokens │
                    │  Register    │
                    │  webhooks    │
                    └──────────────┘
```

### Webhook Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Bitrix24   │────>│ /webhooks/   │────>│  Update     │
│   Events    │     │   bitrix24   │     │  local DB   │
└─────────────┘     └──────────────┘     └─────────────┘

События:
- ONCRMLEADADD      - Новый лид
- ONCRMLEADUPDATE   - Обновление лида
- ONCRMDEALADD      - Новая сделка
- ONCRMDEALUPDATE   - Обновление сделки
```

## База данных

### Новые колонки в user_accounts

```sql
bitrix24_domain              -- example.bitrix24.ru
bitrix24_access_token        -- OAuth access token
bitrix24_refresh_token       -- OAuth refresh token
bitrix24_token_expires_at    -- Время истечения (1 час)
bitrix24_member_id           -- ID портала
bitrix24_user_id             -- ID пользователя Bitrix24
bitrix24_qualification_fields -- JSON с полями квалификации
bitrix24_entity_type         -- 'lead', 'deal', или 'both'
bitrix24_connected_at        -- Время подключения
```

### Новые колонки в leads

```sql
bitrix24_lead_id             -- ID лида в Bitrix24
bitrix24_contact_id          -- ID контакта в Bitrix24
bitrix24_deal_id             -- ID сделки в Bitrix24
bitrix24_entity_type         -- 'lead' или 'deal'
```

### Новые таблицы

- `bitrix24_pipeline_stages` - Воронки и этапы
- `bitrix24_status_history` - История изменений статусов
- `bitrix24_sync_log` - Лог синхронизации

## API Endpoints

### OAuth и подключение

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/bitrix24/connect` | GET | HTML страница подключения |
| `/bitrix24/auth` | GET | Редирект на OAuth Bitrix24 |
| `/bitrix24/callback` | GET | OAuth callback |
| `/bitrix24/status` | GET | Статус подключения |
| `/bitrix24/disconnect` | DELETE | Отключить Bitrix24 |
| `/bitrix24/entity-type` | POST | Выбор типа сущностей |

### Воронки и этапы

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/bitrix24/sync-pipelines` | POST | Синхронизация воронок |
| `/bitrix24/pipelines` | GET | Получить все воронки |
| `/bitrix24/pipeline-stages/:id` | PATCH | Обновить настройки этапа |

### Кастомные поля

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/bitrix24/lead-custom-fields` | GET | Поля лидов |
| `/bitrix24/deal-custom-fields` | GET | Поля сделок |
| `/bitrix24/contact-custom-fields` | GET | Поля контактов |
| `/bitrix24/qualification-fields` | GET/PATCH | Поля квалификации |

### Синхронизация

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/bitrix24/sync-leads` | POST | Синхронизация лидов/сделок |
| `/bitrix24/creative-funnel-stats` | GET | Статистика воронки |
| `/webhooks/bitrix24` | POST | Webhook от Bitrix24 |

---

# Что делать дальше

## 1. Зарегистрировать OAuth приложение в Bitrix24

### Шаги:

1. Войдите в свой портал Bitrix24
2. Перейдите: **Маркет → Разработчикам → Добавить локальное приложение**
   - Или напрямую: `https://ВАШ_ПОРТАЛ.bitrix24.ru/devops/list/`

3. Заполните форму:
   - **Название**: Performante AI Agency
   - **Тип**: Серверное приложение
   - **Права доступа**:
     - `crm` - Работа с CRM
     - `user` - Информация о пользователях
   - **URL обработчика**: `https://api.performanteaiagency.com/api/bitrix24/callback`
   - **URL установки**: оставить пустым

4. После создания скопируйте:
   - **client_id** (ID приложения)
   - **client_secret** (Секретный ключ)

## 2. Добавить переменные окружения

Добавьте в файл `.env.agent` на сервере:

```bash
# Bitrix24 OAuth
BITRIX24_CLIENT_ID=your_client_id_here
BITRIX24_CLIENT_SECRET=your_client_secret_here
BITRIX24_REDIRECT_URI=https://api.performanteaiagency.com/api/bitrix24/callback
```

## 3. Применить миграцию БД

Выполните SQL из файла `migrations/102_add_bitrix24_integration.sql` в Supabase:

1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Вставьте содержимое файла миграции
4. Выполните

Или через CLI:
```bash
psql $DATABASE_URL -f migrations/102_add_bitrix24_integration.sql
```

## 4. Пересобрать и перезапустить сервисы

```bash
# На сервере
cd /path/to/agents-monorepo

# Пересобрать agent-service
docker-compose build agent-service

# Перезапустить
docker-compose up -d agent-service

# Проверить логи
docker-compose logs -f agent-service
```

## 5. Пересобрать frontend

```bash
# Локально или в CI/CD
cd services/frontend
npm run build

# Задеплоить на хостинг (Vercel/Netlify/etc)
```

## 6. Протестировать интеграцию

1. Откройте страницу Profile в приложении
2. Найдите карточку "Bitrix24" в разделе подключений
3. Нажмите "Подключить"
4. Введите адрес вашего портала (например: `mycompany.bitrix24.ru`)
5. Выберите тип сущностей (Лиды/Сделки/Оба)
6. Авторизуйтесь в Bitrix24
7. После успешного подключения настройте квалификацию

## Чек-лист готовности

- [ ] OAuth приложение создано в Bitrix24
- [ ] Переменные окружения добавлены в `.env.agent`
- [ ] Миграция `102_add_bitrix24_integration.sql` применена
- [ ] agent-service пересобран и перезапущен
- [ ] Frontend пересобран и задеплоен
- [ ] Тестовое подключение прошло успешно
- [ ] Квалификация настроена
- [ ] Webhooks получают события (проверить логи)

## Troubleshooting

### Ошибка "Bitrix24 OAuth not configured on server"
Проверьте что переменные `BITRIX24_CLIENT_ID` и `BITRIX24_REDIRECT_URI` установлены.

### Ошибка при обмене кода на токен
Проверьте что `BITRIX24_CLIENT_SECRET` корректный и `BITRIX24_REDIRECT_URI` совпадает с указанным в настройках приложения Bitrix24.

### Webhooks не приходят
1. Проверьте что webhook URL доступен извне
2. Проверьте логи: `docker-compose logs agent-service | grep bitrix24`
3. В Bitrix24 проверьте раздел "Исходящие вебхуки"

### Rate limit ошибки
Bitrix24 имеет лимит 2 запроса в секунду. Адаптер автоматически ограничивает скорость запросов, но при массовых операциях могут быть задержки.

### Токен истёк
Токены автоматически обновляются при каждом запросе. Если возникает ошибка, попробуйте переподключить Bitrix24.

---

## Контакты и поддержка

При возникновении проблем проверьте:
1. Логи agent-service
2. Логи в таблице `bitrix24_sync_log`
3. Историю статусов в `bitrix24_status_history`
