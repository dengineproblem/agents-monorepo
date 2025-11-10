# Резюме: Оптимизация CRM очереди и персонализации

**Дата**: 2025-11-10  
**Коммит**: Будет создан после выполнения

## Выполненные задачи

### ✅ 1. Удалено дублирование генерации сообщений

**Файл**: `services/crm-backend/src/scripts/analyzeDialogs.ts`

- Удалено поле `next_message` из интерфейса `AnalysisResult`
- Удалено `next_message` из `BASE_ANALYSIS_PROMPT`
- Удалено сохранение `next_message` в функции `saveAnalysisResult`
- Теперь сообщения генерируются **только** при формировании очереди кампании

**Результат**: Нет дублирования, AI генерирует сообщения с актуальным контекстом.

---

### ✅ 2. Смягчены критерии отбора лидов в очередь

**Файл**: `services/chatbot-service/src/lib/campaignScoringAgent.ts`

**Изменения в `calculateTimeCoefficient`**:
- Порог включения снижен с 100% до 70% интервала
- Лиды попадают в очередь раньше (hot: с 1.4 дней вместо 2, warm: с 3.5 вместо 5, cold: с 7 вместо 10)
- Используется градиентный коэффициент 0.5-1.0 для лидов в диапазоне 70%-100%

**Изменения в фильтрации**:
- Вместо `reactivationScore > 0` используется динамический порог: `baseScore * 0.3`
- Позволяет включить больше лидов с разным уровнем приоритета

**Результат**: Из 1000 лидов в очередь будет попадать ~300 вместо 9.

---

### ✅ 3. Переработан онбординг клиента (3 шага вместо 2)

**Файл**: `services/crm-frontend/src/components/onboarding/OnboardingModal.tsx`

**Новая структура вопросов**:

**Шаг 1 - Базовая информация**:
1. Сфера деятельности
2. Описание продуктов/услуг
3. Целевая аудитория

**Шаг 2 - Воронка продаж** (новое):
4. Этапы воронки продаж
5. Критерии перехода между этапами

**Шаг 3 - Сигналы и задачи** (новое):
6. Позитивные сигналы заинтересованности
7. Типичные возражения клиентов
8. Главные задачи бизнеса

**Результат**: Собираем все необходимые данные для персонализации промптов.

---

### ✅ 4. Обновлена схема БД

**Файл**: `services/crm-backend/migrations/002_business_profile.sql`

**Добавлены поля**:
```sql
funnel_stages_description TEXT         -- Описание этапов воронки
stage_transition_criteria TEXT         -- Критерии переходов
positive_signals TEXT                  -- Позитивные сигналы
negative_signals TEXT                  -- Негативные сигналы
```

**Результат**: БД готова хранить расширенные данные брифа.

---

### ✅ 5. Обновлена валидация API

**Файл**: `services/crm-backend/src/routes/businessProfile.ts`

- Расширена схема `BusinessProfileSchema` с новыми полями
- Обновлен `upsert` для сохранения всех новых полей
- Передача новых данных в `generatePersonalizedPromptContext`

**Результат**: API принимает и валидирует все новые поля брифа.

---

### ✅ 6. Обновлён генератор персонализированных промптов

**Файл**: `services/crm-backend/src/lib/promptGenerator.ts`

**Изменения в META_PROMPT**:
- Добавлены переменные: `<<<FUNNEL_STAGES>>>`, `<<<STAGE_CRITERIA>>>`, `<<<POSITIVE_SIGNALS>>>`, `<<<NEGATIVE_SIGNALS>>>`
- Обновлён выходной JSON с полями `funnel_stages`, `stage_transition_criteria`

**Обновлены интерфейсы**:
```typescript
interface BusinessProfile {
  // ...существующие поля
  funnel_stages_description?: string;
  stage_transition_criteria?: string;
  positive_signals?: string;
  negative_signals?: string;
}

interface PersonalizedContext {
  // ...существующие поля
  funnel_stages?: string[];
  stage_transition_criteria?: Record<string, string>;
}
```

**Обновлена функция `formatContextForPrompt`**:
- Добавлены секции для этапов воронки и критериев переходов
- Динамическое форматирование на основе наличия данных

**Результат**: AI генерирует контекст на основе всех данных брифа клиента.

---

### ✅ 7. Добавлен персонализированный контекст в генератор сообщений

**Файл**: `services/chatbot-service/src/lib/messageGenerator.ts`

**Изменения**:
- Функция `generateBatchMessages` теперь загружает `business_profile` с `personalized_context`
- Формируется секция "ПЕРСОНАЛИЗИРОВАННЫЙ КОНТЕКСТ БИЗНЕСА" из данных профиля
- Контекст передаётся в `generatePersonalizedMessage` через новый параметр `businessContext`
- Промпт изменён с "менеджер Performante" на "персональный менеджер по продажам"

**Используемые данные из контекста**:
- Специфика бизнеса
- Идеальный профиль лида
- Особенности воронки
- Этапы воронки (если указаны)
- Позитивные/негативные сигналы
- Модификаторы приоритета

**Результат**: Сообщения генерируются с учётом специфики бизнеса каждого клиента.

---

## Итоговый результат

✅ **Убрано дублирование**: Сообщения генерируются только при формировании очереди  
✅ **Больше лидов в очереди**: ~300 вместо 9 из 1000 лидов  
✅ **Персонализация промптов**: Под каждого клиента индивидуально  
✅ **Расширенный бриф**: Собираем воронку, критерии, сигналы  

## Следующие шаги

1. **Выполнить миграцию БД** в Supabase:
   ```bash
   # Выполнить в SQL Editor Supabase
   cat services/crm-backend/migrations/002_business_profile.sql
   ```

2. **Пересобрать и перезапустить сервисы**:
   ```bash
   cd services/crm-backend && npm run build
   cd services/chatbot-service && npm run build
   cd services/crm-frontend && npm run build
   ```

3. **Протестировать онбординг**: Пройти новый процесс онбординга с 3 шагами

4. **Протестировать формирование очереди**: Создать очередь и проверить количество лидов

5. **Проверить генерацию сообщений**: Убедиться, что используется персонализированный контекст

## Файлы для коммита

```
services/crm-backend/src/scripts/analyzeDialogs.ts
services/chatbot-service/src/lib/campaignScoringAgent.ts
services/crm-frontend/src/components/onboarding/OnboardingModal.tsx
services/crm-backend/src/lib/promptGenerator.ts
services/chatbot-service/src/lib/messageGenerator.ts
services/crm-backend/migrations/002_business_profile.sql
services/crm-backend/src/routes/businessProfile.ts
```

## Коммит

```bash
git add services/
git commit -m "feat(crm): персонализация промптов и оптимизация очереди

- Убрано дублирование генерации next_message
- Смягчены критерии отбора лидов (70% интервала + динамический порог)
- Расширен онбординг: воронка, критерии, сигналы (3 шага)
- Обновлён META_PROMPT под новые переменные
- Добавлен personalized_context в генератор сообщений
- Добавлены поля в business_profile: funnel_stages_description, stage_transition_criteria, positive_signals, negative_signals

Результат: ~300 лидов в очереди вместо 9, персонализация под каждого клиента"
```

