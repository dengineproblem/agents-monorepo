# 📊 ТАБЛИЦА `creative_tests` — СХЕМА ДЛЯ FRONTEND

## 📅 Дата: 6 октября 2025

---

## 🎯 НАЗНАЧЕНИЕ

Таблица `creative_tests` хранит **все данные о быстрых тестах креативов**:
- Статус теста
- Метрики из Facebook (обновляются **cron каждые 5 минут**)
- Результаты LLM анализа (после завершения)

**Frontend должен:**
1. **Читать** эту таблицу для отображения статуса и метрик
2. **Подписываться** на обновления через Supabase Realtime
3. **Отображать** прогресс, метрики и результаты анализа

---

## 📋 ПОЛНАЯ СХЕМА ТАБЛИЦЫ

### TypeScript Interface

```typescript
interface CreativeTest {
  // ==========================================
  // ИДЕНТИФИКАТОРЫ
  // ==========================================
  
  id: string;                      // UUID теста (primary key)
  user_creative_id: string;        // UUID креатива (FK → user_creatives.id)
  user_id: string;                 // UUID пользователя (для RLS)
  
  // ==========================================
  // FACEBOOK IDs
  // ==========================================
  
  campaign_id: string | null;      // Facebook Campaign ID
  adset_id: string | null;         // Facebook AdSet ID
  ad_id: string | null;            // Facebook Ad ID
  rule_id: string | null;          // (не используется, всегда null)
  
  // ==========================================
  // КОНФИГУРАЦИЯ ТЕСТА
  // ==========================================
  
  test_budget_cents: number;       // Бюджет теста в центах (по умолчанию: 2000 = $20)
  test_impressions_limit: number;  // Лимит показов (по умолчанию: 1000)
  objective: string;               // Цель кампании (всегда: "WhatsApp")
  
  // ==========================================
  // СТАТУС ТЕСТА
  // ==========================================
  
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  
  started_at: string | null;       // ISO timestamp начала теста
  completed_at: string | null;     // ISO timestamp завершения теста
  
  // ==========================================
  // МЕТРИКИ (ОБНОВЛЯЮТСЯ CRON КАЖДЫЕ 5 МИНУТ)
  // ==========================================
  
  // --- Базовые метрики ---
  
  impressions: number;             // Показы (ключевая метрика для завершения)
  reach: number;                   // Охват
  frequency: number;               // Частота показов (impressions/reach)
  
  // --- Клики ---
  
  clicks: number;                  // Все клики
  link_clicks: number;             // Клики по ссылке
  ctr: number;                     // Click-through rate (%)
  link_ctr: number;                // Link CTR (%)
  
  // --- Лиды ---
  
  leads: number;                   // Количество лидов
  
  // --- Стоимость ---
  
  spend_cents: number;             // Потрачено (в центах, делить на 100 для долларов)
  cpm_cents: number | null;        // Cost per 1000 impressions (центы)
  cpc_cents: number | null;        // Cost per click (центы)
  cpl_cents: number | null;        // Cost per lead (центы, null если лидов нет)
  
  // --- Видео метрики ---
  
  video_views: number;                    // Просмотры видео
  video_views_25_percent: number;         // Досмотрели 25%
  video_views_50_percent: number;         // Досмотрели 50%
  video_views_75_percent: number;         // Досмотрели 75%
  video_views_95_percent: number;         // Досмотрели 95%
  video_avg_watch_time_sec: number;       // Среднее время просмотра (секунды)
  
  // ==========================================
  // LLM АНАЛИЗ (ЗАПОЛНЯЕТСЯ ПОСЛЕ ЗАВЕРШЕНИЯ)
  // ==========================================
  
  llm_score: number | null;               // Оценка от 0 до 100
  llm_verdict: string | null;             // 'excellent' | 'good' | 'average' | 'poor'
  llm_reasoning: string | null;           // Общий анализ результатов
  llm_video_analysis: string | null;      // Анализ просмотров видео
  llm_text_recommendations: string | null; // Рекомендации по тексту видео
  
  // --- Анализ транскрипции ---
  
  transcript_match_quality: string | null; // 'high' | 'medium' | 'low' | 'N/A'
  transcript_suggestions: {                // JSON массив предложений
    from: string;                          // Старый текст
    to: string;                            // Новый текст
    reason: string;                        // Причина изменения
  }[] | null;
  
  // ==========================================
  // TIMESTAMPS
  // ==========================================
  
  created_at: string;              // ISO timestamp создания записи
  updated_at: string;              // ISO timestamp последнего обновления
}
```

---

## 🔄 ЖИЗНЕННЫЙ ЦИКЛ ТЕСТА

### 1. **pending** (создан, но еще не запущен)
```typescript
{
  status: 'pending',
  started_at: null,
  impressions: 0,
  // остальные метрики = 0 или null
}
```

---

### 2. **running** (тест идет, метрики обновляются каждые 5 минут)
```typescript
{
  status: 'running',
  started_at: '2025-10-06T10:00:00Z',
  
  // Cron обновляет эти поля:
  impressions: 456,           // Текущие показы
  reach: 389,
  clicks: 12,
  leads: 2,
  spend_cents: 1450,          // $14.50
  // и т.д.
}
```

**Важно:** Frontend должен **периодически читать** эту запись или **подписываться на обновления** через Supabase Realtime!

---

### 3. **completed** (достигнут лимит показов, тест завершен, LLM проанализировал)
```typescript
{
  status: 'completed',
  started_at: '2025-10-06T10:00:00Z',
  completed_at: '2025-10-06T12:34:56Z',
  
  // Финальные метрики:
  impressions: 1024,
  reach: 876,
  clicks: 34,
  leads: 5,
  spend_cents: 2000,          // $20
  cpl_cents: 400,             // $4 за лид
  
  // LLM анализ:
  llm_score: 78,
  llm_verdict: 'good',
  llm_reasoning: 'Хорошие показатели CTR...',
  llm_video_analysis: 'Видео удерживает внимание...',
  llm_text_recommendations: 'Улучшить CTA...',
  transcript_match_quality: 'high',
  transcript_suggestions: [...]
}
```

---

## 📊 ОПИСАНИЕ МЕТРИК ДЛЯ FRONTEND

### Основные показатели

| Поле | Тип | Описание | Формат для UI |
|------|-----|----------|---------------|
| `impressions` | number | Показы | `1,234` |
| `reach` | number | Охват (уникальные пользователи) | `1,100` |
| `frequency` | number | Частота показов (среднее) | `1.12` |
| `clicks` | number | Все клики | `45` |
| `link_clicks` | number | Клики по ссылке | `38` |
| `ctr` | number | Click-through rate (%) | `3.65%` |
| `link_ctr` | number | Link CTR (%) | `3.08%` |
| `leads` | number | Количество лидов | `5` |

---

### Стоимость (в центах!)

| Поле | Тип | Описание | Конвертация в $ | Формат для UI |
|------|-----|----------|-----------------|---------------|
| `spend_cents` | number | Потрачено | `spend_cents / 100` | `$14.50` |
| `cpm_cents` | number \| null | Cost per 1000 impressions | `cpm_cents / 100` | `$12.34` |
| `cpc_cents` | number \| null | Cost per click | `cpc_cents / 100` | `$0.45` |
| `cpl_cents` | number \| null | Cost per lead | `cpl_cents / 100` | `$4.00` |

**⚠️ ВАЖНО:** Все поля с `_cents` нужно **делить на 100** для отображения в долларах!

```typescript
const spendUSD = test.spend_cents / 100; // 2000 → $20.00
const cplUSD = test.cpl_cents ? test.cpl_cents / 100 : null; // 400 → $4.00
```

---

### Видео метрики

| Поле | Тип | Описание | Формат для UI |
|------|-----|----------|---------------|
| `video_views` | number | Просмотры видео | `234` |
| `video_views_25_percent` | number | Досмотрели 25% | `180` (77%) |
| `video_views_50_percent` | number | Досмотрели 50% | `120` (51%) |
| `video_views_75_percent` | number | Досмотрели 75% | `80` (34%) |
| `video_views_95_percent` | number | Досмотрели 95% | `45` (19%) |
| `video_avg_watch_time_sec` | number | Среднее время просмотра | `8.5 сек` |

**Процент досмотра:**
```typescript
const completion25 = (test.video_views_25_percent / test.video_views * 100).toFixed(1);
// Пример: 180/234 * 100 = 76.9%
```

---

### LLM Анализ

| Поле | Тип | Описание | Возможные значения |
|------|-----|----------|-------------------|
| `llm_score` | number \| null | Оценка от 0 до 100 | `0-100` |
| `llm_verdict` | string \| null | Вердикт | `'excellent'`, `'good'`, `'average'`, `'poor'` |
| `llm_reasoning` | string \| null | Общий анализ | Текст |
| `llm_video_analysis` | string \| null | Анализ видео | Текст |
| `llm_text_recommendations` | string \| null | Рекомендации | Текст |
| `transcript_match_quality` | string \| null | Качество соответствия | `'high'`, `'medium'`, `'low'`, `'N/A'` |
| `transcript_suggestions` | array \| null | Предложения по тексту | См. ниже |

**Формат `transcript_suggestions`:**
```json
[
  {
    "from": "Узнайте больше на нашем сайте",
    "to": "Напишите нам прямо сейчас",
    "reason": "Более четкий CTA увеличит конверсию"
  }
]
```

---

## 💻 ПРИМЕРЫ КОДА ДЛЯ FRONTEND

### 1. Чтение теста из Supabase

```typescript
const { data: test, error } = await supabase
  .from('creative_tests')
  .select('*')
  .eq('user_creative_id', creativeId)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (test) {
  console.log('Статус:', test.status);
  console.log('Показы:', test.impressions, '/', test.test_impressions_limit);
  console.log('Потрачено:', test.spend_cents / 100, 'USD');
}
```

---

### 2. Подписка на обновления (Realtime)

```typescript
const subscription = supabase
  .channel(`test:${testId}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'creative_tests',
      filter: `id=eq.${testId}`
    },
    (payload) => {
      const updatedTest = payload.new as CreativeTest;
      
      // Обновляем UI
      setImpressions(updatedTest.impressions);
      setSpend(updatedTest.spend_cents / 100);
      
      // Проверяем статус
      if (updatedTest.status === 'completed') {
        showResults(updatedTest);
      }
    }
  )
  .subscribe();
```

---

### 3. Компонент прогресса

```tsx
function TestProgress({ test }: { test: CreativeTest }) {
  const progress = (test.impressions / test.test_impressions_limit) * 100;
  
  return (
    <div className="test-progress">
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${progress}%` }}
        />
      </div>
      <p>{test.impressions} / {test.test_impressions_limit} показов</p>
      <p>Потрачено: ${(test.spend_cents / 100).toFixed(2)}</p>
    </div>
  );
}
```

---

### 4. Компонент метрик

```tsx
function TestMetrics({ test }: { test: CreativeTest }) {
  return (
    <div className="metrics-grid">
      <MetricCard
        label="Показы"
        value={test.impressions.toLocaleString()}
        icon="👁️"
      />
      <MetricCard
        label="Охват"
        value={test.reach.toLocaleString()}
        icon="👥"
      />
      <MetricCard
        label="CTR"
        value={`${test.ctr.toFixed(2)}%`}
        icon="🎯"
      />
      <MetricCard
        label="Лиды"
        value={test.leads}
        icon="✉️"
      />
      <MetricCard
        label="Потрачено"
        value={`$${(test.spend_cents / 100).toFixed(2)}`}
        icon="💰"
      />
      <MetricCard
        label="CPL"
        value={test.cpl_cents ? `$${(test.cpl_cents / 100).toFixed(2)}` : 'N/A'}
        icon="📊"
      />
    </div>
  );
}
```

---

### 5. Компонент LLM результатов

```tsx
function LLMResults({ test }: { test: CreativeTest }) {
  if (!test.llm_score) return null;
  
  const verdictConfig = {
    excellent: { emoji: '🌟', color: 'green', label: 'Отлично' },
    good: { emoji: '👍', color: 'blue', label: 'Хорошо' },
    average: { emoji: '😐', color: 'yellow', label: 'Средне' },
    poor: { emoji: '👎', color: 'red', label: 'Плохо' }
  };
  
  const verdict = verdictConfig[test.llm_verdict as keyof typeof verdictConfig];
  
  return (
    <div className="llm-results">
      <div className={`verdict verdict-${verdict.color}`}>
        <span>{verdict.emoji}</span>
        <span>{verdict.label}</span>
        <span className="score">{test.llm_score}/100</span>
      </div>
      
      <div className="analysis">
        <h4>Анализ</h4>
        <p>{test.llm_reasoning}</p>
      </div>
      
      {test.llm_video_analysis && (
        <div className="analysis">
          <h4>📹 Видео</h4>
          <p>{test.llm_video_analysis}</p>
        </div>
      )}
      
      {test.llm_text_recommendations && (
        <div className="analysis">
          <h4>✍️ Рекомендации</h4>
          <p>{test.llm_text_recommendations}</p>
        </div>
      )}
      
      {test.transcript_suggestions && test.transcript_suggestions.length > 0 && (
        <div className="suggestions">
          <h4>💡 Предложения по тексту</h4>
          {test.transcript_suggestions.map((s, i) => (
            <div key={i} className="suggestion">
              <span className="from">"{s.from}"</span>
              <span>→</span>
              <span className="to">"{s.to}"</span>
              <small>{s.reason}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 🔄 КОГДА ОБНОВЛЯЮТСЯ ДАННЫЕ

### Создание теста (POST /api/creative-test/start)
```typescript
// Backend создает запись:
{
  status: 'running',
  started_at: NOW(),
  impressions: 0,
  // все метрики = 0
}
```

---

### Cron (каждые 5 минут)
```sql
UPDATE creative_tests
SET 
  impressions = <данные из Facebook>,
  reach = <данные из Facebook>,
  clicks = <данные из Facebook>,
  -- и т.д.
  updated_at = NOW()
WHERE id = <test_id>
```

**Frontend видит обновления через Realtime или polling!**

---

### Завершение теста (impressions >= 1000)
```sql
UPDATE creative_tests
SET
  status = 'completed',
  completed_at = NOW(),
  llm_score = <от LLM>,
  llm_verdict = <от LLM>,
  llm_reasoning = <от LLM>,
  -- и т.д.
WHERE id = <test_id>
```

---

## ⚠️ ВАЖНЫЕ МОМЕНТЫ

### 1. Один тест = один креатив
```sql
UNIQUE(user_creative_id)
```
Нельзя запустить два теста для одного креатива одновременно.

---

### 2. Все цены в центах!
```typescript
// НЕПРАВИЛЬНО:
<p>Потрачено: ${test.spend_cents}</p> // 2000 вместо $20

// ПРАВИЛЬНО:
<p>Потрачено: ${(test.spend_cents / 100).toFixed(2)}</p> // $20.00
```

---

### 3. Метрики могут быть null
```typescript
// Всегда проверяй:
const cpl = test.cpl_cents ? test.cpl_cents / 100 : null;
const displayCPL = cpl ? `$${cpl.toFixed(2)}` : 'N/A';
```

---

### 4. Видео метрики могут быть 0
Если креатив не видео или нет просмотров:
```typescript
if (test.video_views > 0) {
  // Показываем видео метрики
}
```

---

## 📚 SQL QUERIES ДЛЯ REFERENCE

### Получить последний тест креатива
```sql
SELECT * FROM creative_tests
WHERE user_creative_id = 'uuid'
ORDER BY created_at DESC
LIMIT 1;
```

---

### Получить все активные тесты пользователя
```sql
SELECT * FROM creative_tests
WHERE user_id = 'uuid'
  AND status = 'running'
ORDER BY started_at DESC;
```

---

### Получить завершенные тесты с хорошими оценками
```sql
SELECT * FROM creative_tests
WHERE user_id = 'uuid'
  AND status = 'completed'
  AND llm_score >= 70
ORDER BY llm_score DESC;
```

---

## 🎨 РЕКОМЕНДАЦИИ ПО UI

### Статус бейдж
- **pending**: Серый, "⏳ Ожидание"
- **running**: Синий, "▶️ Тестируется"
- **completed**: Зеленый, "✅ Завершено"
- **failed**: Красный, "❌ Ошибка"

### Прогресс бар
```
Показы: [████████░░] 823/1000 (82%)
Потрачено: $16.45 / $20.00
```

### Оценка LLM
- **80-100**: 🌟 Отлично (зеленый)
- **60-79**: 👍 Хорошо (синий)
- **40-59**: 😐 Средне (желтый)
- **0-39**: 👎 Плохо (красный)

---

**Готово для интеграции!** 🚀

