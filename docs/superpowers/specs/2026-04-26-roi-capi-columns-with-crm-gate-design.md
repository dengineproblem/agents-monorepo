# Возврат CAPI-блоков UI с гейтом «CRM подключён»

**Дата:** 2026-04-26
**Статус:** Approved (готов к writing-plans)

## Контекст

В нескольких прошлых коммитах из UI скрыли все элементы, связанные с Meta CAPI и трёхуровневой воронкой Level 1/2/3:

- Коммит `4fcf601` (29.03.2026) удалил карточку «Meta CAPI» в [Profile.tsx:1591](services/frontend/src/pages/Profile.tsx#L1591) и radio «Конверсии» в [CreateDirectionDialog.tsx:663](services/frontend/src/components/profile/CreateDirectionDialog.tsx#L663).
- Коммит `5a26bee` (20.04.2026) закомментировал колонки Level 1/2/3 + Conv 1/2/3 % в [ROIAnalytics.tsx](services/frontend/src/pages/ROIAnalytics.tsx).
- Промежуточная правка от 2026-04-26 (текущая сессия) частично вернула колонку Qualified — её нужно откатить и заменить полным набором колонок с гейтом.

Backend и схема БД остались нетронутыми: таблицы `capi_settings` (миграция 208), `capi_events_log` (125), компоненты `CapiSettingsModal`, `CapiWizard`, агрегация `capi_events.qualified` в [salesApi.ts](services/frontend/src/services/salesApi.ts) — всё работает.

Проблема: новый юзер, у которого подключена CRM (amoCRM или Bitrix24), не видит ни UI настроек CAPI, ни конверсионных метрик в ROI-аналитике, потому что они скрыты глобально.

## Цель

Вернуть скрытые CAPI-элементы UI, но показывать их **только** когда у юзера подключена хотя бы одна CRM (amoCRM или Bitrix24). Для юзеров без CRM ничего не меняется — никакого «шума» в интерфейсе.

## Принцип

Один общий гейт во всех трёх точках:

```
hasCrm = amocrmConnected || bitrix24Connected
```

Этот же паттерн уже используется в [CapiWizard.tsx:73](services/frontend/src/components/profile/CapiWizard.tsx#L73), переиспользуем его.

## Точки правки

### 1. Карточка «Meta CAPI» в Profile

**Файл:** [services/frontend/src/pages/Profile.tsx](services/frontend/src/pages/Profile.tsx) (~строка 1591, в секции `cards={[...]}` блока интеграций)

**Что:** Возвращаем удалённый коммитом `4fcf601` блок карточки `meta_capi`, оборачиваем в условный spread:

```tsx
...((amocrmConnected || bitrix24Connected) ? [{
  id: 'meta_capi' as const,
  title: 'Meta CAPI',
  connected: capiSettings.length > 0,
  onClick: () => setCapiSettingsModalOpen(true),
  editMode: true,
  badge: capiSettings.length > 0
    ? `${capiSettings.length} ${capiSettings.length === 1 ? 'канал' : 'канала'}`
    : undefined,
}] : []),
```

Состояние `amocrmConnected` и `bitrix24Connected` уже существует в Profile (строки 203, 224) — менять нечего.

### 2. Radio «Конверсии» в CreateDirectionDialog

**Файл:** [services/frontend/src/components/profile/CreateDirectionDialog.tsx](services/frontend/src/components/profile/CreateDirectionDialog.tsx) (~строка 663, в `<RadioGroup>` выбора `objective`)

**Что:** Возвращаем удалённый radio:

```tsx
{hasCrm && (
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="conversions" id="obj-conversions" />
    <Label htmlFor="obj-conversions" className="font-normal cursor-pointer">
      {OBJECTIVE_DESCRIPTIONS.conversions}
    </Label>
  </div>
)}
```

`hasCrm` приходит через props из родителя ([Profile.tsx](services/frontend/src/pages/Profile.tsx) уже владеет состояниями `amocrmConnected` и `bitrix24Connected`). Добавить `hasCrm: boolean` в `CreateDirectionDialogProps` и передать `hasCrm={amocrmConnected || bitrix24Connected}` при использовании.

### 3. Колонки Level 1/2/3 + Conv 1/2/3 в ROI Analytics

**Файл:** [services/frontend/src/pages/ROIAnalytics.tsx](services/frontend/src/pages/ROIAnalytics.tsx)

**Подэтап 3a:** Откатить промежуточную правку от 2026-04-26, которая вернула только колонку «Квал»/«Conv Qual» — раскомментировать и упростить блоки до состояния «весь CEP-блок виден», без частичной маскировки.

**Подэтап 3b:** Восстановить **все 6 колонок** как было до коммита `5a26bee`:
- Заголовки: `Level 1`, `Level 2`, `Level 3`, `Conv 1`, `Conv 2`, `Conv 3`
- Ячейки: соответствующие `<td>` с подсветкой и значениями `campaign.capi_events.{interest|qualified|scheduled}` и расчётом `(× 100 / leads)` для Conv
- CSV-экспорт: те же 6 колонок

Лейблы и расчёты не меняем — оставляем оригинальные имена.

**Подэтап 3c:** Обернуть всю группу из 6 колонок (заголовки + ячейки + CSV-секция) в условный рендер по `hasCrm`:

```tsx
{hasCrm && (
  <>
    <th>Level 1</th>
    {/* ... */}
    <th>Conv 3</th>
  </>
)}
```

Аналогично для `<td>` ячеек в каждой строке таблицы. Аналогично для CSV — `hasCrm ? [...levelColumns] : []`.

### 4. Источник `hasCrm` в ROIAnalytics

ROIAnalytics — отдельная страница, не имеет доступа к state из Profile. Решение:

**Локальный fetch внутри ROIAnalytics**, по аналогии с тем, как это сделано в Profile:
- amoCRM: `GET ${API_BASE_URL}/amocrm/status?userAccountId=${user.id}` ([Profile.tsx:386](services/frontend/src/pages/Profile.tsx#L386))
- Bitrix24: `getBitrix24Status(user.id, accountId)` из [bitrix24Api](services/frontend/src/services/bitrix24Api.ts) ([Profile.tsx:440](services/frontend/src/pages/Profile.tsx#L440))

В multi-account режиме передаём `currentAdAccountId` (он уже доступен в ROIAnalytics через `useAppContext()`, [строка 123](services/frontend/src/pages/ROIAnalytics.tsx#L123)).

Состояния:
```tsx
const [amocrmConnected, setAmocrmConnected] = useState(false);
const [bitrix24Connected, setBitrix24Connected] = useState(false);
const hasCrm = amocrmConnected || bitrix24Connected;
```

Fetch в `useEffect` при изменении `user?.id` или `currentAdAccountId`.

Рефакторинг в общий hook `useCrmConnection()` — вне scope этого спека.

## Что не делаем

- Не пишем миграций.
- Не трогаем backend (агрегация `capi_events` в [salesApi.ts](services/frontend/src/services/salesApi.ts) уже работает).
- Не делаем fallback на `qualityLeads` (Facebook messaging depth) для юзеров без CRM — колонок просто нет.
- Не меняем имена колонок (остаются Level 1/2/3, Conv 1/2/3).
- Не делаем динамические лейблы из настроек direction CAPI — отдельная история.
- Не возвращаем секцию «Ключевые этапы» / `KeyStageSelector` (она была про другую механику — pipeline/status — и имела bypass-проблему; мы используем CAPI custom fields через `capi_settings`).

## Поведение для юзера

| Состояние юзера | Profile | CreateDirectionDialog | ROI Analytics |
|---|---|---|---|
| **Без CRM** | Карточки «Meta CAPI» нет | Цели «Конверсии» нет | Колонок Level/Conv нет |
| **С CRM (amoCRM или Bitrix24)** | Карточка есть, открывает CapiSettingsModal | Цель «Конверсии» доступна | 6 колонок Level 1/2/3 + Conv 1/2/3 видны |

При отключении/удалении CRM — карточка/цель/колонки автоматически исчезают (т.к. условие реактивное на state).

## Тестирование

- Юзер без подключённого amoCRM и Bitrix24: карточки/цели/колонок нет.
- Юзер с подключённым amoCRM: всё видно.
- Юзер с подключённым Bitrix24: всё видно.
- Multi-account режим: `accountId` передаётся в status-проверки, CRM статус определяется per-account.
- Отключение CRM (через свою же карточку amoCRM/Bitrix24): после успешного disconnect карточка/цель/колонки исчезают без рефреша страницы (или с рефрешем, если так уже работает).

## Файлы которые точно меняются

- [services/frontend/src/pages/Profile.tsx](services/frontend/src/pages/Profile.tsx) — вернуть карточку Meta CAPI (с гейтом).
- [services/frontend/src/components/profile/CreateDirectionDialog.tsx](services/frontend/src/components/profile/CreateDirectionDialog.tsx) — вернуть radio «Конверсии» (с гейтом).
- [services/frontend/src/pages/ROIAnalytics.tsx](services/frontend/src/pages/ROIAnalytics.tsx) — откатить временную «Квал» правку, вернуть все 6 колонок, добавить fetch CRM-статуса и обернуть в гейт.
