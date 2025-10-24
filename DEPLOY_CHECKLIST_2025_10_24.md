# Деплой: WhatsApp Numbers + Analyzer Fixes

**Дата**: 24 октября 2025  
**Ветка**: main

## Что изменено

### 1. WhatsApp номера для направлений ✅
- Множественные WhatsApp номера с привязкой к направлениям
- Каскадная логика: направление → дефолтный → legacy
- Применено во всех местах: auto-launch, quick test, Brain Agent, ручной запуск

### 2. Analyzer: LLM анализ в БД ✅
- LLM анализ теперь сохраняется в `creative_tests` таблицу
- Повторные запросы берут из БД (не вызывают OpenAI)
- Try-catch для OpenAI ошибок

### 3. Analyzer: отображение cancelled тестов ✅
- Тесты со статусом `cancelled` теперь отображают метрики

### 4. Frontend: fix proxy для analyzer ✅
- Vite proxy корректно проксирует `/api/analyzer/*` на analyzer
- Fix `creativeAnalyticsApi.ts` - использование URLSearchParams вместо new URL()

### 5. UI: скрыт выбор языка ✅
- Переключатель языка убран из левого нижнего угла

---

## Команды для деплоя

### На сервере (после `git pull`)

```bash
# 1. Перейти в корень проекта
cd /path/to/agents-monorepo

# 2. Установить зависимости для agent-brain
cd services/agent-brain
npm install

# 3. Перезапустить agent-brain (analyzer)
pm2 restart agent-brain
# ИЛИ если через systemd:
sudo systemctl restart agent-brain

# 4. Пересобрать frontend (если нужно)
cd ../frontend
npm run build

# 5. Перезапустить agent-service (если нужно)
cd ../agent-service
pm2 restart agent-service
# ИЛИ
sudo systemctl restart agent-service
```

**Примечание**: Миграция БД УЖЕ применена (Supabase - одна БД для всех окружений)

---

## Проверка после деплоя

### 1. Миграция применилась ✅
```sql
-- Проверить что таблица создана
SELECT COUNT(*) FROM whatsapp_phone_numbers;

-- Проверить что колонка добавлена
SELECT whatsapp_phone_number_id FROM account_directions LIMIT 1;
```

### 2. Analyzer работает ✅
```bash
# Проверить что процесс запущен
curl https://agents.performanteaiagency.com/api/analyzer/health

# Должен вернуть:
# {"ok": true, "service": "creative-analyzer"}
```

### 3. LLM анализ сохраняется ✅
```sql
-- Проверить completed тест после первого просмотра на фронте
SELECT llm_score, llm_verdict 
FROM creative_tests 
WHERE status = 'completed' 
  AND llm_score IS NOT NULL
LIMIT 1;

-- Должны быть заполненные значения
```

### 4. Frontend обновился ✅
- Открыть https://agents.performanteaiagency.com
- Проверить что НЕТ переключателя языка внизу слева
- Открыть любой креатив с completed тестом
- Проверить что отображаются метрики

---

## Измененные файлы

### Backend
- `services/agent-brain/src/analyzerService.js` - сохранение LLM в БД, cancelled тесты
- `services/agent-service/src/routes/campaignBuilder.ts` - WhatsApp cascading
- `services/agent-service/src/routes/creativeTest.ts` - WhatsApp cascading  
- `services/agent-service/src/routes/actions.ts` - WhatsApp cascading для Brain Agent
- `services/agent-service/src/workflows/createAdSetInDirection.ts` - WhatsApp cascading
- `services/agent-service/src/routes/directions.ts` - CRUD для WhatsApp номеров
- `services/agent-service/src/routes/whatsappNumbers.ts` - **НОВЫЙ** API endpoints

### Frontend
- `services/frontend/src/config/api.ts` - fix API_BASE_URL в dev
- `services/frontend/src/config/appReview.ts` - SHOW_LANGUAGE_SWITCHER = false
- `services/frontend/src/services/creativeAnalyticsApi.ts` - fix new URL() ошибка
- `services/frontend/vite.config.ts` - proxy для analyzer с rewrite
- `services/frontend/src/components/profile/WhatsAppNumbersCard.tsx` - **НОВЫЙ** компонент
- `services/frontend/src/components/profile/DirectionsCard.tsx` - WhatsApp поле
- `services/frontend/src/components/profile/EditDirectionDialog.tsx` - WhatsApp поле
- `services/frontend/src/components/AdsetList.tsx` - **НОВЫЙ** компонент
- `services/frontend/src/components/EditAdsetDialog.tsx` - **НОВЫЙ** компонент

### Миграции
- `migrations/012_whatsapp_phone_numbers_table.sql` - **НОВАЯ** таблица + колонка

---

## Откат (если что-то пошло не так)

```bash
# 1. Откат кода
git reset --hard HEAD~1

# 2. Откат миграции (только если что-то сломалось)
# ВНИМАНИЕ: потеряются данные из whatsapp_phone_numbers!
psql $DATABASE_URL << EOF
DROP TABLE IF EXISTS whatsapp_phone_numbers CASCADE;
ALTER TABLE account_directions DROP COLUMN IF EXISTS whatsapp_phone_number_id;
EOF

# 3. Перезапустить сервисы
pm2 restart all
```

---

## Известные проблемы

1. **OpenAI quota** - если закончилась, LLM анализ не будет создаваться (но метрики покажутся)
2. **Legacy номера** - старые номера из `user_accounts.whatsapp_phone_number` остаются как fallback

---

## Поддержка

Если что-то не работает:
1. Проверить логи: `pm2 logs agent-brain` / `pm2 logs agent-service`
2. Проверить БД: миграция применилась?
3. Проверить env: `OPENAI_API_KEY` указан в `.env`?

**Готово к деплою!** ✅

