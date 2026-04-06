# Design: Несколько вопросов + шаблоны Meta для WhatsApp направлений

**Дата:** 2026-04-06  
**Статус:** Approved

## Контекст

При создании направления с целью WhatsApp пользователь задаёт «вопрос клиента» — текст, который предзаполняется в WhatsApp при клике на объявление (через `page_welcome_message` в Meta API). Сейчас можно добавить только один вопрос. Meta позволяет задавать до 5 вариантов (ротация/A/B). Нужно:
1. Добавить UI с кнопкой «+» для нескольких вопросов (до 5)
2. Загружать сохранённые Welcome Message шаблоны из Meta Ads Manager

## Архитектура

### База данных

Новая колонка в `default_ad_settings`:
```sql
ALTER TABLE default_ad_settings
ADD COLUMN client_questions JSONB DEFAULT '[]'::jsonb;
```

Старая `client_question TEXT` остаётся как fallback — не удаляем, не мигрируем старые данные. При сохранении пишем в обе: `client_questions` (массив) и `client_question` (первый элемент — для TikTok wa.me ссылок и textMatcher).

### Backend (agent-service)

**Файлы:**
- `services/agent-service/src/routes/directions.ts` — Zod схемы: добавить `client_questions: z.array(z.string().min(1)).min(1).max(5).optional()`
- `services/agent-service/src/routes/defaultSettings.ts` — аналогично
- `services/agent-service/src/lib/defaultSettings.ts` — интерфейс `DefaultSettings`: добавить `client_questions?: string[]`

**Новый роут:** `GET /directions/meta-welcome-templates`

Query params: `adAccountId`, `pageId`  
Использует токен пользователя из аккаунта.  
Meta Graph API endpoint: `GET /{page_id}/welcome_message_flows`  
Кеш: простой `Map<string, {data, ts}>` в памяти, TTL 5 минут.  
Возвращает: `{ templates: Array<{ id: string, name: string, questions: string[] }> }`

### facebook.ts

Файл: `services/agent-service/src/adapters/facebook.ts`

`createWhatsAppCreative` и `createWhatsAppImageCreative` получают `clientQuestions: string[]` вместо `clientQuestion: string`.

`page_welcome_message` передаёт массив:
```json
{
  "customer_action_type": "autofill_message",
  "message": {
    "autofill_message": [
      { "content": "Вопрос 1" },
      { "content": "Вопрос 2" }
    ],
    "text": "Здравствуйте! Чем можем помочь?"
  }
}
```

Если Meta возвращает ошибку на массив — fallback на первый элемент (добавить в существующий механизм обработки `error_subcode`).

### textMatcher.ts

Файл: `services/agent-service/src/lib/textMatcher.ts`

Запрашивать оба поля: `default_ad_settings!inner(client_question, client_questions)`.  
Для сравнения: объединить `client_questions` (если не пустой) с `[client_question]` в один массив, сравнивать по всем, брать максимальный `similarity`.

### tiktokSettings.ts

Файл: `services/agent-service/src/lib/tiktokSettings.ts`

Использовать первый элемент из `client_questions` если есть, иначе `client_question` (fallback без изменений логики).

### Frontend

**Типы** (`services/frontend/src/types/direction.ts`):
- `DefaultAdSettings`: добавить `client_questions: string[] | null`
- `CreateDefaultSettingsInput` / `UpdateDefaultSettingsInput` / `DirectionDefaultSettingsInput`: добавить `client_questions?: string[]`

**Компоненты:**
- `services/frontend/src/components/profile/CreateDirectionDialog.tsx`
- `services/frontend/src/components/profile/EditDirectionDialog.tsx`

Вместо одного `<Textarea>` для `clientQuestion` — компонент списка:
- Массив строк `clientQuestions: string[]` в state (начальное значение из `client_questions ?? [client_question ?? '']`)
- Каждый элемент — `<Textarea>` с крестиком (удалить), кроме последнего если он единственный
- Кнопка «+ Добавить вопрос» (скрывается при 5 вопросах)
- Кнопка «Загрузить из Meta» → запрос `GET /directions/meta-welcome-templates`, выбор из дропдауна, добавляет вопросы в список
- Валидация: минимум 1 непустой вопрос

При отправке: `client_questions: clientQuestions.filter(q => q.trim())`, `client_question: clientQuestions[0]`

**API сервис** (`services/frontend/src/services/directionsApi.ts`):
- Добавить функцию `fetchMetaWelcomeTemplates(adAccountId, pageId)`

## Верификация

1. Создать направление с целью WhatsApp, добавить 3 вопроса — проверить сохранение в БД (`client_questions` = массив из 3 строк)
2. Проверить, что при создании объявления через агента `page_welcome_message` содержит 3 варианта
3. Отправить WhatsApp сообщение с текстом второго вопроса — textMatcher должен определить правильное направление
4. Открыть форму редактирования направления — вопросы должны загружаться из `client_questions`
5. Кнопка «Загрузить из Meta» — проверить что шаблоны загружаются (нужен реальный page_id с шаблонами)
6. Старые направления (только `client_question`) должны работать без изменений
