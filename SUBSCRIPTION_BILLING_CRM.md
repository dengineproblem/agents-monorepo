# Subscription Billing + CRM

Документация по системе подписок, напоминаний об окончании тарифа, авто-отключению и CRM-интеграции продаж подписки.

## 1. Что реализовано

### База данных
Миграция: `migrations/190_subscription_billing_crm.sql`

Созданы таблицы:
- `crm_subscription_products` — каталог подписочных SKU
- `crm_subscription_sales` — продажи подписок/кастомных продуктов (отдельно от `purchases`)
- `crm_phone_user_links` — ручные связи `phone -> user_account_id`

Заполнены SKU:
- `SUB_1M` — 1 месяц, `49000 KZT`
- `SUB_3M` — 3 месяца, `99000 KZT`
- `SUB_12M` — 12 месяцев, `299000 KZT`

Расширен check-constraint `user_accounts_tarif_check`:
- добавлены `subscription_1m`, `subscription_3m`, `subscription_12m`

### Backend (CRM)
Сервис: `services/crm-backend/src/lib/subscriptionBilling.ts`

Реализовано:
- Применение подписки к `user_accounts` (`tarif`, `tarif_expires`, `tarif_renewal_cost`, `is_active=true`)
- Логика продления:
  - если текущий `tarif_expires` в будущем — продление от него
  - иначе старт от `user_accounts.created_at` (или `start_date`, если передан вручную)
- Напоминания о завершении тарифа: D-7, D-3, D-1
- Каналы уведомлений: in-app (`user_notifications`) + Telegram (`telegram_id`, `telegram_id_2..4`)
- Дедупликация отправки по дню через `notification_history`
- Авто-отключение просроченных: `is_active=false` + уведомление об истечении

### API (CRM backend)
Роуты: `services/crm-backend/src/routes/subscriptionBilling.ts`

Основные endpoint-ы:
- `GET /subscription/products`
- `GET /subscription/sales`
- `POST /subscription/sales`
- `POST /subscription/sales/:saleId/link-user` (tech admin)
- `POST /subscription/sales/:saleId/apply` (tech admin)
- `POST /admin/subscriptions/users/:userAccountId/set` (tech admin, ручная установка)
- `GET /admin/subscriptions/user-search` (tech admin)
- `GET /admin/subscriptions/phone-links` (tech admin)
- `POST /admin/subscriptions/phone-links` (tech admin)
- `POST /admin/subscriptions/run-jobs` (tech admin, ручной запуск sweep)

### Read-only режим
Файл: `services/crm-backend/src/middleware/consultantAuth.ts`

Поведение:
- Для mutating-запросов (`POST/PUT/PATCH/DELETE`) проверяется активность владельца аккаунта.
- Если `user_accounts.is_active=false` — запись блокируется с `403 READ_ONLY_MODE`.
- Tech admin не блокируется этим правилом.

### Cron
Файл: `services/crm-backend/src/cron/notificationCron.ts`

Добавлен hourly sweep подписок:
- Напоминания D-7/D-3/D-1
- Авто-деактивация просроченных

### CRM Frontend
Новая страница: `services/crm-frontend/src/pages/SubscriptionsPage.tsx`

Доступно в меню:
- `Консультации -> Подписки`

Функции страницы:
- Создание продажи (SKU и custom)
- Фильтрация и просмотр списка продаж
- Привязка продажи к пользователю (tech admin)
- Применение подписки по продаже (tech admin)
- Ручная установка подписки пользователю (tech admin)
- Поиск `phone -> user links`
- Ручной запуск sweep (tech admin)

## 2. Порядок запуска

1. Применить миграцию `190` в Supabase.
2. Перезапустить `crm-backend` и `crm-frontend`.
3. Открыть CRM frontend: раздел `Консультации -> Подписки`.
4. Проверить бизнес-флоу:
   - создать продажу
   - привязать к пользователю
   - применить
   - убедиться, что в `user_accounts` обновились `tarif`, `tarif_expires`, `is_active`

## 3. Бизнес-правила (зафиксировано)

- Тарифная модель: `1/3/12 месяцев`.
- Продление: от текущего `tarif_expires`, если он в будущем.
- Если не в будущем: старт от `user_accounts.created_at` (или ручной `start_date`).
- Grace period: нет.
- При просрочке: сразу `is_active=false`.
- Неактивный пользователь: режим read-only.
- Каналы уведомлений: Telegram + in-app.
- Продажи подписки хранятся отдельно от `purchases`.
- Телефон может соответствовать нескольким users; выбор целевого user делает только tech admin.

## 4. Что еще нужно для полного продакшн-контура

- Сквозная read-only блокировка во всех остальных сервисах/эндпоинтах продукта (вне CRM backend).
- UI-ограничения на основном frontend для неактивных пользователей (глобальный баннер + блокировки действий).
- One-time backfill актуальных дат подписок через ваш SQL-файл с исходными данными.

## 5. Файлы изменений

- `migrations/190_subscription_billing_crm.sql`
- `services/crm-backend/src/lib/subscriptionBilling.ts`
- `services/crm-backend/src/routes/subscriptionBilling.ts`
- `services/crm-backend/src/middleware/consultantAuth.ts`
- `services/crm-backend/src/cron/notificationCron.ts`
- `services/crm-backend/src/server.ts`
- `services/crm-backend/src/routes/consultantSales.ts`
- `services/crm-frontend/src/types/subscription.ts`
- `services/crm-frontend/src/services/subscriptionApi.ts`
- `services/crm-frontend/src/pages/SubscriptionsPage.tsx`
- `services/crm-frontend/src/App.tsx`
- `services/crm-frontend/src/components/Sidebar.tsx`
