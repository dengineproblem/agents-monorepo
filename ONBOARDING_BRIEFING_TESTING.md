# Тестирование онбординг-брифа AI-таргетолог

## Обзор

Реализована система онбординга для новых пользователей, которая собирает информацию о бизнесе клиента и автоматически генерирует персонализированный `prompt1` через OpenAI API.

## Что было реализовано

### Backend (agent-service)

1. **Миграция БД**: `migrations/031_create_user_briefing_responses.sql`
   - Создана таблица `user_briefing_responses` для хранения ответов брифа
   - Поля: business_name, business_niche, instagram_url, has_fb_account, can_provide_fb_access, daily_budget_usd, directions (JSONB), conversion_lead_to_appointment, conversion_appointment_to_sale, additional_notes

2. **OpenAI генератор**: `services/agent-service/src/lib/openaiPromptGenerator.ts`
   - Функция `generatePrompt1()` использует GPT-4o для создания персонализированного промпта
   - Базовый шаблон адаптируется под конкретный бизнес клиента

3. **API роуты**: `services/agent-service/src/routes/briefingRoutes.ts`
   - `POST /briefing/generate-prompt` - генерирует prompt1, сохраняет ответы брифа, обновляет user_accounts
   - `GET /briefing/:user_id` - получает сохраненные ответы брифа

4. **Интеграция в server.ts**: Роуты подключены с префиксом `/briefing`

### Frontend

1. **API сервис**: `services/frontend/src/services/briefingApi.ts`
   - Методы для генерации промпта и получения сохраненного брифа
   - Автоматическое обновление localStorage после генерации

2. **Компоненты онбординга**: `services/frontend/src/components/onboarding/`
   - **OnboardingWizard.tsx** - главный компонент с state management и прогресс-баром
   - **Step1BusinessInfo.tsx** - название бизнеса и ниша
   - **Step2Instagram.tsx** - ссылка на Instagram
   - **Step3FacebookAccount.tsx** - рекламный аккаунт FB и доступы
   - **Step4Budget.tsx** - дневной бюджет
   - **Step5Directions.tsx** - направления бизнеса с целевой стоимостью лида
   - **Step6Economics.tsx** - план продаж и средний чек
   - **Step7Conversion.tsx** - конверсии воронки продаж
   - **Step8Additional.tsx** - дополнительные пожелания
   - **Step9Completion.tsx** - генерация промпта с индикацией статуса

3. **Интеграция в App.tsx**
   - Проверка наличия `prompt1` при загрузке пользователя
   - Автоматическое отображение OnboardingWizard если `prompt1` пустой
   - Wizard показывается поверх основного интерфейса

4. **Типы**: Обновлен `services/frontend/src/integrations/supabase/types.ts`
   - Добавлен тип для таблицы `user_briefing_responses`

## Как протестировать

### Подготовка

1. **Запустить миграцию БД**:
```bash
cd /Users/anatolijstepanov/agents-monorepo
# Подключитесь к Supabase и выполните миграцию
psql -h <supabase-host> -U postgres -d postgres < migrations/031_create_user_briefing_responses.sql
```

Или через Supabase Dashboard:
- Перейти в SQL Editor
- Скопировать содержимое `migrations/031_create_user_briefing_responses.sql`
- Выполнить

2. **Убедиться что OpenAI API key настроен**:
```bash
# В .env.agent должен быть OPENAI_API_KEY
cat /root/.env.agent | grep OPENAI_API_KEY
```

3. **Пересобрать и перезапустить сервисы**:
```bash
cd /Users/anatolijstepanov/agents-monorepo
docker-compose down
docker-compose up -d --build agent-service frontend
```

### Тестовый сценарий

#### 1. Создать тестового пользователя без prompt1

Выполните в Supabase SQL Editor:

```sql
-- Создаем тестового пользователя без prompt1
INSERT INTO user_accounts (
  username, 
  password, 
  access_token, 
  ad_account_id, 
  page_id,
  prompt1
) VALUES (
  'test_onboarding',
  'test123',
  'test_token',
  'act_123',
  '123456',
  NULL  -- ВАЖНО: prompt1 должен быть NULL
);
```

#### 2. Войти в приложение

1. Откройте браузер: `https://app.performanteaiagency.com/login`
2. Логин: `test_onboarding`
3. Пароль: `test123`

**Ожидаемый результат**: После входа должен автоматически появиться OnboardingWizard

#### 3. Пройти онбординг

Заполните 5 шагов:

**Шаг 1 - Название и ниша**:
- Название: "Стоматология Белоснежка"
- Ниша: "Стоматология"

**Шаг 2 - Онлайн-присутствие**:
- Instagram: "https://instagram.com/belosnezka_dental"
- Сайт: "https://belosnezka-dental.kz"
- (Можно пропустить оба поля)

**Шаг 3 - Целевая аудитория**:
- Кто клиенты: "Женщины и мужчины 30-50 лет, средний класс, заботящиеся о здоровье зубов"
- География: "Алматы, Казахстан"

**Шаг 4 - О продуктах/услугах**:
- Основные услуги: "Профессиональная чистка зубов, отбеливание, установка виниров, имплантация, брекеты"
- Конкурентные преимущества: "Современное немецкое оборудование, опытные врачи с 15+ лет стажа, безболезненное лечение, гарантия 5 лет на все работы"
- Ценовой сегмент: Средний

**Шаг 5 - Генерация**:
- Должен появиться loader "Создаем ваш персональный промпт..."
- Через 5-10 секунд появится галочка "Промпт успешно создан!"
- Автоматический редирект на главную страницу

#### 4. Проверить результаты

**В БД (Supabase SQL Editor)**:

```sql
-- Проверяем что бриф сохранен
SELECT * FROM user_briefing_responses 
WHERE user_id = (SELECT id FROM user_accounts WHERE username = 'test_onboarding');

-- Проверяем что prompt1 создан
SELECT username, LENGTH(prompt1) as prompt_length, 
       LEFT(prompt1, 100) as prompt_preview
FROM user_accounts 
WHERE username = 'test_onboarding';
```

**В приложении**:
1. Онбординг больше не должен появляться
2. В профиле можно проверить наличие данных

**В логах backend** (опционально):
```bash
docker logs agent-service | grep briefing
```

Должны быть логи:
- "Получен запрос на генерацию промпта"
- "Начинаем генерацию промпта через OpenAI"
- "Промпт успешно сгенерирован"

### Тестирование повторного прохождения

Если пользователь с заполненным `prompt1` войдет в систему, онбординг **не должен** появляться.

Чтобы протестировать повторное прохождение:

```sql
-- Очистить prompt1 для тестового пользователя
UPDATE user_accounts 
SET prompt1 = NULL 
WHERE username = 'test_onboarding';
```

Перезайдите - онбординг должен появиться снова.

## Обработка ошибок

### Если промпт не генерируется

1. **Проверить OpenAI API key**:
```bash
docker exec agent-service printenv | grep OPENAI_API_KEY
```

2. **Проверить логи**:
```bash
docker logs agent-service --tail 100
```

3. **Проверить доступность API**:
```bash
docker exec agent-service curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Если онбординг не появляется

1. Проверить localStorage в браузере (DevTools → Application → Local Storage):
   - Ключ `user` должен содержать объект с `prompt1: null`

2. Проверить консоль браузера на ошибки

3. Убедиться что frontend пересобран:
```bash
docker-compose up -d --build frontend
```

## API Endpoints

### POST /api/briefing/generate-prompt

Генерирует prompt1 на основе ответов брифа.

**Request**:
```json
{
  "user_id": "uuid",
  "business_name": "Стоматология Белоснежка",
  "business_niche": "Стоматология",
  "instagram_url": "https://instagram.com/belosnezka",
  "has_fb_account": true,
  "can_provide_fb_access": true,
  "daily_budget_usd": 50,
  "directions": [
    {
      "name": "Имплантация",
      "target_cpl_usd": 2.5,
      "monthly_sales_plan": 10,
      "average_check_usd": 800
    }
  ],
  "conversion_lead_to_appointment": 60,
  "conversion_appointment_to_sale": 40,
  "additional_notes": "Работаем в Алматы"
}
```

**Response**:
```json
{
  "success": true,
  "prompt1": "## Промпт для AI-помощника...",
  "message": "Промпт успешно создан"
}
```

### GET /api/briefing/:user_id

Получить сохраненные ответы брифа.

**Response**:
```json
{
  "success": true,
  "briefing": {
    "id": "uuid",
    "user_id": "uuid",
    "business_name": "...",
    // ... остальные поля
  }
}
```

## Структура файлов

```
agents-monorepo/
├── migrations/
│   └── 031_create_user_briefing_responses.sql
├── services/
│   ├── agent-service/
│   │   └── src/
│   │       ├── lib/
│   │       │   └── openaiPromptGenerator.ts
│   │       ├── routes/
│   │       │   └── briefingRoutes.ts
│   │       └── server.ts (обновлен)
│   └── frontend/
│       └── src/
│           ├── components/
│           │   └── onboarding/
│           │       ├── OnboardingWizard.tsx
│           │       ├── Step1BusinessInfo.tsx
│           │       ├── Step2Instagram.tsx
│           │       ├── Step3FacebookAccount.tsx
│           │       ├── Step4Budget.tsx
│           │       ├── Step5Directions.tsx
│           │       ├── Step6Economics.tsx
│           │       ├── Step7Conversion.tsx
│           │       ├── Step8Additional.tsx
│           │       └── Step9Completion.tsx
│           ├── services/
│           │   └── briefingApi.ts
│           ├── integrations/supabase/
│           │   └── types.ts (обновлен)
│           └── App.tsx (обновлен)
```

## Возможные улучшения (для будущих итераций)

1. **Возможность редактирования брифа**: Добавить страницу настроек где можно изменить данные брифа и перегенерировать промпт
2. **Сохранение прогресса**: Сохранять промежуточные данные онбординга в localStorage на случай закрытия браузера
3. **Валидация на сервере**: Добавить более строгую валидацию входных данных на backend
4. **Предпросмотр промпта**: Показать пользователю сгенерированный промпт перед сохранением
5. **A/B тестирование промптов**: Возможность создавать несколько вариантов промпта и тестировать эффективность
6. **Шаблоны по нишам**: Предложить готовые шаблоны для популярных ниш (стоматология, косметология и т.д.)

## Заключение

Система онбординга полностью реализована и готова к тестированию. Все компоненты интегрированы, код проверен линтером, ошибок не обнаружено.

