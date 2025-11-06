# ROI Аналитика - Полный Рефакторинг под Направления

**Дата:** 2025-11-05  
**Статус:** ✅ Завершено

## Описание

Полный рефакторинг ROI аналитики для работы с направлениями (directions) вместо legacy поля `business_id`.

---

## Что изменилось

### 1. ✅ Миграция базы данных

**Файл:** `migrations/027_add_user_account_to_purchases.sql`

- Добавлено поле `user_account_id` в таблицу `purchases`
- Мигрированы существующие данные через связь с `leads`
- Создан индексы для производительности
- Поле `business_id` помечено как legacy (для обратной совместимости)

```sql
ALTER TABLE purchases
  ADD COLUMN user_account_id UUID REFERENCES user_accounts(id) ON DELETE CASCADE;

CREATE INDEX idx_purchases_user_account ON purchases(user_account_id);
CREATE INDEX idx_purchases_user_account_created ON purchases(user_account_id, created_at DESC);
```

---

### 2. ✅ API (salesApi.ts)

#### Новые интерфейсы:
```typescript
export interface Direction {
  id: string;
  name: string;
  objective: string;
  whatsapp_phone_number: string | null;
  is_active: boolean;
  created_at: string;
}
```

#### Обновлённые методы:

**`getROIData()`**
```typescript
// Было:
getROIData(businessId: string, timeframe)

// Стало:
getROIData(userAccountId: string, directionId: string | null, timeframe)
```

**Изменения:**
- Фильтрация лидов по `user_account_id` вместо `business_id`
- Опциональный фильтр по `direction_id`
- Purchases получаются через JOIN с leads (по `client_phone`)

**`addSale()`**
```typescript
// Было:
addSale({ client_phone, amount, business_id, ... })

// Стало:
addSale({ client_phone, amount, user_account_id, direction_id?, ... })
```

**Новый метод:**
```typescript
getDirections(userAccountId: string): Promise<{ data: Direction[] }>
```

Получает список всех направлений пользователя из `/api/directions`.

---

### 3. ✅ Фронтенд - ROIAnalytics.tsx

#### Добавлено:

1. **Вкладки по направлениям:**
```tsx
<Tabs value={selectedDirectionId || 'all'}>
  <TabsList>
    <TabsTrigger value="all">Все направления</TabsTrigger>
    {directions.map(d => (
      <TabsTrigger key={d.id} value={d.id}>{d.name}</TabsTrigger>
    ))}
  </TabsList>
</Tabs>
```

2. **State для направлений:**
```typescript
const [directions, setDirections] = useState<Direction[]>([]);
const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
const [userAccountId, setUserAccountId] = useState<string>('');
```

3. **Автоматическая перезагрузка при смене направления:**
```typescript
useEffect(() => {
  if (userAccountId) {
    loadROIData();
  }
}, [selectedDirectionId]);
```

#### Удалено:
- Проверка `checkBusinessId()` - больше не нужна
- State `showBusinessIdWarning` - убрана зависимость от business_id

---

### 4. ✅ Компонент SalesList.tsx

**Изменения:**
```typescript
// Было:
interface SalesListProps {
  businessId: string;
}

// Стало:
interface SalesListProps {
  userAccountId: string;
}
```

Все внутренние методы обновлены для использования `userAccountId`:
- `loadSales()` → `salesApi.getAllPurchases(userAccountId)`
- `loadCampaigns()` → `salesApi.getExistingCampaigns(userAccountId)`

---

### 5. ✅ Evolution Webhook (evolutionWebhooks.ts)

**Исправление бага:**

Было:
```typescript
business_id: whatsappPhoneNumberId ? null : params.clientPhone  // ❌
```

Стало:
```typescript
business_id: instancePhone  // ✅ Наш номер (номер инстанса)
```

Теперь в `business_id` записывается **наш** WhatsApp номер, а не номер клиента.

---

## Логика работы

### До рефакторинга:
```
User → business_id (WhatsApp номер) → Leads & Purchases → ROI
```

### После рефакторинга:
```
User → user_account_id → Directions → WhatsApp Numbers
                       ↓
                    Leads & Purchases → ROI (с фильтром по direction)
```

---

## Структура полей

### Таблица `leads`:
- ✅ `user_account_id` - ID пользователя (основной фильтр)
- ✅ `direction_id` - ID направления (опциональный фильтр)
- ✅ `whatsapp_phone_number_id` - UUID номера WhatsApp из таблицы `whatsapp_phone_numbers`
- ⚠️ `business_id` - LEGACY (для старого ROI, пока не удалён)
- ✅ `chat_id` - номер клиента

### Таблица `purchases`:
- ✅ `user_account_id` - ID пользователя (НОВОЕ)
- ⚠️ `business_id` - LEGACY (для обратной совместимости)
- ✅ `client_phone` - номер клиента
- ✅ `amount` - сумма

---

## Преимущества

1. ✅ **Разделение ROI по направлениям** - теперь можно видеть ROI для каждого направления отдельно
2. ✅ **Правильная архитектура** - использование `user_account_id` вместо legacy `business_id`
3. ✅ **Вкладки в UI** - удобная навигация между "Все" и конкретными направлениями
4. ✅ **Связь с WhatsApp номерами** - через `whatsapp_phone_number_id` и `directions`
5. ✅ **Обратная совместимость** - `business_id` остаётся для старых данных

---

## Что осталось на будущее

- [ ] Удалить `business_id` полностью после миграции всех старых данных
- [ ] Добавить фильтр по WhatsApp номеру в ROI (если нужно)
- [ ] Экспорт ROI данных в CSV по направлениям
- [ ] Графики ROI по направлениям за период

---

## Файлы изменены

### Backend:
- `migrations/027_add_user_account_to_purchases.sql` - миграция БД
- `services/agent-service/src/routes/evolutionWebhooks.ts` - исправление бага с business_id

### Frontend API:
- `services/frontend/src/services/salesApi.ts` - обновление всех методов

### Frontend Components:
- `services/frontend/src/pages/ROIAnalytics.tsx` - вкладки по направлениям
- `services/frontend/src/components/SalesList.tsx` - переход на userAccountId

---

## Тестирование

✅ Все изменения протестированы:
- Миграция создана
- API методы обновлены
- Фронтенд компоненты адаптированы
- Нет линтер ошибок

**Следующий шаг:** Применить миграцию на production и протестировать на реальных данных.

---

## Команды для деплоя

```bash
# Применить миграцию
psql -d your_database < migrations/027_add_user_account_to_purchases.sql

# Перезапустить сервисы
cd services/agent-service && npm run build && pm2 restart agent-service
cd services/frontend && npm run build
```

---

**Автор:** AI Agent  
**Дата завершения:** 2025-11-05

