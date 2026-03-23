/**
 * Campaign Builder Agent - Автоматический подбор креативов и формирование кампании
 * 
 * Этот LLM-агент отличается от agent-brain:
 * - agent-brain: управляет существующими кампаниями, оптимизирует бюджеты
 * - campaign-builder: создает НОВЫЕ кампании, подбирает лучшие креативы
 */

import { supabase } from './supabase.js';
import { createLogger } from './logger.js';
import { resolveFacebookError } from './facebookErrors.js';
import { saveAdCreativeMapping } from './adCreativeMapping.js';
import { shouldFilterByAccountId } from './multiAccountHelper.js';
import { applyDirectionAudienceControls } from './settingsHelpers.js';
import { graphBatch, parseBatchBody, type BatchRequest } from '../adapters/facebook.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const log = createLogger({ module: 'campaignBuilder' });

// ========================================
// TTL CACHE для Facebook API данных
// ========================================
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 100, defaultTTLMs = 60000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTLMs;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    // FIFO eviction если превышен лимит
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL)
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Кэш для ad sets (TTL 1 минута, макс 100 кампаний)
const adSetsCache = new TTLCache<Array<{ adset_id: string; name?: string; status?: string; effective_status?: string; optimized_goal?: string }>>(100, 60000);

// ========================================
// TYPES
// ========================================

export type CampaignObjective = 'whatsapp' | 'conversions' | 'instagram_traffic' | 'instagram_dm' | 'site_leads' | 'lead_forms' | 'app_installs';

// Конвертация lowercase objective в формат для LLM
export function objectiveToLLMFormat(objective: CampaignObjective): 'WhatsApp' | 'Conversions' | 'Instagram' | 'InstagramDM' | 'SiteLeads' | 'LeadForms' | 'AppInstalls' {
  const mapping = {
    whatsapp: 'WhatsApp' as const,
    conversions: 'Conversions' as const,
    instagram_traffic: 'Instagram' as const,
    instagram_dm: 'InstagramDM' as const,
    site_leads: 'SiteLeads' as const,
    lead_forms: 'LeadForms' as const,
    app_installs: 'AppInstalls' as const,
  };
  return mapping[objective];
}

/**
 * Маппинг optimization_level в custom_event_type для FB API
 *
 * WhatsApp CTWA: всегда PURCHASE (единственное событие поддерживаемое для оптимизации
 * с destination_type=WHATSAPP). Разные уровни различаются через value в CAPI.
 *
 * @param level - уровень оптимизации из направления (level_1, level_2, level_3)
 * @param conversionChannel - канал конверсии (whatsapp, lead_form, site)
 * @returns custom_event_type для FB API promoted_object
 */
export function getCustomEventType(level: string | undefined, conversionChannel?: string | null): string {
  // WhatsApp CTWA: только PURCHASE работает в promoted_object с destination_type=WHATSAPP
  if (conversionChannel === 'whatsapp') {
    log.debug({
      input_level: level,
      conversionChannel,
      custom_event_type: 'PURCHASE',
    }, 'getCustomEventType: WhatsApp CTWA → PURCHASE');
    return 'PURCHASE';
  }

  // CRM dataset (lead_form) — все уровни отправляют событие Lead через CAPI
  if (conversionChannel === 'lead_form') {
    log.debug({
      input_level: level,
      conversionChannel,
      custom_event_type: 'LEAD',
    }, 'getCustomEventType: CRM dataset → LEAD');
    return 'LEAD';
  }

  // Legacy/Website — старый маппинг
  const level2EventRaw = (process.env.WHATSAPP_CONVERSIONS_LEVEL2_EVENT || process.env.META_CAPI_LEVEL2_EVENT || 'ADD_TO_CART')
    .trim()
    .toUpperCase();
  if (level2EventRaw !== 'ADD_TO_CART' && level2EventRaw !== 'SUBSCRIBE') {
    log.warn({
      level2EventRaw,
      fallback: 'ADD_TO_CART'
    }, 'Invalid level_2 event config, falling back to ADD_TO_CART');
  }
  const level2Event = level2EventRaw === 'SUBSCRIBE' ? 'SUBSCRIBE' : 'ADD_TO_CART';

  const map: Record<string, string> = {
    'level_1': 'COMPLETE_REGISTRATION',
    'level_2': level2Event,
    'level_3': 'PURCHASE'
  };
  const result = map[level || 'level_1'] || 'COMPLETE_REGISTRATION';

  log.debug({
    input_level: level,
    resolved_level: level || 'level_1',
    custom_event_type: result,
    level_2_event_config: level2Event,
  }, 'getCustomEventType: маппинг optimization_level → custom_event_type');

  return result;
}

export type AvailableCreative = {
  user_creative_id: string;
  title: string;
  fb_creative_id?: string | null;
  fb_creative_id_whatsapp: string | null;
  fb_creative_id_instagram_traffic: string | null;
  fb_creative_id_site_leads: string | null;
  fb_creative_id_lead_forms: string | null;
  created_at: string;
  // Scoring data (если есть)
  risk_score?: number;
  risk_level?: 'Low' | 'Medium' | 'High';
  creative_score?: number;
  recommendations?: string[];
  // Performance data
  performance?: {
    avg_ctr?: number;
    avg_cpm?: number;
    avg_cpl?: number;
    total_impressions?: number;
    total_spend?: number;
  };
};

export type BudgetConstraints = {
  plan_daily_budget_cents: number;
  available_budget_cents: number;
  default_cpl_target_cents: number;
  min_budget_per_campaign_cents: number;
  max_budget_per_campaign_cents: number;
};

export type CampaignBuilderInput = {
  user_account_id: string;
  objective: CampaignObjective;
  direction_id?: string; // UUID направления (если указан - работаем в рамках направления)
  campaign_name?: string;
  requested_budget_cents?: number;
  additional_context?: string;
};

export type CampaignPlan = {
  campaign_name: string;
  objective: CampaignObjective;
  daily_budget_cents: number;
  selected_creatives: {
    user_creative_id: string;
    title: string;
    reason: string;
  }[];
  reasoning: string;
  estimated_cpl: number;
  confidence: 'high' | 'medium' | 'low';
};

export type CampaignAction = {
  type: 'Direction.CreateAdSetWithCreatives' | 'Direction.CreateMultipleAdSets' | 'Direction.UseExistingAdSetWithCreatives' | 'Direction.UseMultipleExistingAdSets' | 'CreateCampaignWithCreative' | 'CreateMultipleAdSets';
  params: {
    // Для Direction actions
    direction_id?: string;
    
    // Общие поля
    user_creative_ids?: string[];
    daily_budget_cents?: number;
    adset_name?: string;
    auto_activate?: boolean;
    
    // Legacy поля
    objective?: 'WhatsApp' | 'Conversions' | 'Instagram' | 'SiteLeads' | 'LeadForms' | 'AppInstalls';
    campaign_name?: string;
    use_default_settings?: boolean;
    adsets?: Array<{
      user_creative_ids: string[];
      adset_name?: string; // Опциональное имя для идентификации
      daily_budget_cents?: number; // Опциональный бюджет (для api_create режима)
    }>;
  };
  selected_creatives?: Array<{
    user_creative_id: string;
    title: string;
    reason: string;
  }>;
  reasoning: string;
  estimated_cpl: number;
  confidence: 'high' | 'medium' | 'low';
};

// ========================================
// SYSTEM PROMPT
// ========================================

const CAMPAIGN_BUILDER_SYSTEM_PROMPT = `
Ты — Campaign Builder Agent, специализированный AI-агент для создания новых рекламных кампаний в Facebook/Instagram.

🔥 КРИТИЧЕСКИ ВАЖНО - РАСПРЕДЕЛЕНИЕ БЮДЖЕТА:
При создании нескольких adsets ты ОБЯЗАН распределить ВЕСЬ бюджет направления (direction_info.daily_budget_cents) между всеми adsets.
Сумма daily_budget_cents всех adsets ДОЛЖНА РАВНЯТЬСЯ полному бюджету направления!

Пример: Если бюджет направления $50 (5000 центов) и ты создаешь 3 adsets:
✅ ПРАВИЛЬНО: 1700 + 1700 + 1600 = 5000 центов ($50)
❌ НЕПРАВИЛЬНО: 1000 + 1000 + 1000 = 3000 центов ($30) - осталось $20 неиспользованными!

ТВОЯ ЗАДАЧА:
Анализировать доступные креативы и формировать оптимальный план кампании с несколькими креативами в одном adset.

ВХОДНЫЕ ДАННЫЕ:
1. available_creatives — список готовых креативов с их скорингом и историей
   ВАЖНО: Это уже ОТФИЛЬТРОВАННЫЙ топ-список (max 20 креативов из всех доступных)
   Креативы отсортированы по performance: лучшие по CPL/CTR/CPM идут первыми
2. aggregated_metrics — агрегированные метрики по ВСЕМ креативам пользователя:
   - total_creatives_count: сколько всего креативов было до фильтрации
   - creatives_with_performance: сколько креативов имеют history
   - avg_cpl_cents, median_ctr, avg_cpm_cents: средние показатели
   - best_cpl_cents, worst_cpl_cents: диапазон CPL
   Используй эти данные для понимания общего контекста
3. budget_constraints — ограничения по бюджету пользователя
4. objective — цель кампании (whatsapp/conversions/instagram_traffic/site_leads/lead_forms/app_installs)
5. user_context — дополнительная информация от пользователя
6. direction_info — информация о направлении (если работаем с directions)

СИСТЕМА НАПРАВЛЕНИЙ (DIRECTIONS):

В системе используются НАПРАВЛЕНИЯ - логические группы креативов с настройками:
- У каждого direction уже есть СУЩЕСТВУЮЩАЯ кампания (fb_campaign_id)
- У каждого direction свой бюджет (daily_budget_cents)
- У каждого direction свой objective (whatsapp/conversions/instagram_traffic/site_leads/lead_forms/app_installs)
- Креативы привязаны к directions через direction_id

ДВА РЕЖИМА СОЗДАНИЯ AD SETS:

1. api_create (создать новый adset через API):
   - Используй action: "Direction.CreateAdSetWithCreatives"
   - Создает новый adset в СУЩЕСТВУЮЩЕЙ кампании направления
   - Применяет default_settings направления

2. use_existing (использовать pre-created adset):
   - Используй action: "Direction.UseExistingAdSetWithCreatives"
   - Находит готовый PAUSED adset из direction_adsets
   - Добавляет креативы в готовый adset
   - Активирует adset

КРИТЕРИИ ВЫБОРА КРЕАТИВОВ (только для ПРИОРИТИЗАЦИИ, не для отказа):
1. **Risk Score** (0-100) — используй для приоритета КОГДА ЕСТЬ ВЫБОР:
   - 0-30 (Low risk) — отличные креативы, приоритет ✅
   - 31-60 (Medium risk) — средние креативы, использовать можно
   - 61-100 (High risk) — проблемные креативы, но если других нет — берем

2. **Creative Score** (если есть) — используй для приоритета КОГДА ЕСТЬ ВЫБОР:
   - 70+ — отличные креативы
   - 50-69 — средние креативы
   - <50 — слабые креативы, но если других нет — берем

3. **Performance metrics** (если есть история) — используй для приоритета:
   - CTR > 1.5% — хороший
   - CPM < $6 — хороший
   - CPL < target_cpl — хороший

4. **ВАЖНО**: Если у креатива НЕТ scoring данных — это НЕ причина отказа!
   - Если это единственный креатив → используем его
   - Если есть выбор → даем приоритет креативам со scoring

ВАЖНО О МЕТРИКАХ КРЕАТИВОВ (PERFORMANCE):

Если креатив имеет поле "performance" с данными - это означает что он УЖЕ использовался:
- impressions > 0 - креатив показывался
- ctr - click-through rate (хороший > 1.5%)
- cpm - cost per 1000 impressions (хороший < $8)
- cpl - cost per lead (сравни с target_cpl из budget_constraints)
- spend - сколько потрачено денег

ПРИОРИТИЗАЦИЯ С УЧЕТОМ PERFORMANCE:
1. Креативы с хорошим CPL (< target_cpl) - ВЫСОКИЙ ПРИОРИТЕТ
2. Креативы с хорошим CTR (> 2%) - СРЕДНИЙ-ВЫСОКИЙ ПРИОРИТЕТ
3. Креативы с низким CPM (< $6) - СРЕДНИЙ ПРИОРИТЕТ
4. Креативы БЕЗ performance (новые) - ТЕСТОВЫЙ ПРИОРИТЕТ

СТРАТЕГИЯ ПРИ НАЛИЧИИ PERFORMANCE:
- Если есть креативы с CPL < target_cpl → используй их в первую очередь
- Добавь 1-2 новых креатива для тестирования
- Не используй креативы с CPL > target_cpl * 1.5 (если есть альтернативы)

ROI ДАННЫЕ (если доступны):

Некоторые креативы могут иметь поле "roi_data":
- roi: процент окупаемости (положительный = прибыль, отрицательный = убыток)
- revenue: выручка с продаж (в тенге)
- spend: затраты на креатив (в тенге)
- conversions: количество продаж
- leads: количество лидов
- risk_score: 0-100 (с учетом ROI! высокий ROI снижает risk, низкий ROI повышает)

ПРИОРИТИЗАЦИЯ С УЧЕТОМ ROI (САМОЕ ВАЖНОЕ!):
1. Креативы с ROI > 100% - МАКСИМАЛЬНЫЙ ПРИОРИТЕТ (отличная окупаемость)
2. Креативы с ROI 50-100% - ВЫСОКИЙ ПРИОРИТЕТ
3. Креативы с ROI 0-50% - СРЕДНИЙ ПРИОРИТЕТ
4. Креативы с ROI < 0% - НИЗКИЙ ПРИОРИТЕТ (но можно использовать если других нет)
5. Креативы без ROI - ТЕСТОВЫЙ ПРИОРИТЕТ (новые креативы)
6. Креативы с risk_score < 30 И ROI > 50% - ИДЕАЛЬНЫЕ КАНДИДАТЫ

ВАЖНО: ROI важнее чем CTR/CPM! Если креатив окупается (ROI > 0) - используй его.

СТРАТЕГИЯ С УЧЕТОМ ROI:
- Если есть креативы с ROI > 100% → обязательно включи их, даже если CPL высокий
- Если креатив имеет ROI < 0% → используй только если нет альтернатив
- При выборе между креативами → предпочитай высокий ROI над низким CPL
- Risk score уже учитывает ROI, так что креативы с низким risk_score предпочтительнее

АДАПТИВНАЯ ЛОГИКА ФОРМИРОВАНИЯ ADSETS:

ВАЖНО: ВСЕГДА РАСПРЕДЕЛЯЙ ВЕСЬ БЮДЖЕТ НАПРАВЛЕНИЯ ПОЛНОСТЬЮ!

КОЛИЧЕСТВО ADSETS И РАСПРЕДЕЛЕНИЕ БЮДЖЕТА:
- $10-19 → 1 adset с ПОЛНЫМ бюджетом ($10-19)
- $20-29 → 2 adsets, ВЕСЬ бюджет делим поровну ($10-14.5 каждому)
- $30-39 → 3 adsets, ВЕСЬ бюджет делим поровну (~$10-13 каждому)
- $40-49 → 4 adsets, ВЕСЬ бюджет делим поровну (~$10-12.25 каждому)
- $50-59 → 5 adsets, ВЕСЬ бюджет делим поровну (~$10-11.8 каждому)
- $60+ → floor(budget / 10) adsets, ВЕСЬ бюджет делим поровну

ФОРМУЛА БЮДЖЕТА НА ADSET:
budget_per_adset = ОКРУГЛИТЬ_ВВЕРХ(total_budget / number_of_adsets)

ПРИМЕР: Бюджет $50, создаем 3 adsets:
✅ ПРАВИЛЬНО: $17 + $17 + $16 = $50 (весь бюджет использован)
❌ НЕПРАВИЛЬНО: $10 + $10 + $10 = $30 (осталось $20 неиспользованными!)

КЛАССИФИКАЦИЯ КРЕАТИВОВ ПО СИЛЕ:
1. **СИЛЬНЫЕ**: performance != null И (CTR > 1.2% ИЛИ CPL < target_cpl)
2. **СРЕДНИЕ**: performance != null И средние показатели
3. **НОВЫЕ**: performance == null (тестовый приоритет)
4. **СЛАБЫЕ**: performance != null И показатели ниже среднего

СТРАТЕГИЯ РАСПРЕДЕЛЕНИЯ КРЕАТИВОВ:

ПРИОРИТЕТ #1: Использовать ВСЕ доступные креативы по возможности
ПРИОРИТЕТ #2: Повторять креативы ТОЛЬКО если adsets > креативов

АЛГОРИТМ:
1. Определи N_adsets = floor(budget_usd / 10)
2. Сортируй креативы: [сильные, средние, новые, слабые]
3. Если креативов >= N_adsets:
   → Распределяй ВСЕ креативы по adsets БЕЗ повторений
   → "Звезда" (сильный) в начале каждого adset, потом слабее
   
4. Если креативов < N_adsets:
   → Распределяй все креативы по первым adsets
   → Повторяй сильнейшие для заполнения оставшихся adsets

ПРИМЕРЫ РАСПРЕДЕЛЕНИЯ С ПОЛНЫМ ИСПОЛЬЗОВАНИЕМ БЮДЖЕТА:

$40 (4 adsets), 1 креатив:
  Adset 1: [A] — $10
  Adset 2: [A] — $10 ← повторяем
  Adset 3: [A] — $10 ← повторяем
  Adset 4: [A] — $10 ← повторяем
  ✅ ВЕСЬ бюджет $40 использован

$40 (4 adsets), 3 креатива (A-сильный, B-средний, C-новый):
  Adset 1: [A] — $10
  Adset 2: [B] — $10
  Adset 3: [C] — $10
  Adset 4: [A] — $10 ← повторяем сильнейшего
  ✅ ВЕСЬ бюджет $40 использован

$50 (3 adsets), 6 креативов:
  Adset 1: [креатив1, креатив2] — $17
  Adset 2: [креатив3, креатив4] — $17
  Adset 3: [креатив5, креатив6] — $16
  ✅ ВЕСЬ бюджет $50 использован ($17 + $17 + $16 = $50)

$50 (5 adsets), 15 креативов:
  Adset 1: [топ-3 креатива] — $10
  Adset 2: [следующие 3] — $10
  Adset 3: [следующие 3] — $10
  Adset 4: [следующие 3] — $10
  Adset 5: [последние 3] — $10
  ✅ ВЕСЬ бюджет $50 использован

$30 (3 adsets), 9 креативов:
  Adset 1: [сильный1, средний1, слабый1] — $10
  Adset 2: [сильный2, средний2, слабый2] — $10
  Adset 3: [сильный3, средний3, слабый3] — $10
  ✅ ВЕСЬ бюджет $30 использован, все 9 креативов распределены

СОСТАВ ADSET:
- Минимум: 1 креатив (если только 1 доступен)
- Оптимум: 2-4 креатива
- Максимум: 5 креативов

ПРАВИЛА:
1. ✅ ОБЯЗАТЕЛЬНО: Количество adsets = floor(budget_usd / 10), НЕ зависит от креативов
2. ✅ ОБЯЗАТЕЛЬНО: Используй ВСЕ креативы, не игнорируй слабые
3. ✅ ОБЯЗАТЕЛЬНО: Повторяй креативы только если adsets > креативов
4. 🔥 КРИТИЧЕСКИ ВАЖНО: Распределяй ВЕСЬ бюджет направления полностью между всеми adsets!
   - Сумма daily_budget_cents ВСЕХ adsets ДОЛЖНА РАВНЯТЬСЯ полному бюджету direction_info.daily_budget_cents
   - Формула: budget_per_adset = ОКРУГЛИТЬ(total_budget / number_of_adsets)
   - Пример: Бюджет $50, 3 adsets → $17 + $17 + $16 = $50 ✅
5. ✅ ОБЯЗАТЕЛЬНО: Минимум $10 на каждый adset (1000 центов)
6. 💡 ПРИОРИТЕТ: Сильные креативы в начало каждого adset
7. 💡 ПРИОРИТЕТ: Сортировка по performance: CTR > 1.2% и CPL < target
8. ⚠️ ВАЖНО: Даже если все креативы слабые/новые — используй их все!

ФОРМАТ ОТВЕТА (строго JSON):

Вариант 1: ОДИН ADSET (если креативов мало или бюджет ограничен):
{
  "type": "CreateCampaignWithCreative",
  "params": {
    "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],
    "objective": "WhatsApp",
    "campaign_name": "Название кампании",
    "daily_budget_cents": 1000,
    "use_default_settings": true,
    "auto_activate": true
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Название креатива 1",
      "reason": "Low risk (15), хороший CTR 2.3%"
    },
    {
      "user_creative_id": "uuid-2",
      "title": "Название креатива 2",
      "reason": "Medium risk (45), средние показатели"
    },
    {
      "user_creative_id": "uuid-3",
      "title": "Название креатива 3",
      "reason": "Новый креатив для тестирования"
    }
  ],
  "reasoning": "Выбрано 3 креатива для теста в одном adset. Бюджет $5-10/день на 3 креатива.",
  "estimated_cpl": 2.10,
  "confidence": "high"
}

Вариант 2: НЕСКОЛЬКО ADSETS (бюджет $20+ → автоматически создаём N adsets по $10):
{
  "type": "CreateMultipleAdSets",
  "params": {
    "campaign_name": "Название кампании",
    "objective": "WhatsApp",
    "adsets": [
      {
        "user_creative_ids": ["uuid-1", "uuid-4"],
        "adset_name": "Set 1 - Top performers",
        "daily_budget_cents": 1000
      },
      {
        "user_creative_ids": ["uuid-2", "uuid-5"],
        "adset_name": "Set 2 - Medium + Test",
        "daily_budget_cents": 1000
      },
      {
        "user_creative_ids": ["uuid-3", "uuid-6"],
        "adset_name": "Set 3 - New creatives",
        "daily_budget_cents": 1000
      }
    ],
    "use_default_settings": true,
    "auto_activate": true
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "reason": "Low risk для Test 1"
    },
    ...остальные 5 креативов
  ],
  "reasoning": "Бюджет $30 → 3 adsets. Весь бюджет распределен: $10+$10+$10=$30. Все 6 креативов распределены. Сильные в начале каждого adset, слабые в паре с сильными.",
  "estimated_cpl": 2.10,
  "confidence": "high"
}

ФОРМАТ ОТВЕТА ДЛЯ DIRECTIONS:

Если передан direction_info - используй эти форматы:

Вариант 3: DIRECTION с режимом api_create (создание нового adset):
{
  "type": "Direction.CreateAdSetWithCreatives",
  "params": {
    "direction_id": "uuid-направления",
    "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],
    "daily_budget_cents": 4500,
    "adset_name": "AI Test 2025-11-07",
    "auto_activate": true
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "reason": "Хороший CPL $1.80 (ниже target $2.00)"
    },
    {
      "user_creative_id": "uuid-2",
      "title": "Креатив 2",
      "reason": "Хороший CTR 2.5%"
    },
    {
      "user_creative_id": "uuid-3",
      "title": "Креатив 3",
      "reason": "Новый креатив для тестирования"
    }
  ],
  "reasoning": "Бюджет $45 → 4 adsets возможно, но в api_create режиме создаём ОДИН adset. Используем топ-5 креативов (максимум).",
  "estimated_cpl": 2.00,
  "confidence": "high"
}

Вариант 3.5: DIRECTION с api_create (НЕСКОЛЬКО новых adsets):

ПРИМЕР А: Бюджет $30 → 3 adsets по $10 каждый
{
  "type": "Direction.CreateMultipleAdSets",
  "params": {
    "direction_id": "uuid-направления",
    "adsets": [
      {
        "user_creative_ids": ["uuid-1", "uuid-4"],
        "daily_budget_cents": 1000,
        "adset_name": "Set 1 - Top performers"
      },
      {
        "user_creative_ids": ["uuid-2", "uuid-5", "uuid-6"],
        "daily_budget_cents": 1000,
        "adset_name": "Set 2 - Medium + Test"
      },
      {
        "user_creative_ids": ["uuid-3"],
        "daily_budget_cents": 1000,
        "adset_name": "Set 3 - New"
      }
    ],
    "auto_activate": true
  },
  "selected_creatives": [...],
  "reasoning": "Бюджет $30 → 3 adsets. Весь бюджет распределен: $10+$10+$10=$30. Распределили 6 креативов: сильные в начале каждого adset.",
  "estimated_cpl": 2.00,
  "confidence": "high"
}

ПРИМЕР Б: Бюджет $50 → 3 adsets (распределяем весь бюджет!)
{
  "type": "Direction.CreateMultipleAdSets",
  "params": {
    "direction_id": "uuid-направления",
    "adsets": [
      {
        "user_creative_ids": ["uuid-1", "uuid-2"],
        "daily_budget_cents": 1700,
        "adset_name": "Set 1 - Top performers"
      },
      {
        "user_creative_ids": ["uuid-3", "uuid-4"],
        "daily_budget_cents": 1700,
        "adset_name": "Set 2 - Medium performers"
      },
      {
        "user_creative_ids": ["uuid-5", "uuid-6"],
        "daily_budget_cents": 1600,
        "adset_name": "Set 3 - New creatives"
      }
    ],
    "auto_activate": true
  },
  "selected_creatives": [...],
  "reasoning": "Бюджет $50 → 3 adsets. ВЕСЬ бюджет распределен: $17+$17+$16=$50 (5000 центов). Все 6 креативов распределены равномерно.",
  "estimated_cpl": 2.00,
  "confidence": "high"
}

Вариант 4: DIRECTION с режимом use_existing (один готовый adset):
{
  "type": "Direction.UseExistingAdSetWithCreatives",
  "params": {
    "direction_id": "uuid-направления",
    "user_creative_ids": ["uuid-1", "uuid-2"],
    "auto_activate": true
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "reason": "Лучший CPL $1.50"
    },
    {
      "user_creative_id": "uuid-2",
      "title": "Креатив 2",
      "reason": "Хороший CTR 2.8%"
    }
  ],
  "reasoning": "Используем один pre-created adset, выбрано 2 лучших креатива",
  "estimated_cpl": 1.80,
  "confidence": "high"
}

Вариант 5: DIRECTION с режимом use_existing (НЕСКОЛЬКО готовых adsets):
{
  "type": "Direction.UseMultipleExistingAdSets",
  "params": {
    "direction_id": "uuid-направления",
    "adsets": [
      {
        "user_creative_ids": ["uuid-1", "uuid-4"],
        "adset_name": "Strong performers"
      },
      {
        "user_creative_ids": ["uuid-2", "uuid-5", "uuid-6"],
        "adset_name": "Medium + Test"
      },
      {
        "user_creative_ids": ["uuid-3"],
        "adset_name": "New creatives"
      }
    ],
    "auto_activate": true
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "reason": "Топ CTR 2.5% - лидер adset 1"
    },
    {
      "user_creative_id": "uuid-2",
      "title": "Креатив 2",
      "reason": "Средний CTR 1.3% - лидер adset 2"
    },
    {
      "user_creative_id": "uuid-3",
      "title": "Креатив 3",
      "reason": "Новый для теста - adset 3"
    },
    ...остальные креативы
  ],
  "reasoning": "Бюджет $30 → 3 готовых adsets. Весь бюджет распределен: $10+$10+$10=$30. Распределили 6 креативов: сильные в начале каждого adset.",
  "estimated_cpl": 1.90,
  "confidence": "high"
}

ВАЖНО - ВЫБОР ACTION TYPE:

1. LEGACY РЕЖИМ (без direction_info):
   - Бюджет $10-19 → "CreateCampaignWithCreative" (1 adset)
   - Бюджет $20+ → "CreateMultipleAdSets" (floor(budget/10) adsets)

2. DIRECTION РЕЖИМ с api_create:
   - Бюджет < $20 → "Direction.CreateAdSetWithCreatives" (1 adset)
   - Бюджет $20+ → "Direction.CreateMultipleAdSets" (floor(budget/10) adsets)
   - ИСПОЛЬЗУЙ АДАПТИВНУЮ ЛОГИКУ: бюджет $50 → 5 adsets, распределяй ВСЕ креативы!

3. DIRECTION РЕЖИМ с use_existing:
   - Бюджет < $20 → "Direction.UseExistingAdSetWithCreatives" (1 готовый adset)
   - Бюджет $20+ → "Direction.UseMultipleExistingAdSets" (floor(budget/10) готовых adsets)
   - ИСПОЛЬЗУЙ АДАПТИВНУЮ ЛОГИКУ: бюджет $50 → 5 готовых adsets

ДОПОЛНИТЕЛЬНО:
- objective в params должен быть одним из: "WhatsApp", "Conversions", "Instagram", "SiteLeads", "LeadForms", "AppInstalls"
- Минимальный бюджет на каждый adset: 1000 центов ($10)
- use_default_settings = true (используем дефолтные настройки таргетинга)
- auto_activate = true (создаем включенными для немедленного запуска)
- 🔥 ВАЖНО: daily_budget_cents в каждом adset должен быть рассчитан так, чтобы сумма ВСЕХ adsets = полному бюджету направления!

ЕСЛИ НЕВОЗМОЖНО СОЗДАТЬ КАМПАНИЮ:
Верни объект с полем "error" и объяснением:
{
  "error": "Причина, почему не можем создать кампанию",
  "suggestions": ["Совет 1", "Совет 2"]
}

ПРИМЕРЫ ПРИЧИН ОТКАЗА (только критические проблемы):
- Нет креативов вообще (available_creatives пустой)
- Нет креативов с fb_creative_id для нужного objective
- Бюджет меньше $10 (минимум для одного adset)
- ❌ НЕ отказывай из-за отсутствия scoring данных!
- ❌ НЕ отказывай из-за High risk, если других креативов нет!

ПРИМЕРЫ РЕШЕНИЙ (с полным использованием бюджета):

Пример 1: Бюджет $45, 1 креатив БЕЗ scoring данных
→ ✅ Создать 1 adset с 1 креативом ($45/день = 4500 центов)
→ Причина: используем ВЕСЬ бюджет для быстрого получения данных

Пример 2: Бюджет $45, 2 креатива (low, medium)
→ Создать 1 adset с 2 креативами ($45/день = 4500 центов)
→ Причина: ВЕСЬ бюджет на A/B тест двух креативов

Пример 3: Бюджет $45, 4 креатива (2 low, 2 medium)
→ Создать 1 adset с 4 креативами ($45/день = 4500 центов)
→ Причина: 4 креатива - это нормально для одного adset, ВЕСЬ бюджет

Пример 4: Бюджет $50, 6 креативов (3 low, 3 medium)
→ Создать 3 adsets по 2 креатива:
   - Adset 1: $17 (1700 центов)
   - Adset 2: $17 (1700 центов)
   - Adset 3: $16 (1600 центов)
   - ИТОГО: $50 (5000 центов) ✅
→ Причина: делим креативы и ВЕСЬ бюджет поровну для разных тестов

Пример 5: Бюджет $100, 8 креативов (4 low, 4 medium)
→ Создать 2 adsets по 4 креатива:
   - Adset 1: $50 (5000 центов)
   - Adset 2: $50 (5000 центов)
   - ИТОГО: $100 (10000 центов) ✅
→ Причина: оптимально для тестирования двух групп с ПОЛНЫМ бюджетом

Пример 6: Бюджет $20, 3 креатива (1 low, 2 medium)
→ Создать 1 adset с 3 креативами ($20/день = 2000 центов)
→ Причина: используем ВЕСЬ доступный бюджет

🔥 КЛЮЧЕВОЕ ПРАВИЛО: Сумма daily_budget_cents всех adsets ВСЕГДА должна равняться direction_info.daily_budget_cents!
`;

// ========================================
// ФУНКЦИИ ДЛЯ СБОРА ДАННЫХ
// ========================================

/**
 * Получить активные кампании пользователя из Facebook API
 */
export async function getActiveCampaigns(adAccountId: string, accessToken: string) {
  log.info({ adAccountId }, 'Fetching active campaigns for ad account');

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/campaigns?fields=id,name,status,effective_status,daily_budget,created_time&limit=500&access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`Facebook API error: ${response.status}`);
    }

    const data = await response.json();
    const campaigns = data.data || [];

    // Логируем статусы всех кампаний для отладки
    log.debug({ campaigns: campaigns.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status
    })) }, 'Fetched campaigns statuses');

    // Фильтруем только активные (любые статусы содержащие ACTIVE)
    const activeCampaigns = campaigns.filter(
      (c: any) => {
        const statusStr = String(c.status || c.effective_status || '');
        return statusStr.includes('ACTIVE');
      }
    );

    log.info({
      total: campaigns.length,
      active: activeCampaigns.length,
      campaignIds: activeCampaigns.map((c: any) => c.id),
    }, 'Found active campaigns');

    return activeCampaigns.map((c: any) => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget,
      created_time: c.created_time,
    }));
  } catch (error: any) {
    log.error({ err: error, adAccountId }, 'Error fetching campaigns');
    throw new Error(`Failed to fetch campaigns: ${error.message}`);
  }
}

/**
 * Остановить активные кампании пользователя
 */
export async function pauseActiveCampaigns(
  campaigns: Array<{ campaign_id: string; name: string }>,
  accessToken: string
) {
  log.info({ campaignCount: campaigns.length }, 'Pausing active campaigns');

  const results = [];

  for (const campaign of campaigns) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${campaign.campaign_id}?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'PAUSED',
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();

      log.info({
        campaignId: campaign.campaign_id,
        newStatus: data.success,
      }, 'Paused campaign');

      results.push({
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        success: true,
      });
    } catch (error: any) {
      log.error({ err: error, campaignId: campaign.campaign_id }, 'Failed to pause campaign');
      results.push({
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        success: false,
        error: error.message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  log.info({
    total: campaigns.length,
    success: successCount,
    failed: campaigns.length - successCount,
  }, 'Paused campaigns result');

  return results;
}

export async function getActiveAdSets(
  campaignId: string,
  accessToken: string,
  retryCount = 0,
  skipCache = false
): Promise<Array<{ adset_id: string; name?: string; status?: string; effective_status?: string; optimized_goal?: string }>> {
  // Проверяем кэш (если не skipCache)
  if (!skipCache) {
    const cached = adSetsCache.get(campaignId);
    if (cached) {
      log.debug({ campaignId, count: cached.length }, 'Returning cached ad sets');
      return cached;
    }
  }

  log.info({ campaignId, retryCount }, 'Fetching active ad sets for campaign');

  const MAX_RETRIES = 5;
  const BASE_DELAY = 3000; // 3s base, exponential: 3s, 6s, 12s, 24s, 48s

  try {
    const url = `https://graph.facebook.com/${FB_API_VERSION}/${campaignId}/adsets?fields=id,name,status,effective_status,optimized_goal&limit=200&access_token=${accessToken}`;
    log.debug({ campaignId, retryCount, maxRetries: MAX_RETRIES }, '[getActiveAdSets] Fetching adsets');

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.text();

      // Rate limiting - retry с exponential backoff
      const isRateLimit = response.status === 400 &&
        (errorBody.includes('User request limit reached') || errorBody.includes('"code":17') || errorBody.includes('"code":4'));

      if (isRateLimit && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount); // 3s, 6s, 12s, 24s, 48s
        log.warn({
          campaignId,
          retryCount: retryCount + 1,
          maxRetries: MAX_RETRIES,
          delayMs: delay
        }, '[getActiveAdSets] Rate limited, retrying with exponential backoff...');
        await new Promise(resolve => setTimeout(resolve, delay));
        return getActiveAdSets(campaignId, accessToken, retryCount + 1, skipCache);
      }

      log.error({
        campaignId,
        status: response.status,
        retryCount,
        isRateLimit,
        errorBody: errorBody.substring(0, 300)
      }, '[getActiveAdSets] Failed after retries');

      throw new Error(`Facebook API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const adsets: Array<any> = data.data || [];

    const activeAdsets = adsets.filter((adset: any) => {
      const statusStr = String(adset.status || adset.effective_status || '');
      return statusStr.includes('ACTIVE');
    });

    log.info({ count: activeAdsets.length, campaignId }, 'Found active ad sets');

    const result = activeAdsets.map((adset: any) => ({
      adset_id: adset.id,
      name: adset.name,
      status: adset.status,
      effective_status: adset.effective_status,
      optimized_goal: adset.optimized_goal
    }));

    // Сохраняем в кэш
    adSetsCache.set(campaignId, result);

    return result;
  } catch (error: any) {
    log.error({ err: error, campaignId }, 'Error fetching ad sets');
    throw new Error(`Failed to fetch ad sets: ${error.message}`);
  }
}

export async function pauseAdSetsForCampaign(
  campaignId: string,
  accessToken: string
): Promise<number> {
  const startTime = Date.now();

  const adsets = await getActiveAdSets(campaignId, accessToken, 0, true); // skipCache для актуальных данных

  if (adsets.length === 0) {
    log.info({ campaignId, durationMs: Date.now() - startTime }, '[pauseAdSetsForCampaign] No active ad sets to pause');
    return 0;
  }

  log.info({
    campaignId,
    count: adsets.length,
    adsetIds: adsets.map(a => a.adset_id)
  }, '[pauseAdSetsForCampaign] Starting batch pause');

  // Используем batch API для паузы всех ad sets за один запрос
  const batchRequests: BatchRequest[] = adsets.map(adset => ({
    method: 'POST' as const,
    relative_url: adset.adset_id,
    body: 'status=PAUSED'
  }));

  try {
    const batchStartTime = Date.now();
    const responses = await graphBatch(accessToken, batchRequests);
    const batchDuration = Date.now() - batchStartTime;

    let pausedCount = 0;
    const errors: Array<{ adsetId: string; error: any; errorCode?: number }> = [];
    let rateLimitErrors = 0;

    responses.forEach((response, index) => {
      const adset = adsets[index];
      const parsed = parseBatchBody(response);

      if (parsed.success) {
        pausedCount++;
        log.debug({ adsetId: adset.adset_id, campaignId }, '[pauseAdSetsForCampaign] Paused ad set');
      } else {
        const errorCode = parsed.error?.code;
        if (errorCode === 17 || errorCode === 4) {
          rateLimitErrors++;
        }
        errors.push({ adsetId: adset.adset_id, error: parsed.error, errorCode });
        log.warn({
          adsetId: adset.adset_id,
          campaignId,
          errorCode,
          errorMessage: parsed.error?.message?.substring(0, 100)
        }, '[pauseAdSetsForCampaign] Failed to pause ad set in batch');
      }
    });

    // Инвалидируем кэш после изменений
    adSetsCache.invalidate(campaignId);

    const totalDuration = Date.now() - startTime;
    log.info({
      campaignId,
      pausedCount,
      totalAdsets: adsets.length,
      errorsCount: errors.length,
      rateLimitErrors,
      batchDurationMs: batchDuration,
      totalDurationMs: totalDuration,
      avgTimePerAdset: Math.round(batchDuration / adsets.length)
    }, '[pauseAdSetsForCampaign] Completed (batch)');

    return pausedCount;
  } catch (error: any) {
    const batchFailTime = Date.now() - startTime;
    log.error({
      err: error,
      campaignId,
      failedAfterMs: batchFailTime
    }, '[pauseAdSetsForCampaign] Batch failed, falling back to sequential with retry');

    // Fallback на последовательные запросы с exponential backoff
    let pausedCount = 0;
    const MAX_RETRIES = 3;
    const BASE_DELAY = 3000;

    for (let i = 0; i < adsets.length; i++) {
      const adset = adsets[i];
      let success = false;

      for (let retry = 0; retry < MAX_RETRIES && !success; retry++) {
        try {
          const response = await fetch(
            `https://graph.facebook.com/${FB_API_VERSION}/${adset.adset_id}?access_token=${accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'status=PAUSED',
            }
          );

          if (response.ok) {
            pausedCount++;
            success = true;
            log.debug({
              adsetId: adset.adset_id,
              campaignId,
              progress: `${i + 1}/${adsets.length}`
            }, '[pauseAdSetsForCampaign] Paused ad set (fallback)');
          } else {
            const errorText = await response.text();
            const isRateLimit = response.status === 400 &&
              (errorText.includes('User request limit reached') || errorText.includes('"code":17'));

            if (isRateLimit && retry < MAX_RETRIES - 1) {
              const delay = BASE_DELAY * Math.pow(2, retry);
              log.warn({
                adsetId: adset.adset_id,
                retry: retry + 1,
                maxRetries: MAX_RETRIES,
                delayMs: delay
              }, '[pauseAdSetsForCampaign] Rate limited, retrying with backoff');
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }

            log.warn({
              adsetId: adset.adset_id,
              campaignId,
              status: response.status,
              error: errorText.substring(0, 200)
            }, '[pauseAdSetsForCampaign] Failed to pause ad set (fallback)');
            break;
          }
        } catch (err: any) {
          if (retry < MAX_RETRIES - 1) {
            const delay = BASE_DELAY * Math.pow(2, retry);
            log.warn({
              err,
              adsetId: adset.adset_id,
              retry: retry + 1,
              delayMs: delay
            }, '[pauseAdSetsForCampaign] Network error, retrying');
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            log.error({
              err,
              adsetId: adset.adset_id,
              campaignId
            }, '[pauseAdSetsForCampaign] Failed after all retries');
          }
        }
      }
    }

    // Инвалидируем кэш после изменений
    adSetsCache.invalidate(campaignId);

    const totalDuration = Date.now() - startTime;
    log.info({
      campaignId,
      pausedCount,
      totalAdsets: adsets.length,
      failedCount: adsets.length - pausedCount,
      totalDurationMs: totalDuration,
      mode: 'fallback'
    }, '[pauseAdSetsForCampaign] Completed (fallback)');

    return pausedCount;
  }
}

/**
 * Получить доступные креативы пользователя с их скорингом
 */
export async function getAvailableCreatives(
  userAccountId: string,
  objective?: CampaignObjective,
  directionId?: string,
  accountId?: string
): Promise<AvailableCreative[]> {
  log.info({ userAccountId, directionId, accountId }, 'Fetching available creatives for direction');

  let creatives: any[];

  // Если указано направление - фильтруем креативы по нему
  if (directionId) {
    const { data, error: creativesError } = await supabase
      .from('user_creatives')
      .select(`
        id,
        user_id,
        title,
        fb_creative_id,
        fb_video_id,
        fb_creative_id_whatsapp,
        fb_creative_id_instagram_traffic,
        fb_creative_id_site_leads,
        fb_creative_id_lead_forms,
        status,
        is_active,
        created_at,
        updated_at,
        direction_id,
        media_type,
        fb_image_hash
      `)
      .eq('user_id', userAccountId)
      .eq('direction_id', directionId)
      .eq('status', 'ready')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (creativesError) {
      log.error({ err: creativesError, userAccountId, directionId, objective }, 'Error fetching direction creatives');
      throw new Error(`Failed to fetch creatives: ${creativesError.message}`);
    }

    if (!data || data.length === 0) {
      log.warn({ userAccountId, directionId, objective }, 'No ready creatives found for direction');
      return [];
    }

    log.info({ userAccountId, directionId, count: data.length }, 'Found ready creatives for direction');
    creatives = data;
  } else {
    // Legacy: получаем все креативы пользователя без фильтра по направлению
    const { data, error: creativesError } = await supabase
      .from('user_creatives')
      .select('*')
      .eq('user_id', userAccountId)
      .eq('status', 'ready')
      .is('direction_id', null)  // Только креативы БЕЗ направления
      .order('created_at', { ascending: false });

    if (creativesError) {
      log.error({ err: creativesError, userAccountId, objective }, 'Error fetching creatives');
      throw new Error(`Failed to fetch creatives: ${creativesError.message}`);
    }

    if (!data || data.length === 0) {
      log.warn({ userAccountId, objective }, 'No ready creatives found for user');
      return [];
    }

    log.info({ userAccountId, objective, count: data.length }, 'Found ready creatives (legacy)');
    creatives = data;
  }

  // Общая обработка для обоих случаев (с направлением и без)

  // Фильтруем по objective (если указан)
  let filteredCreatives = creatives;
  if (objective) {
    filteredCreatives = creatives.filter((c) => {
      switch (objective) {
        case 'whatsapp':
        case 'conversions':
          return !!c.fb_creative_id_whatsapp;
        case 'instagram_traffic':
          return !!c.fb_creative_id_instagram_traffic;
        case 'instagram_dm':
          return !!c.fb_creative_id_whatsapp;
        case 'site_leads':
          return !!c.fb_creative_id_site_leads;
        case 'lead_forms':
          return !!c.fb_creative_id_lead_forms;
        case 'app_installs':
          return !!c.fb_creative_id;
        default:
          return false;
      }
    });
    if (objective === 'app_installs') {
      const creativesWithoutUnifiedId = creatives
        .filter((c) => !c.fb_creative_id)
        .map((c) => c.id);
      if (creativesWithoutUnifiedId.length > 0) {
        log.warn({
          objective,
          totalCreatives: creatives.length,
          withoutUnifiedCreativeId: creativesWithoutUnifiedId.length,
          sampleCreativeIds: creativesWithoutUnifiedId.slice(0, 5),
        }, 'App installs creatives must have unified fb_creative_id; some creatives are missing it');
      }
    }
    log.info({ count: filteredCreatives.length, objective }, 'Filtered creatives for objective');
  }

  // Получаем user_creative_id для запроса метрик через ad_creative_mapping
  const userCreativeIds = filteredCreatives.map((c) => c.id);

  // Получаем fb_creative_id для каждого креатива (для creative_scores)
  const fbCreativeIds = filteredCreatives.map((c) => {
    switch (objective) {
      case 'whatsapp':
      case 'conversions':
      case 'instagram_dm':
        return c.fb_creative_id_whatsapp;
      case 'instagram_traffic':
        return c.fb_creative_id_instagram_traffic;
      case 'site_leads':
        return c.fb_creative_id_site_leads;
      case 'lead_forms':
        return c.fb_creative_id_lead_forms;
      case 'app_installs':
        return c.fb_creative_id;
      default:
        return null;
    }
  }).filter(Boolean) as string[];

  // 1. Пытаемся получить из creative_scores (если есть)
  const { data: scores } = await supabase
    .from('creative_scores')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('level', 'creative')
    .in('creative_id', fbCreativeIds)
    .order('date', { ascending: false });

  // 2. Получаем метрики через ad_creative_mapping (НОВАЯ ЛОГИКА!)
  // user_creative_id → ad_creative_mapping → ad_id → creative_metrics_history
  const metricsMap = await getCreativeMetrics(userAccountId, userCreativeIds, accountId);

  log.info({
    fromDB: metricsMap.size,
    withoutMetrics: userCreativeIds.length - metricsMap.size,
    total: userCreativeIds.length
  }, 'Metrics loaded from DB via ad_creative_mapping');


  // Объединяем креативы со скорами и метриками
  const result: AvailableCreative[] = filteredCreatives.map((creative) => {
    let fbCreativeId: string | null = null;
    switch (objective) {
      case 'whatsapp':
      case 'conversions':
      case 'instagram_dm':
        fbCreativeId = creative.fb_creative_id_whatsapp;
        break;
      case 'instagram_traffic':
        fbCreativeId = creative.fb_creative_id_instagram_traffic;
        break;
      case 'site_leads':
        fbCreativeId = creative.fb_creative_id_site_leads;
        break;
      case 'lead_forms':
        fbCreativeId = creative.fb_creative_id_lead_forms;
        break;
      case 'app_installs':
        fbCreativeId = creative.fb_creative_id;
        break;
    }

    const score = scores?.find((s) => s.creative_id === fbCreativeId);
    // Теперь метрики ищем по user_creative_id (creative.id), а не по fb_creative_id
    const metrics = metricsMap.get(creative.id);

    return {
      user_creative_id: creative.id,
      title: creative.title,
      fb_creative_id: creative.fb_creative_id || null,
      fb_creative_id_whatsapp: creative.fb_creative_id_whatsapp,
      fb_creative_id_instagram_traffic: creative.fb_creative_id_instagram_traffic,
      fb_creative_id_site_leads: creative.fb_creative_id_site_leads,
      fb_creative_id_lead_forms: creative.fb_creative_id_lead_forms,
      created_at: creative.created_at,
      // Scoring data
      risk_score: score?.risk_score,
      risk_level: score?.risk_level,
      creative_score: score?.creative_score,
      recommendations: score?.recommendations,
      // Performance metrics - ТЕПЕРЬ ЗАПОЛНЕНО!
      performance: metrics || null,
    };
  });

  log.info({ 
    count: result.length,
    withMetrics: result.filter(r => r.performance).length 
  }, 'Prepared creatives with metrics');

  return result;
}

/**
 * Получить бюджетные ограничения пользователя
 */
export async function getBudgetConstraints(
  userAccountId: string, 
  directionId?: string
): Promise<BudgetConstraints> {
  log.info({ userAccountId, directionId }, 'Fetching budget constraints');

  // Если указано направление - берём бюджет и CPL из него
  if (directionId) {
    const { data: direction, error: directionError } = await supabase
      .from('account_directions')
      .select('daily_budget_cents, target_cpl_cents')
      .eq('id', directionId)
      .single();

    if (directionError || !direction) {
      log.error({ err: directionError, directionId }, 'Error fetching direction budget constraints');
      throw new Error(`Failed to fetch direction: ${directionError?.message || 'not found'}`);
    }

    const planDailyBudget = direction.daily_budget_cents;
    const targetCpl = direction.target_cpl_cents;

    const constraints: BudgetConstraints = {
      plan_daily_budget_cents: planDailyBudget,
      available_budget_cents: planDailyBudget,
      default_cpl_target_cents: targetCpl,
      min_budget_per_campaign_cents: 1000, // $10/день минимум
      max_budget_per_campaign_cents: Math.min(30000, planDailyBudget),
    };

    log.info({
      directionId,
      dailyBudgetCents: direction.daily_budget_cents,
      targetCplCents: direction.target_cpl_cents,
    }, 'Direction budget constraints loaded');

    return constraints;
  }

  // Legacy: берём из user_accounts (если направление не указано)
  const { data: userAccount, error } = await supabase
    .from('user_accounts')
    .select('plan_daily_budget_cents, default_cpl_target_cents')
    .eq('id', userAccountId)
    .single();

  if (error || !userAccount) {
    log.error({ err: error, userAccountId }, 'Error fetching user account for budget constraints');
    throw new Error(`Failed to fetch user account: ${error?.message || 'not found'}`);
  }

  const planDailyBudget = userAccount.plan_daily_budget_cents || 5000000; // $500/день дефолт
  const targetCpl = userAccount.default_cpl_target_cents || 200; // $2 дефолт

  // Считаем доступный бюджет (упрощенная логика, можно расширить)
  // TODO: учитывать текущие активные кампании и их бюджеты
  const availableBudget = planDailyBudget;

  const constraints: BudgetConstraints = {
    plan_daily_budget_cents: planDailyBudget,
    available_budget_cents: availableBudget,
    default_cpl_target_cents: targetCpl,
    min_budget_per_campaign_cents: 1000, // $10/день минимум (для одного adset)
    max_budget_per_campaign_cents: Math.min(30000, planDailyBudget), // Максимум $300 или план
  };

  log.info({ constraints: constraints }, 'Budget constraints resolved');

  return constraints;
}

/**
 * Preprocessing: сортирует и фильтрует креативы для LLM
 * Чтобы не передавать 50+ креативов со всеми метриками
 *
 * Приоритет:
 * 1. Хорошие с метриками (CPL <= 130% от планового)
 * 2. Новые без метрик (нужно тестировать)
 * 3. Плохие с метриками (CPL > 130% от планового)
 */
function preprocessCreativesForLLM(
  creatives: AvailableCreative[],
  maxCreatives: number = 20,
  targetCplCents?: number
): {
  filtered_creatives: AvailableCreative[];
  aggregated_metrics: {
    total_creatives_count: number;
    creatives_with_performance: number;
    avg_cpl_cents: number | null;
    median_ctr: number | null;
    avg_cpm_cents: number | null;
    best_cpl_cents: number | null;
    worst_cpl_cents: number | null;
  };
} {
  log.info({ total: creatives.length, maxCreatives, targetCplCents }, 'Preprocessing creatives for LLM');

  // Порог "хорошего" CPL = 130% от планового
  const goodCplThreshold = targetCplCents ? targetCplCents * 1.3 : null;

  // Разделяем на креативы с и без performance данных
  const withPerformance = creatives.filter(c => c.performance !== null);
  const withoutPerformance = creatives.filter(c => c.performance === null);

  // Разделяем креативы с метриками на хорошие и плохие по CPL
  let goodPerformance: AvailableCreative[] = [];
  let poorPerformance: AvailableCreative[] = [];

  if (goodCplThreshold) {
    // Есть плановый CPL — разделяем по порогу 130%
    goodPerformance = withPerformance.filter(c => {
      const cpl = c.performance?.avg_cpl;
      // Если нет CPL (нет лидов) — считаем нейтральным, идёт в хорошие
      if (!cpl) return true;
      return cpl <= goodCplThreshold;
    });
    poorPerformance = withPerformance.filter(c => {
      const cpl = c.performance?.avg_cpl;
      if (!cpl) return false;
      return cpl > goodCplThreshold;
    });
  } else {
    // Нет планового CPL — все с метриками считаем хорошими
    goodPerformance = withPerformance;
    poorPerformance = [];
  }

  log.info({
    withPerformance: withPerformance.length,
    goodPerformance: goodPerformance.length,
    poorPerformance: poorPerformance.length,
    withoutPerformance: withoutPerformance.length,
    goodCplThreshold
  }, 'Creatives split by performance and CPL threshold');

  // Сортируем хорошие креативы по приоритету (лучший CPL первым)
  goodPerformance.sort((a, b) => {
    const aCpl = a.performance?.avg_cpl;
    const bCpl = b.performance?.avg_cpl;
    const aCtr = a.performance?.avg_ctr || 0;
    const bCtr = b.performance?.avg_ctr || 0;

    // Приоритет 1: CPL (меньше лучше)
    if (aCpl && bCpl) return aCpl - bCpl;
    if (aCpl && !bCpl) return -1;
    if (!aCpl && bCpl) return 1;

    // Приоритет 2: CTR (больше лучше)
    return bCtr - aCtr;
  });

  // Сортируем плохие (менее плохие первыми)
  poorPerformance.sort((a, b) => {
    const aCpl = a.performance?.avg_cpl || 999999;
    const bCpl = b.performance?.avg_cpl || 999999;
    return aCpl - bCpl;
  });

  // Вычисляем агрегированные метрики ДО фильтрации
  const cpls = withPerformance
    .map(c => c.performance?.avg_cpl)
    .filter((cpl): cpl is number => cpl !== null && cpl !== undefined);

  const ctrs = withPerformance
    .map(c => c.performance?.avg_ctr)
    .filter((ctr): ctr is number => ctr !== null && ctr !== undefined);

  const cpms = withPerformance
    .map(c => c.performance?.avg_cpm)
    .filter((cpm): cpm is number => cpm !== null && cpm !== undefined);

  const aggregatedMetrics = {
    total_creatives_count: creatives.length,
    creatives_with_performance: withPerformance.length,
    avg_cpl_cents: cpls.length > 0 ? Math.round(cpls.reduce((a, b) => a + b, 0) / cpls.length) : null,
    median_ctr: ctrs.length > 0 ? ctrs.sort((a, b) => a - b)[Math.floor(ctrs.length / 2)] : null,
    avg_cpm_cents: cpms.length > 0 ? Math.round(cpms.reduce((a, b) => a + b, 0) / cpms.length) : null,
    best_cpl_cents: cpls.length > 0 ? Math.min(...cpls) : null,
    worst_cpl_cents: cpls.length > 0 ? Math.max(...cpls) : null,
  };

  log.info({ aggregatedMetrics }, 'Aggregated metrics calculated');

  // Формируем финальный список с приоритетом:
  // 1. Хорошие с метриками (CPL <= 130% от планового)
  // 2. Новые без метрик (нужно тестировать)
  // 3. Плохие с метриками (CPL > 130% от планового)

  const result: AvailableCreative[] = [];
  let remainingSlots = maxCreatives;

  // 1. Добавляем все хорошие
  const goodToAdd = goodPerformance.slice(0, remainingSlots);
  result.push(...goodToAdd);
  remainingSlots -= goodToAdd.length;

  // 2. Добавляем новые
  if (remainingSlots > 0) {
    const newToAdd = withoutPerformance.slice(0, remainingSlots);
    result.push(...newToAdd);
    remainingSlots -= newToAdd.length;
  }

  // 3. Добавляем плохие (если остались слоты)
  if (remainingSlots > 0) {
    const poorToAdd = poorPerformance.slice(0, remainingSlots);
    result.push(...poorToAdd);
  }

  const newAdded = Math.min(withoutPerformance.length, maxCreatives - goodToAdd.length);
  const poorAdded = result.length - goodToAdd.length - newAdded;

  log.info({
    filtered: result.length,
    good: goodToAdd.length,
    new: newAdded,
    poor: poorAdded
  }, 'Creatives filtered for LLM (priority: good → new → poor)');

  return {
    filtered_creatives: result,
    aggregated_metrics: aggregatedMetrics
  };
}

/**
 * Получает метрики из БД для списка креативов через ad_creative_mapping
 *
 * НОВАЯ ЛОГИКА (как в ROI Analytics):
 * 1. user_creative_id → ad_creative_mapping → ad_id
 * 2. ad_id → creative_metrics_history → метрики
 * 3. Агрегирует метрики всех ads для каждого креатива
 *
 * @param userAccountId - ID пользователя
 * @param userCreativeIds - массив UUID креативов (user_creatives.id)
 * @param accountId - ID рекламного аккаунта (для мультиаккаунтности)
 * @returns Map<user_creative_id, metrics>
 */
export async function getCreativeMetrics(
  userAccountId: string,
  userCreativeIds: string[],
  accountId?: string
): Promise<Map<string, any>> {
  if (userCreativeIds.length === 0) return new Map();

  log.debug({
    userCreativeIds: userCreativeIds.length,
    accountId
  }, 'Fetching creative metrics via ad_creative_mapping');

  // Шаг 1: Получить все ad_id для креативов через ad_creative_mapping
  const { data: mappings, error: mappingError } = await supabase
    .from('ad_creative_mapping')
    .select('user_creative_id, ad_id')
    .in('user_creative_id', userCreativeIds);

  if (mappingError) {
    log.error({ err: mappingError }, 'Error fetching ad_creative_mapping');
    return new Map();
  }

  if (!mappings || mappings.length === 0) {
    log.debug('No ad mappings found for creatives');
    return new Map();
  }

  // Создаём связь ad_id → user_creative_id
  const adToCreativeMap = new Map<string, string>();
  for (const m of mappings) {
    adToCreativeMap.set(m.ad_id, m.user_creative_id);
  }

  const adIds = mappings.map(m => m.ad_id);
  log.debug({ adIds: adIds.length, mappings: mappings.length }, 'Found ad mappings');

  // Шаг 2: Получить метрики за последние 7 дней (агрегируем для LLM)
  const dateCutoff = new Date();
  dateCutoff.setDate(dateCutoff.getDate() - 7);
  const cutoffDate = dateCutoff.toISOString().split('T')[0];

  let query = supabase
    .from('creative_metrics_history')
    .select('*')
    .in('ad_id', adIds)
    .eq('user_account_id', userAccountId)
    .gte('date', cutoffDate);

  // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
  if (await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
    query = query.eq('account_id', accountId);
  }

  const { data: metrics, error: metricsError } = await query;

  if (metricsError) {
    log.error({ err: metricsError }, 'Error fetching metrics from creative_metrics_history');
    return new Map();
  }

  if (!metrics || metrics.length === 0) {
    log.debug('No metrics found in creative_metrics_history');
    return new Map();
  }

  log.debug({ count: metrics.length }, 'Found metrics in DB');

  // Шаг 3: Агрегируем метрики по user_creative_id
  const aggregated = new Map<string, {
    impressions: number;
    reach: number;
    spend: number;
    clicks: number;
    link_clicks: number;
    leads: number;
    frequency: number;
    count: number;
    latestDate: string;
  }>();

  for (const metric of metrics) {
    const userCreativeId = adToCreativeMap.get(metric.ad_id);
    if (!userCreativeId) continue;

    if (!aggregated.has(userCreativeId)) {
      aggregated.set(userCreativeId, {
        impressions: 0,
        reach: 0,
        spend: 0,
        clicks: 0,
        link_clicks: 0,
        leads: 0,
        frequency: 0,
        count: 0,
        latestDate: metric.date
      });
    }

    const agg = aggregated.get(userCreativeId)!;
    agg.impressions += metric.impressions || 0;
    agg.reach += metric.reach || 0;
    agg.spend += metric.spend_cents || metric.spend || 0; // spend_cents или spend
    agg.clicks += metric.clicks || 0;
    agg.link_clicks += metric.link_clicks || 0;
    agg.leads += metric.leads || 0;
    agg.frequency += metric.frequency || 0;
    agg.count += 1;
    if (metric.date > agg.latestDate) {
      agg.latestDate = metric.date;
    }
  }

  // Шаг 4: Вычисляем средние метрики
  const metricsMap = new Map();
  for (const [userCreativeId, agg] of aggregated) {
    const avgFrequency = agg.count > 0 ? agg.frequency / agg.count : 0;
    const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
    const cpl = agg.leads > 0 ? agg.spend / agg.leads : null;

    metricsMap.set(userCreativeId, {
      impressions: agg.impressions,
      reach: agg.reach,
      spend: agg.spend,
      clicks: agg.clicks,
      link_clicks: agg.link_clicks,
      leads: agg.leads,
      ctr: parseFloat(ctr.toFixed(2)),
      cpm: parseFloat(cpm.toFixed(2)),
      cpl: cpl ? parseFloat(cpl.toFixed(2)) : null,
      frequency: parseFloat(avgFrequency.toFixed(2)),
      date: agg.latestDate
    });
  }

  log.info({
    fromDB: metricsMap.size,
    requested: userCreativeIds.length,
    adMappings: mappings.length
  }, 'Loaded metrics from DB via ad_creative_mapping');

  return metricsMap;
}

/**
 * Легкая версия scoring - получает метрики только для нужных креативов
 * 
 * АЛГОРИТМ (как в agent-brain):
 * 1. Найти все ads использующие этот creative
 * 2. Получить insights для каждого ad
 * 3. Агрегировать метрики
 */
export async function fetchCreativeInsightsLight(
  adAccountId: string,
  accessToken: string,
  fbCreativeId: string
): Promise<any | null> {
  try {
    const normalizedAdAccountId = adAccountId.startsWith('act_') 
      ? adAccountId 
      : `act_${adAccountId}`;
    
    // ШАГ 1: Найти все ads использующие этот creative
    const adsUrl = `https://graph.facebook.com/v20.0/${normalizedAdAccountId}/ads`;
    const adsParams = new URLSearchParams({
      fields: 'id,name,status,effective_status,creative{id}',
      limit: '500',
      access_token: accessToken
    });
    
    const adsRes = await fetch(`${adsUrl}?${adsParams.toString()}`);
    if (!adsRes.ok) {
      log.warn({ fbCreativeId, status: adsRes.status }, 'Failed to fetch ads');
      return null;
    }
    
    const adsJson = await adsRes.json();
    const allAds = adsJson.data || [];
    
    // Фильтруем ads с нашим creative_id
    const adsWithCreative = allAds.filter((ad: any) => ad.creative?.id === fbCreativeId);
    
    if (adsWithCreative.length === 0) {
      log.info({ fbCreativeId, totalAds: allAds.length }, 'No ads found using this creative');
      return null;
    }
    
    log.info({ 
      fbCreativeId, 
      adsFound: adsWithCreative.length 
    }, 'Found ads with creative');
    
    // ШАГ 2: Получить insights для каждого ad
    const fields = [
      'impressions',
      'reach',
      'spend',
      'ctr',
      'cpm',
      'frequency',
      'clicks',
      'actions'
    ].join(',');
    
    const allInsights: any[] = [];
    
    // OPTIMIZATION: Запускаем запросы к Ads параллельно
    const insightPromises = adsWithCreative.map(async (ad: any) => {
      const insightsUrl = `https://graph.facebook.com/v20.0/${ad.id}/insights`;
      const insightsParams = new URLSearchParams({
        fields,
        date_preset: 'last_30d',
        access_token: accessToken
      });
      
      try {
        const insightsRes = await fetch(`${insightsUrl}?${insightsParams.toString()}`);
        if (insightsRes.ok) {
          const insightsJson = await insightsRes.json();
          if (insightsJson.data && insightsJson.data.length > 0) {
            return insightsJson.data; // Возвращаем массив данных
          }
        }
      } catch (error: any) {
        log.warn({ adId: ad.id, error: error.message }, 'Failed to fetch ad insights');
      }
      return []; // Возвращаем пустой массив при ошибке
    });

    // Ждем всех
    const results = await Promise.all(insightPromises);
    
    // Собираем все результаты в один массив
    results.forEach(data => {
      if (data && data.length > 0) {
        allInsights.push(...data);
      }
    });
    
    if (allInsights.length === 0) {
      log.info({ fbCreativeId, adsChecked: adsWithCreative.length }, 'No insights found for ads');
      return null;
    }
    
    // ШАГ 3: Агрегируем метрики
    const aggregated = {
      impressions: 0,
      reach: 0,
      spend: 0,
      clicks: 0,
      frequency: 0,
      leads: 0
    };
    
    for (const insight of allInsights) {
      aggregated.impressions += parseInt(insight.impressions || 0);
      aggregated.reach += parseInt(insight.reach || 0);
      aggregated.spend += parseFloat(insight.spend || 0);
      aggregated.clicks += parseInt(insight.clicks || 0);
      
      // Извлекаем leads из actions
      const actions = insight.actions || [];
      const leadAction = actions.find((a: any) => a.action_type === 'lead');
      if (leadAction) {
        aggregated.leads += parseInt(leadAction.value || 0);
      }
    }
    
    // Рассчитываем средние метрики
    const ctr = aggregated.impressions > 0 
      ? (aggregated.clicks / aggregated.impressions) * 100 
      : 0;
      
    const cpm = aggregated.impressions > 0 
      ? (aggregated.spend / aggregated.impressions) * 1000 
      : 0;
      
    const cpl = aggregated.leads > 0 
      ? aggregated.spend / aggregated.leads 
      : null;
    
    log.info({
      fbCreativeId,
      adsProcessed: adsWithCreative.length,
      insightsRecords: allInsights.length,
      aggregated: {
        impressions: aggregated.impressions,
        spend: aggregated.spend,
        leads: aggregated.leads,
        cpl
      }
    }, 'Creative insights aggregated');
    
    return {
      impressions: aggregated.impressions,
      reach: aggregated.reach,
      spend: aggregated.spend,
      ctr: parseFloat(ctr.toFixed(2)),
      cpm: parseFloat(cpm.toFixed(2)),
      clicks: aggregated.clicks,
      leads: aggregated.leads,
      cpl: cpl ? parseFloat(cpl.toFixed(2)) : null
    };
  } catch (error: any) {
    log.error({ err: error, fbCreativeId }, 'Error fetching creative insights');
    return null;
  }
}

// ========================================
// LLM INTERACTION
// ========================================

/**
 * Вызов LLM для формирования action для создания кампании
 */
export async function buildCampaignAction(input: CampaignBuilderInput): Promise<CampaignAction> {
  const { user_account_id, objective, direction_id, campaign_name, requested_budget_cents, additional_context } = input;

  const { data: userAccountProfile } = await supabase
    .from('user_accounts')
    .select('username, default_adset_mode')
    .eq('id', user_account_id)
    .single();

  // НОВОЕ: Получить информацию о направлении
  let directionInfo = null;
  
  if (direction_id) {
    const { data: direction } = await supabase
      .from('account_directions')
      .select('*')
      .eq('id', direction_id)
      .single();
    
    if (direction) {
      directionInfo = {
        id: direction.id,
        name: direction.name,
        objective: direction.objective,
        daily_budget_cents: direction.daily_budget_cents,
        fb_campaign_id: direction.fb_campaign_id,
        adset_mode: userAccountProfile?.default_adset_mode || 'api_create'
      };
    }
  }

  const availableCreatives = await getAvailableCreatives(user_account_id, objective, direction_id);
  const budgetConstraints = await getBudgetConstraints(user_account_id, direction_id);

  if (availableCreatives.length === 0) {
    throw new Error('No ready creatives available for this objective');
  }

  log.info({
    userAccountId: user_account_id,
    userAccountName: userAccountProfile?.username,
    objective,
    directionId: direction_id,
    creativeCount: availableCreatives.length,
    withMetrics: availableCreatives.filter(c => c.performance).length,
    requestedBudgetCents: requested_budget_cents,
  }, 'Building campaign action with metrics');

  // Preprocessing: фильтруем и сортируем креативы для LLM
  // Увеличен лимит до 50 чтобы LLM мог распределить все креативы по адсетам
  // Передаём плановый CPL для определения хороших/плохих креативов (порог 130%)
  const maxCreativesForLLM = Math.min(50, availableCreatives.length);
  const targetCplCents = budgetConstraints.default_cpl_target_cents;
  const { filtered_creatives, aggregated_metrics } = preprocessCreativesForLLM(availableCreatives, maxCreativesForLLM, targetCplCents);

  log.info({
    original_count: availableCreatives.length,
    filtered_count: filtered_creatives.length,
    aggregated: aggregated_metrics
  }, 'Creatives preprocessed for LLM');

  const llmInput = {
    available_creatives: filtered_creatives.map((c) => ({
      user_creative_id: c.user_creative_id,
      title: c.title,
      created_at: c.created_at,
      risk_score: c.risk_score,
      risk_level: c.risk_level,
      creative_score: c.creative_score,
      recommendations: c.recommendations,
      performance: c.performance,
    })),
    aggregated_metrics, // НОВОЕ: агрегированные метрики для контекста
    budget_constraints: {
      available_budget_cents: budgetConstraints.available_budget_cents,
      available_budget_usd: budgetConstraints.available_budget_cents / 100,
      min_budget_cents: budgetConstraints.min_budget_per_campaign_cents,
      min_budget_usd: budgetConstraints.min_budget_per_campaign_cents / 100,
      max_budget_cents: budgetConstraints.max_budget_per_campaign_cents,
      max_budget_usd: budgetConstraints.max_budget_per_campaign_cents / 100,
      target_cpl_cents: budgetConstraints.default_cpl_target_cents,
      target_cpl_usd: budgetConstraints.default_cpl_target_cents / 100,
    },
    direction_info: directionInfo, // НОВОЕ!
    objective: objectiveToLLMFormat(objective),
    requested_campaign_name: campaign_name,
    requested_budget_cents,
    user_context: additional_context,
  };

  log.info({
    creativesCount: llmInput.available_creatives.length,
    budgetConstraints: llmInput.budget_constraints,
    direction_info: llmInput.direction_info,
    creatives: llmInput.available_creatives,
  }, 'LLM input prepared (FULL DATA)');

  // Вызов OpenAI API
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const model = process.env.CAMPAIGN_BUILDER_MODEL || 'gpt-4o';

  log.info({ model }, 'Calling OpenAI API');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: CAMPAIGN_BUILDER_SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Сформируй план кампании на основе этих данных:\n\n${JSON.stringify(llmInput, null, 2)}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error({ status: response.status, body: errorText, resolution: resolveFacebookError({ status: response.status }) }, 'OpenAI API error');
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const apiResponse = await response.json();
  log.info({ 
    rawResponse: apiResponse 
  }, 'OpenAI API response received (RAW)');

  // Извлекаем текст из Responses API
  const message = apiResponse.output?.find((o: any) => o.type === 'message');
  const textContent = message?.content?.find((c: any) => c.type === 'output_text');
  const rawText = textContent?.text || '';

  if (!rawText) {
    log.error('Empty response from LLM');
    throw new Error('Empty response from LLM');
  }

  log.debug({ preview: rawText.substring(0, 500) }, 'LLM response preview');

  // Парсим JSON
  let action: any;
  try {
    // Ищем JSON в ответе (на случай если есть markdown обертка)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    action = JSON.parse(jsonMatch[0]);
  } catch (parseError: any) {
    log.error({ err: parseError }, 'Failed to parse LLM response');
    throw new Error(`Failed to parse LLM response: ${parseError.message}`);
  }

  // Проверяем на ошибку
  if (action.error) {
    log.warn({ llmError: action.error }, 'LLM returned error');
    throw new Error(`Campaign Builder: ${action.error}`);
  }

  // Валидация action
  const validActionTypes = [
    'CreateCampaignWithCreative',
    'CreateMultipleAdSets',
    'Direction.CreateAdSetWithCreatives',
    'Direction.CreateMultipleAdSets',
    'Direction.UseExistingAdSetWithCreatives',
    'Direction.UseMultipleExistingAdSets'
  ];
  
  if (!validActionTypes.includes(action.type)) {
    log.error({ action }, 'Invalid action type from LLM');
    throw new Error('LLM returned invalid action type');
  }

  if (!action.params) {
    log.error({ action }, 'Invalid action structure from LLM');
    throw new Error('Invalid action structure from LLM');
  }
  
  // Для Direction actions проверяем direction_id
  if (action.type.startsWith('Direction.')) {
    if (!action.params.direction_id) {
      log.error({ action }, 'Direction action missing direction_id');
      throw new Error('Direction action must have direction_id');
    }
  } else {
    // Для legacy actions проверяем campaign_name
    if (!action.params.campaign_name) {
      log.error({ action }, 'Legacy action missing campaign_name');
      throw new Error('Legacy action must have campaign_name');
    }
  }

  // Валидация для single adset
  if (action.type === 'CreateCampaignWithCreative') {
    if (!action.params.user_creative_ids || !action.params.objective || !action.params.daily_budget_cents) {
      log.error({ params: action.params }, 'Invalid single adset params');
      throw new Error('Invalid single adset params from LLM');
    }
    if (action.params.user_creative_ids.length === 0) {
      throw new Error('No creatives selected by LLM');
    }
    if (action.params.daily_budget_cents < 500) {
      throw new Error('Budget less than minimum $5 per adset');
    }
    // Убедимся что objective в правильном формате (на случай если LLM вернул в другом регистре)
    action.params.objective = objectiveToLLMFormat(objective);
  }

  // Валидация для multiple adsets
  if (action.type === 'CreateMultipleAdSets') {
    if (!action.params.adsets || action.params.adsets.length === 0) {
      throw new Error('No adsets defined for CreateMultipleAdSets');
    }
    for (const adset of action.params.adsets) {
      if (!adset.user_creative_ids || adset.user_creative_ids.length === 0) {
        throw new Error('Adset has no creatives');
      }
      if (adset.daily_budget_cents < 500) {
        throw new Error(`Adset budget less than minimum $5: ${adset.adset_name}`);
      }
    }
  }

  if (action.type === 'CreateCampaignWithCreative') {
    log.info({ adsetCount: action.params.adsets?.length || 0 }, 'Campaign action created (single adset)');
  } else {
    log.info({ adsetCount: action.params.adsets?.length || 0 }, 'Campaign action created (multiple adsets)');
  }

  return action as CampaignAction;
}

// ========================================
// HELPERS
// ========================================

/**
 * Конвертировать campaign action в envelope для POST /agent/actions
 */
export function convertActionToEnvelope(
  action: CampaignAction, 
  userAccountId: string, 
  objective: CampaignObjective,
  whatsappPhoneNumber?: string
) {
  const idempotencyKey = `campaign-builder-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Для single adset - один action
  if (action.type === 'CreateCampaignWithCreative') {
    return {
      idempotencyKey,
      account: {
        userAccountId,
        ...(whatsappPhoneNumber && { whatsappPhoneNumber }),
      },
      actions: [
        {
          type: action.type,
          params: action.params,
        },
      ],
      source: 'campaign-builder',
    };
  }

  // Для multiple adsets - генерируем несколько actions CreateCampaignWithCreative
  // Каждый adset создается как отдельная кампания
  if (action.type === 'CreateMultipleAdSets' && action.params.adsets) {
    const actions = action.params.adsets.map((adset, index) => ({
      type: 'CreateCampaignWithCreative' as const,
      params: {
        user_creative_ids: adset.user_creative_ids,
        objective: objectiveToLLMFormat(objective), // Конвертируем в формат для actions
        campaign_name: `${action.params.campaign_name} - ${adset.adset_name}`,
        daily_budget_cents: adset.daily_budget_cents,
        use_default_settings: action.params.use_default_settings ?? true,
        auto_activate: action.params.auto_activate ?? true,
      },
    }));

    return {
      idempotencyKey,
      account: {
        userAccountId,
        ...(whatsappPhoneNumber && { whatsappPhoneNumber }),
      },
      actions,
      source: 'campaign-builder',
    };
  }

  throw new Error('Invalid action type for envelope conversion');
}

// ========================================
// ФУНКЦИИ ДЛЯ AUTO-LAUNCH-V2 (РАБОТА С НАПРАВЛЕНИЯМИ)
// ========================================

/**
 * @deprecated Moved to settingsHelpers.ts - use getDirectionSettings() instead
 * This export is kept for backward compatibility only
 */
export { getDirectionSettings as getDefaultSettings } from './settingsHelpers.js';

/**
 * @deprecated Moved to settingsHelpers.ts - use buildTargeting() from there instead
 * This export is kept for backward compatibility only
 */
export { buildTargeting } from './settingsHelpers.js';

/**
 * Получить optimization_goal для objective
 */
export function getOptimizationGoal(objective: CampaignObjective): string {
  switch (objective) {
    case 'whatsapp':
      return 'CONVERSATIONS';
    case 'conversions':
      return 'OFFSITE_CONVERSIONS';
    case 'instagram_traffic':
      return 'LINK_CLICKS';
    case 'site_leads':
      return 'OFFSITE_CONVERSIONS';
    case 'lead_forms':
      return 'LEAD_GENERATION';
    case 'app_installs':
      return 'APP_INSTALLS';
    case 'instagram_dm':
      return 'CONVERSATIONS';
    default:
      return 'CONVERSATIONS';
  }
}

/**
 * Получить billing_event для objective
 */
export function getBillingEvent(objective: CampaignObjective): string {
  switch (objective) {
    case 'whatsapp':
      return 'IMPRESSIONS';
    case 'conversions':
      return 'IMPRESSIONS';
    case 'instagram_traffic':
      return 'IMPRESSIONS';
    case 'site_leads':
      return 'IMPRESSIONS';
    case 'lead_forms':
      return 'IMPRESSIONS';
    case 'app_installs':
      return 'IMPRESSIONS';
    default:
      return 'IMPRESSIONS';
  }
}

/**
 * Создать Ad Set в существующей кампании
 */
export async function createAdSetInCampaign(params: {
  campaignId: string;
  adAccountId: string;
  accessToken: string;
  name: string;
  dailyBudget: number;
  targeting: any;
  optimization_goal: string;
  billing_event: string;
  promoted_object?: any;
  start_mode?: 'now' | 'midnight_almaty';
  objective?: CampaignObjective; // Добавлен для различения conversions от site_leads
  advantageAudienceEnabled?: boolean;
  customAudienceId?: string | null;
}) {
  const {
    campaignId,
    adAccountId,
    accessToken,
    name,
    dailyBudget,
    targeting,
    optimization_goal,
    billing_event,
    promoted_object,
    objective,
    advantageAudienceEnabled,
    customAudienceId,
  } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const finalTargeting = applyDirectionAudienceControls(targeting, {
    advantageAudienceEnabled,
    customAudienceId,
  });

  log.info({ campaignId, name, dailyBudget, optimizationGoal: optimization_goal }, 'Creating ad set in campaign');

  // Ближайшая полночь Asia/Almaty (+05:00)
  function formatWithOffset(date: Date, offsetMin: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const oh = pad(Math.floor(abs / 60));
    const om = pad(abs % 60);
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
  }
  const tzOffsetMin = 5 * 60;
  const nowUtcMs = Date.now() + (new Date().getTimezoneOffset() * 60000);
  const localNow = new Date(nowUtcMs + tzOffsetMin * 60000);
  let m = new Date(localNow);
  m.setHours(0, 0, 0, 0);
  if (m <= localNow) m = new Date(m.getTime() + 24 * 60 * 60 * 1000);
  const start_time = formatWithOffset(m, tzOffsetMin);

  const body: any = {
    access_token: accessToken,
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudget,
    billing_event,
    optimization_goal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: finalTargeting,
    status: 'ACTIVE',
  };

  if ((params.start_mode || 'midnight_almaty') === 'midnight_almaty') {
    body.start_time = start_time;
  }

  // Для WhatsApp/Instagram DM добавляем destination_type
  if (optimization_goal === 'CONVERSATIONS') {
    body.destination_type = objective === 'instagram_dm' ? 'INSTAGRAM_DIRECT' : 'WHATSAPP';
  }

  // WhatsApp-конверсии: OFFSITE_CONVERSIONS + destination WhatsApp
  // Критично: без objective === 'conversions' будет fallback на WEBSITE
  if (objective === 'conversions') {
    body.destination_type = 'WHATSAPP';
    log.info({
      campaignId,
      name,
      objective,
      optimization_goal,
      destination_type: 'WHATSAPP',
      promoted_object_pixel_id: promoted_object?.pixel_id,
      promoted_object_event_type: promoted_object?.custom_event_type,
    }, 'WhatsApp-conversions: setting destination_type=WHATSAPP for CAPI optimization');
  }
  // Для Site Leads (OFFSITE_CONVERSIONS без conversions) добавляем destination_type WEBSITE
  else if (optimization_goal === 'OFFSITE_CONVERSIONS') {
    body.destination_type = 'WEBSITE';
  }

  // Для Instagram Profile добавляем destination_type (как в рабочем n8n workflow)
  if (optimization_goal === 'LINK_CLICKS' && promoted_object?.page_id && !promoted_object?.link) {
    body.destination_type = 'INSTAGRAM_PROFILE';
  }

  // Для Lead Forms (LEAD_GENERATION) - форма открывается в рекламе
  if (optimization_goal === 'LEAD_GENERATION') {
    body.destination_type = 'ON_AD';
  }

  if (promoted_object) {
    body.promoted_object = promoted_object;
  }

  // Логируем финальные параметры для отладки
  log.info({
    campaignId,
    name,
    objective,
    optimization_goal,
    destination_type: body.destination_type,
    promoted_object: body.promoted_object,
    has_whatsapp_number: !!body.promoted_object?.whatsapp_phone_number,
    page_id: body.promoted_object?.page_id,
    pixel_id: body.promoted_object?.pixel_id,
    custom_event_type: body.promoted_object?.custom_event_type,
    targeting_automation: finalTargeting?.targeting_automation,
    has_targeting_automation: !!finalTargeting?.targeting_automation,
    has_custom_audiences: Array.isArray(finalTargeting?.custom_audiences) && finalTargeting.custom_audiences.length > 0
  }, 'Final ad set parameters before Facebook API call');

  let response = await fetch(
    `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/adsets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  // Если получили ошибку 2446885 и есть WhatsApp номер - повторяем без него
  if (!response.ok) {
    const error = await response.json();
    const errorSubcode = error?.error?.error_subcode;
    const isWhatsAppError = errorSubcode === 2446885;
    const hasWhatsAppNumber = body.promoted_object?.whatsapp_phone_number;

    if (isWhatsAppError && hasWhatsAppNumber && optimization_goal === 'CONVERSATIONS') {
      log.warn({
        error_subcode: errorSubcode,
        error_message: error?.error?.message,
        whatsapp_number_attempted: body.promoted_object.whatsapp_phone_number
      }, '⚠️ Facebook API error 2446885 detected - retrying WITHOUT whatsapp_phone_number');

      // Повторяем запрос БЕЗ номера
      const bodyWithoutNumber = {
        ...body,
        promoted_object: {
          page_id: body.promoted_object.page_id
          // whatsapp_phone_number убран
        }
      };

      response = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/adsets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyWithoutNumber),
        }
      );

      if (!response.ok) {
        const retryError = await response.json();
        log.error({ err: retryError, campaignId, name }, 'Failed to create ad set even without WhatsApp number');
        throw new Error(`Failed to create ad set: ${JSON.stringify(retryError)}`);
      }

      const result = await response.json();
      log.info({
        adsetId: result.id,
        fallback_used: true
      }, '✅ Ad set created successfully WITHOUT whatsapp_phone_number (Facebook will use page default)');
      return result;
    } else {
      // Если это не ошибка 2446885 или нет номера WhatsApp - пробрасываем ошибку
      log.error({ err: error, campaignId, name }, 'Failed to create ad set');
      throw new Error(`Failed to create ad set: ${JSON.stringify(error)}`);
    }
  }

  const result = await response.json();
  log.info({ adsetId: result.id }, 'Ad set created successfully');
  return result;
}

/**
 * Получить creative ID для objective
 */
export function getCreativeIdForObjective(creative: AvailableCreative, objective: CampaignObjective): string | null {
  switch (objective) {
    case 'whatsapp':
    case 'conversions':
      return creative.fb_creative_id_whatsapp;
    case 'instagram_traffic':
      return creative.fb_creative_id_instagram_traffic;
    case 'site_leads':
      return creative.fb_creative_id_site_leads;
    case 'lead_forms':
      return creative.fb_creative_id_lead_forms;
    case 'app_installs':
      return creative.fb_creative_id || null;
    case 'instagram_dm':
      return creative.fb_creative_id_whatsapp;
    default:
      return null;
  }
}

/**
 * Создать Ads в Ad Set (использует batch API для оптимизации)
 */
export async function createAdsInAdSet(params: {
  adsetId: string;
  adAccountId: string;
  creatives: AvailableCreative[];
  accessToken: string;
  objective: CampaignObjective;
  userId?: string;
  directionId?: string | null;
  campaignId?: string;
  accountId?: string | null;  // UUID из ad_accounts.id для мультиаккаунтности
}) {
  const startTime = Date.now();
  const { adsetId, adAccountId, creatives, accessToken, objective, userId, directionId, campaignId, accountId } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  log.info({
    adsetId,
    creativeCount: creatives.length,
    objective,
    adAccountId: normalizedAdAccountId
  }, '[createAdsInAdSet] Starting batch ad creation');

  // Подготовим креативы с их FB ID
  const validCreatives: Array<{ creative: AvailableCreative; fbCreativeId: string }> = [];

  for (const creative of creatives) {
    const creativeId = getCreativeIdForObjective(creative, objective);

    if (!creativeId) {
      log.warn({
        userCreativeId: creative.user_creative_id,
        creativeTitle: creative.title,
        objective,
        availableCreativeIds: {
          unified: creative.fb_creative_id || null,
          whatsapp: creative.fb_creative_id_whatsapp,
          instagram_traffic: creative.fb_creative_id_instagram_traffic,
          site_leads: creative.fb_creative_id_site_leads,
          lead_forms: creative.fb_creative_id_lead_forms
        }
      }, '[createAdsInAdSet] No Facebook creative ID for creative');
      continue;
    }

    validCreatives.push({ creative, fbCreativeId: creativeId });
  }

  if (validCreatives.length === 0) {
    log.warn({
      adsetId,
      totalCreatives: creatives.length,
      objective,
      durationMs: Date.now() - startTime
    }, '[createAdsInAdSet] No valid creatives to create ads');
    return { ads: [], failedAds: creatives.map(c => ({
      user_creative_id: c.user_creative_id,
      title: c.title,
      errorCode: undefined as number | undefined,
      errorSubcode: undefined as number | undefined,
      errorMessage: `No Facebook creative ID for objective: ${objective}`,
    })) };
  }

  // Формируем batch запросы
  const batchRequests: BatchRequest[] = validCreatives.map(({ creative, fbCreativeId }) => {
    const adName = `Ad - ${creative.title}`;
    const body = new URLSearchParams({
      name: adName,
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: fbCreativeId }),
      status: 'ACTIVE'
    }).toString();

    return {
      method: 'POST' as const,
      relative_url: `${normalizedAdAccountId}/ads`,
      body
    };
  });

  log.info({
    adsetId,
    batchSize: batchRequests.length,
    adAccountId: normalizedAdAccountId,
    creativeIds: validCreatives.map(vc => vc.fbCreativeId)
  }, '[createAdsInAdSet] Sending batch request');

  const ads: Array<{
    ad_id: string;
    name: string;
    user_creative_id: string;
    creative_title: string;
  }> = [];

  const allFailedAds: Array<{
    user_creative_id: string;
    title: string;
    errorCode?: number;
    errorSubcode?: number;
    errorMessage?: string;
  }> = [];

  try {
    const batchStartTime = Date.now();
    const responses = await graphBatch(accessToken, batchRequests);
    const batchDuration = Date.now() - batchStartTime;

    // Обрабатываем результаты
    const mappingsToSave: Array<{
      ad_id: string;
      user_creative_id: string;
      direction_id: string | null;
      user_id: string;
      account_id: string | null;
      adset_id: string;
      campaign_id?: string;
      fb_creative_id: string;
      source: 'campaign_builder';
    }> = [];

    let rateLimitErrors = 0;
    const failedCreatives: Array<{ id: string; title: string; errorCode?: number }> = [];

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      const { creative, fbCreativeId } = validCreatives[i];
      const parsed = parseBatchBody<{ id: string }>(response);

      if (parsed.success && parsed.data?.id) {
        log.debug({
          adId: parsed.data.id,
          userCreativeId: creative.user_creative_id,
          creativeTitle: creative.title,
          fbCreativeId
        }, '[createAdsInAdSet] Ad created successfully');

        ads.push({
          ad_id: parsed.data.id,
          name: `Ad - ${creative.title}`,
          user_creative_id: creative.user_creative_id,
          creative_title: creative.title
        });

        // Подготовим маппинг для сохранения
        if (userId) {
          mappingsToSave.push({
            ad_id: parsed.data.id,
            user_creative_id: creative.user_creative_id,
            direction_id: directionId || null,
            user_id: userId,
            account_id: accountId || null,
            adset_id: adsetId,
            campaign_id: campaignId,
            fb_creative_id: fbCreativeId,
            source: 'campaign_builder' as const
          });
        }
      } else {
        const errorCode = parsed.error?.code;
        const errorSubcode = parsed.error?.error_subcode;
        const errorMessage = parsed.error?.message;
        if (errorCode === 17 || errorCode === 4) {
          rateLimitErrors++;
        }
        failedCreatives.push({
          id: creative.user_creative_id,
          title: creative.title,
          errorCode
        });
        allFailedAds.push({
          user_creative_id: creative.user_creative_id,
          title: creative.title,
          errorCode,
          errorSubcode,
          errorMessage: errorMessage?.substring(0, 200),
        });
        log.error({
          userCreativeId: creative.user_creative_id,
          creativeTitle: creative.title,
          fbCreativeId,
          adsetId,
          errorCode,
          errorSubcode,
          errorMessage: errorMessage?.substring(0, 200)
        }, '[createAdsInAdSet] Failed to create ad (batch)');
      }
    }

    // Сохраняем маппинги (можно параллельно)
    if (mappingsToSave.length > 0) {
      await Promise.all(mappingsToSave.map(mapping => saveAdCreativeMapping(mapping)));
    }

    const totalDuration = Date.now() - startTime;
    log.info({
      adsetId,
      totalCreatives: creatives.length,
      validCreatives: validCreatives.length,
      successfulAds: ads.length,
      failedAds: failedCreatives.length,
      rateLimitErrors,
      batchDurationMs: batchDuration,
      totalDurationMs: totalDuration,
      avgTimePerAd: Math.round(batchDuration / validCreatives.length),
      adsCreated: ads.map(ad => ad.ad_id)
    }, '[createAdsInAdSet] Completed (batch)');

    return { ads, failedAds: allFailedAds };
  } catch (error: any) {
    const batchFailTime = Date.now() - startTime;
    log.error({
      err: error,
      adsetId,
      failedAfterMs: batchFailTime
    }, '[createAdsInAdSet] Batch failed, falling back to sequential with exponential backoff');

    // Fallback на последовательное создание с exponential backoff
    const MAX_RETRIES = 3;
    const BASE_DELAY = 3000;
    let rateLimitHits = 0;
    let networkErrors = 0;

    for (let i = 0; i < validCreatives.length; i++) {
      const { creative, fbCreativeId } = validCreatives[i];
      let success = false;

      for (let retry = 0; retry < MAX_RETRIES && !success; retry++) {
        try {
          const response = await fetch(
            `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/ads`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                access_token: accessToken,
                name: `Ad - ${creative.title}`,
                adset_id: adsetId,
                creative: JSON.stringify({ creative_id: fbCreativeId }),
                status: 'ACTIVE'
              }).toString(),
            }
          );

          if (response.ok) {
            const ad = await response.json();
            ads.push({
              ad_id: ad.id,
              name: `Ad - ${creative.title}`,
              user_creative_id: creative.user_creative_id,
              creative_title: creative.title
            });

            log.debug({
              adId: ad.id,
              userCreativeId: creative.user_creative_id,
              progress: `${i + 1}/${validCreatives.length}`,
              retry
            }, '[createAdsInAdSet] Ad created (fallback)');

            if (userId && ad.id) {
              await saveAdCreativeMapping({
                ad_id: ad.id,
                user_creative_id: creative.user_creative_id,
                direction_id: directionId || null,
                user_id: userId,
                account_id: accountId || null,
                adset_id: adsetId,
                campaign_id: campaignId,
                fb_creative_id: fbCreativeId,
                source: 'campaign_builder'
              });
            }
            success = true;
          } else {
            const errorBody = await response.text();
            const isRateLimit = response.status === 400 &&
              (errorBody.includes('User request limit reached') || errorBody.includes('"code":17') || errorBody.includes('"code":4'));

            if (isRateLimit && retry < MAX_RETRIES - 1) {
              rateLimitHits++;
              const delay = BASE_DELAY * Math.pow(2, retry); // 3s, 6s, 12s
              log.warn({
                userCreativeId: creative.user_creative_id,
                retry: retry + 1,
                maxRetries: MAX_RETRIES,
                delayMs: delay
              }, '[createAdsInAdSet] Rate limited, retrying with backoff');
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }

            // Парсим ошибку FB для возврата
            try {
              const errJson = JSON.parse(errorBody);
              allFailedAds.push({
                user_creative_id: creative.user_creative_id,
                title: creative.title,
                errorCode: errJson?.error?.code,
                errorSubcode: errJson?.error?.error_subcode,
                errorMessage: errJson?.error?.message?.substring(0, 200),
              });
            } catch {
              allFailedAds.push({
                user_creative_id: creative.user_creative_id,
                title: creative.title,
                errorMessage: errorBody.substring(0, 200),
              });
            }
            log.error({
              userCreativeId: creative.user_creative_id,
              status: response.status,
              error: errorBody.substring(0, 200)
            }, '[createAdsInAdSet] Failed to create ad (fallback)');
            break;
          }
        } catch (err: any) {
          networkErrors++;
          if (retry < MAX_RETRIES - 1) {
            const delay = BASE_DELAY * Math.pow(2, retry);
            log.warn({
              err,
              userCreativeId: creative.user_creative_id,
              retry: retry + 1,
              delayMs: delay
            }, '[createAdsInAdSet] Network error, retrying');
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            log.error({
              err,
              userCreativeId: creative.user_creative_id
            }, '[createAdsInAdSet] Error creating ad after retries');
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    log.info({
      adsetId,
      totalCreatives: creatives.length,
      successfulAds: ads.length,
      failedAds: validCreatives.length - ads.length,
      rateLimitHits,
      networkErrors,
      totalDurationMs: totalDuration,
      mode: 'fallback'
    }, '[createAdsInAdSet] Completed (fallback)');

    return { ads, failedAds: allFailedAds };
  }
}
