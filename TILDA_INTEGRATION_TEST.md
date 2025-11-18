# Тестирование интеграции Tilda с AmoCRM

Руководство по тестированию новой функциональности маппинга лидов с Tilda через ad_id.

## 📋 Что тестируется

1. **Прием webhook от Tilda** с ad_id в utm_content
2. **Маппинг к креативу** через таблицу ad_creative_mapping
3. **Сохранение лида** с source_id, creative_id, direction_id
4. **Работа без ad_id** (graceful degradation)

## 🚀 Быстрый старт

### Вариант 1: Простой тест (рекомендуется)

```bash
# Шаг 1: Убедитесь что API запущен
docker-compose up -d agent-service

# Шаг 2: Создайте тестовые данные в БД (один раз)
psql $DATABASE_URL -f test-tilda-setup.sql

# Шаг 3: Запустите тест
chmod +x test-tilda-simple.sh
./test-tilda-simple.sh
```

### Вариант 2: Полный тест с пошаговой проверкой

```bash
chmod +x test-tilda-integration.sh
./test-tilda-integration.sh
```

## 📦 Подготовка

### 1. Настройка переменных окружения

```bash
export API_URL="http://localhost:8082"
export USER_ACCOUNT_ID="your-user-account-id"
export TEST_AD_ID="test_tilda_ad_123456"
```

### 2. Создание тестовых данных в БД

Выполните SQL скрипт для создания тестовых данных:

```bash
# Через psql
psql $DATABASE_URL -f test-tilda-setup.sql

# Или через Supabase SQL Editor
# Скопируйте содержимое test-tilda-setup.sql
```

Скрипт создаст:
- ✅ Тестовое направление (test-tilda-direction-id)
- ✅ Тестовый креатив (test-tilda-creative-id)
- ✅ Маппинг ad_id → creative (в ad_creative_mapping)

### 3. Проверка что данные созданы

```sql
-- Проверить маппинг
SELECT ad_id, user_creative_id, direction_id 
FROM ad_creative_mapping 
WHERE ad_id = 'test_tilda_ad_123456';
```

## 🧪 Запуск тестов

### Тест 1: Лид с ad_id (должен смаппиться)

```bash
curl -X POST http://localhost:8082/leads \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "name": "Тест Иванов",
    "phone": "+79991234567",
    "email": "test@example.com",
    "utm_source": "tilda",
    "utm_medium": "website",
    "utm_content": "test_tilda_ad_123456"
  }'
```

**Ожидаемый результат:**
```json
{
  "success": true,
  "leadId": 123,
  "message": "Lead received successfully"
}
```

**Проверка в БД:**
```sql
SELECT id, name, phone, source_id, creative_id, direction_id
FROM leads
WHERE phone = '+79991234567';
```

Должно быть:
- `source_id` = `'test_tilda_ad_123456'`
- `creative_id` = `'test-tilda-creative-id'`
- `direction_id` = `'test-tilda-direction-id'`

### Тест 2: Лид без ad_id (должен сохраниться без маппинга)

```bash
curl -X POST http://localhost:8082/leads \
  -H "Content-Type: application/json" \
  -d '{
    "userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b",
    "name": "Тест Петров",
    "phone": "+79997654321",
    "utm_source": "tilda",
    "utm_campaign": "no_ad_id_campaign"
  }'
```

**Ожидаемый результат:**
- Лид создается успешно
- `source_id` = `NULL`
- `creative_id` = `NULL`
- `direction_id` = `NULL`

## 🔍 Проверка результатов

### Проверка в логах API

```bash
# Логи agent-service
docker-compose logs -f agent-service | grep "Resolved creative"

# Должны увидеть:
# "Resolved creative from ad_id for Tilda lead"
# sourceId: "test_tilda_ad_123456"
# creativeId: "test-tilda-creative-id"
# directionId: "test-tilda-direction-id"
```

### Проверка в базе данных

```sql
-- Все лиды с тестовым ad_id
SELECT 
  id,
  name,
  phone,
  source_type,
  source_id,
  creative_id,
  direction_id,
  utm_content,
  created_at
FROM leads
WHERE source_id = 'test_tilda_ad_123456'
ORDER BY created_at DESC;

-- Статистика маппинга
SELECT 
  CASE 
    WHEN creative_id IS NOT NULL THEN 'Mapped'
    ELSE 'Not Mapped'
  END as mapping_status,
  COUNT(*) as count
FROM leads
WHERE source_type = 'website'
GROUP BY mapping_status;
```

## 🧹 Очистка тестовых данных

### Вариант 1: Через SQL скрипт

```bash
psql $DATABASE_URL -f test-tilda-cleanup.sql
```

### Вариант 2: Вручную

```sql
-- Удалить тестовые лиды
DELETE FROM leads 
WHERE source_id = 'test_tilda_ad_123456' 
   OR creative_id = 'test-tilda-creative-id';

-- Удалить тестовый маппинг
DELETE FROM ad_creative_mapping 
WHERE ad_id = 'test_tilda_ad_123456';

-- Удалить тестовый креатив
DELETE FROM user_creatives 
WHERE id = 'test-tilda-creative-id';

-- Удалить тестовое направление
DELETE FROM account_directions 
WHERE id = 'test-tilda-direction-id';
```

## 🎯 Тестирование реального флоу

### 1. Создать реальную рекламу в Facebook

```bash
# В вашем коде при создании рекламы ad_id автоматически сохраняется в ad_creative_mapping
# Например, через направление или тест креатива
```

### 2. Настроить UTM в Facebook Ads

В настройках объявления:
```
URL Parameters: utm_source=tilda&utm_medium=website&utm_content={{ad.id}}
```

### 3. Настроить webhook в Tilda

В Tilda:
1. Настройки сайта → Формы → Webhook
2. URL: `https://your-domain.com/api/leads`
3. ✅ Включить "Посылать Cookie"

### 4. Тестовая отправка формы

1. Откройте страницу Tilda с формой
2. Перейдите по ссылке с UTM параметрами:
   ```
   https://your-tilda.site/?utm_content=REAL_AD_ID
   ```
3. Заполните форму и отправьте
4. Проверьте что лид появился в БД с правильным creative_id

## 📊 Мониторинг в production

### Запросы для мониторинга

```sql
-- Лиды с маппингом за сегодня
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_leads,
  COUNT(creative_id) as mapped_leads,
  ROUND(100.0 * COUNT(creative_id) / COUNT(*), 2) as mapping_rate
FROM leads
WHERE source_type = 'website'
  AND created_at >= CURRENT_DATE
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- Топ креативов по лидам с Tilda
SELECT 
  c.title as creative_name,
  d.name as direction_name,
  COUNT(l.id) as leads_count
FROM leads l
JOIN user_creatives c ON l.creative_id = c.id
JOIN account_directions d ON l.direction_id = d.id
WHERE l.source_type = 'website'
  AND l.created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY c.id, c.title, d.name
ORDER BY leads_count DESC
LIMIT 10;
```

## ❓ Troubleshooting

### Проблема: Лид создается но creative_id = NULL

**Причина:** Маппинг не найден в ad_creative_mapping

**Решение:**
1. Проверьте что ad_id есть в таблице:
   ```sql
   SELECT * FROM ad_creative_mapping WHERE ad_id = 'YOUR_AD_ID';
   ```
2. Убедитесь что UTM параметр передается правильно:
   ```sql
   SELECT source_id, utm_content FROM leads WHERE id = YOUR_LEAD_ID;
   ```

### Проблема: API возвращает 400 ошибку

**Причина:** Неверная валидация данных

**Решение:**
1. Проверьте обязательные поля: userAccountId, name, phone
2. Убедитесь что phone в правильном формате: `+7XXXXXXXXXX`
3. Проверьте логи API: `docker-compose logs agent-service`

### Проблема: Webhook от Tilda не работает

**Причина:** URL недоступен или неправильно настроен

**Решение:**
1. Проверьте что домен доступен извне
2. Убедитесь что используется HTTPS
3. Проверьте что путь правильный: `/api/leads` (не `/leads`)
4. Тест через curl с вашего сервера:
   ```bash
   curl -X POST https://your-domain.com/api/leads \
     -H "Content-Type: application/json" \
     -d '{"userAccountId":"...", "name":"Test", "phone":"+79991234567"}'
   ```

## 📚 Связанные файлы

- `services/agent-service/src/lib/creativeResolver.ts` - Основная логика резолвинга
- `services/agent-service/src/routes/leads.ts` - Endpoint для приема лидов
- `migrations/026_ad_creative_mapping.sql` - Структура таблицы маппинга
- `AMOCRM_INTEGRATION.md` - Общая документация по интеграции



