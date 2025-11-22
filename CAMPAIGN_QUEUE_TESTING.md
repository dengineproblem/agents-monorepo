# Campaign Queue Improvements - Testing Guide

## Обзор

Этот документ содержит инструкции по тестированию новой функциональности формирования очереди рассылок с учетом пользовательских этапов воронки и ключевых этапов.

## Что было реализовано

### 1. База данных
- ✅ Добавлены поля в `business_profile`: `funnel_stages_structured`, `key_funnel_stages`
- ✅ Добавлены поля в `dialog_analysis`: `is_on_key_stage`, `key_stage_entered_at`, `key_stage_left_at`, `funnel_stage_history`
- ✅ Добавлены поля в `campaign_settings`: `key_stage_cooldown_days`, `stage_interval_multipliers`, `fatigue_thresholds`

### 2. Frontend (Onboarding)
- ✅ Интерактивный ввод этапов воронки с кнопками +/- 
- ✅ Выбор ключевых этапов через чекбоксы
- ✅ Валидация: минимум 2 этапа, минимум 1 ключевой

### 3. Backend API
- ✅ Обновлена схема `BusinessProfileSchema` для приема структурированных этапов
- ✅ Сохранение `funnel_stages_structured` и `key_funnel_stages`

### 4. Prompt Generator
- ✅ Обработка структурированных этапов в META_PROMPT
- ✅ Добавление информации о ключевых этапах в контекст
- ✅ Генерация `funnel_stages_details` с флагом `is_key`

### 5. Dialog Analysis
- ✅ Промпт включает инструкции по ключевым этапам
- ✅ Поле `is_on_key_stage` в результатах анализа
- ✅ Отслеживание перехода между этапами
- ✅ Сохранение `key_stage_entered_at` и `key_stage_left_at`
- ✅ История изменений этапов в `funnel_stage_history`

### 6. Campaign Scoring
- ✅ Функция `isLeadBlocked()` - жесткая блокировка лидов на ключевых этапах
- ✅ Функция `getTouchIntervalDays()` - гибкие интервалы по этапам
- ✅ Функция `calculateTimeReadinessCoefficient()` - учет последнего касания
- ✅ Функция `calculateStageCoefficient()` - приоритет по этапам
- ✅ Функция `calculateFatigueCoefficient()` - штраф за спам
- ✅ Обновлен `generateDailyCampaignQueue()` с новой логикой

## План тестирования

### Тест 1: Онбординг - Ввод этапов воронки

**Шаги:**
1. Открыть CRM-интерфейс (без заполненного профиля)
2. Должен появиться онбординг-модал
3. Заполнить Шаг 1 (сфера, описание, аудитория)
4. Перейти на Шаг 2

**Проверить:**
- ✅ Есть 2 инпута для этапов по умолчанию
- ✅ Кнопка "+ Добавить этап" добавляет новый инпут
- ✅ Кнопка удаления появляется только когда этапов > 2
- ✅ Нельзя удалить, если останется < 2 этапов

**Ожидаемый результат:** Интерактивный ввод этапов работает корректно

---

### Тест 2: Онбординг - Выбор ключевых этапов

**Шаги:**
1. Продолжить с Теста 1
2. Заполнить названия этапов (например: "Первый контакт", "Запись на консультацию", "Консультация проведена")
3. Посмотреть на секцию "Выберите ключевые этапы"

**Проверить:**
- ✅ Появились чекбоксы для всех заполненных этапов
- ✅ Можно отметить несколько этапов
- ✅ Валидация требует минимум 1 ключевой этап
- ✅ Нельзя перейти дальше без выбора ключевого этапа

**Ожидаемый результат:** Выбор ключевых этапов работает

---

### Тест 3: Сохранение в базу данных

**Шаги:**
1. Завершить онбординг полностью
2. Проверить в БД таблицу `business_profile`

**SQL запрос:**
```sql
SELECT 
  business_industry,
  funnel_stages_description,
  funnel_stages_structured,
  key_funnel_stages,
  personalized_context
FROM business_profile
WHERE user_account_id = '<your_user_id>';
```

**Проверить:**
- ✅ `funnel_stages_structured` содержит массив объектов с id, name, order
- ✅ `key_funnel_stages` содержит массив названий ключевых этапов
- ✅ `funnel_stages_description` содержит строку "Этап1 → Этап2 → Этап3"
- ✅ `personalized_context` содержит `key_funnel_stages` и `funnel_stages_details`

**Ожидаемый результат:** Данные корректно сохранены

---

### Тест 4: Анализ диалога определяет ключевой этап

**Предусловия:**
- Должен быть запущен сервис crm-backend
- Должны быть диалоги в Evolution API

**Шаги:**
1. Запустить анализ диалогов:
```bash
# Из корня проекта
cd services/crm-backend
npm run analyze -- --instance=<instance_name> --user=<user_id>
```

2. Проверить в БД таблицу `dialog_analysis`

**SQL запрос:**
```sql
SELECT 
  contact_phone,
  contact_name,
  funnel_stage,
  is_on_key_stage,
  key_stage_entered_at,
  funnel_stage_history
FROM dialog_analysis
WHERE user_account_id = '<your_user_id>'
ORDER BY analyzed_at DESC
LIMIT 10;
```

**Проверить:**
- ✅ Если лид на ключевом этапе, `is_on_key_stage = true`
- ✅ `key_stage_entered_at` заполнен для лидов на ключевых этапах
- ✅ `funnel_stage_history` содержит историю переходов (если были изменения)

**Ожидаемый результат:** AI корректно определяет ключевые этапы

---

### Тест 5: Лиды на ключевых этапах не попадают в очередь

**Предусловия:**
- Есть лиды с `is_on_key_stage = true`
- Есть лиды с `is_on_key_stage = false`

**Шаги:**
1. Сгенерировать очередь рассылки через API или UI
2. Проверить результат

**API запрос:**
```bash
curl -X POST http://localhost:3003/campaign/generate-queue \
  -H "Content-Type: application/json" \
  -d '{"userAccountId": "<your_user_id>"}'
```

**Проверить:**
- ✅ В очереди НЕТ лидов с `is_on_key_stage = true`
- ✅ В очереди НЕТ лидов с `funnel_stage = 'deal_closed'`
- ✅ В очереди НЕТ лидов с `funnel_stage = 'deal_lost'`
- ✅ В логах видно: "Lead blocked" для заблокированных лидов

**Ожидаемый результат:** Лиды на ключевых этапах блокируются

---

### Тест 6: Лиды после ухода с ключевого этапа блокируются на 7 дней

**Предусловия:**
- Есть лид с заполненным `key_stage_left_at` (менее 7 дней назад)

**Шаги:**
1. Создать тестового лида с `key_stage_left_at = NOW() - INTERVAL '5 days'`
2. Сгенерировать очередь
3. Проверить, что лид НЕ попал в очередь

**SQL для создания тестового лида:**
```sql
UPDATE dialog_analysis
SET 
  is_on_key_stage = false,
  key_stage_left_at = NOW() - INTERVAL '5 days'
WHERE contact_phone = '<test_phone>';
```

**Проверить:**
- ✅ Лид НЕ попал в очередь (cooldown период)
- ✅ После изменения `key_stage_left_at` на 8 дней назад, лид попадает в очередь

**Ожидаемый результат:** Cooldown период 7 дней работает

---

### Тест 7: Новые коэффициенты влияют на scoring

**Шаги:**
1. Сгенерировать очередь
2. Посмотреть на `reactivation_score` лидов

**Проверить:**
- ✅ Лиды с большим `campaign_messages_count` имеют более низкий score (fatigue)
- ✅ Лиды на этапе "no_show" имеют более высокий score (stage coefficient)
- ✅ Лиды с недавним `last_message` имеют более высокий score (time readiness)

**SQL для проверки:**
```sql
SELECT 
  contact_phone,
  funnel_stage,
  campaign_messages_count,
  reactivation_score,
  last_message,
  last_campaign_message_at
FROM dialog_analysis
WHERE user_account_id = '<your_user_id>'
  AND reactivation_score > 0
ORDER BY reactivation_score DESC
LIMIT 20;
```

**Ожидаемый результат:** Новые коэффициенты влияют на приоритет

---

## Проверка миграций

Перед тестированием убедитесь, что все миграции применены:

```bash
# CRM Backend
cd services/crm-backend
npm run migrate

# Chatbot Service
cd services/chatbot-service
npm run migrate

# Main migrations
cd migrations
# Применить через Supabase CLI или вручную
```

**Файлы миграций:**
- `services/crm-backend/migrations/006_add_funnel_structure.sql`
- `migrations/031_add_key_stage_tracking.sql`
- `services/chatbot-service/migrations/002_add_campaign_scoring_settings.sql`

---

## Известные ограничения

1. **Персонализированные этапы vs база данных**: В БД `funnel_stage` хранится как TEXT, но есть CHECK constraint с дефолтными значениями. Если пользователь создал свои этапы, они могут не проходить валидацию. Решение: либо убрать CHECK constraint, либо использовать другое поле.

2. **Миграция существующих данных**: Для существующих `business_profile` нужно запустить ре-генерацию `personalized_context` с новыми полями.

3. **Синхронизация названий**: Названия этапов в `key_funnel_stages` должны точно совпадать с `funnel_stage` лидов. Опечатки приведут к тому, что блокировка не сработает.

---

## Rollback план

Если что-то пошло не так:

1. **Откат миграций**: Используйте SQL команды для удаления новых колонок
2. **Откат кода**: Вернитесь к предыдущему коммиту
3. **Очистка данных**: Обнулите новые поля в тестовой среде

**SQL для отката:**
```sql
-- business_profile
ALTER TABLE business_profile 
  DROP COLUMN IF EXISTS funnel_stages_structured,
  DROP COLUMN IF EXISTS key_funnel_stages;

-- dialog_analysis
ALTER TABLE dialog_analysis
  DROP COLUMN IF EXISTS is_on_key_stage,
  DROP COLUMN IF EXISTS key_stage_entered_at,
  DROP COLUMN IF EXISTS key_stage_left_at,
  DROP COLUMN IF EXISTS funnel_stage_history;

-- campaign_settings
ALTER TABLE campaign_settings
  DROP COLUMN IF EXISTS key_stage_cooldown_days,
  DROP COLUMN IF EXISTS stage_interval_multipliers,
  DROP COLUMN IF EXISTS fatigue_thresholds;
```

---

## Следующие шаги

После успешного тестирования:

1. ✅ Задеплоить на staging
2. ✅ Протестировать с реальными данными
3. ✅ Собрать feedback от пользователей
4. ✅ Оптимизировать коэффициенты на основе результатов
5. ✅ Добавить UI для настройки коэффициентов в админ-панели

---

## Контакты

Если возникли проблемы при тестировании, создайте issue с описанием проблемы и логами.




