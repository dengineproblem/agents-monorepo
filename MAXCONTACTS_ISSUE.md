# Проблема с maxContacts Feature

**Дата:** 2025-11-03  
**Статус:** Требует отладки, временно откачено

## Описание проблемы

После добавления параметра `maxContacts` для ограничения количества контактов, загружаемых из Evolution PostgreSQL на этапе SQL запроса, анализ диалогов начал возвращать **0 сообщений** из базы данных.

## Симптомы

```
{"level":"info","message":"Retrieved messages from Evolution DB","messageCount":0}
{"level":"info","message":"Grouped messages by contact","contactCount":0}
```

Анализ возвращает пустой результат:
```json
{
  "total": 0,
  "analyzed": 0,
  "new_leads": 0,
  "hot": 0,
  "warm": 0,
  "cold": 0,
  "errors": 0
}
```

## Что было изменено

### 1. `services/agent-service/src/lib/evolutionDb.ts`
Добавлен необязательный параметр `maxContacts` в функцию `getInstanceMessages()`:

```typescript
export async function getInstanceMessages(instanceName: string, maxContacts?: number)
```

При указании `maxContacts` используется SQL запрос с CTE (Common Table Expression):

```sql
WITH instance_data AS (
  SELECT id FROM "Instance" WHERE name = $1
),
top_contacts AS (
  SELECT 
    "key"->>'remoteJid' as remote_jid,
    COUNT(*) as message_count
  FROM "Message"
  WHERE "instanceId" IN (SELECT id FROM instance_data)
  GROUP BY "key"->>'remoteJid'
  ORDER BY message_count DESC
  LIMIT $2
)
SELECT ... 
FROM "Message"
WHERE "instanceId" IN (SELECT id FROM instance_data)
  AND "key"->>'remoteJid' IN (SELECT remote_jid FROM top_contacts)
```

### 2. `services/agent-service/src/scripts/analyzeDialogs.ts`
- Добавлен параметр `maxContacts` в функцию `analyzeDialogs()`
- Добавлена поддержка 6-го CLI аргумента

### 3. `services/agent-service/src/routes/dialogs.ts`
- Добавлен `maxContacts` в Zod схему API endpoint

## Проверенные гипотезы

### ❌ Гипотеза 1: Дублирование параметров в SQL
**Проблема:** PostgreSQL параметр `$1` использовался дважды в запросе  
**Попытка исправления:** Передавали `[instanceName, instanceName, maxContacts]`  
**Результат:** Ошибка "prepared statement requires 2 parameters, got 3"  
**Вывод:** В PostgreSQL `$1` можно использовать многократно - это один параметр

### ❌ Гипотеза 2: Дефолтное значение maxContacts
**Проблема:** `maxContacts = 100` было установлено по умолчанию  
**Попытка исправления:** Убрали дефолт, сделали `maxContacts?: number`  
**Результат:** Даже без параметра (старый SQL) возвращает 0 сообщений  
**Вывод:** Проблема не в дефолтных значениях

### ❌ Гипотеза 3: Кеш Docker
**Проблема:** Docker мог использовать закешированный слой со старым кодом  
**Попытка исправления:** `docker-compose build --no-cache`  
**Результат:** Код обновился, но всё равно 0 сообщений  
**Вывод:** Проблема не в кеше

## Проблемные коммиты

| Коммит | Описание | Дата |
|--------|----------|------|
| `725b236` | feat: add maxContacts parameter to limit DB query for dialog analysis | 2025-11-03 |
| `e81f2af` | fix: pass instanceName twice in SQL query for maxContacts feature | 2025-11-03 |
| `af53f14` | fix: optimize SQL query with CTE for instance_data in maxContacts feature | 2025-11-03 |
| `9d71844` | fix: remove default value for maxContacts to use old SQL query by default | 2025-11-03 |

## Последний рабочий коммит

**Коммит:** `e245fad`  
**Сообщение:** fix: update base funnel scores for accurate lead temperature  
**Дата:** 2025-11-03

В этом коммите анализ работал корректно, загружал сообщения и анализировал диалоги.

## Команды для отката на сервере

```bash
cd ~/agents-monorepo

# Откатить Git на последний рабочий коммит
git checkout e245fad

# Пересобрать Docker образ без кеша
docker-compose build --no-cache agent-service

# Перезапустить сервис
docker-compose up -d agent-service

# Проверить что сервис запустился
docker-compose ps agent-service

# Запустить анализ
docker-compose exec agent-service npm run analyze-dialogs instance_0f559eb0_1761731171791 0f559eb0-53fa-4b6a-a51b-5d3e15e5864b
```

## TODO: Дальнейшая отладка

Когда будем возвращаться к этой проблеме, нужно:

1. **Проверить SQL запрос напрямую в базе данных:**
   ```bash
   docker-compose exec evolution-postgres psql -U evolution -d evolution
   ```
   
   Выполнить вручную новый SQL с CTE и проверить результаты.

2. **Добавить debug логирование:**
   - Логировать полный SQL запрос перед выполнением
   - Логировать параметры запроса
   - Логировать сырой результат от PostgreSQL

3. **Проверить права доступа:**
   - Возможно CTE создает проблемы с правами доступа
   - Попробовать простой JOIN вместо CTE

4. **Тестировать на локальной базе:**
   - Создать минимальный тестовый датасет
   - Отладить запрос локально перед деплоем

5. **Альтернативный подход:**
   Вместо оптимизации на уровне SQL, можно:
   - Загрузить все сообщения старым способом
   - Отфильтровать топ-N контактов в JavaScript коде
   - Это будет медленнее, но надежнее

## Связанные файлы

- `services/agent-service/src/lib/evolutionDb.ts`
- `services/agent-service/src/scripts/analyzeDialogs.ts`
- `services/agent-service/src/routes/dialogs.ts`
- `DIALOG_ANALYSIS_TEST_REPORT.md`
- `DIALOG_ANALYSIS_IMPLEMENTATION.md`

## Примечания

- Проблема воспроизводится стабильно
- Старый код (до добавления maxContacts) работает
- Instance `instance_0f559eb0_1761731171791` существует в базе
- SQL синтаксически корректен (нет ошибок при выполнении)
- Возможно проблема в логике CTE или специфике PostgreSQL версии





