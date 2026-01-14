/**
 * Brain Agent Rules — общие правила принятия решений
 * Используется для унификации логики между Brain-агентом и AdsAgent
 */

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Health Score классы и пороги
 * HS ∈ [-100; +100]
 */
export const HS_CLASSES = {
  VERY_GOOD: 25,     // ≥ +25
  GOOD: 5,           // +5..+24
  NEUTRAL_LOW: -5,   // -5..+4
  SLIGHTLY_BAD: -25, // -25..-6
  BAD: -100          // ≤ -25
};

/**
 * Ограничения бюджетов
 */
export const BUDGET_LIMITS = {
  MAX_INCREASE_PCT: 30,   // +30% max за шаг
  MAX_DECREASE_PCT: 50,   // -50% max за шаг
  MIN_CENTS: 300,         // $3 минимум
  MAX_CENTS: 10000,       // $100 максимум
  NEW_ADSET_MIN: 1000,    // $10 минимум для нового adset
  NEW_ADSET_MAX: 2000     // $20 максимум для нового adset
};

/**
 * Таймфреймы с весами для анализа
 */
export const TIMEFRAME_WEIGHTS = {
  yesterday: 0.50,  // 50% — приоритет
  last_3d: 0.25,    // 25%
  last_7d: 0.15,    // 15%
  last_30d: 0.10    // 10%
};

/**
 * Пороги для Today-компенсации
 */
export const TODAY_COMPENSATION = {
  FULL: 0.5,      // eCPL_today ≤ 0.5 × eCPL_yesterday → полная компенсация
  PARTIAL: 0.7,   // eCPL_today ≤ 0.7 × eCPL_yesterday → 60% компенсация
  SLIGHT: 0.9     // eCPL_today ≤ 0.9 × eCPL_yesterday → +5 бонус
};

/**
 * Минимальные пороги для надёжных выводов
 */
export const VOLUME_THRESHOLDS = {
  MIN_IMPRESSIONS: 1000,  // Минимум показов для выводов
  MIN_CONVERSIONS: 3,     // Минимум конверсий (leads или link_clicks) для расчёта
  TODAY_MIN_IMPRESSIONS: 300  // Минимум показов сегодня для компенсации
};

/**
 * Пороги для определения ads-пожирателей
 * Объявления, которые тратят бюджет без результата
 */
export const AD_EATER_THRESHOLDS = {
  MIN_SPEND_FOR_ANALYSIS: 3,    // $3 минимум (как BUDGET_LIMITS.MIN_CENTS / 100)
  MIN_IMPRESSIONS: 300,          // Минимум показов (как TODAY_MIN_IMPRESSIONS)
  CPL_CRITICAL_MULTIPLIER: 3,    // CPL > 3x от таргета = критично
  SPEND_SHARE_CRITICAL: 0.5      // >50% бюджета адсета без результата
};

/**
 * Временные ограничения для создания новых adsets
 *
 * Причина: новый adset начинает откручивать бюджет не сразу.
 * Если запустить во второй половине дня — за несколько часов
 * он потратит весь суточный бюджет, а алгоритмы FB не успеют
 * оптимизироваться. Это обычно приводит к плохим результатам.
 */
export const ADSET_CREATION_TIME_LIMITS = {
  TIMEZONE: 'Asia/Almaty',       // UTC+5 (Алматы)
  CUTOFF_HOUR: 18,               // После 18:00 не создавать новые adsets
  REASON: 'Создание новых адсетов после 18:00 не рекомендуется — алгоритмы FB не успеют оптимизироваться за оставшееся время суток'
};

/**
 * Проверяет, разрешено ли создавать новые adsets в текущее время
 * @param {Object} options - Опции
 * @param {Object} options.logger - Логгер для записи результатов (опционально)
 * @returns {{ allowed: boolean, currentHour: number, currentTime: string, reason?: string }}
 */
export function isAllowedToCreateAdsets(options = {}) {
  const { logger } = options;
  const now = new Date();

  try {
    // Получаем текущий час по времени Алматы (UTC+5)
    const almatyHour = new Intl.DateTimeFormat('en-US', {
      timeZone: ADSET_CREATION_TIME_LIMITS.TIMEZONE,
      hour: 'numeric',
      hour12: false
    }).format(now);

    // Получаем полное время для логов
    const almatyFullTime = new Intl.DateTimeFormat('ru-RU', {
      timeZone: ADSET_CREATION_TIME_LIMITS.TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(now);

    const currentHour = parseInt(almatyHour, 10);
    const allowed = currentHour < ADSET_CREATION_TIME_LIMITS.CUTOFF_HOUR;

    const result = {
      allowed,
      currentHour,
      currentTime: almatyFullTime,
      timezone: ADSET_CREATION_TIME_LIMITS.TIMEZONE,
      cutoffHour: ADSET_CREATION_TIME_LIMITS.CUTOFF_HOUR,
      reason: allowed ? undefined : ADSET_CREATION_TIME_LIMITS.REASON
    };

    // Логируем результат проверки если передан logger
    if (logger) {
      logger.info({
        where: 'isAllowedToCreateAdsets',
        phase: 'time_check',
        allowed: result.allowed,
        current_hour: result.currentHour,
        current_time: result.currentTime,
        cutoff_hour: result.cutoffHour,
        timezone: result.timezone,
        message: allowed
          ? `Создание adsets разрешено (${almatyFullTime} < ${ADSET_CREATION_TIME_LIMITS.CUTOFF_HOUR}:00)`
          : `Создание adsets заблокировано (${almatyFullTime} >= ${ADSET_CREATION_TIME_LIMITS.CUTOFF_HOUR}:00)`
      });
    }

    return result;
  } catch (error) {
    // В случае ошибки — разрешаем создание (fail-open), но логируем ошибку
    if (logger) {
      logger.error({
        where: 'isAllowedToCreateAdsets',
        phase: 'error',
        error: error.message,
        stack: error.stack,
        message: 'Ошибка проверки времени, разрешаем создание adsets (fail-open)'
      });
    }

    return {
      allowed: true,
      currentHour: -1,
      currentTime: 'error',
      timezone: ADSET_CREATION_TIME_LIMITS.TIMEZONE,
      cutoffHour: ADSET_CREATION_TIME_LIMITS.CUTOFF_HOUR,
      reason: undefined,
      error: error.message
    };
  }
}

// =============================================================================
// ПРОМПТ ДЛЯ ADSAGENT
// =============================================================================

/**
 * Генерирует текст правил Brain для включения в промпт AdsAgent
 * @returns {string} Текст правил
 */
export function getBrainRulesPrompt() {
  return `
## Логика принятия решений (синхронизировано с Brain-агентом)

### Health Score (HS) — оценка эффективности
HS ∈ [-100; +100] — интегральная оценка ad set / кампании:

**Компоненты HS:**
1. **Gap к таргету** (вес 45) — CPL для lead-кампаний, CPC для Instagram Traffic:
   - ≥30% дешевле плана → +45
   - 10-30% дешевле → +30
   - ±10% от плана → +10/-10
   - 10-30% дороже → -30
   - ≥30% дороже → -45

2. **Тренды** (вес до 15):
   - 3d vs 7d, 7d vs 30d
   - Улучшение → + до 15
   - Ухудшение → - до 15

3. **Диагностика** (до -30):
   - CTR < 1% → -8 (слабый креатив)
   - CPM > медианы на ≥30% → -12 (дорогой аукцион)
   - Frequency 30d > 2 → -10 (выгорание)

4. **Новизна** (<48ч):
   - Максимум -10 штраф
   - Множитель 0.7 (не дёргать резко)

5. **Объём** (impr < 1000):
   - Множитель доверия 0.6...1.0
   - Меньше данных → осторожнее выводы

6. **Today-компенсация** (ВАЖНО!):
   - Если сегодня стоимость (CPL/CPC) в 2 раза лучше вчера → ПОЛНАЯ компенсация штрафов
   - Хорошие результаты СЕГОДНЯ перевешивают плохие ВЧЕРА!

**Классы HS:**
| Класс | Диапазон | Значение |
|-------|----------|----------|
| very_good | ≥ +25 | Отличный, масштабировать |
| good | +5..+24 | Хороший, держать |
| neutral | -5..+4 | Нейтральный, наблюдать |
| slightly_bad | -25..-6 | Немного плохой, снижать |
| bad | ≤ -25 | Плохой, пауза/резкое снижение |

### Матрица действий по классу HS

| HS Класс | Действие | Детали |
|----------|----------|--------|
| **very_good** | Масштабировать | +10..+30% бюджета |
| **good** | Держать | При недоборе плана: +0..+10% |
| **neutral** | Держать | Проверить "пожирателей" (≥50% spend, плохой eCPL) |
| **slightly_bad** | Снижать | -20..-50%; ротация креативов |
| **bad** | Пауза/снижение | -50% если CPL x2-3; полная пауза если CPL > x3 |

### Ограничения бюджетов

⚠️ **ЖЁСТКИЕ ПРАВИЛА:**
- Повышение за шаг: максимум **+30%**
- Снижение за шаг: максимум **-50%**
- Диапазон бюджета: **$3..$100** (300..10000 центов)
- Новый ad set: **$10-$20** (не больше!)

### ⏰ Временное ограничение создания adsets

⚠️ **НЕ предлагай создавать новые adsets после 14:00 по времени Алматы (UTC+5)!**

Причина: новый adset начинает откручивать бюджет не сразу. Если запустить во второй
половине дня — за несколько часов он потратит весь суточный бюджет, а алгоритмы
Facebook не успеют оптимизироваться. Это обычно приводит к плохим результатам.

- До 14:00 — можно предлагать создание новых adsets
- После 14:00 — НЕ предлагай создание, только оптимизируй существующие

### Работа с направлениями (Directions)

Каждое направление — отдельная бизнес-вертикаль:
- **СВОЙ суточный бюджет** (direction_daily_budget_cents)
- **СВОЙ целевой показатель** (direction_target_cpl_cents — универсальное поле)
- Сумма бюджетов ad sets **НЕ ДОЛЖНА** превышать бюджет направления

⚠️ **Метрика зависит от objective направления:**
| Objective | Метрика | Формула | Что оптимизируем |
|-----------|---------|---------|------------------|
| whatsapp, lead_forms, site_leads | **CPL** (Cost per Lead) | spend / leads | Стоимость заявки |
| instagram_traffic | **CPC** (Cost per Click) | spend / link_clicks | Стоимость перехода |

- Для **Instagram Traffic**: target_cpl_cents = целевая стоимость перехода (link click)
- Для остальных: target_cpl_cents = целевая стоимость заявки (lead)
- Health Score рассчитывается относительно соответствующей метрики!

**Коридор бюджета направления:**
- Нижняя граница: 95% от плана
- Верхняя граница: 105% от плана (небольшой перебор допустим)

### Таймфреймы и веса

| Период | Вес | Описание |
|--------|-----|----------|
| yesterday | 50% | Приоритет — последний день |
| last_3d | 25% | Краткосрочный тренд |
| last_7d | 15% | Среднесрочный тренд |
| last_30d | 10% | Долгосрочный тренд |

**Today-компенсация:**
- Если impr_today ≥ 300 и cost_today (CPL/CPC) значительно лучше cost_yesterday:
  - В 2 раза лучше → ПОЛНАЯ компенсация вчерашних штрафов
  - На 30% лучше → 60% компенсация
  - Легкое улучшение → +5 бонус

### Best-of-bad логика

Если НЕТ ad sets с HS ≥ +25 (very_good):
1. Выбираем ad set с **максимальным HS** как опорный
2. Используем его для добора бюджета малыми шагами (+10-20%)
3. Рассматриваем создание нового ad set с другими креативами

### Использование Scoring данных

**Приоритет:**
1. **High risk от Scoring = ПРИОРИТЕТ** — даже если HS хороший
2. **Предикшен CPL +30%** за 3 дня → превентивные меры
3. **unused_creatives** → тестировать новый контент (приоритет!)
4. **ready_creatives** → ротация проверенных креативов
5. **ROI данные** — учитывать реальную окупаемость

**ROI интерпретация:**
- ROI > 100% → ПРИОРИТЕТ для масштабирования (даже если CPL высокий!)
- ROI 50-100% → хороший, держать
- ROI 0-50% → можно использовать, следить
- ROI < 0% → ОСТОРОЖНО, рассмотреть паузу

### Защита от лишней дёрготни

1. **Не повторять действия**: если вчера уже снижали бюджет — не снижать снова без критичных изменений
2. **Период обучения**: новые кампании (<48ч) не дёргать агрессивно
3. **Паттерны**: 3 раза снижали за 3 дня → пора паузить, а не продолжать снижать
4. **Колебания**: поднял +20% вчера, сегодня slightly_bad → дать 1-2 дня на стабилизацию
`;
}

// =============================================================================
// ФОРМАТИРОВАНИЕ SCORING ДАННЫХ
// =============================================================================

/**
 * Форматирует данные Scoring Agent для промпта
 * @param {Object} scoring - Объект с scoring данными
 * @returns {string} Форматированный текст
 */
export function formatScoringForPrompt(scoring) {
  if (!scoring) return 'Scoring данные: не загружены';

  const sections = [];

  // Ad Sets с трендами
  if (scoring.adsets?.length > 0) {
    const adsetsInfo = scoring.adsets.slice(0, 10).map(a => {
      const m = a.metrics_last_7d || {};
      const trend = a.trends?.d3?.cpm_change_pct;
      const trendIcon = trend > 10 ? '📈' : trend < -10 ? '📉' : '➡️';

      return `- ${a.adset_name}: spend $${m.spend?.toFixed(2) || 0}, CPL ${m.avg_cpl ? '$' + m.avg_cpl.toFixed(2) : 'N/A'} ${trendIcon}`;
    });

    sections.push(`**Ad Sets (${scoring.adsets.length}):**\n${adsetsInfo.join('\n')}`);
  }

  // Ready creatives
  if (scoring.ready_creatives?.length > 0) {
    const creativesInfo = scoring.ready_creatives.slice(0, 5).map(c => {
      const perf = c.creatives?.[0]?.performance || {};
      const roi = c.roi_data?.roi;
      const risk = c.risk_score;

      return `- ${c.name}: CPL ${perf.avg_cpl ? '$' + perf.avg_cpl.toFixed(2) : 'N/A'}, ROI ${roi ? roi.toFixed(0) + '%' : 'N/A'}, risk ${risk ?? 'N/A'}`;
    });

    sections.push(`**Ready креативы (${scoring.ready_creatives.length}):**\n${creativesInfo.join('\n')}`);
  }

  // Unused creatives
  if (scoring.unused_creatives?.length > 0) {
    const unusedInfo = scoring.unused_creatives.slice(0, 5).map(c => {
      return `- ${c.title}: objective ${c.recommended_objective}, direction ${c.direction_id || 'legacy'}`;
    });

    sections.push(`**Неиспользуемые креативы (${scoring.unused_creatives.length}):**\n${unusedInfo.join('\n')}`);
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : 'Scoring данные: пусто';
}

// =============================================================================
// ФОРМАТИРОВАНИЕ ИСТОРИИ BRAIN
// =============================================================================

/**
 * Форматирует действие Brain для заметки
 * @param {Object} action - Объект действия
 * @returns {string} Форматированное описание
 */
export function formatActionForNote(action) {
  if (!action?.type) return 'Неизвестное действие';

  switch (action.type) {
    case 'UpdateAdSetDailyBudget': {
      const budget = action.params?.daily_budget;
      return `Бюджет изменён: ${action.params?.adset_id} → $${budget ? (budget / 100).toFixed(2) : '?'}`;
    }
    case 'PauseAdset':
      return `Пауза adset: ${action.params?.adsetId}`;
    case 'PauseCampaign':
      return `Кампания остановлена: ${action.params?.campaign_id}`;
    case 'PauseAd':
      return `Объявление остановлено: ${action.params?.ad_id}`;
    case 'Direction.CreateAdSetWithCreatives': {
      const creatives = action.params?.user_creative_ids?.length || 0;
      return `Новый adset создан: ${creatives} креатив(ов), бюджет $${(action.params?.daily_budget_cents || 0) / 100}`;
    }
    case 'Audience.DuplicateAdSetWithAudience':
      return `LAL дубль: ${action.params?.source_adset_id}`;
    case 'Workflow.DuplicateAndPauseOriginal':
      return `Дубль с паузой оригинала: ${action.params?.campaign_id}`;
    case 'GetCampaignStatus':
      return null; // Не показываем read-операции
    default:
      return `${action.type}`;
  }
}

/**
 * Форматирует историю действий Brain для notes
 * @param {Array} executions - Массив executions из brain_executions
 * @returns {Array} Массив notes
 */
export function formatBrainActionsForNotes(executions) {
  if (!executions?.length) return [];

  const notes = [];

  for (const exec of executions) {
    const actions = exec.actions_json || [];
    const date = new Date(exec.created_at).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short'
    });

    for (const action of actions) {
      // Только успешные действия
      if (action.status !== 'success') continue;

      const text = formatActionForNote(action);
      if (!text) continue;

      notes.push({
        text: `[${date}] ${text}`,
        source: { type: 'brain_execution', date: exec.created_at },
        importance: 0.8  // Высокая важность для действий Brain
      });
    }
  }

  return notes;
}

/**
 * Форматирует историю Brain для прямого включения в промпт
 * @param {Array} notes - Массив notes от Brain
 * @returns {string} Форматированный текст
 */
export function formatBrainHistoryForPrompt(notes) {
  if (!notes?.length) return 'Нет данных о последних действиях Brain-агента.';

  const lines = notes.slice(0, 10).map(n => `- ${n.text}`);

  return `### Последние действия Brain-агента (за 3 дня)
${lines.join('\n')}

⚠️ **Учитывай эту историю:**
- Не предлагай повторять недавние действия
- Если бюджет уже снижали — дай время на стабилизацию
- Если создали новый adset — проверь его результаты прежде чем предлагать ещё`;
}

// =============================================================================
// HEALTH SCORE CALCULATION (синхронизировано с server.js)
// =============================================================================

/**
 * Веса для расчёта Health Score
 */
export const HS_WEIGHTS = {
  cpl_gap: 45,      // Основной вес для CPL gap
  trend: 15,        // Тренды (d3 vs d7, d7 vs d30)
  ctr_penalty: 8,   // Штраф за низкий CTR
  cpm_penalty: 12,  // Штраф за высокий CPM
  freq_penalty: 10  // Штраф за высокую частоту
};

/**
 * Пороги классов для Health Score
 */
export const HS_CLASS_THRESHOLDS = {
  very_good: 25,
  good: 5,
  bad: -25,
  neutral_low: -5
};

/**
 * Извлекает лиды из Facebook actions breakdowns
 * @param {Object} bucket - Данные периода с actions
 * @returns {{ leads: number, qualityLeads: number }}
 */
export function computeLeadsFromActions(bucket) {
  if (!bucket) return { leads: 0, qualityLeads: 0 };

  // Если leads уже посчитаны напрямую
  if (typeof bucket.leads === 'number') {
    return {
      leads: bucket.leads,
      qualityLeads: bucket.quality_leads || bucket.qualityLeads || 0
    };
  }

  // Извлекаем из actions
  const actions = bucket.actions || [];
  let leads = 0;
  let qualityLeads = 0;

  for (const a of actions) {
    const val = parseInt(a.value, 10) || 0;
    switch (a.action_type) {
      case 'onsite_conversion.total_messaging_connection':
        leads += val;
        break;
      case 'onsite_conversion.messaging_user_depth_2_message_send':
        qualityLeads += val;
        break;
      case 'onsite_conversion.lead_grouped':
        leads += val;
        break;
      case 'offsite_conversion.fb_pixel_lead':
        leads += val;
        break;
    }
  }

  return { leads, qualityLeads };
}

/**
 * Вычисляет медиану массива чисел
 * @param {number[]} arr - Массив чисел
 * @returns {number|null}
 */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Рассчитывает Health Score для ad set используя взвешенные периоды
 * СИНХРОНИЗИРОВАНО с server.js computeHealthScoreForAdset
 *
 * @param {Object} opts - Параметры
 * @param {Object} opts.windows - Данные по периодам { y: yesterday, d3, d7, d30, today }
 * @param {Object} opts.targets - Целевые показатели { cpl_cents }
 * @param {Object} opts.peers - Данные peers для сравнения { cpm: number[] }
 * @param {Object} opts.weights - Веса (по умолчанию HS_WEIGHTS)
 * @param {Object} opts.classes - Пороги классов (по умолчанию HS_CLASS_THRESHOLDS)
 * @param {boolean} opts.isWhatsApp - Использовать качественные лиды для WhatsApp
 * @param {boolean} opts.isTrafficObjective - Для instagram_traffic использовать link_clicks
 * @returns {{ score: number, cls: string, eCplY: number, ctr: number, cpm: number, freq: number, breakdown: Object[] }}
 */
export function computeHealthScoreForAdset(opts) {
  const {
    windows = {},
    targets = {},
    peers = {},
    weights = HS_WEIGHTS,
    classes = HS_CLASS_THRESHOLDS,
    isWhatsApp = false,
    isTrafficObjective = false
  } = opts;

  const { y = {}, d3 = {}, d7 = {}, d30 = {}, today = {} } = windows;

  const breakdown = [];

  // Объём данных — коэффициент доверия
  const impressions = y.impressions || 0;
  const volumeFactor = impressions >= 1000 ? 1.0 :
    (impressions <= 100 ? 0.6 : 0.6 + 0.4 * Math.min(1, (impressions - 100) / 900));

  // Целевой CPL
  const targetCpl = targets.cpl_cents || 200;

  // Функция расчёта eCPL из bucket
  function eCPLFromBucket(b) {
    if (isTrafficObjective) {
      // Для Instagram Traffic: используем link_clicks
      const clicks = b.link_clicks || 0;
      return clicks > 0 ? (b.spend * 100) / clicks : Infinity;
    }
    const L = computeLeadsFromActions(b);
    const d = (isWhatsApp && L.qualityLeads >= 3) ? L.qualityLeads : L.leads;
    return d > 0 ? (b.spend * 100) / d : Infinity;
  }

  // eCPL по периодам
  const eCplY = eCPLFromBucket(y);
  const e3 = eCPLFromBucket(d3);
  const e7 = eCPLFromBucket(d7);
  const e30 = eCPLFromBucket(d30);

  // 1. ТРЕНДЫ (d3 vs d7, d7 vs d30)
  let trendScore = 0;
  if (Number.isFinite(e3) && Number.isFinite(e7)) {
    if (e3 < e7) {
      trendScore += weights.trend;
      breakdown.push({ factor: 'trend_3d_vs_7d', value: weights.trend, reason: 'CPL 3d лучше 7d (улучшение)' });
    } else if (e3 > e7 * 1.1) {
      trendScore -= weights.trend / 2;
      breakdown.push({ factor: 'trend_3d_vs_7d', value: -weights.trend / 2, reason: 'CPL 3d хуже 7d (ухудшение)' });
    }
  }
  if (Number.isFinite(e7) && Number.isFinite(e30)) {
    if (e7 < e30) {
      trendScore += weights.trend;
      breakdown.push({ factor: 'trend_7d_vs_30d', value: weights.trend, reason: 'CPL 7d лучше 30d (улучшение)' });
    } else if (e7 > e30 * 1.1) {
      trendScore -= weights.trend / 2;
      breakdown.push({ factor: 'trend_7d_vs_30d', value: -weights.trend / 2, reason: 'CPL 7d хуже 30d (ухудшение)' });
    }
  }

  // 2. CPL GAP к TARGET (основной показатель по YESTERDAY)
  let cplScore = 0;
  const yesterdaySpend = y.spend || 0;

  // Zero leads при spend >= 2x target — это проблема
  // При меньшем spend лид может прийти в любой момент, не штрафуем
  if (!Number.isFinite(eCplY) && yesterdaySpend > 0) {
    // CPL = Infinity (leads = 0), но деньги потрачены
    const spendCents = yesterdaySpend * 100;
    if (spendCents >= targetCpl * 2) {
      // Потратили 2x target и 0 лидов — штраф
      cplScore = -weights.cpl_gap; // -45
      breakdown.push({
        factor: 'zero_leads_over_2x',
        value: cplScore,
        reason: `0 лидов при spend $${yesterdaySpend.toFixed(2)} (${Math.round(spendCents/targetCpl)}x target)`
      });
    }
    // При spend < 2x target не штрафуем — лид может прийти
  } else if (Number.isFinite(eCplY)) {
    const ratio = eCplY / targetCpl;
    if (ratio <= 0.7) {
      cplScore = weights.cpl_gap;
      breakdown.push({ factor: 'cpl_gap', value: weights.cpl_gap, reason: `CPL ${Math.round((1-ratio)*100)}% ниже target` });
    } else if (ratio <= 0.9) {
      cplScore = Math.round(weights.cpl_gap * 2 / 3);
      breakdown.push({ factor: 'cpl_gap', value: cplScore, reason: `CPL ${Math.round((1-ratio)*100)}% ниже target` });
    } else if (ratio <= 1.1) {
      cplScore = 10;
      breakdown.push({ factor: 'cpl_gap', value: 10, reason: 'CPL в пределах ±10% от target' });
    } else if (ratio <= 1.3) {
      cplScore = -Math.round(weights.cpl_gap * 2 / 3);
      breakdown.push({ factor: 'cpl_gap', value: cplScore, reason: `CPL ${Math.round((ratio-1)*100)}% выше target` });
    } else {
      cplScore = -weights.cpl_gap;
      breakdown.push({ factor: 'cpl_gap', value: -weights.cpl_gap, reason: `CPL ${Math.round((ratio-1)*100)}% выше target` });
    }
  }

  // 3. ДИАГНОСТИКА
  let diag = 0;
  const ctr = y.ctr || 0;
  if (ctr > 0 && ctr < 1) {
    diag -= weights.ctr_penalty;
    breakdown.push({ factor: 'low_ctr', value: -weights.ctr_penalty, reason: `CTR ${ctr.toFixed(2)}% < 1%` });
  }

  const medianCpm = median(peers.cpm || []);
  const cpm = y.cpm || 0;
  if (medianCpm && cpm > medianCpm * 1.3) {
    diag -= weights.cpm_penalty;
    breakdown.push({ factor: 'high_cpm', value: -weights.cpm_penalty, reason: `CPM $${cpm.toFixed(2)} > медианы на 30%+` });
  }

  const freq = y.frequency || d7.frequency || 0;
  if (freq > 2) {
    diag -= weights.freq_penalty;
    breakdown.push({ factor: 'high_frequency', value: -weights.freq_penalty, reason: `Frequency ${freq.toFixed(1)} > 2` });
  }

  // 4. TODAY-КОМПЕНСАЦИЯ
  let todayAdj = 0;
  const todayImpressions = today.impressions || 0;
  const todayLeadsData = computeLeadsFromActions(today);
  const todayHasLeads = todayLeadsData.leads > 0;

  // Порог impressions снижен если сегодня есть лиды (лиды важнее показов)
  const effectiveMinImpressions = todayHasLeads ? 100 : VOLUME_THRESHOLDS.TODAY_MIN_IMPRESSIONS;

  if (todayImpressions >= effectiveMinImpressions) {
    const eToday = eCPLFromBucket(today);

    // Случай 1: Вчера были лиды — сравниваем today vs yesterday
    if (Number.isFinite(eCplY) && Number.isFinite(eToday) && eCplY > 0) {
      if (eToday <= TODAY_COMPENSATION.FULL * eCplY) {
        // Сегодня в 2+ раза лучше вчера — полная компенсация
        todayAdj = Math.abs(Math.min(0, cplScore)) + 15;
        breakdown.push({ factor: 'today_compensation', value: todayAdj, reason: `СЕГОДНЯ CPL в ${(eCplY/eToday).toFixed(1)}x лучше вчера! Полная компенсация.` });
      } else if (eToday <= TODAY_COMPENSATION.PARTIAL * eCplY) {
        // На 30% лучше — 60% компенсация
        todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.6) + 10;
        breakdown.push({ factor: 'today_compensation', value: todayAdj, reason: `Сегодня CPL на ${Math.round((1 - eToday/eCplY)*100)}% лучше вчера (60% компенсация)` });
      } else if (eToday <= TODAY_COMPENSATION.SLIGHT * eCplY) {
        // Небольшое улучшение
        todayAdj = 5;
        breakdown.push({ factor: 'today_compensation', value: 5, reason: 'Небольшое улучшение CPL сегодня' });
      }
    }
    // Случай 2: Вчера было 0 лидов, но СЕГОДНЯ есть лиды — сравниваем today vs TARGET
    else if (!Number.isFinite(eCplY) && Number.isFinite(eToday)) {
      const todayRatio = eToday / targetCpl;
      if (todayRatio <= 0.7) {
        // Сегодня CPL 30%+ ниже target — полная компенсация штрафа за zero_leads
        todayAdj = Math.abs(Math.min(0, cplScore)) + 15;
        breakdown.push({
          factor: 'today_recovery',
          value: todayAdj,
          reason: `ВОССТАНОВЛЕНИЕ: сегодня CPL $${(eToday/100).toFixed(2)} (${Math.round((1-todayRatio)*100)}% ниже target)!`
        });
      } else if (todayRatio <= 1.0) {
        // Сегодня CPL в пределах target — частичная компенсация
        todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.7) + 10;
        breakdown.push({
          factor: 'today_recovery',
          value: todayAdj,
          reason: `Сегодня CPL $${(eToday/100).toFixed(2)} в пределах target (70% компенсация)`
        });
      } else if (todayRatio <= 1.3) {
        // Сегодня CPL чуть выше target — небольшая компенсация
        todayAdj = Math.round(Math.abs(Math.min(0, cplScore)) * 0.3);
        breakdown.push({
          factor: 'today_recovery',
          value: todayAdj,
          reason: `Сегодня появились лиды, CPL $${(eToday/100).toFixed(2)} (30% компенсация)`
        });
      }
    }
  }

  // Итоговый score
  let score = cplScore + trendScore + diag + todayAdj;

  // Применяем коэффициент объёма
  if (impressions < 1000) {
    score = Math.round(score * volumeFactor);
    breakdown.push({ factor: 'volume_factor', value: null, reason: `Коэффициент доверия ${(volumeFactor*100).toFixed(0)}% (${impressions} impr)` });
  }

  // Определяем класс
  let cls = 'neutral';
  if (score >= classes.very_good) cls = 'very_good';
  else if (score >= classes.good) cls = 'good';
  else if (score <= classes.bad) cls = 'bad';
  else if (score <= classes.neutral_low) cls = 'slightly_bad';

  return {
    score,
    cls,
    eCplY,
    ctr,
    cpm,
    freq,
    breakdown
  };
}
