# Исправление: Режим "Только отчет" для агента Brain

## Проблемы

### Проблема 1: Отсутствие отчета при неактивных кампаниях
Агент Brain не предоставлял отчет, если:
- За вчера были затраты по рекламе
- Но все кампании были выключены (неактивны) на момент запуска агента

В такой ситуации:
- ❌ LLM не вызывался
- ❌ Отчет не отправлялся
- ❌ Пользователь не получал статистику за день с затратами

### Проблема 2: Лимит 25 adsets
Facebook API возвращал только первые 25 adsets по умолчанию:
- ❌ Агент не видел все adsets в кабинете
- ❌ Пропускал активные кампании с затратами
- ❌ Неверно определял, есть ли активные кампании

## Решения

### Решение 1: Режим "Только отчет"

Добавлен **режим "Только отчет" (Report-Only Mode)** с тремя уровнями проверки:

#### A. Подсчет затрат на уровне кампаний (строки 1687-1698)
```javascript
// Считаем затраты на уровне КАМПАНИЙ (более надежно, чем adsets)
const totalYesterdaySpendCampaigns = Array.from(byCY.values()).reduce((sum, data) => {
  return sum + (Number(data.spend) || 0);
}, 0);

// Также считаем на уровне adsets (для детализации)
const totalYesterdaySpendAdsets = Array.from(byY.values()).reduce((sum, data) => {
  return sum + (Number(data.spend) || 0);
}, 0);

// Берем максимум (на случай если на одном уровне данные есть, на другом нет)
const totalYesterdaySpend = Math.max(totalYesterdaySpendCampaigns, totalYesterdaySpendAdsets);
```

**Зачем:** Если кампании выключены, Facebook API может не возвращать insights на уровне adsets, но возвращает на уровне кампаний.

### Решение 2: Увеличение лимита API

Добавлен параметр `limit: '500'` во все функции загрузки данных:

#### A. fetchAdsets (строка 337)
```javascript
async function fetchAdsets(adAccountId, accessToken) {
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${adAccountId}/adsets`);
  url.searchParams.set('fields','id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status');
  url.searchParams.set('limit', '500'); // Get all adsets, not just first 25 ✅
  url.searchParams.set('access_token', accessToken);
  return fbGet(url.toString());
}
```

#### B. fetchYesterdayInsights (строка 347)
```javascript
async function fetchYesterdayInsights(adAccountId, accessToken) {
  // ...
  url.searchParams.set('limit', '500'); // Get all adsets, not just first 25 ✅
  // ...
}
```

**Остальные функции уже имели лимит 500:**
- ✅ `fetchInsightsPreset` (строка 357)
- ✅ `fetchAdLevelInsightsPreset` (строка 368)
- ✅ `fetchCampaignInsightsPreset` (строка 379)
- ✅ `fetchCampaigns` (строка 387)

---

## Детальное описание режима "Только отчет"

### 1. Три сценария обработки

```javascript
// Проверка затрат за вчера
const totalYesterdaySpend = Array.from(byY.values()).reduce((sum, data) => {
  return sum + (Number(data.spend) || 0);
}, 0);

// Все adsets с затратами (включая неактивные) - для отчета
const allAdsetsWithYesterdaySpend = adsetList.filter(as => {
  const yesterdayData = byY.get(as.id)||{};
  const hasResults = (Number(yesterdayData.spend)||0) > 0 || 
                     (computeLeadsFromActions(yesterdayData).leads||0) > 0;
  return hasResults;
});
```

### 2. Три сценария обработки

#### Сценарий A: Нет затрат вообще
```
totalYesterdaySpend === 0 && allAdsetsWithYesterdaySpend.length === 0
```
- ✅ Не вызываем LLM
- ✅ Отправляем короткое сообщение "нет затрат"

#### Сценарий B: Были затраты, но кампании неактивны (НОВОЕ!)
```
reportOnlyMode = true
(adsetsWithYesterdayResults.length === 0 && allAdsetsWithYesterdaySpend.length > 0)
```
- ✅ Вызываем LLM для отчета
- ✅ Включаем ВСЕ кампании с затратами (включая неактивные)
- ❌ НЕ выполняем никакие действия (actions = [])

#### Сценарий C: Активные кампании с затратами
```
reportOnlyMode = false
(adsetsWithYesterdayResults.length > 0)
```
- ✅ Работаем как обычно
- ✅ Анализируем и предлагаем действия

### 3. Изменения в логике

#### A. Фильтрация adsets для LLM (строки 1857-1872)
```javascript
.filter(as => {
  const yesterdayData = byY.get(as.id)||{};
  const hasResults = (Number(yesterdayData.spend)||0) > 0 || 
                     (computeLeadsFromActions(yesterdayData).leads||0) > 0;
  
  if (reportOnlyMode) {
    // Режим "только отчет": включаем все adsets с затратами
    return hasResults;
  } else {
    // Обычный режим: только активные
    if (as.effective_status !== 'ACTIVE') return false;
    return hasResults;
  }
})
```

#### B. Подсчет totals (строки 1910-1930)
```javascript
const campaignsWithResults = (campList||[])
  .filter(c => reportOnlyMode ? true : 
               String(c.status||c.effective_status||'').includes('ACTIVE'))
  .map(c=>({ c, y: byCY.get(c.id)||{} }))
  .filter(({y})=> (Number(y.spend)||0) > 0 || 
                  (computeLeadsFromActions(y).leads||0) > 0);
```

#### C. Очистка actions в режиме reportOnlyMode (строки 1821-1830)
```javascript
if (reportOnlyMode) {
  decisions.length = 0;
  touchedCampaignIds.clear();
  fastify.log.info({ 
    where: 'brain_run', 
    phase: 'report_only_mode_decisions_cleared', 
    userId: userAccountId 
  });
}
```

#### D. Передача флага в llmInput (строка 1840)
```javascript
account: {
  timezone: ua?.account_timezone || 'Asia/Almaty',
  report_date: date,
  dispatch: !!inputs?.dispatch,
  report_only_mode: reportOnlyMode  // <-- новое поле
}
```

### 4. Обновление промпта для LLM (строки 778-802)

Добавлен специальный раздел в начало промпта:

```
🔴 ВАЖНО: РЕЖИМ "ТОЛЬКО ОТЧЕТ" (REPORT-ONLY MODE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ СИТУАЦИЯ: За вчера были затраты по рекламе, 
             НО все кампании НЕАКТИВНЫ (выключены пользователем).

📋 ТВОЯ ЗАДАЧА В ЭТОМ РЕЖИМЕ:
  1. ✅ СОЗДАТЬ ПОЛНЫЙ ОТЧЕТ о затратах, лидах, CPL и QCPL за вчера
  2. ✅ ПРОАНАЛИЗИРОВАТЬ статистику по всем кампаниям (включая неактивные)
  3. ❌ НЕ ПРЕДЛАГАТЬ НИКАКИХ ДЕЙСТВИЙ с кампаниями/adsets/ads
  4. ❌ НЕ РЕКОМЕНДОВАТЬ изменение бюджетов
  5. ❌ actions массив должен быть ПУСТЫМ: []

💡 ОБЪЯСНЕНИЕ ПОЛЬЗОВАТЕЛЮ:
  • Упомяни в отчете, что все кампании были НЕАКТИВНЫ на момент проверки
  • Предоставь статистику за вчера (когда были затраты)
  • Порекомендуй включить кампании, если нужна реклама

⚠️ КРИТИЧНО: actions ДОЛЖЕН БЫТЬ ПУСТЫМ МАССИВОМ []
planNote должен содержать: "report_only_mode_inactive_campaigns"
```

## Результат

Теперь агент Brain корректно обрабатывает все три сценария:

| Сценарий | Затраты за вчера | Активные кампании | LLM | Отчет | Действия |
|----------|------------------|-------------------|-----|-------|----------|
| A | ❌ Нет | ❌ Нет | ❌ | ✅ Короткий | ❌ |
| B | ✅ Да | ❌ Нет | ✅ | ✅ Полный | ❌ |
| C | ✅ Да | ✅ Да | ✅ | ✅ Полный | ✅ |

## Тестирование

### Тест кейс 1: Были затраты, кампании выключены
```bash
# 1. Создай кампанию с затратами за вчера
# 2. Выключи все кампании
# 3. Запусти Brain agent
# Ожидается: Полный отчет с затратами, actions = []
```

### Тест кейс 2: Нет затрат, нет активных кампаний
```bash
# 1. Выключи все кампании
# 2. Убедись, что нет затрат за вчера
# 3. Запусти Brain agent
# Ожидается: Короткое сообщение "нет затрат", LLM не вызывается
```

### Тест кейс 3: Есть затраты, есть активные кампании (обычный режим)
```bash
# 1. Создай кампанию с затратами
# 2. Оставь кампанию активной
# 3. Запусти Brain agent
# Ожидается: Полный отчет + анализ + actions
```

## Логирование

Добавлено подробное логирование для отладки:

```javascript
fastify.log.info({
  where: 'brain_run',
  phase: 'adsets_filtered',
  total_adsets: adsetList.length,
  active_adsets: ...,
  with_yesterday_results: adsetsWithYesterdayResults.length,
  all_with_spend: allAdsetsWithYesterdaySpend.length,  // новое
  total_yesterday_spend: totalYesterdaySpend,           // новое
});
```

## Файлы изменены

- ✅ `services/agent-brain/src/server.js` (строки 1656-2009)

## Версия

- **До**: v1.2 (пропускал отчеты при неактивных кампаниях)
- **После**: v1.3 (режим "только отчет")

