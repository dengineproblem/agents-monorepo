/**
 * Scoring Agent Module (SIMPLIFIED VERSION)
 * 
 * Агент скоринга и предикшена для оценки рисков роста CPL
 * Работает как часть agent-brain, запускается ПЕРЕД основным LLM
 * 
 * КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ СТАРОЙ ВЕРСИИ:
 * - Данные всегда берутся из FB API напрямую (не из creative_metrics_history)
 * - FB API сам агрегирует метрики за нужные периоды (last_7d, last_30d)
 * - Для трендов сравниваем два периода (last_7d vs previous_7d)
 * - creative_metrics_history используется ТОЛЬКО для аудита/логирования
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { logger } from './lib/logger.js';
import { logScoringError } from './lib/errorLogger.js';
import {
  HS_CLASSES,
  BUDGET_LIMITS,
  TIMEFRAME_WEIGHTS,
  TODAY_COMPENSATION,
  VOLUME_THRESHOLDS,
  AD_EATER_THRESHOLDS,
  isAllowedToCreateAdsets
} from './chatAssistant/shared/brainRules.js';

const FB_API_VERSION = 'v23.0';

// =============================================================================
// LLM FUNCTIONS ДЛЯ BRAIN MINI
// =============================================================================

const BRAIN_MINI_MODEL = process.env.BRAIN_MODEL || 'gpt-4.1';
const LLM_TIMEOUT_MS = 600000; // 10 минут таймаут для LLM (GPT-5 может долго думать)

/**
 * Вызов OpenAI Responses API для Brain Mini
 * С таймаутом и подробным логированием
 */
async function responsesCreateMini(payload) {
  const startTime = Date.now();
  const { model, input, reasoning, temperature, top_p, metadata } = payload || {};

  // Проверка наличия API ключа
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY not configured');
    err.status = 500;
    logger.error({
      where: 'responsesCreateMini',
      phase: 'config_error',
      error: 'OPENAI_API_KEY environment variable is not set'
    });
    throw err;
  }

  const safeBody = {
    ...(model ? { model } : {}),
    ...(input ? { input } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof top_p === 'number' ? { top_p } : {}),
    ...(metadata ? { metadata } : {})
  };

  // Логируем начало запроса
  logger.info({
    where: 'responsesCreateMini',
    phase: 'request_start',
    model: safeBody.model,
    input_length: JSON.stringify(safeBody.input || []).length,
    timeout_ms: LLM_TIMEOUT_MS
  });

  // Создаём AbortController для таймаута
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(safeBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const text = await res.text();
    const duration = Date.now() - startTime;

    // Подробное логирование ответа
    logger.info({
      where: 'responsesCreateMini',
      phase: 'response_received',
      status: res.status,
      duration_ms: duration,
      response_length: text.length,
      bodyPreview: text.slice(0, 500)
    });

    if (!res.ok) {
      const err = new Error(`LLM API error: ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      err._responseText = text;
      logger.error({
        where: 'responsesCreateMini',
        phase: 'api_error',
        status: res.status,
        duration_ms: duration,
        error_preview: text.slice(0, 500)
      });
      throw err;
    }

    try {
      return JSON.parse(text);
    } catch (parseErr) {
      logger.warn({
        where: 'responsesCreateMini',
        phase: 'json_parse_warning',
        error: String(parseErr),
        raw_preview: text.slice(0, 200)
      });
      return { raw: text };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError') {
      const timeoutErr = new Error(`LLM request timeout after ${LLM_TIMEOUT_MS}ms`);
      timeoutErr.status = 408;
      logger.error({
        where: 'responsesCreateMini',
        phase: 'timeout',
        duration_ms: duration,
        timeout_ms: LLM_TIMEOUT_MS,
        error: 'Request aborted due to timeout'
      });
      throw timeoutErr;
    }

    logger.error({
      where: 'responsesCreateMini',
      phase: 'fetch_error',
      duration_ms: duration,
      error: String(error),
      error_name: error.name
    });
    throw error;
  }
}

/**
 * Wrapper с retry-логикой для Brain Mini
 * Ретраит на 429 (rate limit), 500, 502, 503 и таймауты
 */
async function responsesCreateMiniWithRetry(payload, maxRetries = 3) {
  let lastError;
  const overallStartTime = Date.now();

  logger.info({
    where: 'responsesCreateMiniWithRetry',
    phase: 'start',
    max_retries: maxRetries,
    model: payload?.model
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();

    try {
      const result = await responsesCreateMini(payload);

      logger.info({
        where: 'responsesCreateMiniWithRetry',
        phase: 'success',
        attempt,
        attempt_duration_ms: Date.now() - attemptStartTime,
        total_duration_ms: Date.now() - overallStartTime,
        was_retry: attempt > 1
      });

      return result;
    } catch (error) {
      lastError = error;
      const status = error.status || parseInt(error.message?.match(/^\d+/)?.[0]);
      const attemptDuration = Date.now() - attemptStartTime;

      // Определяем, нужно ли ретраить
      const isRateLimited = status === 429;
      const isServerError = status >= 500 && status < 600;
      const isTimeout = status === 408;
      const isNetworkError = !status && (error.name === 'FetchError' || error.code === 'ECONNRESET');
      const shouldRetry = isRateLimited || isServerError || isTimeout || isNetworkError;

      logger.warn({
        where: 'responsesCreateMiniWithRetry',
        phase: 'attempt_failed',
        attempt,
        max_retries: maxRetries,
        status,
        error_type: isRateLimited ? 'rate_limit' : isServerError ? 'server_error' : isTimeout ? 'timeout' : isNetworkError ? 'network' : 'other',
        should_retry: shouldRetry,
        attempt_duration_ms: attemptDuration,
        error: String(error).slice(0, 200)
      });

      // Если не нужно ретраить или последняя попытка
      if (!shouldRetry || attempt === maxRetries) {
        logger.error({
          where: 'responsesCreateMiniWithRetry',
          phase: 'final_failure',
          attempt,
          max_retries: maxRetries,
          total_duration_ms: Date.now() - overallStartTime,
          status,
          error: String(error),
          should_retry,
          reason: !shouldRetry ? 'non_retryable_error' : 'max_retries_exceeded'
        });
        throw error;
      }

      // Exponential backoff с jitter
      const baseDelay = 1000 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelay + jitter, 15000);

      logger.info({
        where: 'responsesCreateMiniWithRetry',
        phase: 'retry_scheduled',
        attempt,
        next_attempt: attempt + 1,
        delay_ms: Math.round(delay),
        total_elapsed_ms: Date.now() - overallStartTime
      });

      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Вызов LLM для Brain Mini с валидацией и подробным логированием
 * @param {string} systemPrompt - Системный промпт
 * @param {object} userPayload - Данные для анализа
 * @returns {object} - { parsed, rawText, parseError, meta, validation }
 */
async function llmPlanMini(systemPrompt, userPayload) {
  const startTime = Date.now();

  // Безопасная сериализация payload
  let payloadJson;
  try {
    payloadJson = JSON.stringify(userPayload);
  } catch (serializeErr) {
    logger.error({
      where: 'llmPlanMini',
      phase: 'payload_serialize_error',
      error: String(serializeErr),
      payload_keys: Object.keys(userPayload || {})
    });
    return {
      parsed: null,
      rawText: '',
      parseError: `payload_serialize_error: ${serializeErr.message}`,
      meta: {},
      validation: { valid: false, errors: ['Failed to serialize payload'] }
    };
  }

  logger.info({
    where: 'llmPlanMini',
    phase: 'start',
    model: BRAIN_MINI_MODEL,
    prompt_length: systemPrompt.length,
    payload_length: payloadJson.length,
    payload_adsets_count: userPayload?.adsets?.length || 0,
    payload_directions_count: userPayload?.directions?.length || 0
  });

  const resp = await responsesCreateMiniWithRetry({
    model: BRAIN_MINI_MODEL,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: payloadJson }] }
    ]
  });

  const duration = Date.now() - startTime;

  // Extract text from output array
  let txt = '';
  if (Array.isArray(resp.output)) {
    const message = resp.output.find(o => o.type === 'message');
    if (message && Array.isArray(message.content)) {
      const textContent = message.content.find(c => c.type === 'output_text');
      txt = textContent?.text || '';
    }
  }

  logger.info({
    where: 'llmPlanMini',
    phase: 'response_extracted',
    duration_ms: duration,
    output_length: txt.length,
    output_preview: txt.slice(0, 300),
    has_output: !!txt
  });

  let parsed = null;
  let parseError = null;

  if (txt) {
    // Попытка 1: прямой парсинг
    try {
      parsed = JSON.parse(txt);
      logger.debug({
        where: 'llmPlanMini',
        phase: 'json_parse_success',
        method: 'direct'
      });
    } catch (e) {
      // Попытка 2: извлечение JSON из текста
      try {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) {
          parsed = JSON.parse(m[0]);
          logger.debug({
            where: 'llmPlanMini',
            phase: 'json_parse_success',
            method: 'regex_extract'
          });
        } else {
          parseError = 'no_json_found_in_response';
        }
      } catch (e2) {
        parseError = `json_parse_failed: ${e2.message}`;
      }
    }
  } else {
    parseError = 'empty_llm_response';
  }

  // Валидация структуры ответа
  const validation = { valid: false, errors: [], warnings: [] };

  if (parsed) {
    // Проверяем наличие обязательных полей
    if (!parsed.proposals) {
      validation.errors.push('Missing required field: proposals');
    } else if (!Array.isArray(parsed.proposals)) {
      validation.errors.push('proposals must be an array');
    } else {
      // Валидация каждого proposal
      parsed.proposals.forEach((p, idx) => {
        if (!p.action) validation.errors.push(`proposals[${idx}]: missing action`);
        if (!p.entity_id) validation.errors.push(`proposals[${idx}]: missing entity_id`);
        if (!p.entity_type) validation.warnings.push(`proposals[${idx}]: missing entity_type`);
        if (typeof p.health_score !== 'number') validation.warnings.push(`proposals[${idx}]: health_score is not a number`);
      });
    }

    if (!parsed.planNote) validation.warnings.push('Missing planNote');
    if (!parsed.summary) validation.warnings.push('Missing summary');

    validation.valid = validation.errors.length === 0;
  }

  logger.info({
    where: 'llmPlanMini',
    phase: 'complete',
    duration_ms: duration,
    parse_success: !!parsed,
    parse_error: parseError,
    proposals_count: parsed?.proposals?.length || 0,
    validation_valid: validation.valid,
    validation_errors: validation.errors,
    validation_warnings: validation.warnings,
    llm_usage: resp?.usage
  });

  return {
    parsed,
    rawText: txt,
    parseError,
    meta: {
      id: resp.id || null,
      created: resp.created || null,
      finish_reason: resp.output?.[0]?.finish_reason || null,
      usage: resp?.usage || null
    },
    validation
  };
}

// =============================================================================
// SYSTEM PROMPT ДЛЯ BRAIN MINI (адаптирован для внешних кампаний и proposals)
// =============================================================================

/**
 * Генерирует системный промпт для Brain Mini
 * Ключевые отличия от основного Brain:
 * - Поддержка внешних кампаний (без direction_id)
 * - Возврат proposals вместо actions
 * - Фокус на данных TODAY
 * - Не выполняет действия автоматически
 */
function SYSTEM_PROMPT_MINI() {
  return `Ты — таргетолог-агент Brain Mini, анализирующий рекламу в Facebook Ads Manager.

## ТВОЯ ЗАДАЧА
Ты работаешь в режиме РЕАЛЬНОГО ВРЕМЕНИ (данные за СЕГОДНЯ).
Ты НЕ выполняешь действия автоматически — только ПРЕДЛАГАЕШЬ их пользователю.
Пользователь сам решает, применить предложения или нет.

## КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ ОСНОВНОГО BRAIN
1. **Данные TODAY**: Ты анализируешь данные за СЕГОДНЯ (today), а не за вчера
2. **Proposals вместо Actions**: Ты возвращаешь ПРЕДЛОЖЕНИЯ (proposals), а не выполняемые действия
3. **Внешние кампании**: Ты анализируешь ВСЕ кампании, включая внешние (без direction_id)
4. **Подтверждение пользователя**: Все предложения требуют одобрения пользователя

## ВНЕШНИЕ КАМПАНИИ (ВАЖНО!)
- Внешние кампании = кампании БЕЗ привязки к направлению (direction_id = null)
- Для них используй настройки аккаунта (default_cpl_target_cents)
- Если нет ни direction target, ни account target → анализируй только по трендам
- В предложениях помечай их как campaign_type: "external"
- МОЖЕШЬ и ДОЛЖЕН предлагать действия для внешних кампаний!

## HEALTH SCORE (HS) — оценка эффективности
HS ∈ [-100; +100] — интегральная оценка ad set:

**Компоненты HS:**
1. **Gap к таргету** (вес 45) — CPL для lead-кампаний, CPC для Instagram Traffic:
   - ≥30% дешевле плана → +45
   - 10-30% дешевле → +30
   - ±10% от плана → +10/-10
   - 10-30% дороже → -30
   - ≥30% дороже → -45

2. **Тренды** (вес до 15):
   - 3d vs 7d, today vs yesterday
   - Улучшение → + до 15
   - Ухудшение → - до 15

3. **Диагностика** (до -30):
   - CTR < 1% → -8 (слабый креатив)
   - CPM > медианы на ≥30% → -12 (дорогой аукцион)
   - Frequency 30d > 2 → -10 (выгорание)

4. **Today-компенсация** (КРИТИЧНО!):
   - Если сегодня стоимость в 2 раза лучше вчера → ПОЛНАЯ компенсация штрафов
   - Хорошие результаты СЕГОДНЯ перевешивают плохие ВЧЕРА!

**Классы HS:**
| Класс | Диапазон | Значение |
|-------|----------|----------|
| very_good | ≥ +25 | Отличный, масштабировать |
| good | +5..+24 | Хороший, держать |
| neutral | -5..+4 | Нейтральный, наблюдать |
| slightly_bad | -25..-6 | Немного плохой, снижать |
| bad | ≤ -25 | Плохой, пауза/резкое снижение |

## МАТРИЦА ДЕЙСТВИЙ ПО КЛАССУ HS

| HS Класс | Действие | Детали |
|----------|----------|--------|
| **very_good** | Масштабировать | +10..+30% бюджета |
| **good** | Держать | При недоборе плана: +0..+10% |
| **neutral** | Держать | Не предлагать изменений |
| **slightly_bad** | Снижать | -20..-50% бюджета |
| **bad** | Пауза/снижение | -50% если CPL x2-3; полная пауза если CPL > x3 |

## ОГРАНИЧЕНИЯ БЮДЖЕТОВ
- Повышение за шаг: максимум **+30%**
- Снижение за шаг: максимум **-50%**
- Диапазон бюджета: **$3..$100** (300..10000 центов)
- Новый ad set: **$10-$20** (не больше!)

## 🔥 АНАЛИЗ ОБЪЯВЛЕНИЙ (ADS) — ПОИСК ПОЖИРАТЕЛЕЙ
В каждом adset есть массив \`ads\` с данными по объявлениям за last_7d.
Каждый ad содержит: ad_id, ad_name, spend, impressions, leads, cpl.

**Алгоритм поиска пожирателя (СТРОГО по критериям!):**
1. В адсете должно быть **≥2 объявлений** (ads.length >= 2)
2. Посчитай totalSpend = сумма spend всех объявлений в адсете
3. Найди topAd = объявление с максимальным spend
4. **Условие пожирателя:** topAd.spend >= **50%** от totalSpend И (topAd.cpl > target_cpl × 1.3 ИЛИ topAd.leads = 0)

**target_cpl** берётся из:
- direction.target_cpl_cents / 100 (если адсет привязан к направлению)
- account_settings.default_cpl_target_cents / 100 (иначе)

Формат proposal для pauseAd:
- action: "pauseAd"
- entity_type: "ad"
- entity_id: ad_id пожирателя
- entity_name: ad_name пожирателя
- adset_id: adset_id адсета (ВАЖНО: нужен для выполнения!)
- priority: "high"
- reason: "Пожиратель: тратит X% бюджета адсета, CPL=$Y (цель $Z)"

**Применяй для адсетов с hs_class: neutral, slightly_bad, bad!**

## ⏰ ВРЕМЕННОЕ ОГРАНИЧЕНИЕ НА СОЗДАНИЕ ADSETS (КРИТИЧЕСКИ ВАЖНО!)
**ОБЯЗАТЕЛЬНО** проверь поле \`time_context.can_create_adsets\` в payload!

- Если \`can_create_adsets: true\` → можно предлагать createAdSet, launchNewCreatives
- Если \`can_create_adsets: false\` → **ЗАПРЕЩЕНО** предлагать создание новых adsets!
  - Работай ТОЛЬКО с перераспределением бюджета между существующими adsets
  - Не используй action: "createAdSet" или "launchNewCreatives"!
  - Весь освободившийся бюджет направляй в лучшие существующие adsets

**Причина:** новый adset начинает откручивать бюджет не сразу. Если запустить во второй
половине дня — алгоритмы Facebook не успеют оптимизироваться, бюджет сольётся впустую.

**Текущее время и статус указаны в time_context — ПРОВЕРЯЙ ЕГО ПЕРВЫМ ДЕЛОМ!**

## ВЕСА ПЕРИОДОВ ДЛЯ АНАЛИЗА
| Период | Вес | Описание |
|--------|-----|----------|
| today | 50% | Приоритет — текущий день (если есть данные) |
| yesterday | 30% | Вчерашние результаты |
| last_7d | 15% | Среднесрочный тренд |
| last_30d | 5% | Долгосрочный тренд |

Если данных за сегодня недостаточно (< 300 impressions), увеличь вес yesterday до 50%.

## МЕТРИКИ ПО ТИПАМ КАМПАНИЙ
| Objective | Метрика | Формула |
|-----------|---------|---------|
| whatsapp | CPL | spend / conversations_started |
| lead_forms | CPL | spend / form_leads |
| site_leads | CPL | spend / pixel_leads |
| instagram_traffic | CPC | spend / link_clicks |

## ФОРМАТ ВЫХОДА (СТРОГО!)
Выведи ОДИН JSON-объект и НИЧЕГО больше:
{
  "planNote": "краткое техническое описание анализа",
  "proposals": [
    {
      "action": "updateBudget" | "pauseAdSet" | "pauseAd" | "createAdSet" | "review",
      "priority": "critical" | "high" | "medium" | "low",
      "entity_type": "adset" | "ad" | "campaign" | "direction",
      "entity_id": "string",
      "entity_name": "string",
      "adset_id": "string | null", // ОБЯЗАТЕЛЬНО для pauseAd — ID адсета содержащего объявление
      "campaign_id": "string",
      "campaign_type": "internal" | "external",
      "direction_id": "string | null",
      "direction_name": "string | null",
      "health_score": number,
      "hs_class": "very_good" | "good" | "neutral" | "slightly_bad" | "bad",
      "reason": "Понятное объяснение на русском языке",
      "confidence": number (0-1),
      "suggested_action_params": {
        "increase_percent": number | null,
        "decrease_percent": number | null,
        "current_budget_cents": number,
        "new_budget_cents": number,
        "min_budget_cents": 300,
        "max_budget_cents": 10000
      },
      "metrics": {
        "today_spend": number,
        "today_conversions": number,
        "today_cpl": number | null,
        "target_cpl": number | null,
        "objective": "string",
        "metrics_source": "today" | "yesterday" | "last_7d"
      }
    }
  ],
  "summary": "Краткое резюме анализа для пользователя на русском языке"
}

## ПРАВИЛА ГЕНЕРАЦИИ PROPOSALS
1. Генерируй proposals для adsets с классом very_good, slightly_bad, bad
2. Для neutral — НЕ генерируй proposals (наблюдаем)
3. Для good — генерируй ЕСЛИ есть недобор планового бюджета (+5..+10%)
4. Каждый proposal должен иметь понятное объяснение в поле reason
5. Для внешних кампаний обязательно указывай campaign_type: "external"
6. confidence зависит от объёма данных: мало данных → ниже confidence

## ⚠️ КРИТИЧЕСКИ ВАЖНО: ПРАВИЛО СОХРАНЕНИЯ БЮДЖЕТА
При снижении/паузе любого adset ВСЕГДА предлагай перераспределение освободившегося бюджета!

**ПРАВИЛО:**
- Если предлагаешь снизить daily_budget adset_A с $50 до $25 (освобождается $25):
  1. ОБЯЗАТЕЛЬНО предложи увеличить бюджет другого adset (с лучшим HS) на ~$25
  2. ИЛИ предложи создать новый adset если есть unused_creatives **И time_context.can_create_adsets: true**
  3. Если \`can_create_adsets: false\` → ТОЛЬКО перераспределение на существующие adsets!

- Если предлагаешь паузу adset_B с бюджетом $50:
  1. ОБЯЗАТЕЛЬНО предложи перераспределить $50 на другие adsets
  2. Если нет хороших adsets — используй best-of-bad логику (лучший из плохих)
  3. Общий бюджет должен сохраняться!

## BEST-OF-BAD ЛОГИКА (как в основном Brain)
Если НЕТ adsets с HS ≥ +25 (very_good):
1. Найди adset с МАКСИМАЛЬНЫМ HS (наименее плохой) — это "best of bad"
2. Используй его для добора бюджета: предложи +10..+20% (не более +30%)
3. В reason укажи: "Лучший из доступных — используем для добора планового бюджета"
4. Это позволяет НЕ останавливать рекламу полностью!

## КОНТРОЛЬ ПЛАНОВОГО БЮДЖЕТА (95-105% коридор)
Если указан plan_daily_budget_cents в account_settings:
1. Посчитай current_total_budget_cents (сумма всех adsets)
2. Сравни с планом:
   - Если < 95% плана → НЕДОБОР: добирай через увеличение лучших или best-of-bad
   - Если > 105% плана → ПЕРЕБОР: режь у худших по HS
   - Если в коридоре 95-105% → ОК
3. ⚠️ НЕ ПРЕДЛАГАЙ только снижения если это приведёт к недобору плана!
4. Итоговая сумма proposals должна сохранять бюджет в коридоре

## ПОРЯДОК ДОБОРА БЮДЖЕТА (при недоборе)
1. Сначала — adsets с HS ≥ +25 (very_good): +10..+30%
2. Затем — adsets с HS +5..+24 (good): +5..+10%
3. Если таких нет — best-of-bad: +10..+20%
4. Ограничение: один adset не должен занимать >40% от планового бюджета

## ПРИМЕР PROPOSAL
{
  "action": "updateBudget",
  "priority": "high",
  "entity_type": "adset",
  "entity_id": "120123456789",
  "entity_name": "Креатив 1 — LAL3",
  "campaign_id": "120987654321",
  "campaign_type": "external",
  "direction_id": null,
  "direction_name": null,
  "health_score": 35,
  "hs_class": "very_good",
  "reason": "«Креатив 1 — LAL3» [внешняя кампания]: отличные результаты! CPL $1.50 на 25% ниже цели. Увеличить бюджет с $20 до $26 (+30%).",
  "confidence": 0.85,
  "suggested_action_params": {
    "increase_percent": 30,
    "current_budget_cents": 2000,
    "new_budget_cents": 2600,
    "max_budget_cents": 10000
  },
  "metrics": {
    "today_spend": 15.50,
    "today_conversions": 10,
    "today_cpl": 1.55,
    "target_cpl": 2.00,
    "objective": "whatsapp",
    "metrics_source": "today"
  }
}

Теперь проанализируй входные данные и сгенерируй JSON с proposals.`;
}

/**
 * Normalize ad account ID (ensure it starts with 'act_')
 */
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return '';
  const id = String(adAccountId).trim();
  return id.startsWith('act_') ? id : `act_${id}`;
}

/**
 * Fetch insights для конкретного Facebook Ad
 * Используется для получения метрик на уровне Ad (не AdSet)
 */
async function fetchAdInsights(adAccountId, accessToken, adId, datePresetOrRange = 'last_7d') {
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${adId}/insights`;
  const params = new URLSearchParams({
    fields: 'impressions,reach,spend,clicks,actions,ctr,cpm,frequency,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,video_play_actions,video_avg_time_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions',
    access_token: accessToken
  });

  // Поддержка как строки date_preset, так и объекта с time_range
  if (typeof datePresetOrRange === 'string') {
    params.set('date_preset', datePresetOrRange);
  } else if (datePresetOrRange && datePresetOrRange.time_range) {
    params.set('time_range', JSON.stringify(datePresetOrRange.time_range));
  } else {
    // fallback на default
    params.set('date_preset', 'last_7d');
  }

  try {
    const res = await fetch(`${url}?${params.toString()}`);
    if (!res.ok) {
      if (res.status === 400) {
        // Ad не имеет показов или удален
        return null;
      }
      const err = await res.text();
      logger.warn({ 
        where: 'fetchAdInsights',
        ad_id: adId,
        status: res.status,
        error: err
      }, 'Failed to fetch ad insights');
      return null;
    }

    const json = await res.json();
    return json.data?.[0] || null;
  } catch (error) {
    logger.warn({ 
      where: 'fetchAdInsights',
      ad_id: adId,
      error: error.message
    }, 'Error fetching ad insights');
    return null;
  }
}

/**
 * Извлечь лиды сайта из actions (fb_pixel_lead с fallback на custom)
 */
function extractSiteLeads(actions) {
  if (!actions || !Array.isArray(actions)) return 0;

  let hasPixelLead = false;
  let siteLeads = 0;

  for (const action of actions) {
    if (action.action_type === 'offsite_conversion.fb_pixel_lead') {
      siteLeads = parseFloat(action.value || '0') || 0;
      hasPixelLead = true;
    } else if (!hasPixelLead && typeof action.action_type === 'string' && action.action_type.startsWith('offsite_conversion.custom')) {
      siteLeads = parseFloat(action.value || '0') || 0;
    }
  }

  return siteLeads;
}

/**
 * Извлечь количество лидов из actions
 * Поддерживает разные типы конверсий (lead, messaging, site leads)
 */
function extractLeads(actions) {
  if (!actions || !Array.isArray(actions)) return 0;

  // Count leads from ALL sources (same logic as facebookApi.ts)
  // DON'T count 'lead' - it's an aggregate that duplicates pixel_lead for site campaigns
  let messagingLeads = 0;
  let leadFormLeads = 0;

  for (const action of actions) {
    if (action.action_type === 'onsite_conversion.total_messaging_connection') {
      messagingLeads = parseInt(action.value || '0', 10);
    } else if (action.action_type === 'onsite_conversion.lead_grouped') {
      leadFormLeads = parseInt(action.value || '0', 10);
    }
  }

  const siteLeads = extractSiteLeads(actions);
  return messagingLeads + siteLeads + leadFormLeads;
}

/**
 * Извлечь количество кликов по ссылке из actions
 */
function extractLinkClicks(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  
  const linkClickAction = actions.find(a => a.action_type === 'link_click');
  return linkClickAction ? parseInt(linkClickAction.value) || 0 : 0;
}

/**
 * Извлечь метрики по просмотру видео из insights
 */
function extractVideoMetrics(insights) {
  if (!insights) {
    return {
      video_views: 0,
      video_views_25_percent: 0,
      video_views_50_percent: 0,
      video_views_75_percent: 0,
      video_views_95_percent: 0,
      video_avg_watch_time_sec: null
    };
  }

  return {
    video_views: parseInt(insights.video_play_actions?.[0]?.value) || 0,
    video_views_25_percent: parseInt(insights.video_p25_watched_actions?.[0]?.value) || 0,
    video_views_50_percent: parseInt(insights.video_p50_watched_actions?.[0]?.value) || 0,
    video_views_75_percent: parseInt(insights.video_p75_watched_actions?.[0]?.value) || 0,
    video_views_95_percent: parseInt(insights.video_p95_watched_actions?.[0]?.value) || 0,
    video_avg_watch_time_sec: parseFloat(insights.video_avg_time_watched_actions?.[0]?.value) || null
  };
}

/**
 * Извлекает значение action из массива FB actions по типу
 * @param {Array} actions - массив actions из FB API
 * @param {string} actionType - тип действия (lead, link_click, etc)
 * @returns {number} количество действий
 */
function getActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return parseInt(action?.value || 0);
}

/**
 * Форматирует сумму в доллары (центы → доллары с разделителями)
 * @param {number} cents - сумма в центах
 * @returns {string} форматированная сумма, например "$5,000"
 */
function formatDollars(cents) {
  if (cents === null || cents === undefined) return '—';
  const dollars = Math.round(cents / 100);
  return '$' + dollars.toLocaleString('en-US');
}

/**
 * Строит человекочитаемое объяснение на основе hsBreakdown
 * @param {Array} hsBreakdown - массив факторов [{ factor, value, reason }]
 * @param {object} metrics - метрики { todayCPL, targetCPL, metricName }
 * @returns {string} понятное объяснение почему HS такой
 */
function buildHumanReadableReason(hsBreakdown, metrics = {}) {
  if (!hsBreakdown || hsBreakdown.length === 0) return '';

  const { todayCPL, targetCPL, metricName = 'CPL' } = metrics;
  const reasons = [];

  // Группируем факторы по типу
  const cplGap = hsBreakdown.find(f => f.factor === 'cpl_gap' || f.factor === 'cpc_gap');
  const trend = hsBreakdown.find(f => f.factor === 'trend_cpl' || f.factor === 'trend_cpc');
  const diagnostics = hsBreakdown.filter(f => ['ctr_low', 'cpm_high', 'frequency_high'].includes(f.factor));

  // CPL/CPC к target
  if (cplGap && targetCPL) {
    const gap = todayCPL - targetCPL;
    const gapPercent = Math.round((gap / targetCPL) * 100);
    if (gap > 0) {
      reasons.push(`${metricName} $${Math.round(todayCPL)} выше цели $${Math.round(targetCPL)} на ${gapPercent}%`);
    } else if (gap < 0) {
      reasons.push(`${metricName} $${Math.round(todayCPL)} ниже цели $${Math.round(targetCPL)} — отлично!`);
    }
  } else if (todayCPL && !targetCPL) {
    reasons.push(`${metricName} $${Math.round(todayCPL)} (цель не задана)`);
  }

  // Тренд
  if (trend) {
    if (trend.value > 0) {
      reasons.push('тренд ухудшается');
    } else if (trend.value < 0) {
      reasons.push('тренд улучшается');
    }
  }

  // Диагностика
  for (const diag of diagnostics) {
    if (diag.factor === 'ctr_low' && diag.value < 0) {
      reasons.push('низкий CTR');
    } else if (diag.factor === 'cpm_high' && diag.value < 0) {
      reasons.push('высокий CPM');
    } else if (diag.factor === 'frequency_high' && diag.value < 0) {
      reasons.push('высокая частота показов (выгорание)');
    }
  }

  return reasons.join(', ');
}

/**
 * Fetch активных ad sets с insights за указанный период
 */
async function fetchAdsets(adAccountId, accessToken, options = 'last_7d') {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  
  // Поддержка как строки date_preset, так и объекта с time_range
  const isHistorical = typeof options === 'object' && options.historical === true;
  
  if (typeof options === 'string') {
    url.searchParams.set('date_preset', options);
  } else if (options.time_range) {
    url.searchParams.set('time_range', JSON.stringify(options.time_range));
  } else if (options.date_preset) {
    url.searchParams.set('date_preset', options.date_preset);
  } else {
    url.searchParams.set('date_preset', 'last_7d');
  }
  
  // Для текущих данных фильтруем только ACTIVE adsets
  // Для исторических данных НЕ фильтруем - берем все adsets которые работали в тот период
  if (!isHistorical) {
    url.searchParams.set('filtering', JSON.stringify([
      { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
    ]));
  }
  
  url.searchParams.set('fields', 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpp,cpc,frequency,reach,actions');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch diagnostics (quality/engagement/conversion rankings) для ad sets
 * NOTE: Diagnostics доступны только на уровне ad, поэтому группируем по adset_id
 */
async function fetchAdsetDiagnostics(adAccountId, accessToken) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('date_preset', 'last_7d');
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'ad_id,ad_name,adset_id,quality_ranking,engagement_rate_ranking,conversion_rate_ranking');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB diagnostics failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  const ads = json.data || [];
  
  // Группируем по adset_id и берем средние/худшие rankings
  const byAdset = {};
  for (const ad of ads) {
    const adsetId = ad.adset_id;
    if (!byAdset[adsetId]) {
      byAdset[adsetId] = {
        adset_id: adsetId,
        ads: []
      };
    }
    byAdset[adsetId].ads.push({
      ad_id: ad.ad_id,
      quality_ranking: ad.quality_ranking,
      engagement_rate_ranking: ad.engagement_rate_ranking,
      conversion_rate_ranking: ad.conversion_rate_ranking
    });
  }
  
  // Для каждого adset берем ХУДШИЙ ranking (самый проблемный ad)
  const result = [];
  for (const adsetId in byAdset) {
    const data = byAdset[adsetId];
    const worstQuality = getWorstRanking(data.ads.map(a => a.quality_ranking));
    const worstEngagement = getWorstRanking(data.ads.map(a => a.engagement_rate_ranking));
    const worstConversion = getWorstRanking(data.ads.map(a => a.conversion_rate_ranking));
    
    result.push({
      adset_id: adsetId,
      quality_ranking: worstQuality,
      engagement_rate_ranking: worstEngagement,
      conversion_rate_ranking: worstConversion,
      ads_count: data.ads.length
    });
  }
  
  return result;
}

/**
 * Определить худший ranking из списка
 */
function getWorstRanking(rankings) {
  const order = {
    'above_average': 4,
    'average': 3,
    'below_average_35': 2,
    'below_average_20': 1,
    'below_average_10': 0
  };
  
  let worst = 'average';
  let worstScore = 3;
  
  for (const rank of rankings) {
    if (!rank) continue;
    const score = order[rank] ?? 3;
    if (score < worstScore) {
      worstScore = score;
      worst = rank;
    }
  }
  
  return worst;
}

/**
 * Извлекает значение action из массива actions FB API
 */
function extractActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return action ? parseFloat(action.value || 0) : 0;
}

/**
 * Fetch adsets config (id, name, budgets, status) для переиспользования в brain_run
 * Это избегает повторного запроса и rate limit
 */
async function fetchAdsetsConfig(adAccountId, accessToken, logger) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/adsets`);
  url.searchParams.set('fields', 'id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    logger?.warn({ where: 'fetchAdsetsConfig', error: `FB adsets config failed: ${res.status}`, body: err?.substring(0, 500) });
    // Не бросаем ошибку, возвращаем объект с ошибкой (как в server.js)
    return { error: `FB adsets config failed: ${res.status} ${err}` };
  }

  const json = await res.json();
  logger?.info({ where: 'fetchAdsetsConfig', adsetsCount: json?.data?.length || 0 });
  return json; // Возвращаем весь объект { data: [...], paging: {...} }
}

/**
 * Fetch adsets insights с breakdown по дням за N дней (для трендов)
 */
async function fetchAdsetsDaily(adAccountId, accessToken, days = 14) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  url.searchParams.set('time_increment', '1'); // breakdown по дням
  url.searchParams.set('date_preset', `last_${days}d`);
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'adset_id,adset_name,campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,ctr,cpm,cpp,cpc,frequency,reach');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets daily insights failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  return json.data || [];
}

/**
 * Получить objective для adsets через campaign_id → direction
 * Возвращает Map<campaign_id, objective>
 * В мультиаккаунтном режиме фильтрует по account_id
 */
async function getAdsetsObjectives(supabase, userAccountId, accountUUID = null) {
  const objectivesMap = new Map();

  try {
    // Получаем campaign_id для каждого adset из Facebook Insights
    // (уже есть в dailyData: campaign_id)
    // Поэтому вместо adsetIds используем campaign_ids

    // Получаем directions с их fb_campaign_id и objective
    let query = supabase
      .from('account_directions')
      .select('fb_campaign_id, objective')
      .eq('user_account_id', userAccountId)
      .not('fb_campaign_id', 'is', null);

    if (accountUUID) {
      query = query.eq('account_id', accountUUID);
    } else {
      query = query.is('account_id', null);
    }

    const { data: directions, error } = await query;

    if (error) {
      logger.error({ error: error.message }, '[getAdsetsObjectives] Failed to fetch directions');
      return objectivesMap;
    }

    // Создаем Map<fb_campaign_id, objective>
    const campaignObjectives = new Map();
    for (const d of directions || []) {
      campaignObjectives.set(d.fb_campaign_id, d.objective);
    }

    logger.debug({
      directions_count: directions?.length || 0,
      campaigns_mapped: campaignObjectives.size,
      accountUUID: accountUUID || null
    }, '[getAdsetsObjectives] Loaded campaign objectives');

    return campaignObjectives;

  } catch (err) {
    logger.error({ err: err.message }, '[getAdsetsObjectives] Error fetching objectives');
    return objectivesMap;
  }
}

/**
 * Fetch агрегированные actions для adsets (для всех типов кампаний)
 */
async function fetchAdsetsActions(adAccountId, accessToken, datePreset = 'last_7d') {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);
  url.searchParams.set('level', 'adset');
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', 'adset_id,actions');
  url.searchParams.set('action_breakdowns', 'action_type');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB adsets actions failed: ${res.status} ${err}`);
  }
  
  const json = await res.json();
  
  // Логируем actions для отладки
  if (json.data && json.data.length > 0) {
    const sample = json.data[0];
    logger.debug({ sampleAdsetsActions: sample }, '[fetchAdsetsActions] Sample actions');
  }
  
  return json.data || [];
}

/**
 * Получить insights по всем активным ads
 * Один batch-запрос вместо N отдельных для оптимизации API вызовов
 * Включает retry при rate limit и graceful fallback при ошибках
 *
 * @param {string} adAccountId - ID рекламного аккаунта
 * @param {string} accessToken - Токен доступа
 * @param {number} maxRetries - Максимальное количество попыток (по умолчанию 2)
 * @returns {Promise<Array>} Массив ads с метриками (пустой массив при ошибке)
 */
async function fetchAdsInsights(adAccountId, accessToken, maxRetries = 2) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  const url = new URL(`https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/insights`);

  url.searchParams.set('level', 'ad');
  url.searchParams.set('date_preset', 'last_7d');
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }
  ]));
  url.searchParams.set('fields', [
    'ad_id', 'ad_name', 'adset_id', 'adset_name',
    'campaign_id', 'campaign_name', 'spend',
    'impressions', 'clicks', 'ctr', 'actions'
  ].join(','));
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug({
        where: 'fetchAdsInsights',
        attempt,
        ad_account_id: normalizedId
      }, '[fetchAdsInsights] Fetching ads insights...');

      const res = await fetch(url.toString());
      const duration = Date.now() - startTime;

      if (res.ok) {
        const json = await res.json();
        const adsCount = json.data?.length || 0;

        logger.info({
          where: 'fetchAdsInsights',
          ad_account_id: normalizedId,
          ads_count: adsCount,
          duration_ms: duration,
          attempt
        }, `[fetchAdsInsights] Success: ${adsCount} ads fetched in ${duration}ms`);

        return json.data || [];
      }

      // Rate limit — ждём и повторяем
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        logger.warn({
          where: 'fetchAdsInsights',
          status: 429,
          retry_after_sec: retryAfter,
          attempt
        }, `[fetchAdsInsights] Rate limited, waiting ${retryAfter}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      // Другие ошибки
      const errText = await res.text();
      logger.error({
        where: 'fetchAdsInsights',
        status: res.status,
        error: errText.substring(0, 500),
        duration_ms: duration,
        attempt
      }, `[fetchAdsInsights] FB API error: ${res.status}`);

      // Graceful fallback — возвращаем пустой массив вместо throw
      return [];

    } catch (fetchError) {
      const duration = Date.now() - startTime;
      logger.error({
        where: 'fetchAdsInsights',
        error: String(fetchError),
        duration_ms: duration,
        attempt
      }, `[fetchAdsInsights] Fetch failed: ${fetchError.message}`);

      // Последняя попытка — graceful fallback
      if (attempt >= maxRetries) {
        return [];
      }

      // Ждём перед повтором
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return [];
}

/**
 * Анализирует ads для поиска "пожирателей" — объявлений,
 * которые тратят бюджет без результата
 *
 * @param {Array} adsInsights - Массив ads с метриками из fetchAdsInsights
 * @param {Object} options - Опции анализа
 * @param {number} options.targetCPL - Целевой CPL (в долларах)
 * @param {Map} options.adsetSpendMap - Map<adset_id, total_spend> для расчёта доли
 * @param {Object} options.thresholds - Пороги из AD_EATER_THRESHOLDS
 * @returns {Array} Массив "пожирателей" с причинами и приоритетом
 */
function analyzeAdsForEaters(adsInsights, options = {}) {
  const { targetCPL, adsetSpendMap, thresholds = AD_EATER_THRESHOLDS } = options;
  const eaters = [];

  // Статистика для логирования
  let skippedLowSpend = 0;
  let skippedLowImpressions = 0;
  let analyzedCount = 0;

  logger.debug({
    where: 'analyzeAdsForEaters',
    total_ads: adsInsights.length,
    target_cpl: targetCPL,
    thresholds: {
      min_spend: thresholds.MIN_SPEND_FOR_ANALYSIS,
      min_impressions: thresholds.MIN_IMPRESSIONS,
      cpl_multiplier: thresholds.CPL_CRITICAL_MULTIPLIER,
      spend_share: thresholds.SPEND_SHARE_CRITICAL
    }
  }, '[analyzeAdsForEaters] Starting analysis...');

  for (const ad of adsInsights) {
    const spend = parseFloat(ad.spend || 0);
    const leads = extractLeads(ad.actions);
    const impressions = parseInt(ad.impressions || 0);

    // Пропускаем ads с малым расходом — недостаточно данных для выводов
    if (spend < thresholds.MIN_SPEND_FOR_ANALYSIS) {
      skippedLowSpend++;
      continue;
    }

    // Пропускаем ads с малыми показами
    if (impressions < thresholds.MIN_IMPRESSIONS) {
      skippedLowImpressions++;
      continue;
    }

    analyzedCount++;
    const reasons = [];
    let priority = 'medium';
    let isCritical = false;

    // Критерий 1: Потратил $X, но 0 лидов (главный критерий пожирателя)
    if (leads === 0) {
      reasons.push(`Потрачено $${spend.toFixed(2)}, но 0 лидов`);
      priority = 'high';

      // Если занимает >50% бюджета адсета — критично
      const adsetSpend = adsetSpendMap?.get(ad.adset_id) || 0;
      if (adsetSpend > 0 && spend / adsetSpend >= thresholds.SPEND_SHARE_CRITICAL) {
        const sharePercent = Math.round(spend / adsetSpend * 100);
        reasons.push(`Занимает ${sharePercent}% бюджета адсета`);
        priority = 'critical';
        isCritical = true;
      }
    }

    // Критерий 2: CPL > 3x от таргета (есть лиды, но слишком дорого)
    if (leads > 0 && targetCPL && targetCPL > 0) {
      const adCPL = spend / leads;
      const multiplier = adCPL / targetCPL;
      if (multiplier >= thresholds.CPL_CRITICAL_MULTIPLIER) {
        reasons.push(`CPL $${adCPL.toFixed(2)} = ${multiplier.toFixed(1)}x от цели $${targetCPL.toFixed(2)}`);
        priority = 'high';
        isCritical = true;
      }
    }

    // Если есть причины — это пожиратель
    if (reasons.length > 0) {
      const eater = {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        adset_id: ad.adset_id,
        adset_name: ad.adset_name,
        campaign_id: ad.campaign_id,
        campaign_name: ad.campaign_name,
        spend,
        leads,
        impressions,
        cpl: leads > 0 ? spend / leads : null,
        ctr: parseFloat(ad.ctr || 0),
        reasons,
        priority,
        is_critical: isCritical
      };

      // Логируем каждого найденного пожирателя
      logger.info({
        where: 'analyzeAdsForEaters',
        ad_id: eater.ad_id,
        ad_name: eater.ad_name?.substring(0, 50),
        adset_id: eater.adset_id,
        spend: eater.spend,
        leads: eater.leads,
        priority: eater.priority,
        is_critical: eater.is_critical,
        reasons: eater.reasons
      }, `[analyzeAdsForEaters] 🔥 EATER FOUND: ${eater.ad_name?.substring(0, 30)} - $${spend.toFixed(2)}, ${leads} leads, priority=${priority}`);

      eaters.push(eater);
    }
  }

  // Сортируем: critical → high → medium, затем по spend (убывание)
  const priorityOrder = { critical: 0, high: 1, medium: 2 };
  const sortedEaters = eaters.sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority] || b.spend - a.spend
  );

  // Итоговый лог
  const totalWastedSpend = sortedEaters.reduce((sum, e) => sum + e.spend, 0);
  logger.info({
    where: 'analyzeAdsForEaters',
    total_ads: adsInsights.length,
    skipped_low_spend: skippedLowSpend,
    skipped_low_impressions: skippedLowImpressions,
    analyzed: analyzedCount,
    eaters_found: sortedEaters.length,
    critical_count: sortedEaters.filter(e => e.is_critical).length,
    high_count: sortedEaters.filter(e => e.priority === 'high').length,
    total_wasted_spend: totalWastedSpend.toFixed(2)
  }, `[analyzeAdsForEaters] Analysis complete: ${sortedEaters.length} eaters found, $${totalWastedSpend.toFixed(2)} wasted`);

  return sortedEaters;
}

/**
 * Группирует daily данные и вычисляет тренды для 1d, 3d, 7d
 * @param {Array} dailyData - данные с breakdown по дням
 * @param {Array} actionsData - агрегированные actions
 * @param {Map} campaignObjectives - Map<campaign_id, objective>
 */
function calculateMultiPeriodTrends(dailyData, actionsData = [], campaignObjectives = new Map()) {
  // Группируем по adset_id
  const byAdset = new Map();
  
  for (const row of dailyData) {
    const id = row.adset_id;
    if (!byAdset.has(id)) {
      byAdset.set(id, {
        adset_id: id,
        adset_name: row.adset_name,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        days: []
      });
    }
    byAdset.get(id).days.push({
      date: row.date_start,
      cpm: parseFloat(row.cpm || 0),
      ctr: parseFloat(row.ctr || 0),
      frequency: parseFloat(row.frequency || 0),
      impressions: parseFloat(row.impressions || 0),
      spend: parseFloat(row.spend || 0),
      reach: parseFloat(row.reach || 0)
    });
  }
  
  // Сортируем дни по дате (старые → новые)
  for (const adset of byAdset.values()) {
    adset.days.sort((a, b) => new Date(a.date) - new Date(b.date));
  }
  
  // Для каждого adset вычисляем метрики и тренды
  const result = [];
  
  for (const adset of byAdset.values()) {
    const days = adset.days;
    if (days.length < 2) continue; // Недостаточно данных
    
    // Агрегируем метрики за последние 7 дней
    const last7d = aggregateMetrics(days.slice(-7));
    
    // Вычисляем тренды для разных периодов
    const trends = {
      d1: calculateTrend(days.slice(-2, -1), days.slice(-1)), // позавчера vs вчера
      d3: calculateTrend(days.slice(-6, -3), days.slice(-3)), // дни 4-6 vs последние 3
      d7: calculateTrend(days.slice(-14, -7), days.slice(-7)) // дни 8-14 vs последние 7
    };
    
    // Получаем objective для этого adset
    const objective = campaignObjectives.get(adset.campaign_id) || 'whatsapp'; // fallback для legacy

    // Получаем actions для этого adset
    const actionsForAdset = actionsData.find(a => a.adset_id === adset.adset_id);
    const actions = actionsForAdset?.actions || [];

    // Для отладки: выводим все action_types
    const allActionTypes = actions.map(a => `${a.action_type}:${a.value}`).join(', ');

    let dataValid = true;
    let dataValidityReason = null;
    let objectiveMetrics = null;

    // Собираем метрики в зависимости от objective
    if (objective === 'whatsapp') {
      // WhatsApp метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const conversationsTotal = extractActionValue(actions, 'onsite_conversion.total_messaging_connection');
      const qualityLeadsTotal = extractActionValue(actions, 'onsite_conversion.messaging_user_depth_2_message_send');

      const conversionRate = linkClicksTotal > 0 ? (conversationsTotal / linkClicksTotal) * 100 : 0;
      const qualityConversionRate = linkClicksTotal > 0 ? (qualityLeadsTotal / linkClicksTotal) * 100 : 0;

      // Проверка валидности ТОЛЬКО для WhatsApp
      if (linkClicksTotal > 0 && conversionRate < 10) {
        dataValid = false;
        dataValidityReason = `Низкая конверсия WhatsApp: ${conversionRate.toFixed(1)}% (${linkClicksTotal} кликов → ${conversationsTotal} переписок). Возможно, лиды не прогрузились.`;
      }

      objectiveMetrics = {
        whatsapp_metrics: {
          link_clicks: linkClicksTotal,
          conversations_started: conversationsTotal,
          quality_leads: qualityLeadsTotal,
          conversion_rate: conversionRate.toFixed(1),
          quality_conversion_rate: qualityConversionRate.toFixed(1),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'site_leads') {
      // Site Leads метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const siteLeadsTotal = extractSiteLeads(actions);

      const conversionRate = linkClicksTotal > 0 ? (siteLeadsTotal / linkClicksTotal) * 100 : 0;

      objectiveMetrics = {
        site_leads_metrics: {
          link_clicks: linkClicksTotal,
          pixel_leads: siteLeadsTotal,
          conversion_rate: conversionRate.toFixed(1),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'instagram_traffic') {
      // Instagram Traffic метрики
      const linkClicksTotal = extractActionValue(actions, 'link_click');
      const totalSpend = last7d?.spend || 0;
      const costPerClick = linkClicksTotal > 0 ? totalSpend / linkClicksTotal : 0;

      objectiveMetrics = {
        instagram_metrics: {
          link_clicks: linkClicksTotal,
          cost_per_click: costPerClick.toFixed(2),
          all_action_types: allActionTypes
        }
      };
    } else if (objective === 'lead_forms') {
      // Lead Forms метрики (Facebook Instant Forms)
      const formLeadsTotal = extractActionValue(actions, 'onsite_conversion.lead_grouped');
      const totalSpend = last7d?.spend || 0;
      const costPerLead = formLeadsTotal > 0 ? totalSpend / formLeadsTotal : 0;

      objectiveMetrics = {
        lead_forms_metrics: {
          form_leads: formLeadsTotal,
          cost_per_lead: costPerLead.toFixed(2),
          all_action_types: allActionTypes
        }
      };
    }

    result.push({
      adset_id: adset.adset_id,
      adset_name: adset.adset_name,
      campaign_id: adset.campaign_id,
      campaign_name: adset.campaign_name,
      objective: objective, // ✅ ДОБАВЛЕНО
      metrics_last_7d: last7d,
      trends,
      data_valid: dataValid,
      data_validity_reason: dataValidityReason,
      ...objectiveMetrics // ✅ Условное добавление метрик
    });
  }
  
  return result;
}

/**
 * Агрегирует метрики за период
 */
function aggregateMetrics(days) {
  if (!days || days.length === 0) return null;
  
  const totalSpend = days.reduce((sum, d) => sum + d.spend, 0);
  const totalImpressions = days.reduce((sum, d) => sum + d.impressions, 0);
  const totalReach = days.reduce((sum, d) => sum + d.reach, 0);
  const totalClicks = days.reduce((sum, d) => sum + (d.impressions * d.ctr / 100), 0);
  
  return {
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0,
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
    frequency: totalReach > 0 ? (totalImpressions / totalReach) : 0,
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach
  };
}

/**
 * Вычисляет % изменение между двумя периодами
 */
function calculateTrend(prevDays, currentDays) {
  const prev = aggregateMetrics(prevDays);
  const current = aggregateMetrics(currentDays);
  
  if (!prev || !current) {
    return { cpm_change_pct: 0, ctr_change_pct: 0 };
  }
  
  const cpmChange = prev.cpm > 0 
    ? ((current.cpm - prev.cpm) / prev.cpm * 100)
    : 0;
  
  const ctrChange = prev.ctr > 0
    ? ((current.ctr - prev.ctr) / prev.ctr * 100)
    : 0;
  
  return {
    cpm_change_pct: parseFloat(cpmChange.toFixed(1)),
    ctr_change_pct: parseFloat(ctrChange.toFixed(1))
  };
}

/**
 * DEPRECATED: Fetch insights для креатива за указанный период
 * 
 * НОВЫЙ МЕТОД: Сначала находим все ads использующие этот creative,
 * затем получаем insights для каждого ad и агрегируем результаты
 * 
 * ЗАМЕЧАНИЕ: Теперь используем getCreativeMetricsFromDB() вместо этой функции
 */
/* DEPRECATED - используется getCreativeMetricsFromDB
async function fetchCreativeInsights(adAccountId, accessToken, fbCreativeId, options = {}) {
  const normalizedId = normalizeAdAccountId(adAccountId);
  
  // ============================================
  // ШАГ 1: Найти все ads использующие этот creative
  // ============================================
  const adsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${normalizedId}/ads`;
  const adsParams = new URLSearchParams({
    fields: 'id,name,status,effective_status,creative{id}',
    limit: '500',
    access_token: accessToken
  });
  
  const adsRes = await fetch(`${adsUrl}?${adsParams.toString()}`);
  if (!adsRes.ok) {
    const err = await adsRes.text();
    logger.error({ 
      where: 'fetchCreativeInsights',
      phase: 'fetch_ads',
      creative_id: fbCreativeId,
      status: adsRes.status,
      error: err
    });
    return null;
  }
  
  const adsJson = await adsRes.json();
  const allAds = adsJson.data || [];
  
  // Фильтруем ads с нашим creative_id
  const adsWithCreative = allAds.filter(ad => ad.creative?.id === fbCreativeId);
  
  logger.info({ 
    where: 'fetchCreativeInsights',
    phase: 'ads_found',
    creative_id: fbCreativeId,
    total_ads: allAds.length,
    ads_with_creative: adsWithCreative.length
  });
  
  if (adsWithCreative.length === 0) {
    logger.info({ 
      where: 'fetchCreativeInsights',
      creative_id: fbCreativeId,
      message: 'No ads found using this creative'
    });
    return null;
  }
  
  // ============================================
  // ШАГ 2: Получить insights для каждого ad
  // ============================================
  const datePreset = options.date_preset || 'last_30d';
  const allInsights = [];
  
  for (const ad of adsWithCreative) {
    const insightsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${ad.id}/insights`;
    const insightsParams = new URLSearchParams({
      fields: 'ctr,cpm,cpp,cpc,frequency,impressions,spend,actions,reach',
      access_token: accessToken
    });
    
    if (options.date_preset) {
      insightsParams.set('date_preset', options.date_preset);
    } else if (options.time_range) {
      insightsParams.set('time_range', JSON.stringify(options.time_range));
    } else {
      insightsParams.set('date_preset', 'last_30d');
    }
    
    try {
      const insightsRes = await fetch(`${insightsUrl}?${insightsParams.toString()}`);
      if (insightsRes.ok) {
        const insightsJson = await insightsRes.json();
        if (insightsJson.data && insightsJson.data.length > 0) {
          allInsights.push(...insightsJson.data);
        }
      }
    } catch (error) {
      logger.warn({ 
        where: 'fetchCreativeInsights',
        ad_id: ad.id,
        error: error.message
      });
    }
  }
  
  // LOG: результаты
  logger.info({ 
    where: 'fetchCreativeInsights',
    phase: 'insights_fetched',
    creative_id: fbCreativeId,
    ads_checked: adsWithCreative.length,
    insights_records: allInsights.length,
    date_preset: datePreset
  });
  
  if (allInsights.length === 0) {
    return null;
  }
  
  const data = allInsights;
  
  // Агрегируем (если несколько ads с одним креативом)
  const totalImpressions = data.reduce((sum, d) => sum + (parseFloat(d.impressions) || 0), 0);
  const totalSpend = data.reduce((sum, d) => sum + (parseFloat(d.spend) || 0), 0);
  const totalReach = data.reduce((sum, d) => sum + (parseFloat(d.reach) || 0), 0);
  const avgCTR = data.reduce((sum, d) => sum + (parseFloat(d.ctr) || 0), 0) / data.length;
  const avgCPM = data.reduce((sum, d) => sum + (parseFloat(d.cpm) || 0), 0) / data.length;
  const avgFrequency = data.reduce((sum, d) => sum + (parseFloat(d.frequency) || 0), 0) / data.length;
  
  // CPL (cost per lead) - use extractLeads for consistent counting
  let totalLeads = 0;
  for (const d of data) {
    if (d.actions) {
      totalLeads += extractLeads(d.actions);
    }
  }
  
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : null;
  
  return {
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach,
    avg_ctr: avgCTR,
    avg_cpm: avgCPM,
    avg_frequency: avgFrequency,
    total_leads: totalLeads,
    avg_cpl: avgCPL
  };
}

/**
 * Получить метрики креатива из creative_metrics_history
 * Агрегирует за последние N дней
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID из user_accounts
 * @param {string} fbCreativeId - ID креатива Facebook
 * @param {number} days - Количество дней для агрегации (по умолчанию 30)
 * @param {string|null} accountId - UUID из ad_accounts.id для мультиаккаунтности (опционально)
 * @returns {Object|null} Метрики или null если данных нет (первый запуск)
 */
async function getCreativeMetricsFromDB(supabase, userAccountId, fbCreativeId, days = 30, accountId = null) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);

  let query = supabase
    .from('creative_metrics_history')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('creative_id', fbCreativeId)
    .eq('source', 'production')
    .gte('date', dateFrom.toISOString().split('T')[0]);

  // Фильтрация по рекламному аккаунту для мультиаккаунтного режима
  if (accountId) {
    query = query.eq('account_id', accountId);
  }

  const { data, error } = await query.order('date', { ascending: false });

  if (error) {
    logger.warn({
      error: error.message,
      creative_id: fbCreativeId,
      user_account_id: userAccountId,
      account_id: accountId
    }, 'Failed to fetch metrics from creative_metrics_history');
    return null;
  }
  
  if (!data || data.length === 0) {
    logger.info({ 
      creative_id: fbCreativeId,
      user_account_id: userAccountId,
      days
    }, 'No metrics found in creative_metrics_history - first run');
    return null; // Нет данных - первый запуск
  }
  
  // Агрегируем метрики за период
  const totalImpressions = data.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const totalSpend = data.reduce((sum, row) => sum + (parseFloat(row.spend) || 0), 0);
  const totalReach = data.reduce((sum, row) => sum + (row.reach || 0), 0);
  const totalLeads = data.reduce((sum, row) => sum + (row.leads || 0), 0);
  const totalClicks = data.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const totalLinkClicks = data.reduce((sum, row) => sum + (row.link_clicks || 0), 0);
  
  // Средние значения
  const avgCTR = data.reduce((sum, row) => sum + (parseFloat(row.ctr) || 0), 0) / data.length;
  const avgCPM = data.reduce((sum, row) => sum + (parseFloat(row.cpm) || 0), 0) / data.length;
  const avgFrequency = data.reduce((sum, row) => sum + (parseFloat(row.frequency) || 0), 0) / data.length;
  
  logger.info({ 
    creative_id: fbCreativeId,
    user_account_id: userAccountId,
    data_points: data.length,
    impressions: totalImpressions,
    leads: totalLeads
  }, 'Metrics loaded from creative_metrics_history');
  
  return {
    impressions: totalImpressions,
    spend: totalSpend,
    reach: totalReach,
    clicks: totalClicks,
    link_clicks: totalLinkClicks,
    total_leads: totalLeads,
    avg_cpl: totalLeads > 0 ? totalSpend / totalLeads : null,
    avg_ctr: avgCTR,
    avg_cpm: avgCPM,
    avg_frequency: avgFrequency,
    data_points: data.length,
    date_from: dateFrom.toISOString().split('T')[0],
    date_to: new Date().toISOString().split('T')[0]
  };
}

/**
 * Получить активные креативы пользователя из user_creatives
 */
async function getActiveCreatives(supabase, userAccountId, accountId = null) {
  // ========================================
  // ФИЛЬТРУЕМ КРЕАТИВЫ ПО АКТИВНЫМ НАПРАВЛЕНИЯМ
  // ========================================
  // Получаем креативы с информацией о направлении (только из активных направлений)
  let query = supabase
    .from('user_creatives')
    .select(`
      id, 
      title, 
      fb_video_id, 
      fb_creative_id_whatsapp, 
      fb_creative_id_instagram_traffic, 
      fb_creative_id_site_leads, 
      is_active, 
      status, 
      created_at,
      direction_id,
      account_directions!inner(is_active)
    `)
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .eq('account_directions.is_active', true); // ТОЛЬКО из активных направлений!

  if (accountId) {
    query = query.eq('account_id', accountId).eq('account_directions.account_id', accountId);
  } else {
    query = query.is('account_id', null).is('account_directions.account_id', null);
  }

  const { data, error } = await query;
  
  if (error) throw new Error(`Failed to get active creatives: ${error.message}`);
  
  // Также включаем креативы БЕЗ направления (legacy)
  let legacyQuery = supabase
    .from('user_creatives')
    .select('id, title, fb_video_id, fb_creative_id_whatsapp, fb_creative_id_instagram_traffic, fb_creative_id_site_leads, fb_creative_id_lead_forms, is_active, status, created_at, direction_id')
    .eq('user_id', userAccountId)
    .eq('is_active', true)
    .eq('status', 'ready')
    .is('direction_id', null); // Креативы без направления (legacy)

  if (accountId) {
    legacyQuery = legacyQuery.eq('account_id', accountId);
  } else {
    legacyQuery = legacyQuery.is('account_id', null);
  }

  const { data: legacyCreatives, error: legacyError } = await legacyQuery;
  
  if (legacyError) throw new Error(`Failed to get legacy creatives: ${legacyError.message}`);
  
  return [...(data || []), ...(legacyCreatives || [])];
}

/**
 * Получить все creative_id из активных ads в Facebook
 */
async function getActiveCreativeIds(adAccountId, accessToken) {
  const fields = 'id,name,status,effective_status,adset_id,creative{id}';
  const url = `https://graph.facebook.com/${FB_API_VERSION}/${normalizeAdAccountId(adAccountId)}/ads`;
  
  try {
    const response = await fetch(`${url}?access_token=${accessToken}&fields=${fields}&limit=500`);
    const result = await response.json();
    
    if (!response.ok || result.error) {
      throw new Error(result.error?.message || 'Failed to fetch ads');
    }
    
    const activeAds = (result.data || []).filter(ad => 
      ad.status === 'ACTIVE' && ad.effective_status === 'ACTIVE'
    );
    
    const creativeIdsSet = new Set();
    const creativeToAdsMap = new Map();
    
    for (const ad of activeAds) {
      const creativeId = ad.creative?.id;
      if (!creativeId) continue;
      
      creativeIdsSet.add(creativeId);
      
      if (!creativeToAdsMap.has(creativeId)) {
        creativeToAdsMap.set(creativeId, []);
      }
      
      creativeToAdsMap.get(creativeId).push({
        ad_id: ad.id,
        ad_name: ad.name,
        adset_id: ad.adset_id
      });
    }
    
    return { creativeIdsSet, creativeToAdsMap };
  } catch (error) {
    logger.error({ err: error, message: error.message }, 'Failed to fetch active creative IDs');
    return { creativeIdsSet: new Set(), creativeToAdsMap: new Map() };
  }
}

/**
 * Опционально: сохранить snapshot метрик для аудита
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID пользователя
 * @param {Array} adsets - массив adsets с метриками
 * @param {string|null} accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
async function saveMetricsSnapshot(supabase, userAccountId, adsets, accountUUID = null) {
  if (!adsets || !adsets.length) return;

  const today = new Date().toISOString().split('T')[0];

  const records = adsets.map(a => ({
    user_account_id: userAccountId,
    account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
    date: today,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id,
    impressions: parseInt(a.metrics_last_7d?.impressions || 0),
    spend: parseFloat(a.metrics_last_7d?.spend || 0),
    ctr: parseFloat(a.metrics_last_7d?.ctr || 0),
    cpm: parseFloat(a.metrics_last_7d?.cpm || 0),
    frequency: parseFloat(a.metrics_last_7d?.frequency || 0),
    quality_ranking: a.diagnostics?.quality_ranking,
    engagement_rate_ranking: a.diagnostics?.engagement_rate_ranking,
    conversion_rate_ranking: a.diagnostics?.conversion_rate_ranking
  }));

  // Insert (ignore duplicates)
  await supabase
    .from('creative_metrics_history')
    .upsert(records, { onConflict: 'user_account_id,adset_id,date', ignoreDuplicates: true });
}

/**
 * Сохранить метрики креативов за вчерашний день в creative_metrics_history
 *
 * Получает метрики на уровне Ad (не AdSet) для каждого креатива
 * Использует ad_creative_mapping для точного мэтчинга
 * Собирает инкрементальные данные за вчерашний день
 *
 * @param {Object} supabase - Supabase client
 * @param {string} userAccountId - ID пользователя
 * @param {Array} readyCreatives - массив креативов
 * @param {string} adAccountId - Facebook Ad Account ID (act_xxx)
 * @param {string} accessToken - Facebook Access Token
 * @param {string|null} accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
async function saveCreativeMetricsToHistory(supabase, userAccountId, readyCreatives, adAccountId, accessToken, accountUUID = null) {
  if (!readyCreatives || !readyCreatives.length) return;
  
  // Вчерашний день (метрики собираются на следующий день после показов)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  const records = [];
  
  logger.info({ 
    where: 'saveCreativeMetricsToHistory',
    creatives_count: readyCreatives.length,
    date: yesterdayStr
  }, 'Starting to save creative metrics to history');

  for (const creative of readyCreatives) {
    try {
      // Получить список ads через ad_creative_mapping
      const { data: mappings, error } = await supabase
        .from('ad_creative_mapping')
        .select('ad_id, adset_id, campaign_id, fb_creative_id')
        .eq('user_creative_id', creative.user_creative_id);

      if (error) {
        logger.warn({ 
          where: 'saveCreativeMetricsToHistory',
          creative_id: creative.user_creative_id,
          error: error.message 
        }, 'Failed to fetch ad mappings');
        continue;
      }

      if (!mappings || mappings.length === 0) {
        logger.debug({ 
          where: 'saveCreativeMetricsToHistory',
          creative_id: creative.user_creative_id 
        }, 'No ad mappings found for creative');
        continue;
      }

      logger.debug({ 
        where: 'saveCreativeMetricsToHistory',
        creative_id: creative.user_creative_id,
        ads_count: mappings.length 
      }, 'Found ad mappings');

      // Получить метрики для каждого ad за вчерашний день
      for (const mapping of mappings) {
        try {
          const insights = await fetchAdInsights(adAccountId, accessToken, mapping.ad_id, {
            time_range: {
              since: yesterdayStr,
              until: yesterdayStr
            }
          });
          
          if (!insights) {
            logger.debug({ 
              where: 'saveCreativeMetricsToHistory',
              ad_id: mapping.ad_id,
              date: yesterdayStr
            }, 'No insights for ad');
            continue;
          }

          // Пропускаем если нет показов (ad не показывался вчера)
          const impressions = parseInt(insights.impressions || 0);
          if (impressions === 0) {
            logger.debug({ 
              where: 'saveCreativeMetricsToHistory',
              ad_id: mapping.ad_id,
              date: yesterdayStr
            }, 'No impressions, skipping');
            continue;
          }

          // Извлекаем метрики
          const leads = extractLeads(insights.actions);
          const linkClicks = extractLinkClicks(insights.actions);
          const spend = parseFloat(insights.spend || 0);
          const videoMetrics = extractVideoMetrics(insights);
          
          // Вычисляем CPL (если есть лиды)
          const cpl = leads > 0 ? (spend / leads) : null;

          records.push({
            user_account_id: userAccountId,
            account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
            // user_creative_id заполнится автоматически через триггер на основе ad_id
            date: yesterdayStr,  // Вчерашний день
            ad_id: mapping.ad_id,
            creative_id: mapping.fb_creative_id,
            adset_id: mapping.adset_id,
            campaign_id: mapping.campaign_id,

            // Абсолютные метрики
            impressions: impressions,
            reach: parseInt(insights.reach || 0),
            spend: spend,
            clicks: parseInt(insights.clicks || 0),
            link_clicks: linkClicks,
            leads: leads,

            // Вычисляемые метрики (сохраняем сразу)
            ctr: parseFloat(insights.ctr || 0),
            cpm: parseFloat(insights.cpm || 0),
            cpl: cpl,
            frequency: parseFloat(insights.frequency || 0),

            // Видео метрики
            video_views: videoMetrics.video_views,
            video_views_25_percent: videoMetrics.video_views_25_percent,
            video_views_50_percent: videoMetrics.video_views_50_percent,
            video_views_75_percent: videoMetrics.video_views_75_percent,
            video_views_95_percent: videoMetrics.video_views_95_percent,
            video_avg_watch_time_sec: videoMetrics.video_avg_watch_time_sec,

            // Diagnostics (на уровне ad)
            quality_ranking: insights.quality_ranking || null,
            engagement_rate_ranking: insights.engagement_rate_ranking || null,
            conversion_rate_ranking: insights.conversion_rate_ranking || null,

            source: 'production'
          });

          logger.debug({ 
            where: 'saveCreativeMetricsToHistory',
            ad_id: mapping.ad_id,
            date: yesterdayStr,
            impressions: impressions,
            leads: leads 
          }, 'Collected metrics for ad');

        } catch (err) {
          logger.warn({ 
            where: 'saveCreativeMetricsToHistory',
            ad_id: mapping.ad_id,
            error: err.message 
          }, 'Failed to fetch ad insights');
        }
      }
    } catch (err) {
      logger.warn({ 
        where: 'saveCreativeMetricsToHistory',
        creative_id: creative.user_creative_id,
        error: err.message 
      }, 'Failed to process creative');
    }
  }

  // Сохраняем все записи одним batch запросом
  if (records.length > 0) {
    try {
      const { error } = await supabase
        .from('creative_metrics_history')
        .upsert(records, { 
          onConflict: 'user_account_id,ad_id,date',
          ignoreDuplicates: false  // Обновляем если уже есть (на случай повторного запуска)
        });

      if (error) {
        logger.error({ 
          where: 'saveCreativeMetricsToHistory',
          error: error.message,
          records_count: records.length 
        }, 'Failed to save metrics to history');
      } else {
        logger.info({ 
          where: 'saveCreativeMetricsToHistory',
          saved_count: records.length,
          date: yesterdayStr
        }, 'Successfully saved creative metrics to history');
      }
    } catch (err) {
      logger.error({ 
        where: 'saveCreativeMetricsToHistory',
        error: err.message,
        records_count: records.length 
      }, 'Error saving metrics to history');
    }
  } else {
    logger.info({ 
      where: 'saveCreativeMetricsToHistory',
      date: yesterdayStr
    }, 'No metrics to save (no ads with impressions yesterday)');
  }
}

/**
 * Рассчитывает risk score креатива с учетом ROI
 * 
 * @param {Object} performance - метрики из Facebook API (cpl, ctr, cpm)
 * @param {Object} roiData - данные о реальной окупаемости
 * @param {number} targetCPL - целевой CPL пользователя (в центах)
 * @returns {number} risk_score (0-100)
 */
function calculateRiskScoreWithROI(performance, roiData, targetCPL = 200) {
  let baseScore = 50; // Начальный нейтральный score
  
  // Фактор 1: Facebook метрики (вес 60%)
  if (performance) {
    const cpl = performance.cpl || 0; // в центах
    const ctr = performance.ctr || 0; // в процентах
    const cpm = performance.cpm || 0; // в центах
    
    // CPL выше target -> повышаем risk
    if (cpl > targetCPL * 1.3) {
      baseScore += 20;
    } else if (cpl > targetCPL) {
      baseScore += 10;
    } else if (cpl < targetCPL * 0.7) {
      baseScore -= 15;
    }
    
    // Низкий CTR -> риск
    if (ctr < 0.8) {
      baseScore += 15;
    } else if (ctr > 2.0) {
      baseScore -= 10;
    }
    
    // Высокий CPM -> риск (конвертируем из центов в доллары)
    const cpmDollars = cpm / 100;
    if (cpmDollars > 8) {
      baseScore += 10;
    } else if (cpmDollars < 5) {
      baseScore -= 5;
    }
  }
  
  // Фактор 2: ROI (вес 40% - важнее метрик!)
  // Учитываем ROI только если есть минимум 2 конверсии для статистической значимости
  if (roiData && roiData.conversions >= 2) {
    const roi = roiData.roi;
    
    if (roi > 100) {
      // Отличная окупаемость -> сильно снижаем риск
      baseScore -= 25;
    } else if (roi > 50) {
      // Хорошая окупаемость
      baseScore -= 15;
    } else if (roi > 0) {
      // Положительный ROI
      baseScore -= 5;
    } else if (roi < -50) {
      // Сильный убыток -> высокий риск
      baseScore += 30;
    } else if (roi < 0) {
      // Убыток
      baseScore += 15;
    }
  }
  // Если нет ROI данных или мало конверсий (новый креатив) -> используем только Facebook метрики
  
  // Ограничиваем диапазон 0-100
  return Math.max(0, Math.min(100, Math.round(baseScore)));
}

/**
 * ОСНОВНАЯ ФУНКЦИЯ: Запуск Scoring Agent
 * @param {Object} userAccount - данные пользователя из user_accounts
 * @param {Object} options - опции
 * @param {Object} options.supabase - Supabase client
 * @param {Object} options.logger - logger
 * @param {string|null} options.accountUUID - UUID рекламного аккаунта (для мультиаккаунтности), NULL для legacy
 */
export async function runScoringAgent(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId, username } = userAccount;

  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  );

  const logger = options.logger || console;

  // UUID рекламного аккаунта для мультиаккаунтности (NULL для legacy)
  const accountUUID = options.accountUUID || null;

  logger.info({ where: 'scoring_agent', phase: 'start', userId: userAccountId, username, accountUUID });
  
  try {
    // ========================================
    // ЧАСТЬ 1: АКТИВНЫЕ ADSETS (ОСНОВНОЕ!)
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_adsets' });

    // Сначала получаем adsets config (для переиспользования в brain_run) - делаем ПЕРВЫМ запросом
    // чтобы избежать rate limit от параллельных запросов
    const adsetsConfig = await fetchAdsetsConfig(ad_account_id, access_token, logger);

    // Fetch данные: daily breakdown (для трендов) + агрегированные actions + diagnostics + objectives
    const [dailyData, actionsData, diagnostics, campaignObjectives] = await Promise.all([
      fetchAdsetsDaily(ad_account_id, access_token, 14),
      fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),
      fetchAdsetDiagnostics(ad_account_id, access_token),
      getAdsetsObjectives(supabase, userAccountId, accountUUID)
    ]);

    // Группируем по adset_id и вычисляем метрики для разных периодов
    const adsetMetrics = calculateMultiPeriodTrends(dailyData, actionsData, campaignObjectives);
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'adsets_fetched',
      daily_rows: dailyData.length,
      actions_rows: actionsData.length,
      unique_adsets: adsetMetrics.length,
      diagnostics: diagnostics.length
    });
    
    // Объединяем данные с diagnostics
    const adsetsWithTrends = adsetMetrics.map(adset => {
      const diag = diagnostics.find(d => d.adset_id === adset.adset_id);

      // Формируем базовый объект
      const result = {
        adset_id: adset.adset_id,
        adset_name: adset.adset_name,
        campaign_id: adset.campaign_id,
        campaign_name: adset.campaign_name,
        objective: adset.objective, // ✅ ДОБАВЛЕНО
        metrics_last_7d: adset.metrics_last_7d,
        trends: {
          // Короткий тренд (1 день): вчера vs позавчера
          d1: {
            cpm_change_pct: adset.trends.d1.cpm_change_pct,
            ctr_change_pct: adset.trends.d1.ctr_change_pct
          },
          // Средний тренд (3 дня): последние 3 vs предыдущие 3
          d3: {
            cpm_change_pct: adset.trends.d3.cpm_change_pct,
            ctr_change_pct: adset.trends.d3.ctr_change_pct
          },
          // Долгий тренд (7 дней): последние 7 vs предыдущие 7
          d7: {
            cpm_change_pct: adset.trends.d7.cpm_change_pct,
            ctr_change_pct: adset.trends.d7.ctr_change_pct
          }
        },
        diagnostics: diag ? {
          quality_ranking: diag.quality_ranking,
          engagement_rate_ranking: diag.engagement_rate_ranking,
          conversion_rate_ranking: diag.conversion_rate_ranking,
          ads_count: diag.ads_count
        } : null,
        data_valid: adset.data_valid,
        data_validity_reason: adset.data_validity_reason
      };

      // Условное добавление метрик в зависимости от objective
      if (adset.whatsapp_metrics) {
        result.whatsapp_metrics = adset.whatsapp_metrics;
      }
      if (adset.site_leads_metrics) {
        result.site_leads_metrics = adset.site_leads_metrics;
      }
      if (adset.instagram_metrics) {
        result.instagram_metrics = adset.instagram_metrics;
      }

      return result;
    });
    
    // Опционально: сохраняем snapshot для аудита
    if (options.saveSnapshot !== false) {
      await saveMetricsSnapshot(supabase, userAccountId, adsetsWithTrends, accountUUID);
    }
    
    // ========================================
    // ЧАСТЬ 2: ГОТОВЫЕ КРЕАТИВЫ
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_creatives' });
    
    const userCreatives = await getActiveCreatives(supabase, userAccountId, accountUUID);
    
    // Получаем список creative_id которые используются в активных ads
    const activeCreativeIds = await getActiveCreativeIds(ad_account_id, access_token);
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_fetched', 
      total_creatives: userCreatives.length,
      active_in_ads: activeCreativeIds.creativeIdsSet.size
    });
    
    // ========================================
    // ЧАСТЬ 2.5: ЗАГРУЗКА ROI ДАННЫХ
    // ========================================
    
    logger.info({ where: 'scoring_agent', phase: 'fetching_roi' });
    
    let creativeROIMap = new Map();
    try {
      const { calculateCreativeROI } = await import('../../agent-service/src/lib/roiCalculator.js');
      creativeROIMap = await calculateCreativeROI(userAccountId, null, 30, supabase);
      
      logger.info({ 
        where: 'scoring_agent', 
        phase: 'roi_loaded',
        creatives_with_roi: creativeROIMap.size
      });
    } catch (error) {
      logger.warn({
        where: 'scoring_agent',
        phase: 'roi_load_failed',
        error: String(error)
      }, 'Failed to load ROI data, continuing without it');
    }
    
    const readyCreatives = [];
    
    for (const uc of userCreatives) {
      const creatives = [];
      
      // WhatsApp (MESSAGES)
      if (uc.fb_creative_id_whatsapp) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_whatsapp,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'MESSAGES',
          fb_creative_id: uc.fb_creative_id_whatsapp,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }

      // Site Leads (OUTCOME_LEADS)
      if (uc.fb_creative_id_site_leads) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_site_leads,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'OUTCOME_LEADS',
          fb_creative_id: uc.fb_creative_id_site_leads,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }

      // Instagram Traffic (OUTCOME_TRAFFIC)
      if (uc.fb_creative_id_instagram_traffic) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id_instagram_traffic,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'OUTCOME_TRAFFIC',
          fb_creative_id: uc.fb_creative_id_instagram_traffic,
          performance: stats,
          has_data: stats !== null  // НОВОЕ: флаг наличия данных
        });
      }

      // NEW: Универсальный fb_creative_id (lead_forms и другие objectives)
      // Используется если старые поля не заполнены (новый формат креативов)
      if (uc.fb_creative_id && creatives.length === 0) {
        const stats = await getCreativeMetricsFromDB(
          supabase,
          userAccountId,
          uc.fb_creative_id,
          30,
          accountUUID // UUID из ad_accounts.id для мультиаккаунтности
        );

        creatives.push({
          objective: 'OUTCOME_LEADS', // Default для lead_forms
          fb_creative_id: uc.fb_creative_id,
          performance: stats,
          has_data: stats !== null
        });
      }

      if (creatives.length > 0) {
        // Добавляем ROI данные если есть
        const roiData = creativeROIMap.get(uc.id) || null;
        
        // Рассчитываем risk score с учетом ROI только если есть данные
        // Берем первый креатив для расчета (обычно это основной objective)
        const primaryCreative = creatives[0];
        const performance = primaryCreative?.performance || null;
        const targetCPL = 200; // Целевой CPL в центах (можно получить из настроек пользователя)
        const riskScore = performance ? calculateRiskScoreWithROI(performance, roiData, targetCPL) : null;
        
        readyCreatives.push({
          name: uc.title,
          user_creative_id: uc.id,
          id: uc.id, // Добавляем для совместимости
          title: uc.title,
          direction_id: uc.direction_id,
          created_at: uc.created_at,
          fb_creative_id_whatsapp: uc.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: uc.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: uc.fb_creative_id_site_leads,
          creatives: creatives,
          roi_data: roiData, // { revenue, spend, roi, conversions, leads }
          risk_score: riskScore, // 0-100, с учетом ROI или null если нет данных
          has_data: creatives.some(c => c.has_data) // Есть ли хоть один креатив с данными
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'creatives_processed',
      total: readyCreatives.length,
      with_data: readyCreatives.filter(c => c.has_data).length,
      without_data: readyCreatives.filter(c => !c.has_data).length,
      with_roi: readyCreatives.filter(c => c.roi_data !== null).length
    });
    
    // ========================================
    // ЧАСТЬ 2.6: СОХРАНЕНИЕ МЕТРИК В ИСТОРИЮ
    // ========================================
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'saving_metrics_to_history',
      creatives_count: readyCreatives.length 
    });
    
    // Сохраняем метрики за вчерашний день для всех активных ads
    try {
      await saveCreativeMetricsToHistory(
        supabase,
        userAccountId,
        readyCreatives,
        ad_account_id,
        access_token,
        accountUUID
      );
      
      logger.info({
        where: 'scoring_agent',
        phase: 'metrics_saved'
      });

      // Заполнить direction_metrics_rollup (агрегация по направлениям)
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const { data: rollupResult, error: rollupError } = await supabase.rpc(
          'upsert_direction_metrics_rollup',
          {
            p_user_account_id: userAccountId,
            p_account_id: accountUUID,
            p_day: yesterdayStr
          }
        );

        if (rollupError) {
          logger.warn({
            where: 'scoring_agent',
            phase: 'direction_rollup_failed',
            error: rollupError.message
          }, 'Failed to update direction metrics rollup');
        } else {
          logger.info({
            where: 'scoring_agent',
            phase: 'direction_rollup_updated',
            rows_affected: rollupResult
          });
        }
      } catch (rollupErr) {
        logger.warn({
          where: 'scoring_agent',
          phase: 'direction_rollup_error',
          error: String(rollupErr)
        }, 'Error updating direction metrics rollup');
      }

    } catch (error) {
      // Не критическая ошибка - продолжаем работу даже если не удалось сохранить метрики
      logger.error({
        where: 'scoring_agent',
        phase: 'metrics_save_failed',
        error: String(error)
      }, 'Failed to save metrics to history, continuing...');
    }

    // ========================================
    // ОПРЕДЕЛЯЕМ НЕИСПОЛЬЗОВАННЫЕ КРЕАТИВЫ
    // ========================================
    // Креативы попадают в unused_creatives если:
    // 1. Не используются в активных ads (isUnused = true)
    // 2. Или у них нет метрик в БД (первый запуск, has_data = false)
    
    const unusedCreatives = [];
    
    for (const uc of userCreatives) {
      // Проверяем все fb_creative_id этого креатива
      const creativeIds = [
        uc.fb_creative_id_whatsapp,
        uc.fb_creative_id_instagram_traffic,
        uc.fb_creative_id_site_leads
      ].filter(id => id);
      
      // Проверяем есть ли этот креатив в ready_creatives и есть ли у него данные
      const readyCreative = readyCreatives.find(rc => rc.id === uc.id);
      const hasData = readyCreative?.has_data || false;
      
      // Если НИ ОДИН из creative_id не используется в активных ads
      const isUnused = creativeIds.length > 0 && 
                       !creativeIds.some(id => activeCreativeIds.creativeIdsSet.has(id));
      
      // Креатив unused если он не используется ИЛИ у него нет данных (первый запуск)
      if (isUnused || !hasData) {
        // Определяем рекомендуемый objective на основе наличия креативов
        let recommendedObjective = 'WhatsApp'; // По умолчанию
        if (uc.fb_creative_id_whatsapp) recommendedObjective = 'WhatsApp';
        else if (uc.fb_creative_id_instagram_traffic) recommendedObjective = 'Instagram';
        else if (uc.fb_creative_id_site_leads) recommendedObjective = 'SiteLeads';
        
        unusedCreatives.push({
          id: uc.id,
          title: uc.title,
          fb_creative_id_whatsapp: uc.fb_creative_id_whatsapp,
          fb_creative_id_instagram_traffic: uc.fb_creative_id_instagram_traffic,
          fb_creative_id_site_leads: uc.fb_creative_id_site_leads,
          recommended_objective: recommendedObjective,
          created_at: uc.created_at,
          direction_id: uc.direction_id,  // ВАЖНО: привязка к направлению
          first_run: !hasData,  // НОВОЕ: флаг первого запуска (нет метрик в БД)
          not_in_active_ads: isUnused  // Не используется в активных ads
        });
      }
    }
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'unused_creatives_identified',
      count: unusedCreatives.length,
      first_run_count: unusedCreatives.filter(c => c.first_run).length,
      not_in_active_ads_count: unusedCreatives.filter(c => c.not_in_active_ads).length
    });
    
    // ========================================
    // ЧАСТЬ 3: ФОРМИРОВАНИЕ RAW OUTPUT (БЕЗ LLM!)
    // ========================================
    
    // Разделяем ready_creatives на те, что с данными и без данных
    const creativesWithData = readyCreatives.filter(c => c.has_data);
    const creativesWithoutData = readyCreatives.filter(c => !c.has_data);
    
    // Возвращаем только RAW данные, без LLM анализа
    const scoringRawData = {
      adsets: adsetsWithTrends,
      ready_creatives: creativesWithData,  // Только креативы с метриками
      unused_creatives: unusedCreatives,  // Включает креативы без метрик (first_run: true)
      adsets_config: adsetsConfig  // Конфигурация adsets для brain_run (избегаем повторный запрос и rate limit)
    };
    
    logger.info({ 
      where: 'scoring_agent', 
      phase: 'data_collected',
      adsets_count: adsetsWithTrends.length,
      ready_creatives_count: creativesWithData.length,
      unused_creatives_count: unusedCreatives.length,
      creatives_without_data_count: creativesWithoutData.length
    });
    
    // ========================================
    // ЧАСТЬ 4: СОХРАНЕНИЕ РЕЗУЛЬТАТОВ (опционально)
    // ========================================
    
    const duration = Date.now() - startTime;
    
    // Сохраняем факт сбора данных для аудита
    if (options.saveExecution !== false) {
      await supabase.from('scoring_executions').insert({
        user_account_id: userAccountId,
        account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        status: 'success',
        items_analyzed: adsetsWithTrends.length,
        creatives_analyzed: readyCreatives.length,
        scoring_output: scoringRawData, // raw данные
        llm_used: false, // больше не используем LLM в scoring agent
        llm_model: null
      });
    }
    
    logger.info({
      where: 'scoring_agent',
      phase: 'complete',
      userId: userAccountId,
      duration,
      stats: {
        adsets: adsetsWithTrends.length,
        creatives: readyCreatives.length
      }
    });
    
    return scoringRawData;
    
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      where: 'scoring_agent',
      phase: 'error',
      userId: userAccountId,
      username,
      duration,
      error: String(error),
      stack: error.stack
    });

    // Логируем ошибку в централизованную систему
    logScoringError(userAccountId, error, {
      username,
      accountUUID,
      duration,
      phase: 'scoring_agent'
    }).catch(() => {});

    await supabase.from('scoring_executions').insert({
      user_account_id: userAccountId,
      account_id: accountUUID || null,  // UUID для мультиаккаунтности, NULL для legacy
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'error',
      error_message: String(error),
      items_analyzed: 0,
      creatives_analyzed: 0,
      llm_model: process.env.BRAIN_MODEL || 'gpt-5'
    });

    throw error;
  }
}

/**
 * Interactive Brain Mode (ENHANCED)
 *
 * Собирает данные с фокусом на TODAY и генерирует proposals без выполнения.
 * Использует ту же логику Health Score что и основной Brain Agent.
 * Proposals возвращаются для подтверждения пользователем через Chat Assistant.
 *
 * КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ АВТОМАТИЧЕСКОГО BRAIN:
 * 1. ФОКУС НА СЕГОДНЯ — анализирует realtime данные за сегодня
 * 2. ИСПОЛЬЗУЕТ ПОСЛЕДНИЙ ОТЧЁТ BRAIN — берёт исторические данные из scoring_executions
 * 3. TODAY-КОМПЕНСАЦИЯ — если сегодня лучше вчера, смягчает негативные решения
 * 4. НЕ ВЫПОЛНЯЕТ — только предлагает, ждёт подтверждения пользователя
 *
 * @param {Object} userAccount - данные пользователя (ad_account_id, access_token, id)
 * @param {Object} options - опции
 * @param {string} options.directionId - UUID направления (опционально, для фильтрации)
 * @param {Object} options.supabase - Supabase client
 * @param {Object} options.logger - logger instance
 * @param {boolean} options.useLLM - использовать ли LLM для генерации proposals (default: true)
 * @returns {Object} - { proposals: [...], context: {...}, summary: {...} }
 */
export async function runInteractiveBrain(userAccount, options = {}) {
  const startTime = Date.now();
  const { ad_account_id, access_token, id: userAccountId, account_uuid } = userAccount;

  const supabase = options.supabase || createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  );

  const log = options.logger || logger;
  const directionId = options.directionId || null;
  const campaignId = options.campaignId || null;  // Facebook campaign ID для фильтрации
  const useLLM = options.useLLM !== false; // default: true

  // accountUUID может быть передан через options или через userAccount
  // Консистентно с основным Brain (server.js)
  const accountUUID = options.accountUUID || account_uuid || null;

  log.info({
    where: 'interactive_brain',
    phase: 'start',
    userId: userAccountId,
    directionId,
    campaignId,
    useLLM,
    accountUUID,
    ad_account_id
  });

  try {
    // ========================================
    // ЧАСТЬ 1: СБОР ДАННЫХ ЗА СЕГОДНЯ (REAL-TIME)
    // ========================================

    log.info({ where: 'interactive_brain', phase: 'fetching_today_data' });

    // Получаем данные из FB API:
    // - today/yesterday для текущих метрик
    // - dailyData + actionsData для исторических метрик (как в основном runScoringAgent)
    log.info({
      where: 'interactive_brain',
      phase: 'fetching_fb_data',
      ad_account_id,
      message: 'Запрашиваем today, yesterday, daily (14d), actions (7d)'
    });

    let todayData, yesterdayData, dailyData, actionsData, adsetsConfigData, adsInsightsData;
    try {
      [todayData, yesterdayData, dailyData, actionsData, adsetsConfigData, adsInsightsData] = await Promise.all([
        fetchAdsets(ad_account_id, access_token, 'today'),
        fetchAdsets(ad_account_id, access_token, 'yesterday'),
        fetchAdsetsDaily(ad_account_id, access_token, 14),  // 14 дней для трендов
        fetchAdsetsActions(ad_account_id, access_token, 'last_7d'),  // actions за 7 дней
        fetchAdsetsConfig(ad_account_id, access_token, log),  // конфиг с бюджетами
        fetchAdsInsights(ad_account_id, access_token)  // ads insights для анализа пожирателей
      ]);
    } catch (fbError) {
      log.error({
        where: 'interactive_brain',
        phase: 'fb_api_error',
        error: String(fbError),
        message: 'Ошибка при запросе данных из Facebook API'
      });
      throw new Error(`FB API fetch failed: ${fbError.message}`);
    }

    // Валидация ответов FB API
    if (!Array.isArray(todayData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'todayData не массив, заменяем на []' });
      todayData = [];
    }
    if (!Array.isArray(yesterdayData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'yesterdayData не массив, заменяем на []' });
      yesterdayData = [];
    }
    if (!Array.isArray(dailyData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'dailyData не массив, заменяем на []' });
      dailyData = [];
    }
    if (!Array.isArray(actionsData)) {
      log.warn({ where: 'interactive_brain', phase: 'validation', message: 'actionsData не массив, заменяем на []' });
      actionsData = [];
    }

    log.info({
      where: 'interactive_brain',
      phase: 'fb_data_received',
      today_rows: todayData.length,
      yesterday_rows: yesterdayData.length,
      daily_rows: dailyData.length,
      actions_rows: actionsData.length,
      today_adset_ids: todayData.slice(0, 5).map(a => a.adset_id),
      message: `Получено ${todayData.length} адсетов today, ${yesterdayData.length} yesterday`
    });

    // Проверка на пустые данные
    if (todayData.length === 0) {
      log.warn({
        where: 'interactive_brain',
        phase: 'no_data',
        message: 'Нет активных адсетов за сегодня. Возможно, все кампании на паузе или нет расхода.'
      });
    }

    // Рассчитываем метрики как в основном агенте (для external кампаний)
    // campaignObjectives = пустая Map, т.к. для external нет directions
    const adsetMetricsFromFB = calculateMultiPeriodTrends(dailyData, actionsData, new Map());

    // Создаём Map для быстрого доступа к рассчитанным метрикам по adset_id
    const fbMetricsByAdset = new Map();
    for (const adset of adsetMetricsFromFB) {
      fbMetricsByAdset.set(adset.adset_id, adset);
    }

    // Создаём Map для бюджетов адсетов (id → {daily_budget, status})
    const adsetBudgets = new Map();
    if (adsetsConfigData?.data && Array.isArray(adsetsConfigData.data)) {
      for (const adset of adsetsConfigData.data) {
        adsetBudgets.set(adset.id, {
          daily_budget_cents: adset.daily_budget ? parseInt(adset.daily_budget) : null,
          lifetime_budget_cents: adset.lifetime_budget ? parseInt(adset.lifetime_budget) : null,
          status: adset.status,
          effective_status: adset.effective_status
        });
      }
    }

    log.info({
      where: 'interactive_brain',
      phase: 'metrics_calculated',
      fb_metrics_adsets: adsetMetricsFromFB.length,
      adset_budgets_loaded: adsetBudgets.size,
      sample_metrics: adsetMetricsFromFB.slice(0, 2).map(a => ({
        adset_id: a.adset_id,
        has_7d: !!a.metrics_last_7d,
        spend_7d: a.metrics_last_7d?.spend
      })),
      message: 'calculateMultiPeriodTrends завершён'
    });

    // ========================================
    // ЧАСТЬ 2: ЗАГРУЗКА ПОСЛЕДНЕГО ОТЧЁТА BRAIN
    // ========================================

    log.info({ where: 'interactive_brain', phase: 'loading_brain_report' });

    // Получаем последний успешный scoring_output (отчёт основного Brain)
    const { data: lastExecution } = await supabase
      .from('scoring_executions')
      .select('scoring_output, completed_at')
      .eq('user_account_id', userAccountId)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const brainReport = lastExecution?.scoring_output || null;
    const brainReportAge = lastExecution?.completed_at
      ? Math.round((Date.now() - new Date(lastExecution.completed_at).getTime()) / 1000 / 60 / 60)
      : null;

    log.info({
      where: 'interactive_brain',
      phase: 'brain_report_loaded',
      has_report: !!brainReport,
      report_age_hours: brainReportAge,
      adsets_in_report: brainReport?.adsets?.length || 0,
      unused_creatives: brainReport?.unused_creatives?.length || 0
    });

    // ========================================
    // ЧАСТЬ 3: ПОЛУЧАЕМ НАПРАВЛЕНИЯ И НАСТРОЙКИ
    // Фильтруем по account_id для мультиаккаунтного режима
    // Консистентно с основным Brain (server.js getUserDirections)
    // ========================================

    let directionsQuery = supabase
      .from('account_directions')
      .select('id, name, fb_campaign_id, objective, daily_budget_cents, target_cpl_cents, is_active, created_at')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true);

    if (directionId) {
      directionsQuery = directionsQuery.eq('id', directionId);
    }

    // Мультиаккаунтность: фильтруем directions по account_id
    if (accountUUID) {
      directionsQuery = directionsQuery.eq('account_id', accountUUID);
      log.info({
        where: 'interactive_brain',
        phase: 'directions_filter',
        accountUUID,
        message: 'Фильтрация directions по account_id'
      });
    } else {
      // Legacy режим: только directions без account_id
      directionsQuery = directionsQuery.is('account_id', null);
    }

    const { data: directions } = await directionsQuery;

    // ========================================
    // ЗАГРУЗКА НАСТРОЕК АККАУНТА (для внешних кампаний)
    // Приоритет: accountUUID > ad_account_id > user_account_id
    // ========================================
    let adAccountSettings = null;

    if (accountUUID) {
      // Мультиаккаунтный режим: загружаем по UUID напрямую
      const { data: adAccountByUUID } = await supabase
        .from('ad_accounts')
        .select('id, default_cpl_target_cents, plan_daily_budget_cents')
        .eq('id', accountUUID)
        .single();

      adAccountSettings = adAccountByUUID || null;
    } else {
      // Legacy режим: пробуем найти ad_account по fb_ad_account_id
      const { data: adAccountData } = await supabase
        .from('ad_accounts')
        .select('id, default_cpl_target_cents, plan_daily_budget_cents')
        .eq('ad_account_id', ad_account_id)
        .single();

      if (adAccountData) {
        adAccountSettings = adAccountData;
      } else {
        // Fallback: ищем по user_account_id
        const { data: adAccountByUser } = await supabase
          .from('ad_accounts')
          .select('id, default_cpl_target_cents, plan_daily_budget_cents')
          .eq('user_account_id', userAccountId)
          .limit(1)
          .single();

        adAccountSettings = adAccountByUser || null;
      }
    }

    log.info({
      where: 'interactive_brain',
      phase: 'ad_account_settings_loaded',
      has_settings: !!adAccountSettings,
      default_cpl: adAccountSettings?.default_cpl_target_cents,
      plan_budget: adAccountSettings?.plan_daily_budget_cents,
      accountUUID,
      settings_source: accountUUID ? 'accountUUID' : 'fallback'
    });

    // Загружаем последние действия Brain для защиты от дёрготни
    const { data: recentActions } = await supabase
      .from('brain_executions')
      .select('proposals_json, completed_at')
      .eq('user_account_id', userAccountId)
      .in('status', ['proposals_generated', 'executed'])
      .order('completed_at', { ascending: false })
      .limit(3);

    // ========================================
    // ЧАСТЬ 4: АНАЛИЗ С HEALTH SCORE
    // ========================================

    // ========================================
    // ВЫБОР ИСТОЧНИКА АДСЕТОВ ДЛЯ АНАЛИЗА
    // Если есть данные за сегодня — используем todayData
    // Если нет данных за сегодня — используем adsetMetricsFromFB (все адсеты за 14 дней)
    // Это позволяет анализировать кампании, которые были на паузе сегодня
    // ========================================
    let adsetsToAnalyze = todayData.length > 0 ? todayData : adsetMetricsFromFB;
    const usingHistoricalData = todayData.length === 0;
    const originalAdsetsCount = adsetsToAnalyze.length;

    // ========================================
    // ФИЛЬТРАЦИЯ ПО КАМПАНИИ
    // Если передан campaignId или directionId — анализируем только одну кампанию
    // Приоритет: campaignId (напрямую) > directionId (через fb_campaign_id)
    // ========================================
    let targetCampaignId = campaignId || null;

    // Если campaignId не передан, но есть directionId — берём fb_campaign_id из direction
    if (!targetCampaignId && directionId && directions?.length > 0) {
      targetCampaignId = directions[0]?.fb_campaign_id;
    }

    // Фильтруем адсеты по кампании
    if (targetCampaignId) {
      adsetsToAnalyze = adsetsToAnalyze.filter(adset => adset.campaign_id === targetCampaignId);

      if (adsetsToAnalyze.length === 0) {
        log.warn({
          where: 'interactive_brain',
          phase: 'filtered_by_campaign',
          target_campaign_id: targetCampaignId,
          source: campaignId ? 'campaignId_param' : 'direction_fb_campaign_id',
          original_count: originalAdsetsCount,
          filtered_count: 0,
          message: `ВНИМАНИЕ: После фильтрации не найдено адсетов для кампании ${targetCampaignId}. Возможно кампания на паузе или нет активных адсетов.`
        });
      } else {
        log.info({
          where: 'interactive_brain',
          phase: 'filtered_by_campaign',
          target_campaign_id: targetCampaignId,
          source: campaignId ? 'campaignId_param' : 'direction_fb_campaign_id',
          original_count: originalAdsetsCount,
          filtered_count: adsetsToAnalyze.length,
          message: `Отфильтровано до ${adsetsToAnalyze.length} адсетов для кампании ${targetCampaignId}`
        });
      }
    }

    log.info({
      where: 'interactive_brain',
      phase: 'calculating_health_scores',
      adsets_to_process: adsetsToAnalyze.length,
      using_historical_data: usingHistoricalData,
      today_adsets_count: todayData.length,
      fb_metrics_adsets_count: adsetMetricsFromFB.length,
      directions_count: directions?.length || 0,
      filtered_by_campaign: !!targetCampaignId,
      target_campaign_id: targetCampaignId,
      original_adsets_count: originalAdsetsCount,
      message: usingHistoricalData
        ? `Нет данных за сегодня, анализируем ${adsetsToAnalyze.length} адсетов за 14 дней`
        : `Начинаем анализ ${adsetsToAnalyze.length} адсетов`
    });

    const proposals = [];
    const adsetAnalysis = [];
    const skippedAdsets = [];  // Для логирования пропущенных адсетов

    for (let adsetIndex = 0; adsetIndex < adsetsToAnalyze.length; adsetIndex++) {
      const adsetData = adsetsToAnalyze[adsetIndex];
      // Унифицируем структуру: adsetMetricsFromFB и todayData имеют разные поля
      const adsetId = adsetData.adset_id;
      const adsetName = adsetData.adset_name;
      const campaignId = adsetData.campaign_id;

      try {
        // ========================================
        // ПОИСК СВЯЗАННЫХ ДАННЫХ
        // ========================================
        const todayAdset = todayData.find(a => a.adset_id === adsetId);
        const yesterdayAdset = yesterdayData.find(a => a.adset_id === adsetId);
        const brainAdset = brainReport?.adsets?.find(a => a.adset_id === adsetId);
        const direction = directions?.find(d => d.fb_campaign_id === campaignId);
        const fbMetrics = fbMetricsByAdset.get(adsetId);

        // ========================================
        // ОПРЕДЕЛЕНИЕ ТИПА КАМПАНИИ (internal vs external)
        // ========================================
        const isExternalCampaign = !direction;

        // Детальное логирование для каждого адсета (первые 3 + все external)
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_processing_start',
            adset_index: adsetIndex,
            adset_id: adsetId,
            adset_name: adsetName?.substring(0, 50),
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            has_today_data: !!todayAdset,
            has_yesterday_data: !!yesterdayAdset,
            has_fb_metrics: !!fbMetrics,
            has_brain_report_data: !!brainAdset,
            has_direction: !!direction,
            direction_id: direction?.id || null,
            using_historical: usingHistoricalData
          });
        }

        // ========================================
        // МЕТРИКИ
        // Если есть данные за сегодня — используем их
        // Иначе используем metrics_last_7d как "текущие" метрики
        // ========================================
        let todaySpend, todayImpressions, todayClicks, todayCTR, todayCPM;
        let todayLinkClicks, todayLeads, todayConversions, todayCostPerConversion, todayCPL;
        let metricsSource = 'none';

        if (todayAdset) {
          // Есть данные за сегодня
          todaySpend = parseFloat(todayAdset.spend || 0);
          todayImpressions = parseInt(todayAdset.impressions || 0);
          todayClicks = parseInt(todayAdset.clicks || 0);
          todayCTR = todayImpressions > 0 ? (todayClicks / todayImpressions * 100) : null;
          todayCPM = todayImpressions > 0 ? (todaySpend / todayImpressions * 1000) : null;
          todayLinkClicks = getActionValue(todayAdset.actions, 'link_click');
          // ВАЖНО: используем extractLeads() для корректного подсчёта WhatsApp/messaging лидов
          // (onsite_conversion.total_messaging_connection + lead_grouped + pixel_lead)
          todayLeads = extractLeads(todayAdset.actions);
          metricsSource = 'today';
        } else if (fbMetrics?.metrics_last_7d) {
          // Нет данных за сегодня — используем средние за 7 дней
          const m7d = fbMetrics.metrics_last_7d;
          todaySpend = m7d.spend || 0;
          todayImpressions = m7d.impressions || 0;
          todayClicks = m7d.clicks || 0;
          todayCTR = m7d.ctr || null;
          todayCPM = m7d.cpm || null;
          todayLinkClicks = m7d.link_clicks || 0;
          todayLeads = m7d.leads || 0;
          metricsSource = 'last_7d';
        } else {
          // Нет никаких данных — пропускаем
          skippedAdsets.push({ adset_id: adsetId, adset_name: adsetName, error: 'No metrics data' });
          continue;
        }

        // Для instagram_traffic используем link_clicks как "конверсии", для остальных - leads
        // Для внешних кампаний по умолчанию используем leads (CPL)
        const directionObjective = direction?.objective || 'whatsapp';
        const isTrafficObjective = directionObjective === 'instagram_traffic';
        const metricName = isTrafficObjective ? 'CPC' : 'CPL';

        // Конверсии
        todayConversions = isTrafficObjective ? todayLinkClicks : todayLeads;
        todayCostPerConversion = todayConversions > 0 ? todaySpend / todayConversions : null;
        todayCPL = todayCostPerConversion;

        // Yesterday метрики
        const yesterdaySpend = parseFloat(yesterdayAdset?.spend || 0);
        const yesterdayLinkClicks = getActionValue(yesterdayAdset?.actions, 'link_click');
        // ВАЖНО: используем extractLeads() для корректного подсчёта WhatsApp/messaging лидов
        const yesterdayLeads = extractLeads(yesterdayAdset?.actions);
        const yesterdayConversions = isTrafficObjective ? yesterdayLinkClicks : yesterdayLeads;
        const yesterdayCostPerConversion = yesterdayConversions > 0 ? yesterdaySpend / yesterdayConversions : null;
        const yesterdayCPL = yesterdayCostPerConversion;

        // ========================================
        // TARGET CPL с каскадом fallback
        // 1. target_cpl из direction (если есть)
        // 2. default_cpl_target_cents из ad_accounts (если есть)
        // 3. null — анализ только по трендам
        // ========================================
        let targetCPL = null;
        let targetCPLSource = 'none';

        if (direction?.target_cpl_cents) {
          targetCPL = direction.target_cpl_cents / 100;
          targetCPLSource = 'direction';
        } else if (adAccountSettings?.default_cpl_target_cents) {
          targetCPL = adAccountSettings.default_cpl_target_cents / 100;
          targetCPLSource = 'account_default';
        }
        // Если targetCPL = null — всё равно анализируем (только тренды)

        // ========================================
        // МЕТРИКИ ЗА 7 ДНЕЙ (hist7d)
        // ========================================
        let hist7d = {};
        let histCPL = null;
        let histCTR = null;
        let histCPM = null;
        let histFrequency = 0;
        let hist7dSource = 'none';

        if (!isExternalCampaign && brainAdset?.metrics_last_7d) {
          // Internal кампании: используем brainReport (сохранённый с утреннего прогона)
          hist7d = brainAdset.metrics_last_7d;
          hist7dSource = 'brain_report';
        } else {
          // External кампании ИЛИ internal без данных в brainReport:
          // используем данные из FB API (рассчитанные через calculateMultiPeriodTrends)
          const fbMetrics = fbMetricsByAdset.get(adsetId);
          if (fbMetrics?.metrics_last_7d) {
            hist7d = fbMetrics.metrics_last_7d;
            hist7dSource = 'fb_api_calculated';
          }
        }

        // Извлекаем метрики из hist7d (одинаковая структура для internal и external)
        if (hist7d && Object.keys(hist7d).length > 0) {
          const hist7dConversions = isTrafficObjective
            ? (hist7d.link_clicks || 0)
            : (hist7d.leads || 0);
          histCPL = hist7dConversions > 0 ? hist7d.spend / hist7dConversions : null;
          histCTR = hist7d.ctr || null;
          histCPM = hist7d.cpm || null;
          histFrequency = hist7d.frequency || 0;
        }

        // Логируем источники данных для external и первых internal
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_data_sources',
            adset_id: adsetId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            target_cpl_source: targetCPLSource,
            target_cpl_value: targetCPL,
            hist7d_source: hist7dSource,
            hist7d_has_data: Object.keys(hist7d).length > 0,
            hist_metrics: {
              histCPL: histCPL?.toFixed(2),
              histCTR: histCTR?.toFixed(2),
              histCPM: histCPM?.toFixed(2),
              histFrequency: histFrequency?.toFixed(2)
            },
            today_metrics: {
              spend: todaySpend.toFixed(2),
              conversions: todayConversions,
              cpl: todayCPL?.toFixed(2),
              impressions: todayImpressions
            }
          });
        }

      // ========================================
      // HEALTH SCORE CALCULATION (синхронизировано с brainRules.js)
      // ========================================
      let healthScore = 0;
      const hsBreakdown = [];

      // 1. CPL/CPC GAP к TARGET (вес 45) — для instagram_traffic используется CPC
      if (todayCPL && targetCPL) {
        const cplRatio = todayCPL / targetCPL;
        if (cplRatio <= 0.7) {
          healthScore += 45;
          hsBreakdown.push({ factor: 'cost_gap', value: 45, reason: `${metricName} ${((1 - cplRatio) * 100).toFixed(0)}% ниже target` });
        } else if (cplRatio <= 0.9) {
          healthScore += 30;
          hsBreakdown.push({ factor: 'cost_gap', value: 30, reason: `${metricName} ${((1 - cplRatio) * 100).toFixed(0)}% ниже target` });
        } else if (cplRatio <= 1.1) {
          healthScore += 10;
          hsBreakdown.push({ factor: 'cost_gap', value: 10, reason: `${metricName} в пределах ±10% от target` });
        } else if (cplRatio <= 1.3) {
          healthScore -= 30;
          hsBreakdown.push({ factor: 'cost_gap', value: -30, reason: `${metricName} ${((cplRatio - 1) * 100).toFixed(0)}% выше target` });
        } else {
          healthScore -= 45;
          hsBreakdown.push({ factor: 'cost_gap', value: -45, reason: `${metricName} ${((cplRatio - 1) * 100).toFixed(0)}% выше target` });
        }
      }

      // 2. ТРЕНДЫ (вес до 15) — сегодня vs вчера
      if (todayCPL && yesterdayCPL) {
        const trendRatio = todayCPL / yesterdayCPL;
        if (trendRatio <= 0.8) {
          healthScore += 15;
          hsBreakdown.push({ factor: 'trend', value: 15, reason: `${metricName} улучшился на ${((1 - trendRatio) * 100).toFixed(0)}% vs вчера` });
        } else if (trendRatio >= 1.2) {
          healthScore -= 15;
          hsBreakdown.push({ factor: 'trend', value: -15, reason: `${metricName} ухудшился на ${((trendRatio - 1) * 100).toFixed(0)}% vs вчера` });
        }
      }

      // 3. ДИАГНОСТИКА (до -30)
      // CTR слишком низкий
      if (todayCTR !== null && todayCTR < 1) {
        healthScore -= 8;
        hsBreakdown.push({ factor: 'low_ctr', value: -8, reason: `CTR ${todayCTR.toFixed(2)}% < 1% (слабый креатив)` });
      }

      // CPM слишком высокий (vs история)
      if (todayCPM && histCPM && todayCPM > histCPM * 1.3) {
        healthScore -= 12;
        hsBreakdown.push({ factor: 'high_cpm', value: -12, reason: `CPM $${todayCPM.toFixed(2)} на 30%+ выше средней` });
      }

      // Frequency высокая (выгорание)
      if (histFrequency > 2) {
        healthScore -= 10;
        hsBreakdown.push({ factor: 'high_frequency', value: -10, reason: `Frequency ${histFrequency.toFixed(1)} > 2 (выгорание)` });
      }

      // 4. ОБЪЁМ ДАННЫХ (множитель доверия)
      let volumeMultiplier = 1.0;
      if (todayImpressions < VOLUME_THRESHOLDS.TODAY_MIN_IMPRESSIONS) {
        volumeMultiplier = 0.6;
        hsBreakdown.push({ factor: 'low_volume', value: null, reason: `Мало данных (${todayImpressions} impr), доверие 60%` });
      } else if (todayImpressions < VOLUME_THRESHOLDS.MIN_IMPRESSIONS) {
        volumeMultiplier = 0.8;
      }

      // 5. TODAY-КОМПЕНСАЦИЯ (КЛЮЧЕВОЕ для мини-brain!)
      // Если сегодня CPL значительно лучше вчера — компенсируем негатив
      let todayCompensation = 0;
      if (todayCPL && yesterdayCPL && todayImpressions >= VOLUME_THRESHOLDS.TODAY_MIN_IMPRESSIONS) {
        const improvementRatio = todayCPL / yesterdayCPL;

        if (improvementRatio <= TODAY_COMPENSATION.FULL) {
          // CPL/CPC в 2+ раза лучше вчера → ПОЛНАЯ компенсация штрафов
          const negativePart = hsBreakdown.filter(h => h.value < 0).reduce((sum, h) => sum + h.value, 0);
          todayCompensation = Math.abs(negativePart);
          hsBreakdown.push({
            factor: 'today_compensation',
            value: todayCompensation,
            reason: `СЕГОДНЯ ${metricName} в ${(1 / improvementRatio).toFixed(1)}x лучше вчера! Полная компенсация.`
          });
        } else if (improvementRatio <= TODAY_COMPENSATION.PARTIAL) {
          // На 30%+ лучше → 60% компенсация
          const negativePart = hsBreakdown.filter(h => h.value < 0).reduce((sum, h) => sum + h.value, 0);
          todayCompensation = Math.abs(negativePart) * 0.6;
          hsBreakdown.push({
            factor: 'today_compensation',
            value: Math.round(todayCompensation),
            reason: `Сегодня ${metricName} на ${((1 - improvementRatio) * 100).toFixed(0)}% лучше вчера (60% компенсация)`
          });
        } else if (improvementRatio <= TODAY_COMPENSATION.SLIGHT) {
          // Небольшое улучшение → +5 бонус
          todayCompensation = 5;
          hsBreakdown.push({ factor: 'today_compensation', value: 5, reason: `Небольшое улучшение ${metricName} сегодня` });
        }
        healthScore += todayCompensation;
      }

      // Применяем множитель доверия
      healthScore = Math.round(healthScore * volumeMultiplier);

      // Ограничиваем диапазон [-100, +100]
      healthScore = Math.max(-100, Math.min(100, healthScore));

      // ========================================
      // ОПРЕДЕЛЕНИЕ КЛАССА HS
      // ========================================
      let hsClass;
      if (healthScore >= HS_CLASSES.VERY_GOOD) hsClass = 'very_good';
      else if (healthScore >= HS_CLASSES.GOOD) hsClass = 'good';
      else if (healthScore >= HS_CLASSES.NEUTRAL_LOW) hsClass = 'neutral';
      else if (healthScore >= HS_CLASSES.SLIGHTLY_BAD) hsClass = 'slightly_bad';
      else hsClass = 'bad';

      // Сохраняем анализ
      adsetAnalysis.push({
        adset_id: adsetId,
        adset_name: adsetName,
        campaign_id: campaignId,
        campaign_type: isExternalCampaign ? 'external' : 'internal',
        direction_id: direction?.id || null,
        direction_name: direction?.name || null,
        direction_objective: directionObjective,
        target_cpl_source: targetCPLSource,
        hist7d_source: hist7dSource,
        metrics_source: metricsSource,  // NEW: откуда взяты текущие метрики (today/last_7d)
        health_score: healthScore,
        hs_class: hsClass,
        hs_breakdown: hsBreakdown,
        metrics: {
          today: {
            spend: todaySpend,
            conversions: todayConversions,
            cost_per_conversion: todayCPL,
            ctr: todayCTR,
            impressions: todayImpressions,
            // Для обратной совместимости
            leads: todayLeads,
            link_clicks: todayLinkClicks
          },
          yesterday: {
            spend: yesterdaySpend,
            conversions: yesterdayConversions,
            cost_per_conversion: yesterdayCPL,
            leads: yesterdayLeads,
            link_clicks: yesterdayLinkClicks
          },
          target_cost_per_conversion: targetCPL,
          metric_name: metricName, // 'CPC' для instagram_traffic, 'CPL' для остальных
          hist_7d: hist7d,
          hist_7d_calculated: {
            histCPL,
            histCTR,
            histCPM,
            histFrequency
          }
        }
      });

      // ========================================
      // ГЕНЕРАЦИЯ PROPOSALS по классу HS
      // ========================================

      // Защита от дёрготни: проверяем недавние действия
      const recentActionOnAdset = recentActions?.some(ra =>
        ra.proposals_json?.some(p => p.entity_id === adsetId)
      );

      // Получаем текущий бюджет адсета
      const adsetBudgetInfo = adsetBudgets.get(adsetId);
      const currentBudgetCents = adsetBudgetInfo?.daily_budget_cents || null;
      const currentBudgetDollars = currentBudgetCents ? Math.round(currentBudgetCents / 100) : null;

      // Строим человекочитаемое объяснение
      const humanReason = buildHumanReadableReason(hsBreakdown, { todayCPL, targetCPL, metricName });

      // Добавляем пометку если данные исторические
      const dataNote = metricsSource === 'last_7d' ? ' (данные за 7 дней)' : '';
      const campaignNote = isExternalCampaign ? ' [внешняя кампания]' : '';

      if (hsClass === 'very_good' && !recentActionOnAdset) {
        // Масштабировать +20%
        const increasePercent = Math.min(BUDGET_LIMITS.MAX_INCREASE_PCT, 20);
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 + increasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        const budgetChangeText = currentBudgetDollars && newBudgetDollars
          ? `Увеличить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (+${increasePercent}%).`
          : `Увеличить бюджет на ${increasePercent}%.`;

        proposals.push({
          action: 'updateBudget',
          priority: 'high',
          entity_type: 'adset',
          entity_id: adsetId,
          entity_name: adsetName,
          campaign_id: campaignId,
          campaign_type: isExternalCampaign ? 'external' : 'internal',
          direction_id: direction?.id || null,
          direction_name: direction?.name || null,
          target_cpl_source: targetCPLSource,
          health_score: healthScore,
          hs_class: hsClass,
          reason: `«${adsetName}»${campaignNote}: ${humanReason || 'отличные результаты'}${dataNote}. ${budgetChangeText}`,
          confidence: 0.85,
          suggested_action_params: {
            increase_percent: increasePercent,
            current_budget_cents: currentBudgetCents,
            new_budget_cents: newBudgetCents,
            max_budget_cents: BUDGET_LIMITS.MAX_CENTS
          },
          metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
        });
      }
      else if (hsClass === 'bad') {
        // CPL/CPC критически высокий → пауза или сильное снижение (-50%)
        const cplMultiple = todayCPL && targetCPL ? todayCPL / targetCPL : null;
        const decreasePercent = BUDGET_LIMITS.MAX_DECREASE_PCT;
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 - decreasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        if (cplMultiple && cplMultiple > 3) {
          proposals.push({
            action: 'pauseAdSet',
            priority: 'critical',
            entity_type: 'adset',
            entity_id: adsetId,
            entity_name: adsetName,
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'external' : 'internal',
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            target_cpl_source: targetCPLSource,
            health_score: healthScore,
            hs_class: hsClass,
            reason: `«${adsetName}»${campaignNote}: КРИТИЧНО! ${humanReason}${dataNote}. ${metricName} превышает цель в ${cplMultiple.toFixed(1)}x раз. Рекомендую поставить на паузу.`,
            confidence: 0.9,
            suggested_action_params: {
              current_budget_cents: currentBudgetCents
            },
            metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
          });
        } else {
          const budgetChangeText = currentBudgetDollars && newBudgetDollars
            ? `Снизить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (-${decreasePercent}%).`
            : `Снизить бюджет на ${decreasePercent}%.`;

          proposals.push({
            action: 'updateBudget',
            priority: 'high',
            entity_type: 'adset',
            entity_id: adsetId,
            entity_name: adsetName,
            campaign_id: campaignId,
            campaign_type: isExternalCampaign ? 'external' : 'internal',
            direction_id: direction?.id || null,
            direction_name: direction?.name || null,
            target_cpl_source: targetCPLSource,
            health_score: healthScore,
            hs_class: hsClass,
            reason: `«${adsetName}»${campaignNote}: ${humanReason}${dataNote}. ${budgetChangeText}`,
            confidence: 0.8,
            suggested_action_params: {
              decrease_percent: decreasePercent,
              current_budget_cents: currentBudgetCents,
              new_budget_cents: newBudgetCents,
              min_budget_cents: BUDGET_LIMITS.MIN_CENTS
            },
            metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
          });
        }
      }
      else if (hsClass === 'slightly_bad' && !recentActionOnAdset) {
        // Снижать -25%
        const decreasePercent = 25;
        const newBudgetCents = currentBudgetCents ? Math.round(currentBudgetCents * (1 - decreasePercent / 100)) : null;
        const newBudgetDollars = newBudgetCents ? Math.round(newBudgetCents / 100) : null;

        const budgetChangeText = currentBudgetDollars && newBudgetDollars
          ? `Снизить бюджет с $${currentBudgetDollars} до $${newBudgetDollars} (-${decreasePercent}%).`
          : `Снизить бюджет на ${decreasePercent}%.`;

        proposals.push({
          action: 'updateBudget',
          priority: 'medium',
          entity_type: 'adset',
          entity_id: adsetId,
          entity_name: adsetName,
          campaign_id: campaignId,
          campaign_type: isExternalCampaign ? 'external' : 'internal',
          direction_id: direction?.id || null,
          direction_name: direction?.name || null,
          target_cpl_source: targetCPLSource,
          health_score: healthScore,
          hs_class: hsClass,
          reason: `«${adsetName}»${campaignNote}: ${humanReason || 'результаты ниже нормы'}${dataNote}. ${budgetChangeText}`,
          confidence: 0.7,
          suggested_action_params: {
            decrease_percent: decreasePercent,
            current_budget_cents: currentBudgetCents,
            new_budget_cents: newBudgetCents,
            min_budget_cents: BUDGET_LIMITS.MIN_CENTS
          },
          metrics: { today_spend: todaySpend, today_conversions: todayConversions, today_cpl: todayCPL, target_cpl: targetCPL, objective: directionObjective, metrics_source: metricsSource }
        });
      }
      // good и neutral — не предлагаем изменений (наблюдаем)

        // Логируем итоговый результат анализа адсета (для external и первых internal)
        if (adsetIndex < 3 || isExternalCampaign) {
          log.info({
            where: 'interactive_brain',
            phase: 'adset_analysis_complete',
            adset_id: adsetId,
            campaign_type: isExternalCampaign ? 'EXTERNAL' : 'internal',
            health_score: healthScore,
            hs_class: hsClass,
            hs_breakdown_count: hsBreakdown.length,
            proposal_generated: proposals.some(p => p.entity_id === adsetId),
            metrics_source: metricsSource
          });
        }

      } catch (adsetError) {
        // Ловим ошибки при обработке отдельного адсета, не прерывая весь анализ
        log.error({
          where: 'interactive_brain',
          phase: 'adset_processing_error',
          adset_id: adsetId,
          adset_name: adsetName?.substring(0, 50),
          error: String(adsetError),
          stack: adsetError.stack?.substring(0, 500)
        });
        skippedAdsets.push({
          adset_id: adsetId,
          adset_name: adsetName,
          error: String(adsetError)
        });
        // Продолжаем обработку следующих адсетов
      }
    }

    // Логируем если были пропущены адсеты из-за ошибок
    if (skippedAdsets.length > 0) {
      log.warn({
        where: 'interactive_brain',
        phase: 'adsets_skipped',
        skipped_count: skippedAdsets.length,
        skipped_adsets: skippedAdsets.slice(0, 5),
        message: `${skippedAdsets.length} адсетов пропущено из-за ошибок обработки`
      });
    }

    // ========================================
    // ЧАСТЬ 4.3.5: АНАЛИЗ ADS-ПОЖИРАТЕЛЕЙ
    // ========================================

    let adEaters = [];
    if (adsInsightsData && adsInsightsData.length > 0) {
      // Собираем spend по адсетам для расчёта доли бюджета
      const adsetSpendMap = new Map();
      for (const adset of todayData) {
        adsetSpendMap.set(adset.adset_id, parseFloat(adset.spend || 0));
      }

      // Целевой CPL из настроек аккаунта
      const effectiveTargetCPL = adAccountSettings?.default_cpl_target_cents
        ? adAccountSettings.default_cpl_target_cents / 100
        : null;

      // Анализируем ads на наличие пожирателей
      adEaters = analyzeAdsForEaters(adsInsightsData, {
        targetCPL: effectiveTargetCPL,
        adsetSpendMap
      });

      log.info({
        where: 'interactive_brain',
        phase: 'ad_eaters_analysis',
        ads_checked: adsInsightsData.length,
        eaters_found: adEaters.length,
        critical_count: adEaters.filter(e => e.is_critical).length,
        target_cpl_used: effectiveTargetCPL,
        message: `Найдено ${adEaters.length} объявлений-пожирателей`
      });

      // Генерируем proposals для pauseAd
      for (const eater of adEaters) {
        // Находим информацию о direction для этого adset
        const adsetAnalysisEntry = adsetAnalysis.find(a => a.adset_id === eater.adset_id);
        const isExternalCampaign = !adsetAnalysisEntry?.direction_id;

        proposals.push({
          action: 'pauseAd',
          priority: eater.priority,
          entity_type: 'ad',
          entity_id: eater.ad_id,
          entity_name: eater.ad_name,
          adset_id: eater.adset_id,
          adset_name: eater.adset_name,
          campaign_id: eater.campaign_id,
          campaign_type: isExternalCampaign ? 'external' : 'internal',
          direction_id: adsetAnalysisEntry?.direction_id || null,
          direction_name: adsetAnalysisEntry?.direction_name || null,
          health_score: null,  // На уровне ad не рассчитываем HS
          hs_class: null,
          reason: `«${eater.ad_name}»: ${eater.reasons.join('. ')}. Рекомендую остановить объявление.`,
          confidence: eater.is_critical ? 0.9 : 0.75,
          suggested_action_params: {
            current_spend: eater.spend,
            current_leads: eater.leads,
            current_cpl: eater.cpl,
            current_ctr: eater.ctr
          },
          metrics: {
            spend: eater.spend,
            leads: eater.leads,
            cpl: eater.cpl,
            ctr: eater.ctr,
            impressions: eater.impressions,
            target_cpl: effectiveTargetCPL,
            metrics_source: 'last_7d'
          }
        });
      }
    }

    // ========================================
    // ЧАСТЬ 4.4: ВЫЗОВ LLM ДЛЯ ГЕНЕРАЦИИ PROPOSALS (NEW!)
    // ========================================

    let llmProposals = null;
    let llmSummary = null;
    let llmPlanNote = null;
    let llmUsed = false;
    let llmError = null;
    let llmValidation = null;
    let llmMeta = null;
    const llmStartTime = Date.now();

    if (useLLM && adsetAnalysis.length > 0) {
      const externalCount = adsetAnalysis.filter(a => a.campaign_type === 'external').length;
      const internalCount = adsetAnalysis.filter(a => a.campaign_type === 'internal').length;

      log.info({
        where: 'interactive_brain',
        phase: 'llm_call_start',
        adsets_count: adsetAnalysis.length,
        external_count: externalCount,
        internal_count: internalCount,
        has_directions: (directions?.length || 0) > 0,
        has_account_settings: !!adAccountSettings,
        has_brain_report: !!brainReport,
        unused_creatives_count: brainReport?.unused_creatives?.length || 0,
        ready_creatives_count: brainReport?.ready_creatives?.length || 0,
        total_ads: adsInsightsData?.length || 0,
        message: 'Подготовка payload для LLM (ads включены в каждый adset)'
      });

      try {
        // Проверяем время для передачи в LLM
        const timeContext = isAllowedToCreateAdsets({ logger: log });

        // Группируем ads по adset_id для включения в каждый адсет
        const adsByAdset = new Map();
        if (adsInsightsData && adsInsightsData.length > 0) {
          for (const ad of adsInsightsData) {
            const adsetId = ad.adset_id;
            if (!adsetId || !ad.ad_id) continue;
            if (!adsByAdset.has(adsetId)) {
              adsByAdset.set(adsetId, []);
            }
            // Считаем leads из actions
            const actions = Array.isArray(ad.actions) ? ad.actions : [];
            const leads = actions.reduce((sum, a) => {
              const t = a?.action_type;
              if (t === 'onsite_conversion.total_messaging_connection' ||
                  t === 'lead_grouped' ||
                  t === 'offsite_conversion.fb_pixel_lead') {
                return sum + parseInt(a.value || 0);
              }
              return sum;
            }, 0);
            const spend = parseFloat(ad.spend || 0);
            const cpl = leads > 0 ? spend / leads : (spend > 0 ? Infinity : null);

            adsByAdset.get(adsetId).push({
              ad_id: ad.ad_id,
              ad_name: ad.ad_name,
              spend: spend,
              impressions: parseInt(ad.impressions || 0),
              leads: leads,
              cpl: cpl !== Infinity ? cpl?.toFixed(2) : 'no_leads'
            });
          }
          log.info({
            where: 'interactive_brain',
            phase: 'ads_grouped_by_adset',
            total_ads: adsInsightsData.length,
            adsets_with_ads: adsByAdset.size
          });
        }

        // Готовим payload для LLM с полным контекстом
        const llmPayload = {
          // Контекст времени — LLM должна знать можно ли создавать новые адсеты
          time_context: {
            current_time_almaty: timeContext.currentTime,
            current_hour_almaty: timeContext.currentHour,
            cutoff_hour: timeContext.cutoffHour,
            timezone: timeContext.timezone,
            can_create_adsets: timeContext.allowed,
            reason: timeContext.allowed
              ? 'Создание новых адсетов разрешено (до 14:00)'
              : 'Создание новых адсетов ЗАПРЕЩЕНО (после 14:00) — только перераспределение бюджета!'
          },
          adsets: adsetAnalysis.map(a => ({
            adset_id: a.adset_id,
            adset_name: a.adset_name,
            campaign_id: a.campaign_id,
            campaign_type: a.campaign_type,
            direction_id: a.direction_id,
            direction_name: a.direction_name,
            direction_objective: a.direction_objective,
            health_score: a.health_score,
            hs_class: a.hs_class,
            hs_breakdown: a.hs_breakdown,
            target_cpl_source: a.target_cpl_source,
            metrics_source: a.metrics_source,
            metrics: a.metrics,
            // Добавляем бюджет адсета
            current_budget_cents: adsetBudgets.get(a.adset_id)?.daily_budget_cents || null,
            // Объявления внутри адсета (для анализа пожирателей)
            ads: adsByAdset.get(a.adset_id) || []
          })),
          directions: directions?.map(d => ({
            id: d.id,
            name: d.name,
            objective: d.objective,
            daily_budget_cents: d.daily_budget_cents,
            target_cpl_cents: d.target_cpl_cents
          })) || [],
          account_settings: {
            default_cpl_target_cents: adAccountSettings?.default_cpl_target_cents || null,
            plan_daily_budget_cents: adAccountSettings?.plan_daily_budget_cents || null
          },
          unused_creatives: brainReport?.unused_creatives?.slice(0, 10) || [],
          ready_creatives: brainReport?.ready_creatives?.slice(0, 10) || [],
          recent_actions_count: recentActions?.length || 0,
          // NOTE: ads для анализа пожирателей включены внутрь каждого adset (см. adsets[].ads)
          summary: {
            total_adsets: adsetAnalysis.length,
            external_count: externalCount,
            internal_count: internalCount,
            by_hs_class: {
              very_good: adsetAnalysis.filter(a => a.hs_class === 'very_good').length,
              good: adsetAnalysis.filter(a => a.hs_class === 'good').length,
              neutral: adsetAnalysis.filter(a => a.hs_class === 'neutral').length,
              slightly_bad: adsetAnalysis.filter(a => a.hs_class === 'slightly_bad').length,
              bad: adsetAnalysis.filter(a => a.hs_class === 'bad').length
            },
            today_total_spend: todayData.reduce((sum, a) => sum + parseFloat(a.spend || 0), 0).toFixed(2),
            // Для best-of-bad логики и баланса бюджета
            current_total_budget_cents: Array.from(adsetBudgets.values()).reduce((sum, b) => sum + (b?.daily_budget_cents || 0), 0),
            plan_daily_budget_cents: adAccountSettings?.plan_daily_budget_cents || null,
            best_adset: adsetAnalysis.length > 0 ? adsetAnalysis.reduce((best, curr) => (curr.health_score > (best?.health_score ?? -Infinity)) ? curr : best, null) : null,
            has_good_adsets: adsetAnalysis.some(a => a.hs_class === 'very_good' || a.hs_class === 'good')
          }
        };

        log.info({
          where: 'interactive_brain',
          phase: 'llm_payload_prepared',
          payload_size: JSON.stringify(llmPayload).length,
          adsets_in_payload: llmPayload.adsets.length,
          message: 'Отправка запроса в LLM'
        });

        const systemPrompt = SYSTEM_PROMPT_MINI();
        const llmResult = await llmPlanMini(systemPrompt, llmPayload);
        const llmDuration = Date.now() - llmStartTime;

        llmMeta = llmResult.meta;
        llmValidation = llmResult.validation;

        // Проверяем успешность и валидность ответа
        if (llmResult.parsed && Array.isArray(llmResult.parsed.proposals)) {
          // Проверяем валидацию
          if (llmResult.validation && !llmResult.validation.valid) {
            log.warn({
              where: 'interactive_brain',
              phase: 'llm_validation_failed',
              duration_ms: llmDuration,
              validation_errors: llmResult.validation.errors,
              validation_warnings: llmResult.validation.warnings,
              proposals_count: llmResult.parsed.proposals.length,
              message: 'LLM ответ не прошёл валидацию, используем детерминированные proposals'
            });
            llmError = `validation_failed: ${llmResult.validation.errors.join(', ')}`;
          } else {
            // LLM успешно сгенерировал валидные proposals
            llmProposals = llmResult.parsed.proposals;
            llmSummary = llmResult.parsed.summary || null;
            llmPlanNote = llmResult.parsed.planNote || null;
            llmUsed = true;

            // Сохраняем детерминированные proposals на случай если нужно сравнить
            const deterministicProposalsCount = proposals.length;

            // Заменяем детерминированные proposals на LLM-сгенерированные
            proposals.length = 0; // Очищаем массив
            proposals.push(...llmProposals);

            log.info({
              where: 'interactive_brain',
              phase: 'llm_call_success',
              duration_ms: llmDuration,
              llm_proposals_count: llmProposals.length,
              deterministic_proposals_count: deterministicProposalsCount,
              proposals_by_action: {
                updateBudget: llmProposals.filter(p => p.action === 'updateBudget').length,
                pauseAdSet: llmProposals.filter(p => p.action === 'pauseAdSet').length,
                pauseAd: llmProposals.filter(p => p.action === 'pauseAd').length,
                createAdSet: llmProposals.filter(p => p.action === 'createAdSet').length,
                review: llmProposals.filter(p => p.action === 'review').length
              },
              proposals_by_type: {
                internal: llmProposals.filter(p => p.campaign_type === 'internal').length,
                external: llmProposals.filter(p => p.campaign_type === 'external').length
              },
              llm_summary_preview: llmSummary?.substring(0, 150),
              llm_plan_note_preview: llmPlanNote?.substring(0, 150),
              validation_warnings: llmResult.validation?.warnings,
              llm_usage: llmResult.meta?.usage,
              message: 'LLM успешно сгенерировал proposals'
            });
          }
        } else {
          // LLM вернул невалидный ответ
          llmError = llmResult.parseError || 'invalid_response_format';
          log.warn({
            where: 'interactive_brain',
            phase: 'llm_call_invalid_response',
            duration_ms: llmDuration,
            error: llmError,
            raw_length: llmResult.rawText?.length || 0,
            raw_preview: llmResult.rawText?.substring(0, 300),
            deterministic_proposals_count: proposals.length,
            message: 'LLM вернул невалидный ответ, используем детерминированные proposals'
          });
        }
      } catch (llmErr) {
        // LLM вызов упал
        const llmDuration = Date.now() - llmStartTime;
        llmError = String(llmErr);
        log.error({
          where: 'interactive_brain',
          phase: 'llm_call_error',
          duration_ms: llmDuration,
          error: llmError,
          error_name: llmErr.name,
          error_status: llmErr.status,
          deterministic_proposals_count: proposals.length,
          message: 'Ошибка при вызове LLM, используем детерминированные proposals как fallback'
        });
      }
    } else if (!useLLM) {
      log.info({
        where: 'interactive_brain',
        phase: 'llm_disabled',
        deterministic_proposals_count: proposals.length,
        message: 'LLM отключен (useLLM=false), используем детерминированные proposals'
      });
    } else if (adsetAnalysis.length === 0) {
      log.info({
        where: 'interactive_brain',
        phase: 'llm_skipped_no_adsets',
        message: 'Нет адсетов для анализа, LLM не вызывается'
      });
    }

    // ========================================
    // ЧАСТЬ 4.5: ЛОГИКА ПЕРЕРАСПРЕДЕЛЕНИЯ БЮДЖЕТА
    // ========================================

    // Считаем сумму экономии от снижения бюджетов
    const decreaseProposals = proposals.filter(p =>
      p.action === 'updateBudget' &&
      p.suggested_action_params?.decrease_percent &&
      p.suggested_action_params?.current_budget_cents
    );

    const totalSavingsCents = decreaseProposals.reduce((sum, p) => {
      const current = p.suggested_action_params.current_budget_cents;
      const newBudget = p.suggested_action_params.new_budget_cents || 0;
      return sum + (current - newBudget);
    }, 0);

    // Находим адсеты с хорошими результатами, куда можно перераспределить
    const goodAdsets = adsetAnalysis.filter(a =>
      (a.hs_class === 'very_good' || a.hs_class === 'good') &&
      !proposals.some(p => p.entity_id === a.adset_id && p.action === 'updateBudget')
    );

    if (totalSavingsCents > 0 && goodAdsets.length > 0) {
      const totalSavingsDollars = Math.round(totalSavingsCents / 100);

      // Добавляем информацию о перераспределении к decrease proposals
      const redistributeTargets = goodAdsets.slice(0, 3).map(a => ({
        adset_id: a.adset_id,
        adset_name: a.adset_name,
        health_score: a.health_score
      }));

      for (const proposal of decreaseProposals) {
        proposal.redistribute_suggestion = {
          total_savings_cents: totalSavingsCents,
          total_savings_dollars: totalSavingsDollars,
          redistribute_to: redistributeTargets,
          message: `Сэкономленные $${totalSavingsDollars} можно перераспределить на: ${redistributeTargets.map(t => `«${t.adset_name}» (HS=${t.health_score})`).join(', ')}`
        };
      }

      log.info({
        where: 'interactive_brain',
        phase: 'redistribution_calculated',
        total_savings_cents: totalSavingsCents,
        total_savings_dollars: totalSavingsDollars,
        decrease_proposals_count: decreaseProposals.length,
        good_adsets_count: goodAdsets.length,
        redistribute_targets: redistributeTargets.map(t => t.adset_name)
      });
    } else if (totalSavingsCents > 0 && goodAdsets.length === 0) {
      // Некуда перераспределять — все адсеты плохие
      // Предлагаем запустить новые адсеты с лучшими креативами
      const totalSavingsDollars = Math.round(totalSavingsCents / 100);

      // Проверяем есть ли внешние кампании среди плохих
      const hasExternalCampaigns = decreaseProposals.some(p => p.campaign_type === 'external');

      // Добавляем рекомендацию к каждому decrease proposal
      for (const proposal of decreaseProposals) {
        if (proposal.campaign_type === 'external') {
          proposal.redistribute_suggestion = {
            total_savings_cents: totalSavingsCents,
            total_savings_dollars: totalSavingsDollars,
            redistribute_to: [],
            no_good_adsets: true,
            message: `Все адсеты показывают слабые результаты. Рекомендуем: запустить новые адсеты с улучшенными креативами (свежие визуалы, новые тексты). Сэкономленные $${totalSavingsDollars} можно направить на тестирование.`
          };
        } else {
          proposal.redistribute_suggestion = {
            total_savings_cents: totalSavingsCents,
            total_savings_dollars: totalSavingsDollars,
            redistribute_to: [],
            no_good_adsets: true,
            message: `Нет адсетов с хорошими результатами для перераспределения бюджета.`
          };
        }
      }

      // Добавляем отдельный proposal-рекомендацию для запуска новых креативов
      // НО только в первой половине дня (до 14:00 по Алматы)
      const timeCheckLaunch = isAllowedToCreateAdsets({ logger: log });

      if (hasExternalCampaigns && timeCheckLaunch.allowed) {
        log.info({
          where: 'interactive_brain',
          phase: 'allow_launch_new_creatives',
          current_time: timeCheckLaunch.currentTime,
          current_hour: timeCheckLaunch.currentHour,
          cutoff_hour: timeCheckLaunch.cutoffHour,
          timezone: timeCheckLaunch.timezone,
          total_savings_dollars: totalSavingsDollars,
          message: `Создание launchNewCreatives proposal разрешено (время ${timeCheckLaunch.currentTime})`
        });

        proposals.push({
          action: 'launchNewCreatives',
          priority: 'medium',
          entity_type: 'account',
          entity_id: ad_account_id,
          entity_name: 'Рекламный аккаунт',
          campaign_type: 'external',
          health_score: null,
          hs_class: null,
          reason: `💡 Все текущие адсеты неэффективны. Рекомендуем запустить новые адсеты с улучшенными креативами: свежие визуалы, новые тексты, возможно другие аудитории. Освободившийся бюджет $${totalSavingsDollars} можно направить на тестирование новых связок.`,
          confidence: 0.7,
          suggested_action_params: {
            recommended_budget_cents: totalSavingsCents,
            suggestions: [
              'Обновить визуалы (новые фото/видео)',
              'Переписать тексты объявлений',
              'Протестировать новые аудитории',
              'Изменить формат (карусель, reels, stories)'
            ]
          }
        });
      } else if (hasExternalCampaigns && !timeCheckLaunch.allowed) {
        log.warn({
          where: 'interactive_brain',
          phase: 'skip_launch_new_creatives',
          current_time: timeCheckLaunch.currentTime,
          current_hour: timeCheckLaunch.currentHour,
          cutoff_hour: timeCheckLaunch.cutoffHour,
          timezone: timeCheckLaunch.timezone,
          total_savings_dollars: totalSavingsDollars,
          message: `⏰ ПРОПУСК launchNewCreatives: ${timeCheckLaunch.reason}`
        });
      }

      log.info({
        where: 'interactive_brain',
        phase: 'no_redistribution_targets',
        total_savings_cents: totalSavingsCents,
        total_savings_dollars: totalSavingsDollars,
        decrease_proposals_count: decreaseProposals.length,
        has_external_campaigns: hasExternalCampaigns,
        message: 'Все адсеты плохие, некуда перераспределять. Предложено запустить новые креативы.'
      });
    }

    // ========================================
    // ЧАСТЬ 5: АНАЛИЗ НЕИСПОЛЬЗОВАННЫХ КРЕАТИВОВ (из отчёта Brain)
    // ========================================

    // Проверяем время — после 14:00 по Алматы не предлагаем создавать новые adsets
    const timeCheckCreate = isAllowedToCreateAdsets({ logger: log });

    if (brainReport?.unused_creatives?.length > 0) {
      if (!timeCheckCreate.allowed) {
        log.warn({
          where: 'interactive_brain',
          phase: 'skip_create_adset_proposals',
          unused_creatives_count: brainReport.unused_creatives.length,
          current_time: timeCheckCreate.currentTime,
          current_hour: timeCheckCreate.currentHour,
          cutoff_hour: timeCheckCreate.cutoffHour,
          timezone: timeCheckCreate.timezone,
          message: `⏰ ПРОПУСК createAdSet: ${timeCheckCreate.reason}`
        });
      } else {
        log.info({
          where: 'interactive_brain',
          phase: 'allow_create_adset_proposals',
          unused_creatives_count: brainReport.unused_creatives.length,
          current_time: timeCheckCreate.currentTime,
          current_hour: timeCheckCreate.currentHour,
          cutoff_hour: timeCheckCreate.cutoffHour,
          timezone: timeCheckCreate.timezone,
          message: `Создание createAdSet proposals разрешено (время ${timeCheckCreate.currentTime})`
        });

        const byDirection = {};
        for (const uc of brainReport.unused_creatives) {
          const dirId = uc.direction_id || 'no_direction';
          if (!byDirection[dirId]) byDirection[dirId] = [];
          byDirection[dirId].push(uc);
        }

        for (const [dirId, creatives] of Object.entries(byDirection)) {
          if (creatives.length > 0 && dirId !== 'no_direction') {
            const direction = directions?.find(d => d.id === dirId);

            log.info({
              where: 'interactive_brain',
              phase: 'create_adset_proposal_added',
              direction_id: dirId,
              direction_name: direction?.name || 'Unknown',
              creatives_count: creatives.length,
              message: `Добавлен createAdSet proposal для направления "${direction?.name || dirId}"`
            });

            proposals.push({
              action: 'createAdSet',
              priority: 'medium',
              entity_type: 'direction',
              entity_id: dirId,
              entity_name: direction?.name || 'Unknown',
              reason: `${creatives.length} неиспользованных креативов готовы к запуску. Рекомендую протестировать.`,
              confidence: 0.75,
              suggested_action_params: {
                creative_ids: creatives.slice(0, 5).map(c => c.id),
                creative_titles: creatives.slice(0, 5).map(c => c.title),
                recommended_budget_cents: BUDGET_LIMITS.NEW_ADSET_MIN
              }
            });
          }
        }
      }
    }

    // ========================================
    // ЧАСТЬ 6: HIGH RISK ИЗ ОТЧЁТА BRAIN
    // ========================================

    if (brainReport?.ready_creatives) {
      for (const creative of brainReport.ready_creatives) {
        if (creative.risk_score && creative.risk_score >= 70) {
          // Уже не добавляем proposal если adset уже в списке
          const alreadyHasProposal = proposals.some(p =>
            p.entity_type === 'creative' && p.entity_id === creative.id
          );

          if (!alreadyHasProposal) {
            proposals.push({
              action: 'review',
              priority: 'low',
              entity_type: 'creative',
              entity_id: creative.id,
              entity_name: creative.title || creative.name,
              reason: `High risk score (${creative.risk_score}/100) по данным последнего анализа Brain. Рекомендую проверить креатив.`,
              confidence: 0.6,
              metrics: { risk_score: creative.risk_score, roi_data: creative.roi_data }
            });
          }
        }
      }
    }

    // ========================================
    // ЧАСТЬ 7: СОРТИРОВКА И ВОЗВРАТ
    // ========================================

    // Сортируем proposals по приоритету
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    proposals.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

    const duration = Date.now() - startTime;

    // Summary статистика
    const externalAdsets = adsetAnalysis.filter(a => a.campaign_type === 'external');
    const internalAdsets = adsetAnalysis.filter(a => a.campaign_type === 'internal');

    // Фильтруем todayData только по проанализированным адсетам (для точных метрик)
    const analyzedAdsetIds = new Set(adsetAnalysis.map(a => a.adset_id));
    const analyzedTodayData = todayData.filter(a => analyzedAdsetIds.has(a.adset_id));

    const summary = {
      total_adsets_analyzed: adsetAnalysis.length,
      skipped_adsets_count: skippedAdsets.length,
      // NEW: статистика по типам кампаний
      by_campaign_type: {
        internal: internalAdsets.length,
        external: externalAdsets.length
      },
      // NEW: статистика по источникам данных
      by_data_source: {
        target_cpl_from_direction: adsetAnalysis.filter(a => a.target_cpl_source === 'direction').length,
        target_cpl_from_account: adsetAnalysis.filter(a => a.target_cpl_source === 'account_default').length,
        target_cpl_none: adsetAnalysis.filter(a => a.target_cpl_source === 'none').length,
        hist7d_from_brain_report: adsetAnalysis.filter(a => a.hist7d_source === 'brain_report').length,
        hist7d_from_fb_api: adsetAnalysis.filter(a => a.hist7d_source === 'fb_api_calculated').length,
        hist7d_none: adsetAnalysis.filter(a => a.hist7d_source === 'none').length
      },
      by_hs_class: {
        very_good: adsetAnalysis.filter(a => a.hs_class === 'very_good').length,
        good: adsetAnalysis.filter(a => a.hs_class === 'good').length,
        neutral: adsetAnalysis.filter(a => a.hs_class === 'neutral').length,
        slightly_bad: adsetAnalysis.filter(a => a.hs_class === 'slightly_bad').length,
        bad: adsetAnalysis.filter(a => a.hs_class === 'bad').length
      },
      // NEW: HS по типам кампаний для сравнения
      external_hs_breakdown: externalAdsets.length > 0 ? {
        avg_health_score: Math.round(externalAdsets.reduce((sum, a) => sum + a.health_score, 0) / externalAdsets.length),
        by_class: {
          very_good: externalAdsets.filter(a => a.hs_class === 'very_good').length,
          good: externalAdsets.filter(a => a.hs_class === 'good').length,
          neutral: externalAdsets.filter(a => a.hs_class === 'neutral').length,
          slightly_bad: externalAdsets.filter(a => a.hs_class === 'slightly_bad').length,
          bad: externalAdsets.filter(a => a.hs_class === 'bad').length
        }
      } : null,
      proposals_by_action: {
        pauseAdSet: proposals.filter(p => p.action === 'pauseAdSet').length,
        pauseAd: proposals.filter(p => p.action === 'pauseAd').length,
        updateBudget: proposals.filter(p => p.action === 'updateBudget').length,
        createAdSet: proposals.filter(p => p.action === 'createAdSet').length,
        review: proposals.filter(p => p.action === 'review').length
      },
      // NEW: proposals по типам кампаний
      proposals_by_campaign_type: {
        internal: proposals.filter(p => p.campaign_type === 'internal').length,
        external: proposals.filter(p => p.campaign_type === 'external').length
      },
      // Статистика по ads-пожирателям
      ad_eaters: {
        total: adEaters.length,
        critical: adEaters.filter(e => e.is_critical).length,
        wasted_spend: adEaters.reduce((sum, e) => sum + e.spend, 0).toFixed(2)
      },
      brain_report_age_hours: brainReportAge,
      // ВАЖНО: считаем только по проанализированным адсетам (analyzedTodayData), а не по всем
      today_total_spend: analyzedTodayData.reduce((sum, a) => sum + parseFloat(a.spend || 0), 0).toFixed(2),
      // ВАЖНО: используем extractLeads() для корректного подсчёта WhatsApp/messaging лидов
      // (onsite_conversion.total_messaging_connection + lead_grouped + pixel_lead)
      today_total_leads: analyzedTodayData.reduce((sum, a) => sum + extractLeads(a.actions), 0),
      today_total_link_clicks: analyzedTodayData.reduce((sum, a) => sum + getActionValue(a.actions, 'link_click'), 0),
      // LLM integration (NEW!)
      llm_used: llmUsed,
      llm_error: llmError
    };

    // Сохраняем запуск для аудита
    await supabase.from('brain_executions').insert({
      user_account_id: userAccountId,
      mode: 'interactive',
      direction_id: directionId,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'proposals_generated',
      proposals_count: proposals.length,
      proposals_json: proposals,
      idempotency_key: crypto.randomUUID()
    });

    log.info({
      where: 'interactive_brain',
      phase: 'complete',
      proposals_count: proposals.length,
      duration_ms: duration,
      adsets_analyzed: adsetAnalysis.length,
      adsets_skipped: skippedAdsets.length,
      internal_adsets: internalAdsets.length,
      external_adsets: externalAdsets.length,
      proposals_internal: summary.proposals_by_campaign_type.internal,
      proposals_external: summary.proposals_by_campaign_type.external,
      data_sources: summary.by_data_source,
      llm_used: llmUsed,
      llm_error: llmError,
      message: `Анализ завершён: ${adsetAnalysis.length} адсетов (${internalAdsets.length} internal, ${externalAdsets.length} external), ${proposals.length} proposals${llmUsed ? ' (LLM)' : ' (deterministic)'}`
    });

    // Детальный лог summary для отладки
    log.debug({
      where: 'interactive_brain',
      phase: 'complete_summary',
      summary
    });

    return {
      success: true,
      mode: 'interactive',
      proposals,
      adset_analysis: adsetAnalysis,
      summary,
      // LLM-related fields (NEW!)
      llm: {
        used: llmUsed,
        summary: llmSummary,
        planNote: llmPlanNote,
        error: llmError
      },
      context: {
        today_adsets: todayData.length,
        yesterday_adsets: yesterdayData.length,
        daily_data_rows: dailyData.length,
        fb_calculated_metrics: adsetMetricsFromFB.length,
        brain_report_available: !!brainReport,
        brain_report_age_hours: brainReportAge,
        ad_account_settings_available: !!adAccountSettings,
        default_cpl_target: adAccountSettings?.default_cpl_target_cents ? (adAccountSettings.default_cpl_target_cents / 100) : null,
        directions_count: directions?.length || 0,
        generated_at: new Date().toISOString(),
        duration_ms: duration,
        focus: llmUsed
          ? 'LLM-powered — решения сгенерированы ИИ на основе сегодняшних данных'
          : 'TODAY — детерминированные решения на основе сегодняшних данных'
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    log.error({
      where: 'interactive_brain',
      phase: 'error',
      userId: userAccountId,
      duration,
      error: String(error),
      stack: error.stack
    });

    // Сохраняем ошибку
    await supabase.from('brain_executions').insert({
      user_account_id: userAccountId,
      mode: 'interactive',
      direction_id: directionId,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      status: 'error',
      error_message: String(error),
      idempotency_key: crypto.randomUUID()
    });

    throw error;
  }
}
