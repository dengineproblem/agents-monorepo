# ✅ Исправления Analyzer - Отображение аналитики креативов

## Проблемы (до исправления)

### 1. LLM ошибка блокировала весь endpoint ❌
**Симптом**: При попытке получить аналитику completed теста возвращалось только:
```json
{
  "error": "OpenAI API error: 429 - insufficient_quota"
}
```

**Причина**: Analyzer пытался сделать LLM анализ через OpenAI, но квота закончилась. Ошибка не обрабатывалась, и весь endpoint падал.

**На production работало**: Потому что там анализ уже был сделан ранее и возвращался из кеша.

### 2. Cancelled тесты не отображались ❌
**Симптом**: Тест со статусом `cancelled` и impressions > 0 не показывал данные

**Причина**: В строке 565 `analyzerService.js` не было условия для cancelled:
```javascript
// БЫЛО:
if (test.status === 'completed' || (test.status === 'running' && test.impressions > 0)) {
  dataSource = 'test';
}
```

Результат: `dataSource = 'none'` → фронтенд не показывал данные

---

## Исправления

### Исправление 1: Try-catch для LLM анализа ✅

**Файл**: `services/agent-brain/src/analyzerService.js`
**Строки**: 662-677

**Было**:
```javascript
if (shouldAnalyze) {
  fastify.log.info({ user_creative_id, data_source: dataSource }, 'Analyzing with LLM');
  
  analysis = await analyzeCreativeTest(metricsForAnalysis, transcriptText);
  // ❌ Если ошибка OpenAI - падает весь endpoint
}
```

**Стало**:
```javascript
if (shouldAnalyze) {
  fastify.log.info({ user_creative_id, data_source: dataSource }, 'Analyzing with LLM');
  
  try {
    analysis = await analyzeCreativeTest(metricsForAnalysis, transcriptText);
    
    fastify.log.info({ 
      user_creative_id, 
      llm_score: analysis.score,
      llm_verdict: analysis.verdict
    }, 'LLM analysis complete');
  } catch (error) {
    fastify.log.warn({ 
      user_creative_id, 
      error: error.message 
    }, 'LLM analysis failed, continuing without analysis');
    // ✅ Продолжаем без анализа, возвращаем данные теста
    analysis = null;
  }
}
```

**Результат**: Теперь при ошибке OpenAI возвращаются данные теста без LLM анализа:
```json
{
  "creative": {...},
  "data_source": "test",
  "test": {
    "status": "completed",
    "metrics": {
      "impressions": 1024,
      "reach": 945,
      "leads": 4,
      "cpl_cents": 228
    }
  },
  "analysis": null  // ← Нет анализа, но данные есть ✅
}
```

---

### Исправление 2: Поддержка cancelled тестов ✅

**Файл**: `services/agent-brain/src/analyzerService.js`
**Строки**: 565-567

**Было**:
```javascript
// Если нет production, используем тест (completed или running с данными)
if (!productionMetrics && test) {
  if (test.status === 'completed' || (test.status === 'running' && test.impressions > 0)) {
    dataSource = 'test';
  }
}
```

**Стало**:
```javascript
// Если нет production, используем тест (completed, cancelled или running с данными)
if (!productionMetrics && test) {
  if (test.status === 'completed' || 
      (test.status === 'running' && test.impressions > 0) ||
      (test.status === 'cancelled' && test.impressions > 0)) {  // ← ДОБАВЛЕНО
    dataSource = 'test';
  }
}
```

**Результат**: Теперь cancelled тесты с данными отображаются:
- ✅ `cancelled` + impressions > 0 → показываются метрики
- ✅ `cancelled` + impressions = 0 → не показываются (правильно)

---

## Тестирование

### До исправления ❌
```bash
$ curl "http://localhost:8081/api/analyzer/creative-analytics/5b5f5d1b.../..."

{
  "error": "OpenAI API error: 429 - insufficient_quota"
}
```

### После исправления ✅
```bash
$ curl "http://localhost:8081/api/analyzer/creative-analytics/5b5f5d1b.../..."

{
  "creative": "Мем 1504_1.mp4",
  "data_source": "test",
  "test": {
    "status": "completed",
    "metrics": {
      "impressions": 1024,
      "leads": 4,
      "cpl_cents": 228
    }
  },
  "analysis": null  ✅ Данные есть, анализа нет (ожидаемо при нехватке OpenAI quota)
}
```

---

## Сравнение с Production

### Production (работало всегда)
- Анализ был сделан ранее → возвращается из кеша
- `from_cache: true` → OpenAI не вызывается

### Local (до исправления)
- Пытался сделать новый анализ → OpenAI 429 → весь endpoint падал

### Local (после исправления)
- Пытается сделать анализ → OpenAI 429 → **catch ловит ошибку** → возвращает данные без анализа ✅

---

## Логика отображения данных

### Что показывается на фронтенде

| Статус теста | Impressions | data_source | Отображение |
|-------------|-------------|-------------|-------------|
| `running` | 0 | `none` | ❌ Нет данных (правильно) |
| `running` | > 0 | `test` | ✅ Метрики показываются |
| `completed` | > 0 | `test` | ✅ Метрики + анализ (если есть) |
| `cancelled` | 0 | `none` | ❌ Нет данных (правильно) |
| `cancelled` | > 0 | `test` | ✅ Метрики показываются *(после исправления)* |

---

## Что НЕ исправлялось

### Running тесты с impressions = 0
**Вопрос**: Почему не показывается статус "Тест запущен"?

**Ответ**: Это правильное поведение:
- Нет данных для отображения (impressions = 0)
- На production тоже не показываются
- Когда появятся impressions → сразу отобразятся

**Если нужно**: Можно добавить на фронтенд отдельный блок для running тестов без данных, но это отдельная задача.

---

## Итого

### ✅ Исправлено
1. **LLM ошибка не блокирует данные** - try-catch обрабатывает ошибки OpenAI
2. **Cancelled тесты отображаются** - добавлено условие в dataSource

### 📋 Файлы изменены
- `services/agent-brain/src/analyzerService.js` (2 изменения)

### 🎯 Результат
- Completed тесты: Показывают метрики даже без LLM анализа ✅
- Cancelled тесты: Показывают метрики если есть impressions ✅
- Running тесты: Показывают метрики если impressions > 0 ✅

---

## Дата исправления

**24 октября 2025, 17:35 (UTC+5)**

Аналитика креативов теперь отображается корректно даже при проблемах с OpenAI! 🎉

