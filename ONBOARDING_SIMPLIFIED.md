# Упрощенный онбординг AI-таргетолог

## Что изменилось

### Было: 9 шагов
1. Название и ниша
2. Instagram
3. Facebook аккаунт
4. Дневной бюджет
5. Направления бизнеса + целевая стоимость лида
6. План продаж + средний чек по направлениям
7. Конверсии воронки
8. Дополнительная информация
9. Генерация промпта

### Стало: 5 шагов
1. **Название и ниша** ✅
2. **Онлайн-присутствие** - Instagram + сайт (оба опциональны, можно пропустить)
3. **Целевая аудитория** - описание ЦА + география
4. **О продуктах/услугах** - основные услуги, конкурентные преимущества, ценовой сегмент
5. **Генерация промпта** ✅

## Логика изменений

### Удалено
- ❌ Вопросы про Facebook аккаунт (настраивается в Profile)
- ❌ Вопрос про дневной бюджет (настраивается в Directions)
- ❌ Детальная настройка направлений с метриками (настраивается в Directions)
- ❌ Конверсии воронки (настраивается в Directions)

### Добавлено
- ✅ Ссылка на сайт (опционально)
- ✅ Целевая аудитория (кто клиенты)
- ✅ География работы
- ✅ Основные услуги/продукты
- ✅ Конкурентные преимущества
- ✅ Ценовой сегмент (эконом/средний/премиум)

## Структура БД

### Таблица user_briefing_responses

```sql
CREATE TABLE user_briefing_responses (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES user_accounts(id),
    
    -- Основная информация
    business_name TEXT NOT NULL,
    business_niche TEXT NOT NULL,
    
    -- Онлайн-присутствие
    instagram_url TEXT,
    website_url TEXT,
    
    -- Целевая аудитория
    target_audience TEXT,
    geography TEXT,
    
    -- О продукте/услугах
    main_services TEXT,
    competitive_advantages TEXT,
    price_segment TEXT, -- эконом/средний/премиум
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id)
);
```

## Компоненты Frontend

### Новые файлы
- `Step2OnlinePresence.tsx` - Instagram + сайт
- `Step3TargetAudience.tsx` - ЦА + география
- `Step4ProductInfo.tsx` - услуги + преимущества + ценовой сегмент
- `Step5Completion.tsx` (переименован из Step9)

### Удаленные файлы
- ~~Step2Instagram.tsx~~
- ~~Step3FacebookAccount.tsx~~
- ~~Step4Budget.tsx~~
- ~~Step5Directions.tsx~~
- ~~Step6Economics.tsx~~
- ~~Step7Conversion.tsx~~
- ~~Step8Additional.tsx~~

## Backend изменения

### openaiPromptGenerator.ts
- Упрощен интерфейс `BriefingData`
- Убраны поля про бюджет, направления, конверсии
- Добавлены поля: website_url, target_audience, geography, main_services, competitive_advantages, price_segment
- Промпт генерации адаптирован под новые данные

### briefingRoutes.ts
- Обновлена валидация запроса (только обязательные: business_name, business_niche)
- Упрощена структура сохранения данных

## Преимущества новой структуры

1. **Быстрее** - 5 шагов вместо 9
2. **Проще** - не дублируются настройки из Directions
3. **Полезнее** - фокус на информации для AI-генерации креативов
4. **Гибкость** - можно пропустить Instagram/сайт если их нет

## Как тестировать

1. Создать пользователя с `prompt1 = NULL`
2. Войти в приложение
3. Пройти 5 шагов онбординга:
   - Указать название и нишу
   - Добавить Instagram/сайт или пропустить
   - Описать целевую аудиторию
   - Рассказать о продуктах/услугах
   - Дождаться генерации промпта

4. Проверить что:
   - Данные сохранились в `user_briefing_responses`
   - `prompt1` создан и содержит персонализированную информацию
   - Онбординг больше не показывается при повторном входе

## Статус

✅ Backend обновлен и развернут
✅ Frontend обновлен и развернут
✅ Миграция БД готова (нужно применить)
✅ Компоненты пересобраны

**Следующий шаг:** Применить миграцию `031_create_user_briefing_responses.sql` в Supabase


