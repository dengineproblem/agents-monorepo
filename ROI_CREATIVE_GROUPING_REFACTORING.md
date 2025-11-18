# ROI Analytics Refactoring: Creative-Based Grouping & Directions

**Дата:** 2025-11-05  
**Коммит:** `cbfae79`  
**Статус:** ✅ Готово к тестированию

---

## 📋 Обзор

Полный рефакторинг ROI аналитики для поддержки группировки по **креативам** вместо кампаний и интеграции с системой **направлений** (directions).

---

## 🎯 Основные изменения

### 1. **Группировка по креативам**
- **Раньше:** ROI рассчитывался по `source_id` (ID объявления/кампании)
- **Теперь:** ROI рассчитывается по `creative_id` (ID креатива)
- **Преимущество:** Один креатив может использоваться в нескольких объявлениях, и затраты суммируются

### 2. **Интеграция с направлениями**
- Добавлен фильтр по `direction_id`
- Десктоп: табы для переключения между направлениями
- Мобилка: dropdown-кнопка с выбором направления
- Затраты и выручка фильтруются по выбранному направлению

### 3. **Миграция БД: user_account_id в purchases**
- Создана миграция `027_add_user_account_to_purchases.sql`
- Добавлена колонка `user_account_id` в таблицу `purchases`
- Backfill существующих данных из связанных `leads`
- Индексы для быстрых запросов

### 4. **Исправление загрузки затрат из FB API**
- **Проблема:** `Promise.all` завершался до загрузки затрат из FB API
- **Решение:** Функция `schedule()` теперь возвращает промис
- **Результат:** Затраты корректно отображаются в UI

### 5. **Кастомный диапазон дат для FB API**
- **Раньше:** `date_preset` (возвращал пустые данные для старых объявлений)
- **Теперь:** `time_range` с кастомным диапазоном дат
- **Преимущество:** Получаем данные даже для остановленных объявлений

### 6. **UI улучшения**
- Кнопка периода перенесена в хедер (используется кнопка "Календарь")
- Чистый интерфейс без дублирования кнопок
- Адаптивная мобильная версия для фильтра направлений

---

## 📁 Измененные файлы

### 1. **migrations/027_add_user_account_to_purchases.sql**
```sql
-- Добавление user_account_id в purchases
ALTER TABLE purchases ADD COLUMN user_account_id UUID;
ALTER TABLE purchases ADD CONSTRAINT fk_purchases_user_account 
  FOREIGN KEY (user_account_id) REFERENCES user_accounts(id);

-- Backfill данных
UPDATE purchases p SET user_account_id = l.user_account_id
FROM leads l WHERE p.client_phone = l.chat_id;

-- Индексы
CREATE INDEX idx_purchases_user_account ON purchases(user_account_id);
CREATE INDEX idx_purchases_created_at ON purchases(created_at);
```

### 2. **services/frontend/src/services/salesApi.ts**

#### Запрос лидов с креативами:
```typescript
// Получаем лиды с creative_id
let leadsQuery = supabase
  .from('leads')
  .select('id, chat_id, sale_amount, source_id, creative_id, creative_url, created_at, direction_id')
  .eq('user_account_id', userAccountId);

if (directionId) {
  leadsQuery = leadsQuery.eq('direction_id', directionId);
}
```

#### Маппинг названий креативов:
```typescript
// Получаем маппинг ad_id -> creative_name
const { data: creativeMappings } = await supabase
  .from('ad_creative_mapping')
  .select('ad_id, user_creatives!inner(title)')
  .in('ad_id', adIds);

creativeMappings.forEach((mapping) => {
  if (mapping.user_creatives?.title) {
    creativeNamesMap.set(mapping.ad_id, mapping.user_creatives.title);
  }
});
```

#### Группировка по креативам:
```typescript
// Группируем лиды по creative_id
for (const lead of leadsStats) {
  const creativeId = lead.creative_id || 'unknown_creative';
  const creativeName = creativeNamesMap.get(lead.source_id) || `Креатив ${creativeId}...`;
  
  if (!campaignMap.has(creativeId)) {
    campaignMap.set(creativeId, {
      id: creativeId,
      name: creativeName,
      creative_url: lead.creative_url,
      spend: 0,
      revenue: 0,
      roi: 0,
      leads: 0,
      conversions: 0
    });
  }
  
  const campaign = campaignMap.get(creativeId);
  campaign.leads++;
  campaign.revenue += revenue;
}
```

#### Суммирование затрат по объявлениям креатива:
```typescript
// Мапа creative_id → source_ids (ad_ids)
const creativeToSourceIds = new Map<string, Set<string>>();
for (const lead of leadsStats) {
  const creativeId = lead.creative_id || 'unknown_creative';
  if (lead.source_id) {
    if (!creativeToSourceIds.has(creativeId)) {
      creativeToSourceIds.set(creativeId, new Set());
    }
    creativeToSourceIds.get(creativeId).add(lead.source_id);
  }
}

// Суммируем затраты со всех объявлений креатива
for (const sourceId of sourceIds) {
  const spendInUsd = await this.getAdSpend(fbAccessToken, sourceId, datePreset);
  spendInKzt += Math.round(spendInUsd * usdToKztRate);
}
```

#### Исправление getAdSpend:
```typescript
// Используем кастомный time_range вместо date_preset
const timeRanges = { 'last_7d': 7, 'last_30d': 30, 'last_90d': 90 };
const daysBack = timeRanges[datePreset];
const since = new Date();
since.setDate(since.getDate() - daysBack);
const sinceStr = since.toISOString().split('T')[0];
const untilStr = new Date().toISOString().split('T')[0];

url.searchParams.append('time_range', JSON.stringify({
  since: sinceStr,
  until: untilStr
}));
```

#### Исправление async загрузки:
```typescript
// Функция schedule теперь возвращает промис
const schedule = async (task: () => Promise<void>): Promise<void> => {
  while (active >= concurrency) {
    await Promise.race(queue);
  }
  const p = runTask(task);
  queue.push(p);
  p.finally(() => {
    const idx = queue.indexOf(p);
    if (idx >= 0) queue.splice(idx, 1);
  });
  return p; // ← ВАЖНО!
};
```

### 3. **services/frontend/src/pages/ROIAnalytics.tsx**

#### Фильтр по направлениям:
```typescript
// Состояние
const [directions, setDirections] = useState<Direction[]>([]);
const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);

// Загрузка направлений
const loadDirections = async (userAccountId: string) => {
  const { data } = await salesApi.getDirections(userAccountId);
  setDirections(data);
};

// Загрузка ROI с фильтром
const data = await salesApi.getROIData(
  userId, 
  selectedDirectionId, // фильтр по направлению
  timeframe
);
```

#### UI для направлений:
```tsx
{/* Десктоп: табы */}
<div className="hidden md:block">
  <Tabs value={selectedDirectionId || 'all'} 
        onValueChange={(value) => setSelectedDirectionId(value === 'all' ? null : value)}>
    <TabsList>
      <TabsTrigger value="all">Все направления</TabsTrigger>
      {directions.map(d => (
        <TabsTrigger key={d.id} value={d.id}>{d.name}</TabsTrigger>
      ))}
    </TabsList>
  </Tabs>
</div>

{/* Мобилка: dropdown */}
<div className="md:hidden">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="w-full">
        {selectedDirectionId 
          ? directions.find(d => d.id === selectedDirectionId)?.name 
          : 'Все направления'}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={() => setSelectedDirectionId(null)}>
        Все направления
      </DropdownMenuItem>
      {directions.map(d => (
        <DropdownMenuItem key={d.id} onClick={() => setSelectedDirectionId(d.id)}>
          {d.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```

#### Меню периодов через кнопку календаря:
```tsx
<Header onOpenDatePicker={() => setIsPeriodMenuOpen(true)} />

{isPeriodMenuOpen && (
  <div className="fixed inset-0 z-50" onClick={() => setIsPeriodMenuOpen(false)}>
    <div className="absolute top-[60px] right-[120px] bg-popover rounded-md border shadow-md p-1">
      <div onClick={() => { loadROIData(7); setIsPeriodMenuOpen(false); }}>
        7 дней
      </div>
      <div onClick={() => { loadROIData(30); setIsPeriodMenuOpen(false); }}>
        30 дней
      </div>
      <div onClick={() => { loadROIData(90); setIsPeriodMenuOpen(false); }}>
        90 дней
      </div>
      <div onClick={() => { loadROIData('all'); setIsPeriodMenuOpen(false); }}>
        Всё время
      </div>
    </div>
  </div>
)}
```

#### Таблица креативов:
```tsx
<thead>
  <tr>
    <th>Название креатива</th> {/* Было: Название кампании */}
    <th>Выручка</th>
    <th>Затраты</th>
    <th>ROI</th>
    <th>Лиды</th>
    <th>Конверсии</th>
    <th>Конверсия %</th>
    <th>Ссылка</th> {/* Ссылка на креатив */}
  </tr>
</thead>
```

### 4. **services/frontend/src/components/SalesList.tsx**

Обновлен для использования `user_account_id`:
```typescript
interface SalesListProps {
  userAccountId: string; // Было: businessId
}

const { data } = await salesApi.getAllPurchases(userAccountId);
```

### 5. **services/agent-service/src/routes/evolutionWebhooks.ts**

Исправлено заполнение `business_id` в лидах:
```typescript
await processAdLead({
  userAccountId: instanceData.user_account_id,
  whatsappPhoneNumberId: finalWhatsappPhoneNumberId,
  instancePhone: instanceData.phone_number, // ← Передаём номер инстанса
  clientPhone,
  // ...
}, app);

// В функции processAdLead:
.insert({
  user_account_id: userAccountId,
  business_id: instancePhone, // ← Номер бизнеса (наш), а не клиента
  chat_id: clientPhone,
  // ...
})
```

---

## 🔄 Схема работы

### 1. Загрузка данных
```
User → ROI Analytics Page
  ↓
Load Directions → salesApi.getDirections(userAccountId)
  ↓
Load ROI Data → salesApi.getROIData(userAccountId, directionId, timeframe)
  ↓
Query Leads (filtered by user_account_id + direction_id)
  ↓
Query Purchases (filtered by user_account_id + lead phones)
  ↓
Map creative names (ad_id → user_creatives.title)
```

### 2. Группировка по креативам
```
Leads → Group by creative_id
  ↓
For each creative:
  - Get all source_ids (ad_ids) using this creative
  - Sum spend from FB API for each ad_id
  - Sum revenue from all leads with this creative_id
  - Calculate ROI = (revenue - spend) / spend * 100
```

### 3. Отображение
```
Campaigns Array (grouped by creative_id)
  ↓
Table:
  - Название креатива (from user_creatives.title)
  - Выручка (sum of lead sales)
  - Затраты (sum of FB API spend for all ads)
  - ROI (calculated)
  - Лиды (count)
  - Конверсии (count of purchases)
  - Ссылка (creative_url)
```

---

## 🐛 Исправленные проблемы

### 1. **Затраты не загружались**
- **Причина:** `schedule()` не возвращала промис, `Promise.all` завершался мгновенно
- **Решение:** Добавлен `return p;` в функцию `schedule()`

### 2. **FB API возвращал пустые данные**
- **Причина:** `date_preset` не работает для остановленных объявлений
- **Решение:** Используем `time_range` с кастомными датами

### 3. **Период "Все" показывал только 3 дня**
- **Причина:** `maximum` в FB API = 3 дня (непредсказуемо)
- **Решение:** Заменён на `last_90d` (90 дней)

### 4. **business_id в лидах был неправильным**
- **Причина:** Записывался номер клиента вместо номера бизнеса
- **Решение:** Передаём `instancePhone` в `processAdLead`

---

## 📊 Структура данных

### Таблица `purchases` (после миграции)
```sql
id                  UUID
client_phone        TEXT
amount              NUMERIC
user_account_id     UUID     ← НОВОЕ ПОЛЕ
created_at          TIMESTAMPTZ
```

### Интерфейс `Direction`
```typescript
interface Direction {
  id: string;
  name: string;
  objective: string;
  whatsapp_phone_number: string | null;
  is_active: boolean;
  created_at: string;
}
```

### Интерфейс `CampaignROI`
```typescript
interface CampaignROI {
  id: string;              // creative_id
  name: string;            // Название креатива из user_creatives.title
  creative_url: string;    // URL креатива
  spend: number;           // Сумма затрат по всем ads этого креатива
  revenue: number;         // Сумма выручки
  roi: number;             // ROI в процентах
  leads: number;           // Количество лидов
  conversions: number;     // Количество конверсий
}
```

---

## ✅ Checklist для тестирования

### База данных
- [ ] Миграция `027` применена успешно
- [ ] В `purchases` заполнен `user_account_id`
- [ ] Индексы созданы

### Функциональность
- [ ] ROI загружается и отображается
- [ ] Затраты приходят из FB API
- [ ] Группировка по креативам работает
- [ ] Фильтр по направлениям работает
- [ ] Кнопка календаря открывает меню периодов
- [ ] Выбор периода перезагружает данные

### UI
- [ ] Таблица показывает "Название креатива"
- [ ] Десктоп: табы направлений отображаются
- [ ] Мобилка: dropdown направлений работает
- [ ] Меню периодов позиционируется правильно
- [ ] Ссылки на креативы работают

### Производительность
- [ ] Запросы к FB API оптимизированы (только нужные ads)
- [ ] Затраты загружаются параллельно (concurrency = 6)
- [ ] Данные кешируются где возможно

---

## 🚀 Deployment

### Шаги для деплоя:

1. **Применить миграцию:**
```sql
-- На production БД
\i migrations/027_add_user_account_to_purchases.sql
```

2. **Проверить backfill:**
```sql
SELECT COUNT(*) FROM purchases WHERE user_account_id IS NOT NULL;
SELECT COUNT(*) FROM purchases WHERE user_account_id IS NULL;
```

3. **Запушить изменения:**
```bash
git push origin main
```

4. **Перезапустить сервисы:**
```bash
# Agent service
cd services/agent-service && npm run build && pm2 restart agent-service

# Frontend
cd services/frontend && npm run build
```

5. **Проверить в UI:**
- Открыть ROI Analytics
- Проверить загрузку данных
- Проверить фильтры
- Проверить затраты из FB API

---

## 📝 Примечания

### Legacy поля
- `business_id` в `leads` остаётся для обратной совместимости
- `business_id` в `purchases` больше не используется в новой логике
- Все новые запросы используют `user_account_id`

### Оптимизация
- Запросы к FB API ограничены 6 параллельными (concurrency)
- Используется маппинг для избежания дублирующих запросов
- Индексы на `user_account_id` и `created_at` для быстрых фильтров

### Будущие улучшения
- [ ] Кеширование FB API ответов (Redis)
- [ ] Batch-запросы к FB API (несколько ads за один запрос)
- [ ] Реал-тайм обновления через WebSocket
- [ ] Экспорт данных в CSV/Excel

---

**Автор:** AI Assistant  
**Дата создания:** 2025-11-05  
**Последнее обновление:** 2025-11-05






