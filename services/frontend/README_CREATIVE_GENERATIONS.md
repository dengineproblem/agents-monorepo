# Система лимитов генерации креативов

## Обзор
Реализована система лимитов для генерации креативов с помощью AI. Теперь пользователи могут генерировать креативы только в пределах доступного лимита.

## Компоненты системы

### 1. База данных
- **Новая колонка**: `creative_generations_available` в таблице `user_accounts`
- **Тип**: INTEGER DEFAULT 0
- **Описание**: Количество доступных генераций для пользователя

### 2. Функциональность
- **Проверка лимита**: Перед генерацией креатива проверяется доступность генераций
- **Уменьшение счетчика**: После успешной генерации счетчик уменьшается на 1
- **Блокировка**: Кнопка генерации неактивна при нулевом лимите

### 3. UI/UX
- **Уведомление**: Показывает количество доступных генераций
- **Статус**: Информирует о возможности генерации или необходимости покупки пакета
- **Блокировка кнопки**: Кнопка "Сгенерировать креатив" неактивна при лимите = 0

## Установка

### Шаг 1: Добавить колонку в базу данных
```sql
-- Выполните SQL из файла add_creative_generations_limit.sql
ALTER TABLE user_accounts 
ADD COLUMN creative_generations_available INTEGER DEFAULT 0;
```

### Шаг 2: Установить начальные значения
```sql
-- Выполните SQL из файла setup_creative_generations_demo.sql
UPDATE user_accounts 
SET creative_generations_available = 3 
WHERE creative_generations_available = 0 OR creative_generations_available IS NULL;
```

## Управление лимитами

### Для администраторов
Вы можете вручную изменять лимиты пользователей:

```sql
-- Добавить 10 генераций пользователю
UPDATE user_accounts 
SET creative_generations_available = creative_generations_available + 10 
WHERE id = 'USER_ID';

-- Установить точное количество генераций
UPDATE user_accounts 
SET creative_generations_available = 20 
WHERE id = 'USER_ID';

-- Обнулить генерации (заблокировать)
UPDATE user_accounts 
SET creative_generations_available = 0 
WHERE id = 'USER_ID';
```

### Проверка статуса
```sql
-- Посмотреть всех пользователей с их лимитами
SELECT username, creative_generations_available 
FROM user_accounts 
ORDER BY creative_generations_available DESC;

-- Найти пользователей с нулевым лимитом
SELECT username, creative_generations_available 
FROM user_accounts 
WHERE creative_generations_available = 0;
```

## Бизнес-логика

### Пакеты генераций
Вы можете создать различные пакеты:
- **Бесплатный**: 3 генерации
- **Базовый**: 10 генераций
- **Премиум**: 25 генераций
- **Безлимитный**: 999 генераций

### Пополнение лимитов
При покупке пакета увеличивайте лимит:
```sql
UPDATE user_accounts 
SET creative_generations_available = creative_generations_available + BOUGHT_AMOUNT 
WHERE id = 'USER_ID';
```

## Особенности реализации

### Проверка лимита
- Выполняется перед началом генерации
- Показывает ошибку при превышении лимита
- Блокирует кнопку при нулевом лимите

### Обновление счетчика
- Происходит только после успешной генерации
- Обновляется в базе данных и в UI
- Логирует операцию в консоль

### Пользовательский интерфейс
- Уведомление сверху страницы с количеством доступных генераций
- Правильное склонение слов (1 креатив, 2 креатива, 5 креативов)
- Информативные сообщения об ошибках

## Расширения

### Возможные улучшения:
1. **История использования**: Логирование каждой генерации
2. **Автоматическое пополнение**: Интеграция с платежными системами
3. **Уведомления**: Email/SMS при истечении лимита
4. **Админ-панель**: Веб-интерфейс для управления лимитами
5. **Промо-коды**: Система промо-кодов для бесплатных генераций

### Аналитика:
```sql
-- Общее количество доступных генераций
SELECT SUM(creative_generations_available) as total_available 
FROM user_accounts;

-- Средний лимит на пользователя
SELECT AVG(creative_generations_available) as average_limit 
FROM user_accounts;

-- Распределение лимитов
SELECT creative_generations_available, COUNT(*) as users_count 
FROM user_accounts 
GROUP BY creative_generations_available 
ORDER BY creative_generations_available;
``` 