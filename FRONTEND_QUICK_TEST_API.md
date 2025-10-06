# 🧪 API ДЛЯ БЫСТРОГО ТЕСТА КРЕАТИВОВ

## 📅 Дата: 6 октября 2025

---

## 🎯 ОБЩАЯ КОНЦЕПЦИЯ

Когда пользователь загружает видео и создает креатив, он может нажать кнопку **"Быстрый тест"** для автоматического запуска тестовой кампании в Facebook.

**Что происходит:**
1. Фронт отправляет webhook с ID креатива
2. Backend создает тестовую кампанию ($20/день, WhatsApp, 1000 показов)
3. Cron автоматически мониторит тест каждые 5 минут
4. При достижении 1000 показов:
   - AdSet ставится на паузу
   - LLM анализирует результаты
   - Статус меняется на "completed"
5. Фронт получает результаты через Supabase Realtime или периодический polling

---

## 🌐 WEBHOOK API

### Эндпоинт

```
POST https://agents.performanteaiagency.com/api/creative-test/start
```

**Локальная разработка:**
```
POST http://localhost:8080/api/creative-test/start
```

---

### Запрос

#### Headers
```json
{
  "Content-Type": "application/json"
}
```

#### Body
```json
{
  "user_creative_id": "48b5599f-68d5-4142-8e63-5f8d109439b8",
  "user_id": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"
}
```

#### Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `user_creative_id` | UUID | ✅ Да | ID креатива из таблицы `user_creatives` |
| `user_id` | UUID | ✅ Да | ID пользователя из таблицы `user_accounts` |

---

### Ответ

#### ✅ Успешный ответ (200 OK)

```json
{
  "success": true,
  "test_id": "5131a3ab-1ed0-4367-a9bb-67db4b26858d",
  "campaign_id": "120236557035220039",
  "adset_id": "120236557036410039",
  "ad_id": "120236557038040039",
  "rule_id": null,
  "message": "Creative test started. Budget: $20/day, Target: 1000 impressions"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `success` | boolean | `true` если тест создан |
| `test_id` | UUID | ID теста в таблице `creative_tests` |
| `campaign_id` | string | Facebook Campaign ID |
| `adset_id` | string | Facebook AdSet ID |
| `ad_id` | string | Facebook Ad ID |
| `rule_id` | null | ~~Auto Rule~~ (отключено, используется cron) |
| `message` | string | Информационное сообщение |

---

#### ❌ Ошибки

**1. Креатив уже тестируется**
```json
{
  "success": false,
  "error": "Test already running for this creative"
}
```
**HTTP Status:** 400 Bad Request

---

**2. Креатив не найден или не готов**
```json
{
  "success": false,
  "error": "Creative not found or not ready"
}
```
**HTTP Status:** 404 Not Found

---

**3. Пользователь не найден**
```json
{
  "success": false,
  "error": "User account not found"
}
```
**HTTP Status:** 404 Not Found

---

**4. Креатив не имеет WhatsApp версии**
```json
{
  "success": false,
  "error": "Creative does not have WhatsApp version (fb_creative_id_whatsapp required)"
}
```
**HTTP Status:** 400 Bad Request

---

## 📊 СТРУКТУРА ДАННЫХ В SUPABASE

### Таблица `creative_tests`

Фронт должен **читать** эту таблицу для отображения статуса и результатов.

#### Основные поля

```typescript
interface CreativeTest {
  // IDs
  id: string;                    // UUID теста
  user_creative_id: string;      // UUID креатива
  user_id: string;               // UUID пользователя
  
  // Facebook IDs
  campaign_id: string;           // Facebook Campaign ID
  adset_id: string;              // Facebook AdSet ID
  ad_id: string;                 // Facebook Ad ID
  rule_id: string | null;        // (не используется)
  
  // Конфигурация теста
  test_budget_cents: number;     // 2000 ($20)
  test_impressions_limit: number; // 1000
  objective: string;             // "WhatsApp"
  
  // Статус
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;            // ISO timestamp
  completed_at: string | null;   // ISO timestamp
  
  // ===== МЕТРИКИ (обновляются cron) =====
  
  // Базовые метрики
  impressions: number;           // Показы
  reach: number;                 // Охват
  frequency: number;             // Частота
  
  // Клики
  clicks: number;                // Все клики
  link_clicks: number;           // Клики по ссылке
  ctr: number;                   // Click-through rate (%)
  link_ctr: number;              // Link CTR (%)
  
  // Лиды
  leads: number;                 // Количество лидов
  
  // Стоимость
  spend_cents: number;           // Потрачено (центы)
  cpm_cents: number;             // Cost per 1000 impressions
  cpc_cents: number;             // Cost per click
  cpl_cents: number | null;      // Cost per lead
  
  // Видео метрики
  video_views: number;                  // Просмотры
  video_views_25_percent: number;       // Досмотрели 25%
  video_views_50_percent: number;       // Досмотрели 50%
  video_views_75_percent: number;       // Досмотрели 75%
  video_views_95_percent: number;       // Досмотрели 95%
  video_avg_watch_time_sec: number;     // Среднее время просмотра
  
  // ===== LLM АНАЛИЗ (заполняется после завершения) =====
  
  llm_score: number | null;              // Оценка 0-100
  llm_verdict: string | null;            // 'excellent' | 'good' | 'average' | 'poor'
  llm_reasoning: string | null;          // Общий анализ
  llm_video_analysis: string | null;     // Анализ видео
  llm_text_recommendations: string | null; // Рекомендации по тексту
  transcript_match_quality: string | null; // 'high' | 'medium' | 'low'
  transcript_suggestions: object | null;   // JSON с предложениями
  
  // Timestamps
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
}
```

---

## 🎨 ИНСТРУКЦИЯ ДЛЯ FRONTEND

### 1️⃣ КНОПКА "БЫСТРЫЙ ТЕСТ"

**Где отображать:**
- На карточке загруженного креатива
- В деталях креатива

**Условия для показа кнопки:**
```javascript
const canStartTest = 
  creative.status === 'ready' &&           // Креатив готов
  creative.is_active === true &&           // Креатив активен
  creative.fb_creative_id_whatsapp &&      // Есть WhatsApp версия
  !activeTest;                             // Нет активного теста
```

**Дизайн кнопки:**
```jsx
<button 
  onClick={handleStartTest}
  disabled={isLoading || activeTest}
  className="btn-primary"
>
  {isLoading ? '⏳ Запуск...' : '🧪 Быстрый тест'}
</button>
```

---

### 2️⃣ ЗАПУСК ТЕСТА (onClick)

```javascript
async function handleStartTest(creativeId, userId) {
  try {
    setIsLoading(true);
    setError(null);
    
    const response = await fetch('https://agents.performanteaiagency.com/api/creative-test/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_creative_id: creativeId,
        user_id: userId
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Не удалось запустить тест');
    }
    
    // Сохраняем test_id для мониторинга
    setActiveTestId(data.test_id);
    
    // Показываем успешное сообщение
    showNotification('✅ Тест запущен! Результаты будут через ~2-4 часа', 'success');
    
    // Начинаем мониторинг
    startTestMonitoring(data.test_id);
    
  } catch (error) {
    setError(error.message);
    showNotification('❌ ' + error.message, 'error');
  } finally {
    setIsLoading(false);
  }
}
```

---

### 3️⃣ МОНИТОРИНГ ТЕСТА

**Вариант A: Supabase Realtime (рекомендуется)**

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function startTestMonitoring(testId) {
  // Подписываемся на изменения
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
        const test = payload.new;
        
        // Обновляем UI
        updateTestUI(test);
        
        // Если завершен - показываем результаты
        if (test.status === 'completed') {
          showTestResults(test);
          subscription.unsubscribe();
        }
      }
    )
    .subscribe();
    
  return subscription;
}
```

---

**Вариант B: Polling (если Realtime недоступен)**

```javascript
async function pollTestStatus(testId) {
  const pollInterval = setInterval(async () => {
    try {
      const { data: test, error } = await supabase
        .from('creative_tests')
        .select('*')
        .eq('id', testId)
        .single();
      
      if (error) throw error;
      
      // Обновляем UI
      updateTestUI(test);
      
      // Если завершен - останавливаем polling
      if (test.status === 'completed' || test.status === 'failed') {
        clearInterval(pollInterval);
        showTestResults(test);
      }
      
    } catch (error) {
      console.error('Polling error:', error);
      clearInterval(pollInterval);
    }
  }, 30000); // Каждые 30 секунд
  
  return pollInterval;
}
```

---

### 4️⃣ ОТОБРАЖЕНИЕ СТАТУСА

```javascript
function TestStatusBadge({ status, impressions, limit }) {
  const statusConfig = {
    pending: {
      label: '⏳ Ожидание',
      color: 'gray',
      description: 'Подготовка теста...'
    },
    running: {
      label: '▶️ Тестируется',
      color: 'blue',
      description: `Показы: ${impressions}/${limit}`
    },
    completed: {
      label: '✅ Завершено',
      color: 'green',
      description: 'Анализ готов'
    },
    failed: {
      label: '❌ Ошибка',
      color: 'red',
      description: 'Что-то пошло не так'
    },
    cancelled: {
      label: '⛔ Отменено',
      color: 'gray',
      description: 'Тест остановлен'
    }
  };
  
  const config = statusConfig[status] || statusConfig.pending;
  
  return (
    <div className={`badge badge-${config.color}`}>
      <span>{config.label}</span>
      <small>{config.description}</small>
    </div>
  );
}
```

---

### 5️⃣ ОТОБРАЖЕНИЕ РЕЗУЛЬТАТОВ

```javascript
function TestResults({ test }) {
  if (test.status !== 'completed') return null;
  
  // Маппинг вердикта на UI
  const verdictConfig = {
    excellent: { label: 'Отлично', emoji: '🌟', color: 'green' },
    good: { label: 'Хорошо', emoji: '👍', color: 'blue' },
    average: { label: 'Средне', emoji: '😐', color: 'yellow' },
    poor: { label: 'Плохо', emoji: '👎', color: 'red' }
  };
  
  const verdict = verdictConfig[test.llm_verdict] || verdictConfig.average;
  
  return (
    <div className="test-results">
      <div className="results-header">
        <h3>Результаты теста</h3>
        <div className={`verdict verdict-${verdict.color}`}>
          <span className="emoji">{verdict.emoji}</span>
          <span className="label">{verdict.label}</span>
          <span className="score">{test.llm_score}/100</span>
        </div>
      </div>
      
      {/* Метрики */}
      <div className="metrics-grid">
        <MetricCard 
          label="Показы" 
          value={test.impressions} 
          icon="👁️"
        />
        <MetricCard 
          label="Охват" 
          value={test.reach} 
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
      
      {/* LLM Анализ */}
      <div className="llm-analysis">
        <h4>Анализ от AI</h4>
        <p>{test.llm_reasoning}</p>
        
        {test.llm_video_analysis && (
          <div className="analysis-section">
            <h5>📹 Анализ видео</h5>
            <p>{test.llm_video_analysis}</p>
          </div>
        )}
        
        {test.llm_text_recommendations && (
          <div className="analysis-section">
            <h5>✍️ Рекомендации по тексту</h5>
            <p>{test.llm_text_recommendations}</p>
          </div>
        )}
        
        {test.transcript_suggestions && test.transcript_suggestions.length > 0 && (
          <div className="analysis-section">
            <h5>💡 Предложения по изменению текста</h5>
            {test.transcript_suggestions.map((suggestion, i) => (
              <div key={i} className="suggestion">
                <span className="from">"{suggestion.from}"</span>
                <span className="arrow">→</span>
                <span className="to">"{suggestion.to}"</span>
                <small className="reason">{suggestion.reason}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 🔄 ПОЛНЫЙ FLOW

```
[Пользователь]
    ↓ Нажимает "Быстрый тест"
    
[Frontend]
    ↓ POST /api/creative-test/start
    
[Backend]
    ↓ Создает Campaign/AdSet/Ad в Facebook
    ↓ Сохраняет в creative_tests (status: 'running')
    ↓ Возвращает test_id
    
[Frontend]
    ↓ Показывает "Тестируется..."
    ↓ Подписывается на обновления (Realtime)
    
[Cron каждые 5 минут]
    ↓ Проверяет impressions
    ↓ Обновляет метрики в creative_tests
    
[Когда impressions >= 1000]
    ↓ Паузит AdSet через Facebook API
    ↓ Вызывает Analyzer Service (LLM)
    
[Analyzer Service]
    ↓ Анализирует метрики + транскрипцию
    ↓ Генерирует оценку, вердикт, рекомендации
    ↓ Сохраняет в creative_tests (status: 'completed')
    
[Frontend через Realtime]
    ↓ Получает обновление
    ↓ Показывает результаты
    ↓ "✅ Завершено! LLM Score: 78/100"
```

---

## ⚠️ ВАЖНЫЕ МОМЕНТЫ

### 1. Один тест = один креатив

```sql
UNIQUE(user_creative_id)
```

Нельзя запустить **два теста** для одного креатива одновременно.

**Проверка перед запуском:**
```javascript
const { data: existingTest } = await supabase
  .from('creative_tests')
  .select('id, status')
  .eq('user_creative_id', creativeId)
  .in('status', ['pending', 'running'])
  .single();

if (existingTest) {
  alert('Для этого креатива уже запущен тест!');
  return;
}
```

---

### 2. Фиксированный бюджет $20

Тест **всегда** запускается с `test_budget_cents = 2000` ($20).

Это **не влияет** на общий дневной бюджет аккаунта (Brain Agent игнорирует тестовые кампании).

---

### 3. Время выполнения теста

**Ориентировочно:** 2-4 часа до достижения 1000 показов.

Зависит от:
- Таргетинга (дефолтный: Россия/Казахстан)
- Времени суток
- Качества креатива

---

### 4. Название тестовой кампании

```
ТЕСТ | Ad: {creative_id} | {дата} | {название}
```

Это позволяет Brain Agent **игнорировать** тестовые кампании при оптимизации.

---

## 📱 ПРИМЕР UI

```jsx
function CreativeCard({ creative, userId }) {
  const [activeTest, setActiveTest] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Загружаем активный тест при монтировании
  useEffect(() => {
    loadActiveTest();
  }, [creative.id]);
  
  async function loadActiveTest() {
    const { data } = await supabase
      .from('creative_tests')
      .select('*')
      .eq('user_creative_id', creative.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    setActiveTest(data);
  }
  
  async function handleStartTest() {
    // ... (см. выше)
  }
  
  return (
    <div className="creative-card">
      <img src={creative.video_url} alt={creative.title} />
      
      <h3>{creative.title}</h3>
      <p>{creative.description}</p>
      
      {/* Статус теста */}
      {activeTest && (
        <TestStatusBadge 
          status={activeTest.status}
          impressions={activeTest.impressions}
          limit={activeTest.test_impressions_limit}
        />
      )}
      
      {/* Кнопка запуска */}
      {!activeTest && creative.status === 'ready' && (
        <button 
          onClick={handleStartTest}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Запуск...' : '🧪 Быстрый тест'}
        </button>
      )}
      
      {/* Результаты */}
      {activeTest?.status === 'completed' && (
        <TestResults test={activeTest} />
      )}
    </div>
  );
}
```

---

## 📚 ССЫЛКИ

- **Backend API:** `services/agent-service/src/routes/creativeTest.ts`
- **Workflow:** `services/agent-service/src/workflows/creativeTest.ts`
- **Cron:** `services/agent-service/src/cron/creativeTestChecker.ts`
- **Analyzer:** `services/agent-brain/src/analyzerService.js`
- **Миграция:** `migrations/006_creative_tests.sql`

---

**Готово для интеграции!** 🎉

