# 🎨 Creative Analytics - Интеграция для фронтенда

**Дата:** 17 октября 2025  
**Для:** Frontend разработчиков

---

## 🎯 Что это?

Новый API для получения **полной аналитики креатива**:
- Результаты теста (если был)
- Реальная статистика из рекламы (если используется)
- LLM анализ с оценкой 0-100
- Видео метрики (где теряем внимание)

**Один запрос = все данные** 📊

---

## 🚀 Быстрый старт

### 1. Endpoint

```
GET http://localhost:7081/api/analyzer/creative-analytics/:creative_id?user_id=xxx
```

### 2. Минимальный пример (JavaScript)

```javascript
async function getCreativeAnalytics(creativeId, userId) {
  const response = await fetch(
    `http://localhost:7081/api/analyzer/creative-analytics/${creativeId}?user_id=${userId}`
  );
  
  if (!response.ok) {
    throw new Error('Failed to load analytics');
  }
  
  return await response.json();
}

// Использование
const data = await getCreativeAnalytics('abc-123', 'user-456');
console.log(data);
```

---

## 📊 Структура ответа

### Основные поля:

```typescript
interface CreativeAnalytics {
  // Информация о креативе
  creative: {
    id: string;
    title: string;
    status: string;
    direction_name: string | null;
  };
  
  // Откуда данные: 'production' | 'test' | 'none'
  data_source: string;
  
  // Результаты теста (если был)
  test: TestData | null;
  
  // Production метрики (если используется)
  production: ProductionData | null;
  
  // LLM анализ
  analysis: Analysis | null;
  
  // Из кеша?
  from_cache: boolean;
}
```

### Полный TypeScript интерфейс:

```typescript
interface CreativeAnalytics {
  creative: {
    id: string;
    title: string;
    status: string;
    direction_id: string | null;
    direction_name: string | null;
  };
  
  data_source: 'production' | 'test' | 'none';
  
  test: {
    exists: boolean;
    status: string;
    completed_at: string;
    metrics: {
      impressions: number;
      reach: number;
      leads: number;
      cpl_cents: number | null;
      ctr: number;
      video_views: number;
      video_views_25_percent: number;
      video_views_50_percent: number;
      video_views_75_percent: number;
      video_views_95_percent: number;
    };
    llm_analysis: {
      score: number;
      verdict: string;
      reasoning: string;
    };
  } | null;
  
  production: {
    in_use: boolean;
    metrics: {
      impressions: number;
      reach: number;
      frequency: number;
      clicks: number;
      link_clicks: number;
      ctr: number;
      link_ctr: number;
      leads: number;
      spend_cents: number;
      cpm_cents: number;
      cpc_cents: number;
      cpl_cents: number | null;
      video_views: number;
      video_views_25_percent: number;
      video_views_50_percent: number;
      video_views_75_percent: number;
      video_views_95_percent: number;
      video_avg_watch_time_sec: number;
    };
  } | null;
  
  analysis: {
    score: number;
    verdict: 'excellent' | 'good' | 'average' | 'poor';
    reasoning: string;
    video_analysis: string;
    text_recommendations: string;
    transcript_match_quality: 'high' | 'medium' | 'low';
    transcript_suggestions: Array<{
      from: string;
      to: string;
      reason: string;
      position: 'начало' | 'середина' | 'конец';
    }>;
    based_on: 'production' | 'test';
    note: string;
  } | null;
  
  from_cache: boolean;
  cached_at?: string;
}
```

---

## 🎨 React компонент (пример)

```jsx
import React, { useState, useEffect } from 'react';

function CreativeAnalytics({ creativeId, userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(
          `http://localhost:7081/api/analyzer/creative-analytics/${creativeId}?user_id=${userId}`
        );
        
        if (!response.ok) {
          throw new Error('Failed to load analytics');
        }
        
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [creativeId, userId]);

  if (loading) return <div>Загрузка...</div>;
  if (error) return <div>Ошибка: {error}</div>;
  if (!data) return null;

  // Нет данных
  if (data.data_source === 'none') {
    return (
      <div className="no-data">
        <p>📊 Креатив не тестировался и не используется в рекламе</p>
        <button>Запустить быстрый тест</button>
      </div>
    );
  }

  // Есть данные
  const metrics = data.production?.metrics || data.test?.metrics;
  const analysis = data.analysis;

  return (
    <div className="creative-analytics">
      <h2>{data.creative.title}</h2>
      
      {/* Источник данных */}
      <div className="data-source">
        {data.data_source === 'production' ? '⚡ Production' : '🧪 Тест'}
      </div>
      
      {/* Скоринг */}
      <div className="scoring">
        <div className="score">{analysis.score}/100</div>
        <div className="verdict">{getVerdictEmoji(analysis.verdict)} {analysis.verdict}</div>
      </div>
      
      {/* Метрики */}
      <div className="metrics">
        <div className="metric">
          <label>CPL</label>
          <value>${(metrics.cpl_cents / 100).toFixed(2)}</value>
        </div>
        <div className="metric">
          <label>CTR</label>
          <value>{metrics.ctr.toFixed(2)}%</value>
        </div>
        <div className="metric">
          <label>Лиды</label>
          <value>{metrics.leads}</value>
        </div>
        <div className="metric">
          <label>Показы</label>
          <value>{metrics.impressions.toLocaleString()}</value>
        </div>
      </div>
      
      {/* Видео retention */}
      {metrics.video_views > 0 && (
        <div className="video-retention">
          <h3>Видео retention</h3>
          <VideoRetentionBar metrics={metrics} />
        </div>
      )}
      
      {/* LLM анализ */}
      <div className="llm-analysis">
        <h3>Анализ</h3>
        <p>{analysis.reasoning}</p>
        
        <h4>Видео:</h4>
        <p>{analysis.video_analysis}</p>
        
        <h4>Рекомендации:</h4>
        <p>{analysis.text_recommendations}</p>
      </div>
      
      {/* Рекомендации по тексту */}
      {analysis.transcript_suggestions?.length > 0 && (
        <div className="suggestions">
          <h3>Что изменить в тексте:</h3>
          {analysis.transcript_suggestions.map((s, i) => (
            <div key={i} className="suggestion">
              <div className="from">❌ "{s.from}"</div>
              <div className="to">✅ "{s.to}"</div>
              <div className="reason">{s.reason}</div>
            </div>
          ))}
        </div>
      )}
      
      {/* Индикатор кеша */}
      {data.from_cache && (
        <div className="cache-info">
          ℹ️ Данные из кеша (обновлено {getTimeAgo(data.cached_at)})
        </div>
      )}
    </div>
  );
}

function getVerdictEmoji(verdict) {
  const emojis = {
    excellent: '⭐⭐⭐',
    good: '⭐⭐',
    average: '⭐',
    poor: '❌'
  };
  return emojis[verdict] || '❓';
}

function VideoRetentionBar({ metrics }) {
  const total = metrics.video_views;
  const percent25 = (metrics.video_views_25_percent / total) * 100;
  const percent50 = (metrics.video_views_50_percent / total) * 100;
  const percent75 = (metrics.video_views_75_percent / total) * 100;
  const percent95 = (metrics.video_views_95_percent / total) * 100;
  
  return (
    <div className="retention-bars">
      <div className="bar">
        <label>25%</label>
        <div className="progress" style={{ width: `${percent25}%` }}></div>
        <span>{percent25.toFixed(1)}%</span>
      </div>
      <div className="bar">
        <label>50%</label>
        <div className="progress" style={{ width: `${percent50}%` }}></div>
        <span>{percent50.toFixed(1)}%</span>
      </div>
      <div className="bar">
        <label>75%</label>
        <div className="progress" style={{ width: `${percent75}%` }}></div>
        <span>{percent75.toFixed(1)}%</span>
      </div>
      <div className="bar">
        <label>95%</label>
        <div className="progress" style={{ width: `${percent95}%` }}></div>
        <span>{percent95.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export default CreativeAnalytics;
```

---

## 🎨 Vue.js компонент (пример)

```vue
<template>
  <div class="creative-analytics">
    <div v-if="loading">Загрузка...</div>
    <div v-else-if="error">Ошибка: {{ error }}</div>
    
    <div v-else-if="data">
      <!-- Нет данных -->
      <div v-if="data.data_source === 'none'" class="no-data">
        <p>📊 Креатив не тестировался и не используется в рекламе</p>
        <button @click="$emit('start-test')">Запустить быстрый тест</button>
      </div>
      
      <!-- Есть данные -->
      <div v-else>
        <h2>{{ data.creative.title }}</h2>
        
        <!-- Источник -->
        <div class="badge">
          {{ data.data_source === 'production' ? '⚡ Production' : '🧪 Тест' }}
        </div>
        
        <!-- Скоринг -->
        <div class="scoring">
          <div class="score">{{ data.analysis.score }}/100</div>
          <div class="verdict">
            {{ getVerdictEmoji(data.analysis.verdict) }} 
            {{ data.analysis.verdict }}
          </div>
        </div>
        
        <!-- Метрики -->
        <div class="metrics-grid">
          <div class="metric">
            <span class="label">CPL</span>
            <span class="value">${{ formatCents(metrics.cpl_cents) }}</span>
          </div>
          <div class="metric">
            <span class="label">CTR</span>
            <span class="value">{{ metrics.ctr.toFixed(2) }}%</span>
          </div>
          <div class="metric">
            <span class="label">Лиды</span>
            <span class="value">{{ metrics.leads }}</span>
          </div>
          <div class="metric">
            <span class="label">Показы</span>
            <span class="value">{{ metrics.impressions.toLocaleString() }}</span>
          </div>
        </div>
        
        <!-- Анализ -->
        <div class="analysis">
          <h3>Анализ</h3>
          <p>{{ data.analysis.reasoning }}</p>
          
          <h4>Видео:</h4>
          <p>{{ data.analysis.video_analysis }}</p>
          
          <h4>Рекомендации:</h4>
          <p>{{ data.analysis.text_recommendations }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'CreativeAnalytics',
  props: {
    creativeId: {
      type: String,
      required: true
    },
    userId: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      data: null,
      loading: false,
      error: null
    };
  },
  computed: {
    metrics() {
      return this.data?.production?.metrics || this.data?.test?.metrics;
    }
  },
  mounted() {
    this.fetchAnalytics();
  },
  methods: {
    async fetchAnalytics() {
      this.loading = true;
      this.error = null;
      
      try {
        const response = await fetch(
          `http://localhost:7081/api/analyzer/creative-analytics/${this.creativeId}?user_id=${this.userId}`
        );
        
        if (!response.ok) {
          throw new Error('Failed to load analytics');
        }
        
        this.data = await response.json();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },
    formatCents(cents) {
      return cents ? (cents / 100).toFixed(2) : 'N/A';
    },
    getVerdictEmoji(verdict) {
      const emojis = {
        excellent: '⭐⭐⭐',
        good: '⭐⭐',
        average: '⭐',
        poor: '❌'
      };
      return emojis[verdict] || '❓';
    }
  }
};
</script>
```

---

## 💡 Практические советы

### 1. Обработка состояний

```javascript
function renderAnalytics(data) {
  // Случай 1: Нет данных
  if (data.data_source === 'none') {
    return {
      title: 'Нет данных',
      message: 'Креатив не тестировался и не используется в рекламе',
      action: 'Запустить быстрый тест'
    };
  }
  
  // Случай 2: Только тест
  if (data.data_source === 'test') {
    return {
      title: 'Результаты теста',
      badge: '🧪 Тест',
      note: 'Креатив не используется в рекламе',
      metrics: data.test.metrics,
      analysis: data.analysis
    };
  }
  
  // Случай 3: Production (приоритет)
  if (data.data_source === 'production') {
    return {
      title: 'Статистика из рекламы',
      badge: '⚡ Production',
      note: 'Реальные данные из объявлений',
      metrics: data.production.metrics,
      analysis: data.analysis,
      showTest: data.test?.exists // Можно раскрыть тест
    };
  }
}
```

### 2. Форматирование метрик

```javascript
// Центы в доллары
function formatCPL(cents) {
  return cents ? `$${(cents / 100).toFixed(2)}` : 'N/A';
}

// Процент досмотра видео
function formatRetention(views, total) {
  return total > 0 ? `${((views / total) * 100).toFixed(1)}%` : '0%';
}

// Большие числа
function formatNumber(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
```

### 3. Индикатор кеша (опционально)

```jsx
{data.from_cache && (
  <div className="cache-indicator">
    ℹ️ Обновлено {formatTimeAgo(data.cached_at)}
    <button onClick={() => fetchAnalytics(true)}>
      🔄 Обновить сейчас
    </button>
  </div>
)}
```

```javascript
// Принудительное обновление (игнорировать кеш)
async function fetchAnalytics(force = false) {
  const url = `http://localhost:7081/api/analyzer/creative-analytics/${creativeId}?user_id=${userId}${force ? '&force=true' : ''}`;
  const response = await fetch(url);
  return await response.json();
}
```

---

## 🎯 UI/UX рекомендации

### Что показывать в приоритете:

**Production (если есть):**
```
⚡ PRODUCTION
━━━━━━━━━━━━━━━━━━━━━━━
CPL: $1.98   Лиды: 450
CTR: 3.21%   Показы: 45.2K

⭐⭐ Оценка: 72/100 (Good)
"Креатив стабилен, можно масштабировать"

ℹ️ Тест был проведен ранее (75/100) ▼
```

**Только тест:**
```
🧪 ТЕСТ
━━━━━━━━━━━━━━━━━━━━━━━
CPL: $1.50   Лиды: 12
CTR: 4.29%   Показы: 1,050

⭐⭐ Оценка: 75/100 (Good)
"Хорошие результаты теста"

⚠️ Креатив не используется в рекламе
[Создать кампанию]
```

### Видео retention (красиво)

```
Досмотры видео:
▓▓▓▓▓▓▓▓▓░ 25%  84.7%
▓▓▓▓▓▓░░░░ 50%  61.2%
▓▓▓▓░░░░░░ 75%  36.5% ⚠️ Падение здесь
▓▓░░░░░░░░ 95%  21.2%
```

### Цвета для verdict

```css
.verdict.excellent { color: #22c55e; } /* Зеленый */
.verdict.good { color: #3b82f6; } /* Синий */
.verdict.average { color: #f59e0b; } /* Оранжевый */
.verdict.poor { color: #ef4444; } /* Красный */
```

---

## 🔄 Обновление данных

### Автоматическое обновление (опционально)

```javascript
useEffect(() => {
  // Первая загрузка
  fetchAnalytics();
  
  // Обновление каждые 5 минут (если на странице)
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchAnalytics();
    }
  }, 5 * 60 * 1000);
  
  return () => clearInterval(interval);
}, [creativeId, userId]);
```

**НО:** Кеш работает 10 минут, поэтому частые запросы не нужны!

---

## ⚠️ Обработка ошибок

```javascript
async function fetchAnalytics(creativeId, userId) {
  try {
    const response = await fetch(
      `http://localhost:7081/api/analyzer/creative-analytics/${creativeId}?user_id=${userId}`
    );
    
    // 404 - креатив не найден
    if (response.status === 404) {
      return { error: 'Креатив не найден' };
    }
    
    // 400 - неверные параметры
    if (response.status === 400) {
      return { error: 'Неверные параметры запроса' };
    }
    
    // 500 - ошибка сервера
    if (response.status === 500) {
      return { error: 'Ошибка сервера. Попробуйте позже.' };
    }
    
    return await response.json();
    
  } catch (error) {
    // Сеть недоступна
    return { error: 'Не удалось загрузить данные. Проверьте соединение.' };
  }
}
```

---

## 🧪 Тестирование на фронте

### В консоли браузера:

```javascript
// Тест
const data = await fetch('http://localhost:7081/api/analyzer/creative-analytics/YOUR_CREATIVE_ID?user_id=YOUR_USER_ID')
  .then(r => r.json());

console.log('Data source:', data.data_source);
console.log('Score:', data.analysis?.score);
console.log('Verdict:', data.analysis?.verdict);
console.log('From cache:', data.from_cache);
```

### С помощью React DevTools / Vue DevTools:

Компонент должен показывать:
- `loading: true` → `false`
- `data: null` → объект с данными
- `error: null` (если нет ошибки)

---

## 📱 Мобильная версия

```jsx
// Компактный вид для мобильных
<div className="creative-card-mobile">
  <div className="header">
    <h3>{creative.title}</h3>
    <span className="score">{analysis.score}/100</span>
  </div>
  
  <div className="key-metrics">
    <div>CPL: ${formatCPL(metrics.cpl_cents)}</div>
    <div>Лиды: {metrics.leads}</div>
  </div>
  
  <button onClick={showDetails}>Подробнее</button>
</div>
```

---

## ✅ Чеклист интеграции

- [ ] Установлен базовый запрос к API
- [ ] Обрабатывается `data_source` (production/test/none)
- [ ] Отображается скоринг (score, verdict)
- [ ] Показываются ключевые метрики (CPL, CTR, лиды)
- [ ] Видео retention визуализирован
- [ ] LLM анализ отображается
- [ ] Рекомендации по тексту видны
- [ ] Обработка ошибок (404, 400, 500)
- [ ] Loading state
- [ ] Индикатор кеша (опционально)
- [ ] Кнопка обновления (опционально)

---

## 🆘 Частые вопросы

**Q: Почему данные не обновляются сразу?**  
A: Кеш работает 10 минут. Используй `force=true` для обновления.

**Q: Почему показывает production, а не тест?**  
A: Production приоритетнее - это ожидаемое поведение. Реальные данные актуальнее теста.

**Q: Где видео метрики?**  
A: В `metrics.video_views_*` - доступны и для теста, и для production.

**Q: Что делать если `data_source === 'none'`?**  
A: Показать кнопку "Запустить быстрый тест".

**Q: Нужно ли показывать тест, если есть production?**  
A: Опционально. Можно спрятать в раскрывающийся блок "История теста".

---

## 📚 Дополнительные ресурсы

- **API документация:** `CREATIVE_ANALYTICS_API.md`
- **Примеры запросов:** `CREATIVE_ANALYTICS_QUICK_START.md`
- **TypeScript типы:** см. раздел "Структура ответа" выше

---

## 🎉 Готово!

Теперь у тебя есть все для интеграции! 🚀

**Нужна помощь?** Пиши! 😊

