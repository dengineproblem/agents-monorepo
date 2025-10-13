# ✅ Исправлено: direction_id теперь сохраняется при загрузке креативов

## Проблема

Фронтенд отправлял `direction_id` в FormData на webhook `/process-video`, но в таблице `user_creatives` поле `direction_id` оставалось `null`.

---

## Решение

Обновлён файл `services/agent-service/src/routes/video.ts`:

### 1. Добавлен `direction_id` в схему валидации

```typescript
const ProcessVideoSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().optional(),
  description: z.string().optional(),
  language: z.string().default('ru'),
  client_question: z.string().optional(),
  site_url: z.string().url().optional(),
  utm: z.string().optional(),
  direction_id: z.string().uuid().optional() // ← ДОБАВЛЕНО! Опционально для legacy
});
```

### 2. `direction_id` сохраняется в БД при создании креатива

```typescript
const { data: creative, error: creativeError } = await supabase
  .from('user_creatives')
  .insert({
    user_id: body.user_id,
    title: body.title || 'Untitled Creative',
    status: 'processing',
    direction_id: body.direction_id || null // ← ДОБАВЛЕНО! null для legacy
  })
  .select()
  .single();
```

### 3. Добавлено логирование для отладки

```typescript
app.log.info(`Processing video for user_id: ${body.user_id}, direction_id: ${body.direction_id || 'null (legacy)'}`);
```

---

## Что изменилось

### До:
```javascript
// Фронтенд отправляет
FormData: {
  user_id: "uuid",
  title: "Акция на имплантацию",
  direction_id: "direction-uuid",  // ← Игнорировалось!
  file: video.mp4
}

// Backend сохранял
INSERT INTO user_creatives (user_id, title, status)
VALUES ('uuid', 'Акция на имплантацию', 'processing')
// direction_id = null ❌
```

### После:
```javascript
// Фронтенд отправляет
FormData: {
  user_id: "uuid",
  title: "Акция на имплантацию",
  direction_id: "direction-uuid",  // ← Теперь обрабатывается!
  file: video.mp4
}

// Backend сохраняет
INSERT INTO user_creatives (user_id, title, status, direction_id)
VALUES ('uuid', 'Акция на имплантацию', 'processing', 'direction-uuid')
// direction_id = 'direction-uuid' ✅
```

---

## Обратная совместимость

✅ **Legacy-клиенты (без направлений) продолжают работать:**

```javascript
// Если фронтенд НЕ отправляет direction_id
FormData: {
  user_id: "uuid",
  title: "Старый креатив",
  file: video.mp4
  // direction_id отсутствует
}

// Backend сохранит
direction_id: null  // ← Корректно для legacy!
```

---

## Тестирование

### Локально (TypeScript):
```bash
cd services/agent-service
npx tsc --noEmit
# ✅ Exit code: 0 (без ошибок)
```

### После деплоя:

#### Тест 1: С направлением
```bash
curl -X POST http://localhost:8082/process-video \
  -F "user_id=YOUR_UUID" \
  -F "title=Тест с направлением" \
  -F "direction_id=DIRECTION_UUID" \
  -F "file=@test-video.mp4"

# Проверить в БД:
SELECT id, title, direction_id FROM user_creatives 
WHERE title = 'Тест с направлением';

# Ожидаем: direction_id = 'DIRECTION_UUID' ✅
```

#### Тест 2: Без направления (legacy)
```bash
curl -X POST http://localhost:8082/process-video \
  -F "user_id=YOUR_UUID" \
  -F "title=Тест без направления" \
  -F "file=@test-video.mp4"

# Проверить в БД:
SELECT id, title, direction_id FROM user_creatives 
WHERE title = 'Тест без направления';

# Ожидаем: direction_id = null ✅
```

#### Тест 3: Проверить логи
```bash
docker logs -f agents-monorepo-agent-service-1 | grep "direction_id"

# Ожидаем:
# Processing video for user_id: xxx, direction_id: DIRECTION_UUID
# или
# Processing video for user_id: xxx, direction_id: null (legacy)
```

---

## Деплой

### На сервере:
```bash
# 1. Зайти на сервер
ssh root@147.182.186.15

# 2. Перейти в проект
cd ~/agents-monorepo

# 3. Pull изменений
git pull origin main

# 4. Пересобрать agent-service
docker-compose build agent-service

# 5. Перезапустить
docker-compose up -d agent-service

# 6. Проверить логи
docker logs -f agents-monorepo-agent-service-1

# Ожидаем: "agent-service started on port 8082"
```

### Проверить на production:
```bash
# Загрузить тестовый креатив через фронтенд
# Проверить в Supabase что direction_id сохранился
```

---

## Статус

✅ **Код обновлён**
✅ **TypeScript компилируется без ошибок**
✅ **Обратная совместимость с legacy**
✅ **Логирование добавлено для отладки**
⏳ **Ждёт деплоя на сервер**
⏳ **Ждёт тестирования на production**

---

## Для фронтенда

**Ничего менять не нужно!** Если фронтенд уже отправляет `direction_id` в FormData, то после деплоя backend начнёт его корректно сохранять.

**Формат запроса (уже используется):**
```javascript
const formData = new FormData();
formData.append('user_id', userAccountId);
formData.append('title', title);
formData.append('direction_id', selectedDirectionId); // ← Теперь сохраняется!
formData.append('file', videoFile);

await fetch('https://agents.performanteaiagency.com/process-video', {
  method: 'POST',
  body: formData
});
```

✅ **Готово к деплою!**

