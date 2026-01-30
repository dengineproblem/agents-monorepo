# Fake Reports Service

Telegram Bot для генерации фейковых отчетов агента Brain.

## Описание

Сервис принимает через Telegram Bot запросы на генерацию отчетов с указанием ниши и плановой стоимости заявки, и возвращает реалистичный отчет в формате агента Brain с вымышленными метриками и LLM-генерированными текстами.

## Требования

- Node.js 20+
- OpenAI API ключ
- Telegram Bot Token (получить у @BotFather)

## Установка

### 1. Создайте Telegram бота

```bash
# Откройте @BotFather в Telegram
# Отправьте /newbot
# Следуйте инструкциям
# Скопируйте токен
```

### 2. Настройте переменные окружения

```bash
cp .env.example .env
# Отредактируйте .env, добавьте токены
```

### 3. Установите зависимости

```bash
npm install
```

### 4. Запустите в режиме разработки

```bash
npm run dev
```

## Docker

### Сборка и запуск

```bash
# Из корня monorepo
docker-compose build fake-reports-service
docker-compose up -d fake-reports-service
```

### Логи

```bash
docker-compose logs -f fake-reports-service
```

## Использование

### Настройка webhook

```bash
# Автоматическая настройка (production URL)
curl -X POST https://api.performanteaiagency.com/fake-reports/telegram/setup-webhook

# Кастомный URL
curl -X POST https://api.performanteaiagency.com/fake-reports/telegram/setup-webhook \
  -H "Content-Type: application/json" \
  -d '{"webhook_url": "https://your-domain.com/telegram/webhook"}'
```

### Проверка webhook

```bash
curl https://api.performanteaiagency.com/fake-reports/telegram/webhook-info
```

### Отправка команд в Telegram

```
/generate Стоматология 2.50
/generate "Юридические услуги" 3.00
/generate Фитнес 1.80
```

## API Endpoints

- `POST /telegram/webhook` - Webhook для Telegram
- `GET /health` - Health check
- `POST /telegram/setup-webhook` - Настройка webhook
- `GET /telegram/webhook-info` - Информация о webhook
- `DELETE /telegram/webhook` - Удаление webhook

## Структура проекта

```
src/
├── server.ts                 # Fastify сервер
├── config.ts                 # Конфигурация
├── routes/
│   └── telegramWebhook.ts    # Webhook endpoints
├── lib/
│   ├── telegramApi.ts        # Telegram API wrapper
│   ├── telegramHandler.ts    # Обработка сообщений
│   ├── metricsGenerator.ts   # Генерация метрик
│   ├── llmService.ts         # OpenAI интеграция
│   └── reportGenerator.ts    # Генерация отчета
├── types/
│   ├── telegram.ts           # Типы Telegram
│   ├── report.ts             # Типы отчетов
│   └── metrics.ts            # Типы метрик
└── utils/
    └── formatters.ts         # Форматирование отчета
```

## Формат отчета

Генерируемый отчет полностью соответствует формату агента Brain и включает:

- Дата отчета
- User ID и Ad Account ID (случайные, но реалистичные)
- Общая сводка (затраты, лиды, CPL)
- 2-3 кампании с метриками близкими к плановым (±20%)
- Качество лидов 60-80%
- LLM-генерированные тексты:
  - Выполненные действия
  - Аналитика в динамике
  - Рекомендации для оптимизации

## Troubleshooting

### Бот не отвечает

```bash
# Проверить webhook
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

# Проверить логи сервиса
docker-compose logs fake-reports-service

# Переустановить webhook
curl -X POST https://api.performanteaiagency.com/fake-reports/telegram/setup-webhook
```

### OpenAI ошибки

- Проверить OPENAI_API_KEY в .env
- Проверить баланс аккаунта OpenAI
- Проверить rate limits

### Неверные метрики

- Проверить алгоритм в lib/metricsGenerator.ts
- Настроить targetCplVariance (по умолчанию ±20%)

## Разработка

### Локальный запуск

```bash
npm run dev
```

### Сборка

```bash
npm run build
```

### Production запуск

```bash
npm start
```

## Лицензия

ISC
