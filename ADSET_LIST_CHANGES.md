# Изменения: Список Ad Sets вместо графиков

## Обзор изменений

Выполнена замена блока с графиками на список offset-агентов (ad sets) на странице детализации кампании. Изменения затрагивают только основной фронтенд, не влияют на App Review версию.

## Что сделано

### 1. API методы (facebookApi.ts)

**Добавлены типы:**
- `Adset` - тип для ad set с полями: id, name, status, daily_budget, campaign_id
- `AdsetStat` - тип для статистики ad set с метриками

**Новые методы:**
- `updateAdsetName(adsetId, newName)` - обновление названия ad set
- `getAdsetStats(campaignId, dateRange)` - получение статистики по ad sets за период

**Файл:** `services/frontend/src/services/facebookApi.ts`

### 2. Компонент AdsetList

Создан новый компонент `AdsetList.tsx` по аналогии с `CampaignList.tsx`:
- Отображает список ad sets кампании в виде карточек
- Показывает метрики: расход, лиды, CPL
- При клике на карточку открывается модальное окно для редактирования
- Поддерживает состояния загрузки
- Автоматически обновляет статистику при изменении периода

**Файл:** `services/frontend/src/components/AdsetList.tsx`

### 3. Модальное окно EditAdsetDialog

Создан компонент `EditAdsetDialog.tsx` для редактирования ad set:
- Редактирование названия ad set
- Редактирование дневного бюджета (с кнопками +/- и прямым вводом)
- Минимальный бюджет: $1
- Отображение ID и статуса ad set
- Валидация и обработка ошибок
- Уведомления об успешном сохранении

**Файл:** `services/frontend/src/components/EditAdsetDialog.tsx`

### 4. Обновление CampaignDetail

**Удалено:**
- Импорт `MetricsChart`
- Блок с графиками (строка "Графики" + компонент MetricsChart)
- Старый блок редактирования бюджетов ad sets (inline редактор)
- Неиспользуемый state для adsets, adsetBudgets, adsetLoading, adsetSaving

**Добавлено:**
- Импорт `AdsetList`
- Новый блок "Ad Sets" с компонентом AdsetList
- Передача dateRange в AdsetList для автоматического обновления статистики

**Файл:** `services/frontend/src/pages/CampaignDetail.tsx`

## Структура данных

### Ad Set (Adset)
```typescript
{
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  daily_budget: number; // в центах
  campaign_id: string;
}
```

### Статистика Ad Set (AdsetStat)
```typescript
{
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  cpl: number;
  date: string;
  status: string;
  _is_real_data?: boolean;
}
```

## Почему убрали графики

1. **Производительность**: Графики делают множество API запросов при выборе большого периода (данные за каждый день отдельно)
2. **Использование**: Графики не так часто используются пользователями
3. **Фокус на операциях**: Действия сейчас происходят на уровне ad sets (offset-агентов), поэтому важнее видеть их список со статистикой

## Преимущества нового подхода

1. **Меньше API запросов**: Статистика ad sets загружается одним запросом
2. **Удобное редактирование**: Модальное окно позволяет редактировать и название, и бюджет в одном месте
3. **Единообразный UI**: Список ad sets выглядит как список кампаний, пользователи привыкнут быстро
4. **Лучшая навигация**: Клик по ad set открывает детали, а не inline-редактор

## Как это работает

1. Пользователь заходит на страницу детализации кампании (`/campaign/:id`)
2. Загружаются ad sets этой кампании (метод `getAdsetsByCampaign`)
3. Загружается статистика ad sets за выбранный период (метод `getAdsetStats`)
4. Отображается список карточек с метриками (расход, лиды, CPL)
5. При клике на карточку открывается модальное окно для редактирования
6. Изменения сохраняются через API методы `updateAdsetName` и `updateAdsetBudget`
7. Локальное состояние обновляется без перезагрузки страницы

## Совместимость с App Review

Изменения затрагивают только основной фронтенд. Для App Review версии (с `VITE_APP_REVIEW_MODE=true`) изменений не требуется, так как эта функциональность не проверяется в процессе App Review.

## Файлы изменены

1. `services/frontend/src/services/facebookApi.ts` - добавлены типы и API методы
2. `services/frontend/src/components/AdsetList.tsx` - новый компонент (создан)
3. `services/frontend/src/components/EditAdsetDialog.tsx` - новый компонент (создан)
4. `services/frontend/src/pages/CampaignDetail.tsx` - убраны графики, добавлен AdsetList

## Тестирование

### Локальное тестирование
```bash
cd services/frontend
npm run dev
```

Открыть: http://localhost:5173

**Что проверить:**
1. Открыть страницу кампании
2. Убедиться, что блок "Графики" отсутствует
3. Убедиться, что список ad sets отображается
4. Кликнуть на ad set - должно открыться модальное окно
5. Изменить название и бюджет
6. Сохранить - должно успешно обновиться

### Production деплой
```bash
cd ~/agents-monorepo
git add .
git commit -m "feat: заменить графики на список ad sets на странице кампании"
git push origin main

# На сервере
ssh root@ubuntu-s-2vcpu-4gb-120gb-intel-nyc1-01
cd /root/agents-monorepo
git pull origin main
docker compose down
docker compose up -d --build frontend
```

## Откат изменений (если нужно)

```bash
# Локально
git revert HEAD

# На сервере
cd /root/agents-monorepo
git checkout HEAD~1
docker compose down
docker compose up -d --build frontend
```

## Дополнительные возможности (можно добавить позже)

1. Фильтрация ad sets по статусу (ACTIVE/PAUSED)
2. Сортировка ad sets по метрикам (CPL, расход, лиды)
3. Групповое редактирование бюджетов
4. График по конкретному ad set (в модальном окне)
5. История изменений ad set






