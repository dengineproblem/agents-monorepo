# ⏰ Время работы кампаний

## Как работает время в созданных кампаниях

### ✅ По умолчанию (как при дублировании)

При создании кампании через `create_campaign_with_creative`:

```javascript
{
  "daily_budget_cents": 100000,  // Используем daily_budget
  // НЕ указываем start_time и end_time
}
```

**Результат:**
- ⏰ **Начало:** СРАЗУ при активации кампании
- ⏰ **Конец:** БЕССРОЧНО (работает пока не остановишь или не закончится бюджет)

Это **идентично** тому, как работает дублирование кампаний!

### 📅 Логика времени в Facebook API

#### Daily Budget (ежедневный бюджет)
```javascript
{
  "daily_budget": 100000,
  // start_time и end_time НЕ указываются!
}
```
✅ Кампания начинается **сразу** при переводе в `ACTIVE`  
✅ Работает **бессрочно**

#### Lifetime Budget (общий бюджет на период)
```javascript
{
  "lifetime_budget": 1000000,
  "start_time": "2025-10-06T00:00:00+0600",  // Обязательно!
  "end_time": "2025-10-13T23:59:59+0600"     // Обязательно!
}
```
⚠️ Требуются start_time и end_time

## Параметр `auto_activate`

### По умолчанию: создается в PAUSED

```javascript
{
  "action": "create_campaign_with_creative",
  "params": {
    "campaign_name": "Новая кампания",
    "daily_budget_cents": 100000
    // auto_activate не указан = false
  }
}
```

**Результат:**
- Campaign: `status: PAUSED`
- AdSet: `status: PAUSED`
- Ad: `status: PAUSED`

Агент создал структуру, но **НЕ запустил**. Агент должен сам принять решение о запуске.

### Автоматическая активация

```javascript
{
  "action": "create_campaign_with_creative",
  "params": {
    "campaign_name": "Новая кампания",
    "daily_budget_cents": 100000,
    "auto_activate": true  // ✅ Сразу активируем!
  }
}
```

**Результат:**
- Campaign: `status: ACTIVE` ✅
- AdSet: `status: ACTIVE` ✅
- Ad: `status: ACTIVE` ✅

Кампания **СРАЗУ** начинает показы!

## Сценарии использования агентом

### 🌅 Утренний запуск (типичный)

Агент работает утром и создает кампанию:

```javascript
// Утро, 9:00 - агент создает кампанию
{
  "action": "create_campaign_with_creative",
  "params": {
    "campaign_name": "Кампания 06.10.2025",
    "objective": "WhatsApp",
    "daily_budget_cents": 50000,
    "auto_activate": true  // Сразу запускаем!
  }
}
```

**Timeline:**
- `09:00` - Кампания создана и **АКТИВНА**
- `09:01` - Первые показы начались ✅
- `09:00 следующего дня` - Новый дневной бюджет
- `...` - Работает пока агент не остановит

### 📝 Подготовка заранее (редко)

Агент создает кампанию заранее, но НЕ активирует:

```javascript
{
  "action": "create_campaign_with_creative",
  "params": {
    "campaign_name": "Будущая кампания",
    "daily_budget_cents": 50000
    // auto_activate = false (по умолчанию)
  }
}
```

**Позже агент активирует:**
```javascript
{
  "action": "update_campaign",
  "params": {
    "campaign_id": "123456",
    "status": "ACTIVE"
  }
}
```

## Сравнение с дублированием

### Дублирование кампании
```javascript
// Исходная кампания с daily_budget
{
  "daily_budget": 100000,
  "status": "ACTIVE"
  // start_time и end_time НЕ копируются при daily_budget!
}

// Дубликат
{
  "daily_budget": 100000,
  "status": "PAUSED",
  // start_time и end_time отсутствуют
  // При активации: начнет работать СРАЗУ
}
```

### Создание новой кампании
```javascript
// Создаем новую
{
  "daily_budget_cents": 100000,
  "auto_activate": false
  // start_time и end_time НЕ указываем
}

// Результат ИДЕНТИЧЕН дубликату!
{
  "daily_budget": 100000,
  "status": "PAUSED"
  // При активации: начнет работать СРАЗУ
}
```

✅ **Полностью идентичное поведение!**

## Важные моменты

### 1. Время в таймзоне ad account

Facebook использует часовой пояс, установленный для ad account:

```javascript
// Проверить timezone ad account
GET /act_{ad_account_id}?fields=timezone_name
// Например: "Asia/Almaty" (UTC+6)
```

### 2. Начало дня бюджета

При `daily_budget` новый бюджет начинается в **00:00** по часовому поясу ad account.

**Пример:**
- Timezone: `Asia/Almaty` (UTC+6)
- Активация: `14:30` (06.10.2025)
- Первый день бюджета: `14:30-23:59` (06.10.2025)
- Второй день бюджета: `00:00-23:59` (07.10.2025)

### 3. Статус PAUSED vs ACTIVE

#### PAUSED
- Не показывается
- Не тратит бюджет
- Можно редактировать без ограничений

#### ACTIVE
- Показывается аудитории
- Тратит бюджет
- Некоторые изменения сбрасывают обучение

### 4. Learning Phase (фаза обучения)

При первом запуске или после значительных изменений:
- Facebook обучает алгоритм ~50 конверсий
- В это время CPL может быть выше
- После обучения - стабилизируется

## Рекомендации для агента

### ✅ Рекомендуется

1. **Использовать `auto_activate: true`** при утреннем запуске
   - Агент работает утром
   - Кампания начинает сразу
   - Не теряем время

2. **Daily budget** для всех кампаний
   - Проще управлять
   - Нет необходимости указывать даты
   - Можно остановить в любой момент

3. **Единая структура**
   - Campaign → AdSet → Ad
   - Все в PAUSED или все в ACTIVE
   - Проще мониторить

### ❌ Не рекомендуется

1. **Lifetime budget без крайней необходимости**
   - Требует указания дат
   - Сложнее управлять
   - Используется для специальных акций

2. **Смешанные статусы**
   - Campaign: ACTIVE, AdSet: PAUSED
   - Создает путаницу

3. **Частые изменения активных кампаний**
   - Сбрасывает обучение
   - Повышает CPL

## Примеры от агента

### Пример 1: Стандартный утренний запуск

```json
{
  "action": "create_campaign_with_creative",
  "params": {
    "user_creative_id": "uuid-креатива",
    "objective": "WhatsApp",
    "campaign_name": "WhatsApp - Новое видео - 06.10.2025",
    "daily_budget_cents": 50000,
    "use_default_settings": true,
    "auto_activate": true
  }
}
```

**Агент думает:**
> "Утро, 9:00. Получил новое видео. Создаю кампанию с дефолтными настройками таргетинга. Бюджет 500₽/день. Активирую сразу. Первые показы пойдут через 5-10 минут после модерации."

### Пример 2: Подготовка на выходные

```json
{
  "action": "create_campaign_with_creative",
  "params": {
    "user_creative_id": "uuid",
    "objective": "Instagram",  
    "campaign_name": "Instagram - Подготовка",
    "daily_budget_cents": 30000,
    "auto_activate": false
  }
}

// Позже в понедельник утром:
{
  "action": "activate_campaign",
  "campaign_id": "created_campaign_id"
}
```

**Агент думает:**
> "Пятница вечер. Готовлю кампанию на понедельник. Создаю в PAUSED. В понедельник утром активирую если метрики прошлой недели хорошие."

## Мониторинг времени

Агент может проверять когда кампания начала работать:

```javascript
GET /act_{ad_account_id}/insights?fields=date_start,impressions
// date_start - первая дата показов
```

---

**Документация обновлена:** 05.10.2025  
**Версия:** 1.0.0
