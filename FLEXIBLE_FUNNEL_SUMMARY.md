# Резюме: Гибкая воронка и детализированные сигналы

**Дата**: 2025-11-10  
**Коммит**: Будет создан после применения изменений

## Выполненные задачи

### ✅ 1. Переработан онбординг (9 детализированных вопросов)

**Файл**: `services/crm-frontend/src/components/onboarding/OnboardingModal.tsx`

**Изменения**:
- С 8 вопросов (3 шага) → на 9 вопросов (3 шага)
- Убрано поле `main_challenges` (было избыточным)
- Заменены поля: `positive_signals`, `negative_signals`

**Новая структура**:

**Шаг 1 - Базовая информация (3 вопроса)**:
1. Сфера деятельности
2. Описание продуктов/услуг
3. Целевая аудитория

**Шаг 2 - Воронка продаж (2 вопроса)**:
4. Этапы воронки продаж
5. Критерии перехода между этапами

**Шаг 3 - Сигналы и характеристики (4 вопроса)**:
6. Идеальный клиент (сегмент, ниша, характеристики)
7. Кто НЕ подходит как клиент
8. Типичные боли и запросы
9. Фразы интереса и типичные возражения

---

### ✅ 2. Обновлена схема БД

**Файл**: `services/crm-backend/migrations/002_business_profile.sql`

**Заменены поля**:
- ❌ `main_challenges` - удалено
- ❌ `positive_signals` - удалено
- ❌ `negative_signals` - удалено

**Добавлены новые**:
- ✅ `ideal_client_profile` - идеальный клиент
- ✅ `non_target_profile` - кто не подходит
- ✅ `client_pains` - боли и запросы
- ✅ `interest_and_objections` - фразы интереса + возражения

---

### ✅ 3. Обновлён META_PROMPT с автоматическим скорингом

**Файл**: `services/crm-backend/src/lib/promptGenerator.ts`

**Добавлено**:
- Переменные: `<<<IDEAL_CLIENT>>>`, `<<<NON_TARGET>>>`, `<<<CLIENT_PAINS>>>`, `<<<INTEREST_OBJECTIONS>>>`
- Инструкции по парсингу этапов воронки и критериев
- **Формула автоматического расчёта скоринга**:
  ```
  score = Math.round((100 / N) * номер_этапа)
  ```
  - 3 этапа: 33, 67, 100
  - 4 этапа: 25, 50, 75, 100
  - 5 этапов: 20, 40, 60, 80, 100

**Обновлён интерфейс `PersonalizedContext`**:
```typescript
{
  funnel_stages?: string[];
  funnel_scoring?: Record<string, number>;  // NEW!
  ideal_client_profile?: string;            // NEW!
  non_target_profile?: string;              // NEW!
  client_pains?: string[];                  // NEW!
  positive_signals: string[];
  negative_signals: string[];
  ...
}
```

---

### ✅ 4. Убрана жёсткая воронка из BASE_ANALYSIS_PROMPT

**Файл**: `services/crm-backend/src/scripts/analyzeDialogs.ts`

**Было** (жёсткий скоринг):
```
ЭТАПЫ ВОРОНКИ:
- not_qualified(15)
- qualified(30)
- consultation_booked(40)
...
```

**Стало** (гибкий):
```
ЭТАПЫ ВОРОНКИ И СКОРИНГ:
Используй этапы воронки, скоринг и критерии 
из ПЕРСОНАЛИЗИРОВАННОГО КОНТЕКСТА клиента.

ДОПОЛНИТЕЛЬНЫЕ МОДИФИКАТОРЫ:
- Совпадение с идеальным профилем: +10-20
- Совпадение с non-target: -20-30
- Упоминание боли: +5-10 за каждую
- Позитивные сигналы: +5
- Негативные сигналы: -10
```

---

### ✅ 5. Обновлён formatContextForPrompt

**Файл**: `services/crm-backend/src/lib/promptGenerator.ts`

**Теперь выводит**:
```
ЭТАПЫ ВОРОНКИ И СКОРИНГ:
1. Первый контакт → 25 баллов
2. Квалификация → 50 баллов
3. Консультация → 75 баллов
4. Сделка → 100 баллов

ИДЕАЛЬНЫЙ КЛИЕНТ:
B2B, владелец клиники, готов инвестировать...

КТО НЕ ПОДХОДИТ:
B2C клиенты, начинающие без бюджета...

ТИПИЧНЫЕ БОЛИ И ЗАПРОСЫ:
- "мало заявок"
- "высокая стоимость лида"

ПОЗИТИВНЫЕ СИГНАЛЫ (фразы интереса):
- "хочу узнать подробнее"

НЕГАТИВНЫЕ СИГНАЛЫ (возражения):
- "дорого"
- "подумаю"

МОДИФИКАТОРЫ СКОРИНГА:
- Бонус за совпадение с идеальным профилем: +10-20
- Штраф за совпадение с non-target: -20-30
- Упоминание боли: +5-10 за каждую
```

---

### ✅ 6. Обновлены API схема и интерфейсы

**Файл**: `services/crm-backend/src/routes/businessProfile.ts`

**Обновлена валидация** `BusinessProfileSchema`:
- Удалено: `main_challenges`, `positive_signals`, `negative_signals`
- Добавлено: `ideal_client_profile`, `non_target_profile`, `client_pains`, `interest_and_objections`

**Обновлён `upsert`** - все новые поля сохраняются в БД

**Обновлён вызов** `generatePersonalizedPromptContext` - передаются новые поля

---

## SQL для применения изменений в БД

Выполни в Supabase SQL Editor:

```sql
-- Add new columns to existing business_profile table
ALTER TABLE business_profile 
  ADD COLUMN IF NOT EXISTS ideal_client_profile TEXT,
  ADD COLUMN IF NOT EXISTS non_target_profile TEXT,
  ADD COLUMN IF NOT EXISTS client_pains TEXT,
  ADD COLUMN IF NOT EXISTS interest_and_objections TEXT;

-- Drop old columns (если они есть и больше не используются)
ALTER TABLE business_profile 
  DROP COLUMN IF EXISTS main_challenges,
  DROP COLUMN IF EXISTS positive_signals,
  DROP COLUMN IF EXISTS negative_signals;

-- Add comments for new columns
COMMENT ON COLUMN business_profile.ideal_client_profile IS 'Ideal client profile: segment, niche, position, characteristics';
COMMENT ON COLUMN business_profile.non_target_profile IS 'Who does NOT fit as a client';
COMMENT ON COLUMN business_profile.client_pains IS 'Typical pains and requests of ideal clients';
COMMENT ON COLUMN business_profile.interest_and_objections IS 'Interest phrases and typical objections combined';
```

---

## Результат

✅ **Этапы воронки индивидуальные** - каждый клиент указывает свои  
✅ **Скоринг рассчитывается автоматически** - по формуле на основе количества этапов  
✅ **Детализированные сигналы** - идеальный клиент, non-target, боли, фразы  
✅ **AI использует весь контекст** - для точного анализа лидов  
✅ **9 целевых вопросов** - вместо размытых 8  

---

## Следующие шаги

1. **Выполнить SQL миграцию** в Supabase (запрос выше)

2. **Пересобрать сервисы**:
```bash
cd services/crm-backend && npm run build
cd services/crm-frontend && npm run build
```

3. **Перезапустить сервисы**

4. **Пройти новый онбординг** - проверить 9 вопросов

5. **Загрузить лидов** - AI будет использовать новый контекст с индивидуальной воронкой

6. **Проверить скоринг** - убедиться что баллы рассчитываются по этапам клиента

---

## Коммит

```bash
git add services/
git commit -m "feat(crm): гибкая воронка и детализированные сигналы

- Онбординг: 9 детализированных вопросов (идеальный клиент, non-target, боли, возражения)
- Автоматический расчёт скоринга по этапам воронки клиента
- Убрана жёсткая воронка из BASE_ANALYSIS_PROMPT
- AI использует персонализированный контекст с индивидуальными этапами
- Обновлена схема БД: ideal_client_profile, non_target_profile, client_pains, interest_and_objections

Результат: AI точно анализирует лидов с учётом воронки и специфики каждого клиента"
```

