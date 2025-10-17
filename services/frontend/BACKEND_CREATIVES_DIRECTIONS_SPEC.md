# Спецификация для бэкенд-разработчика: Связь креативов с направлениями

## 📍 Что изменилось

Теперь при загрузке видео/изображения фронтенд передает `direction_id` - ID направления бизнеса, к которому относится этот креатив.

---

## 🗄️ База данных

### Таблица `user_creatives`

Добавлена колонка:
```sql
ALTER TABLE user_creatives 
ADD COLUMN direction_id UUID REFERENCES account_directions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_creatives_direction ON user_creatives(direction_id) WHERE direction_id IS NOT NULL;

COMMENT ON COLUMN user_creatives.direction_id IS 'Направление бизнеса, к которому относится этот креатив (опционально)';
```

**Важно:**
- `direction_id` - **опциональное** поле (может быть `NULL`)
- При удалении направления креативы остаются, но `direction_id` становится `NULL` (`ON DELETE SET NULL`)

---

## 🔌 Изменения в N8N Webhooks

Все webhook'и для загрузки креативов теперь получают дополнительный параметр:

### Webhooks:
1. `https://n8n.performanteaiagency.com/webhook/downloadvideo` (WhatsApp видео)
2. `https://n8n.performanteaiagency.com/webhook/instagram-traffic` (Instagram Traffic видео)
3. `https://n8n.performanteaiagency.com/webhook/website-leads` (Site Leads видео)
4. `https://n8n.performanteaiagency.com/webhook/tiktok-video` (TikTok видео)
5. `https://n8n.performanteaiagency.com/webhook/image` (Изображения)

### Новый параметр в FormData:

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `direction_id` | UUID | ❌ Опционально | ID направления из таблицы `account_directions` |

### Пример FormData:
```javascript
{
  user_id: "uuid-пользователя",
  direction_id: "uuid-направления", // ← НОВОЕ
  instagram_id: "...",
  page_access_token: "...",
  campaign_name: "Новое объявление",
  ad_text: "Текст под видео",
  // ... остальные параметры
}
```

---

## 🔨 Что нужно сделать

### 1. Выполнить SQL миграцию

Запустите файл:
```bash
\i add_direction_to_creatives.sql
```

Или выполните SQL из файла в Supabase SQL Editor.

### 2. Обновить N8N Workflows

В каждом из 5 webhook'ов выше:

**ШАГ 1: Принять `direction_id` из FormData**
```javascript
const directionId = $input.all()[0].json.direction_id || null;
```

**ШАГ 2: При создании записи в `user_creatives` добавить `direction_id`**

**Было:**
```javascript
await supabase
  .from('user_creatives')
  .insert({
    user_id: userId,
    title: campaignName,
    fb_video_id: videoId,
    // ...
  });
```

**Стало:**
```javascript
await supabase
  .from('user_creatives')
  .insert({
    user_id: userId,
    title: campaignName,
    fb_video_id: videoId,
    direction_id: directionId, // ← НОВОЕ
    // ...
  });
```

### 3. Валидация (опционально)

Если `direction_id` передан, можно проверить:
1. Направление существует
2. Направление принадлежит этому пользователю
3. `objective` направления соответствует типу креатива

Пример:
```javascript
if (directionId) {
  const { data: direction } = await supabase
    .from('account_directions')
    .select('user_account_id, objective')
    .eq('id', directionId)
    .single();
  
  if (!direction || direction.user_account_id !== userId) {
    throw new Error('Invalid direction_id');
  }
  
  // Опционально: проверить objective
  if (campaignGoal !== direction.objective) {
    console.warn('Campaign goal mismatch:', campaignGoal, '!==', direction.objective);
  }
}
```

---

## 📝 Примеры

### Пример 1: Загрузка видео с направлением

**FormData отправляется фронтендом:**
```
user_id=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b
direction_id=d152dc91-da79-4d82-946c-9f4bfbe1f7cd
campaign_name=Имплантация зубов
ad_text=Напишите нам в WhatsApp
video_file=<binary data>
...
```

**N8N workflow создает запись:**
```javascript
await supabase.from('user_creatives').insert({
  user_id: '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  direction_id: 'd152dc91-da79-4d82-946c-9f4bfbe1f7cd', // ← связь с направлением
  title: 'Имплантация зубов',
  fb_video_id: '123456789',
  status: 'processing',
  // ...
});
```

### Пример 2: Загрузка без направления

Если пользователь не выбрал направление, `direction_id` не передается или передается пустая строка:

**FormData:**
```
user_id=0f559eb0-53fa-4b6a-a51b-5d3e15e5864b
campaign_name=Новое объявление
video_file=<binary data>
...
```

**N8N workflow создает запись:**
```javascript
await supabase.from('user_creatives').insert({
  user_id: '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b',
  direction_id: null, // ← нет связи с направлением
  title: 'Новое объявление',
  // ...
});
```

---

## ✅ Чеклист

- [ ] Выполнена SQL миграция `add_direction_to_creatives.sql`
- [ ] Обновлен webhook `/webhook/downloadvideo` (WhatsApp)
- [ ] Обновлен webhook `/webhook/instagram-traffic`
- [ ] Обновлен webhook `/webhook/website-leads`
- [ ] Обновлен webhook `/webhook/tiktok-video`
- [ ] Обновлен webhook `/webhook/image`
- [ ] Протестировано создание креатива С направлением
- [ ] Протестировано создание креатива БЕЗ направления

---

## 🚨 Важно

1. **Обратная совместимость:** Если `direction_id` не передан или пустой - это нормально, сохраняем `NULL`.
2. **Каскадное удаление:** При удалении направления креативы НЕ удаляются, только `direction_id` становится `NULL`.
3. **Опциональное поле:** Пользователь может не выбирать направление - это нормальный сценарий.

---

## 📞 Вопросы

Если возникнут вопросы по интеграции - обращайтесь к фронтенд-разработчику.

