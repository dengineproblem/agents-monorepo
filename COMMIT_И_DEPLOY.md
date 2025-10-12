# 🚀 COMMIT И DEPLOY: Directions

## ✅ ВСЕ ИЗМЕНЕНИЯ ГОТОВЫ

Все потерянные изменения восстановлены и протестированы локально!

---

## 📝 ШАГ 1: COMMIT

```bash
# 1. Добавить все файлы
git add .

# 2. Закоммитить с детальным сообщением
git commit -m "feat: Add Directions (business directions) full integration

ОСНОВНЫЕ ИЗМЕНЕНИЯ:

1. Database Schema:
   - migrations/008_account_directions.sql: Создана таблица account_directions
   - migrations/009_add_objective_to_directions.sql: Добавлено поле objective
   - Каждое направление связано с отдельной Facebook Campaign

2. API Endpoints (services/agent-service):
   - src/routes/directions.ts: CRUD endpoints для направлений
   - POST /api/directions: Создание направления + автоматическое создание FB Campaign
   - GET /api/directions: Получение всех направлений пользователя
   - PATCH /api/directions/:id: Обновление направления
   - DELETE /api/directions/:id: Удаление направления
   - src/server.ts: Регистрация directions routes

3. Brain Agent Integration (services/agent-brain/src/server.js):
   - getUserDirections(): Получение активных направлений пользователя
   - getDirectionByCampaignId(): Поиск направления по campaign_id
   - llmInput.directions[]: Массив направлений с бюджетами и CPL
   - analysis.campaigns[].direction_*: Привязка кампаний к направлениям
   - SYSTEM_PROMPT: Детальные инструкции для LLM по работе с направлениями

4. Scoring Agent Update (services/agent-brain/src/scoring.js):
   - getActiveCreatives(): Фильтрация креативов по АКТИВНЫМ направлениям
   - Поддержка legacy креативов (без direction_id)
   - Экономия токенов: неактивные направления не попадают в LLM

5. Campaign Builder:
   - services/agent-service/src/lib/campaignBuilder.ts: Обновлён для работы с direction_id
   - Используется ТОЛЬКО для legacy креативов (без direction_id)
   - Brain Agent теперь управляет креативами с направлениями

6. Infrastructure:
   - nginx.conf: Исправлен порт agent-service (8080 → 8082)

7. Documentation:
   - CAMPAIGN_BUILDER_VS_BRAIN_AGENT.md: Детальное объяснение архитектуры
   - DIRECTIONS_FRONTEND_SPEC.md: Спецификация для фронтенд разработчика
   - DIRECTIONS_FRONTEND_INTEGRATION.md: Готовые код-сниппеты для фронтенда
   - DIRECTIONS_DEPLOY_CHECKLIST.md: Чеклист для деплоя
   - DIRECTIONS_ВОССТАНОВЛЕНИЕ_ЗАВЕРШЕНО.md: Отчёт о восстановлении

АРХИТЕКТУРА:
- 1 направление = 1 Facebook Campaign (создаётся при создании направления)
- Каждое направление имеет свой бюджет и целевой CPL
- Brain Agent создаёт Ad Sets ВНУТРИ существующих кампаний направлений
- Бюджеты управляются отдельно для каждого направления
- Scoring Agent фильтрует креативы только из активных направлений

ТЕСТИРОВАНИЕ:
✅ API протестирован (создание направления + Facebook Campaign)
✅ Brain Agent получает и обрабатывает directions
✅ LLM получает directions в llmInput
✅ Scoring Agent фильтрует креативы по активным directions
✅ Docker образы пересобраны и запущены локально

BREAKING CHANGES:
- Нет (обратная совместимость с legacy креативами без direction_id)

Closes #[issue_number] (если есть issue)"

# 3. Push в репозиторий
git push origin main
```

---

## 🚀 ШАГ 2: DEPLOY НА СЕРВЕР

### 2.1. Подключиться к серверу

```bash
ssh user@agents.performanteaiagency.com
```

### 2.2. Pull изменений

```bash
cd /path/to/agents-monorepo
git pull origin main
```

### 2.3. Пересобрать Docker образы

```bash
# Пересобрать оба сервиса (agent-brain и agent-service)
docker-compose build --no-cache agent-brain agent-service
```

### 2.4. Перезапустить контейнеры

```bash
# Остановить все контейнеры
docker-compose down

# Запустить заново
docker-compose up -d
```

### 2.5. Проверить что всё запустилось

```bash
# Проверить статус контейнеров
docker-compose ps

# Проверить логи Brain Agent
docker-compose logs -f agent-brain

# Проверить логи Agent Service
docker-compose logs -f agent-service
```

Ожидаемый результат в логах:
```
agent-brain-1  | {"msg":"Server listening at http://0.0.0.0:7080"}
agent-service-1| {"msg":"Server listening at http://0.0.0.0:8082"}
```

---

## 🧪 ШАГ 3: ПРОВЕРКА НА ПРОДЕ

### 3.1. Тест API Directions

```bash
# Создать тестовое направление (замени USER_ACCOUNT_ID на реальный)
curl -X POST https://agents.performanteaiagency.com/api/directions \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "YOUR_USER_ACCOUNT_ID",
    "name": "Тестовое направление",
    "objective": "whatsapp",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200
  }'
```

Ожидаемый результат:
```json
{
  "success": true,
  "direction": {
    "id": "uuid...",
    "fb_campaign_id": "123456...",  // ← Facebook Campaign создан!
    "campaign_status": "PAUSED",
    "daily_budget_cents": 5000,
    "target_cpl_cents": 200,
    "objective": "whatsapp",
    "is_active": true
  }
}
```

### 3.2. Проверить Brain Agent

```bash
# Проверить что Brain Agent получает directions
docker-compose logs agent-brain | grep "directions_loaded"
```

Ожидаемый результат:
```json
{
  "where": "brain_run",
  "phase": "directions_loaded",
  "userId": "...",
  "count": 1  // ← Количество активных направлений
}
```

### 3.3. Проверить Nginx

```bash
# Проверить что Nginx проксирует запросы на правильный порт
curl -I https://agents.performanteaiagency.com/api/directions
```

Ожидаемый статус: `200 OK` или `404 Not Found` (если нет directions), но НЕ `502 Bad Gateway`

---

## 📊 ШАГ 4: МОНИТОРИНГ

После деплоя следи за:

1. **Логи Brain Agent** (08:00 ежедневно):
   ```bash
   docker-compose logs -f agent-brain | grep -E "(directions_loaded|direction_)"
   ```

2. **Логи Agent Service**:
   ```bash
   docker-compose logs -f agent-service | grep "api/directions"
   ```

3. **Отчёты в Telegram**:
   - Brain Agent должен группировать результаты по направлениям
   - В отчёте должны быть секции типа "🎯 Имплантация: 3 заявки, CPL $2.10"

4. **Facebook Ads Manager**:
   - Проверь что кампании создаются с правильными названиями: `[Название направления] WhatsApp/Instagram Traffic/Site Leads`

---

## 🐛 TROUBLESHOOTING

### Проблема: 404 на /api/directions

**Причина:** Agent Service не запустился или Nginx неправильно проксирует

**Решение:**
```bash
# Проверить что agent-service работает
docker-compose ps agent-service

# Проверить логи
docker-compose logs agent-service

# Перезапустить
docker-compose restart agent-service
```

### Проблема: Brain Agent не видит directions

**Причина:** Старый код всё ещё запущен

**Решение:**
```bash
# Полная пересборка и перезапуск
docker-compose down
docker-compose build --no-cache agent-brain
docker-compose up -d
```

### Проблема: Facebook Campaign не создаётся

**Причина:** Неверный access_token или ad_account_id

**Решение:**
```bash
# Проверить логи agent-service
docker-compose logs agent-service | grep "Creating Facebook campaign"

# Проверить что access_token валидный в user_accounts
```

---

## ✅ ЧЕКЛИСТ ПОСЛЕ ДЕПЛОЯ

- [ ] Git push выполнен
- [ ] Pull на сервере выполнен
- [ ] Docker образы пересобраны
- [ ] Контейнеры перезапущены
- [ ] Логи Brain Agent показывают `directions_loaded`
- [ ] API /api/directions отвечает 200 OK
- [ ] Тестовое направление создано
- [ ] Facebook Campaign для направления создан
- [ ] Nginx проксирует запросы корректно
- [ ] Фронтенд разработчику отправлена документация:
  - [ ] DIRECTIONS_FRONTEND_SPEC.md
  - [ ] DIRECTIONS_FRONTEND_INTEGRATION.md
  - [ ] CAMPAIGN_BUILDER_VS_BRAIN_AGENT.md

---

## 🎉 ГОТОВО!

После выполнения всех шагов система полностью готова к работе с направлениями!

**Следующий шаг:** Дождаться ежедневного запуска Brain Agent (08:00 по таймзоне аккаунта) и проверить отчёт в Telegram.

