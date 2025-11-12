# CRM Backend Service

Backend сервис для анализа WhatsApp диалогов с использованием GPT-5-mini.

## Архитектура

```
crm-backend/
├── src/
│   ├── routes/
│   │   └── dialogs.ts        # API endpoints для лидов
│   ├── scripts/
│   │   └── analyzeDialogs.ts # AI анализ диалогов
│   ├── lib/
│   │   ├── evolutionDb.ts    # PostgreSQL Evolution API
│   │   ├── supabase.ts       # Supabase client
│   │   └── logger.ts         # Pino logger
│   └── server.ts             # Fastify сервер
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

## Технологии

- **Fastify** - HTTP сервер
- **OpenAI GPT-5-mini** - анализ диалогов
- **PostgreSQL** (Evolution API) - источник сообщений
- **Supabase** - хранение результатов анализа
- **Pino** - структурированное логирование
- **Zod** - валидация данных

## API Endpoints

### POST /dialogs/analyze
Запустить анализ диалогов для instance.

**Body:**
```json
{
  "instanceName": "string",
  "userAccountId": "uuid",
  "minIncoming": 3,
  "maxDialogs": 100,
  "maxContacts": 100
}
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 50,
    "analyzed": 45,
    "new_leads": 5,
    "hot": 10,
    "warm": 20,
    "cold": 15,
    "errors": 0
  }
}
```

### GET /dialogs/analysis
Получить проанализированные лиды.

**Query params:**
- `userAccountId` (required) - UUID пользователя
- `instanceName` (optional) - фильтр по instance
- `interestLevel` (optional) - hot | warm | cold
- `minScore` (optional) - минимальный score (0-100)
- `funnelStage` (optional) - этап воронки
- `qualificationComplete` (optional) - boolean

**Response:**
```json
{
  "success": true,
  "results": [...],
  "count": 42
}
```

### GET /dialogs/stats
Статистика по лидам.

### GET /dialogs/export-csv
Экспорт в CSV.

### POST /dialogs/leads
Создать лид вручную.

### PATCH /dialogs/leads/:id
Обновить лид.

### DELETE /dialogs/analysis/:id
Удалить лид.

## Переменные окружения

```bash
PORT=8084
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
EVOLUTION_DB_HOST=evolution-postgres
EVOLUTION_DB_PORT=5432
EVOLUTION_DB_NAME=evolution
EVOLUTION_DB_USER=evolution
EVOLUTION_DB_PASSWORD=your-password
OPENAI_API_KEY=sk-...
```

## Запуск

### Development
```bash
cd services/crm-backend
npm install
npm run dev
# Работает на http://localhost:8084
```

### Production (Docker)
```bash
# В корне проекта
docker-compose build crm-backend
docker-compose up -d crm-backend
```

### Health check
```bash
curl http://localhost:8084/health
# {"ok":true,"service":"crm-backend"}
```

## Логика анализа

1. **Получение сообщений** из Evolution PostgreSQL
2. **Группировка** по контактам
3. **Фильтрация** (минимум 3 входящих сообщений)
4. **AI анализ** с GPT-5-mini:
   - Определение ниши (медицина/другое)
   - Квалификация (4 вопроса)
   - Этап воронки
   - Скоринг (0-100)
   - Interest level (hot/warm/cold)
5. **Сохранение** в Supabase

## Система скоринга

### Базовый score по этапу воронки:
- new_lead: 5
- not_qualified: 15
- qualified: 30
- consultation_booked: 40
- consultation_completed: 55
- deal_closed: 75
- deal_lost: 0

### Модификаторы:
- Медицина: +15
- Инфобизнес: +10
- Владелец: +10
- Бюджет указан: +10
- Таргетолог/SMM: -30

### Interest Level:
- **HOT (75-100)**: Записан на консультацию или готов записаться
- **WARM (40-74)**: Есть интерес, но не готов
- **COLD (0-39)**: Слабый интерес, не целевая ниша

## Troubleshooting

### Ошибка подключения к Evolution DB
Проверьте:
```bash
docker exec -it evolution-postgres psql -U evolution -d evolution
\dt
```

### Ошибка OpenAI API
Проверьте квоту и ключ:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Ошибка Supabase
Проверьте service key (не anon key!):
```typescript
const { data, error } = await supabase
  .from('dialog_analysis')
  .select('count')
  .limit(1);
```

## Production monitoring

Логи доступны в Grafana через Promtail (label: `logging: "promtail"`).

Метрики:
- Количество анализов в минуту
- Средний score лидов
- Распределение hot/warm/cold
- Время анализа одного диалога



