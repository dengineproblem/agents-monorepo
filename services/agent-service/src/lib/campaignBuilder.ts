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

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const log = createLogger({ module: 'campaignBuilder' });

// ========================================
// TYPES
// ========================================

export type CampaignObjective = 'whatsapp' | 'instagram_traffic' | 'site_leads';

// Конвертация lowercase objective в формат для LLM
export function objectiveToLLMFormat(objective: CampaignObjective): 'WhatsApp' | 'Instagram' | 'SiteLeads' {
  const mapping = {
    whatsapp: 'WhatsApp' as const,
    instagram_traffic: 'Instagram' as const,
    site_leads: 'SiteLeads' as const,
  };
  return mapping[objective];
}

export type AvailableCreative = {
  user_creative_id: string;
  title: string;
  fb_creative_id_whatsapp: string | null;
  fb_creative_id_instagram_traffic: string | null;
  fb_creative_id_site_leads: string | null;
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
    objective?: 'WhatsApp' | 'Instagram' | 'SiteLeads';
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
4. objective — цель кампании (whatsapp/instagram_traffic/site_leads)
5. user_context — дополнительная информация от пользователя
6. direction_info — информация о направлении (если работаем с directions)

СИСТЕМА НАПРАВЛЕНИЙ (DIRECTIONS):

В системе используются НАПРАВЛЕНИЯ - логические группы креативов с настройками:
- У каждого direction уже есть СУЩЕСТВУЮЩАЯ кампания (fb_campaign_id)
- У каждого direction свой бюджет (daily_budget_cents)
- У каждого direction свой objective (whatsapp/instagram_traffic/site_leads)
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

КОЛИЧЕСТВО ADSETS ОПРЕДЕЛЯЕТСЯ БЮДЖЕТОМ (фиксированно $10 на adset):
- $10-19 → 1 adset по $10-19
- $20-29 → 2 adset по $10-14.5
- $30-39 → 3 adset по $10-13
- $40-49 → 4 adset по $10-12.25
- $50-59 → 5 adset по $10-11.8
- $60+ → floor(budget / 10) adsets, распределяй бюджет равномерно

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

ПРИМЕРЫ РАСПРЕДЕЛЕНИЯ:

$40 (4 adset), 1 креатив:
  Adset 1: [A] — $10
  Adset 2: [A] — $10 ← повторяем
  Adset 3: [A] — $10 ← повторяем
  Adset 4: [A] — $10 ← повторяем

$40 (4 adset), 3 креатива (A-сильный, B-средний, C-новый):
  Adset 1: [A] — $10
  Adset 2: [B] — $10
  Adset 3: [C] — $10
  Adset 4: [A] — $10 ← повторяем сильнейшего

$40 (4 adset), 9 креативов (5 сильных, 4 слабых):
  Adset 1: [сильный1, слабый1, слабый2] — $10
  Adset 2: [сильный2, слабый3] — $10
  Adset 3: [сильный3, слабый4] — $10
  Adset 4: [сильный4, сильный5] — $10
  ✅ Все 9 использованы БЕЗ повторений

$50 (5 adset), 15 креативов:
  Adset 1: [топ-3 креатива] — $10
  Adset 2: [следующие 3] — $10
  Adset 3: [следующие 3] — $10
  Adset 4: [следующие 3] — $10
  Adset 5: [последние 3] — $10
  ✅ Все 15 использованы

$20 (2 adset), 10 креативов:
  Adset 1: [топ-5 креативов] — $10
  Adset 2: [следующие 5] — $10
  ✅ Все 10 использованы

СОСТАВ ADSET:
- Минимум: 1 креатив (если только 1 доступен)
- Оптимум: 2-4 креатива
- Максимум: 5 креативов

ПРАВИЛА:
1. ✅ ОБЯЗАТЕЛЬНО: Количество adsets = floor(budget_usd / 10), НЕ зависит от креативов
2. ✅ ОБЯЗАТЕЛЬНО: Используй ВСЕ креативы, не игнорируй слабые
3. ✅ ОБЯЗАТЕЛЬНО: Повторяй креативы только если adsets > креативов
4. ✅ ОБЯЗАТЕЛЬНО: Бюджет $10 на каждый adset (или равномерно)
5. ✅ ОБЯЗАТЕЛЬНО: Распределяй весь доступный бюджет полностью
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
    "auto_activate": false
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
    "auto_activate": false
  },
  "selected_creatives": [
    {
      "user_creative_id": "uuid-1",
      "title": "Креатив 1",
      "reason": "Low risk для Test 1"
    },
    ...остальные 5 креативов
  ],
  "reasoning": "Бюджет $30 → 3 adsets по $10. Все 6 креативов распределены. Сильные в начале каждого adset, слабые в паре с сильными.",
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
    "auto_activate": false
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
    "auto_activate": false
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
    ...остальные креативы
  ],
  "reasoning": "Бюджет $30 → 3 adsets по $10. Распределили 6 креативов: сильные в начале каждого adset.",
  "estimated_cpl": 2.00,
  "confidence": "high"
}

Вариант 4: DIRECTION с режимом use_existing (один готовый adset):
{
  "type": "Direction.UseExistingAdSetWithCreatives",
  "params": {
    "direction_id": "uuid-направления",
    "user_creative_ids": ["uuid-1", "uuid-2"],
    "auto_activate": false
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
    "auto_activate": false
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
  "reasoning": "Бюджет $30 → 3 готовых adsets. Распределили 6 креативов: сильные в начале каждого adset.",
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
- objective в params должен быть "WhatsApp", "Instagram" или "SiteLeads" (с заглавной буквы!)
- Минимальный бюджет на каждый adset: 1000 центов ($10)
- use_default_settings = true (используем дефолтные настройки таргетинга)
- auto_activate = false (создаем в PAUSED для проверки)

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
→ ✅ Создать 1 adset с 1 креативом ($45/день)
→ Причина: используем весь бюджет для быстрого получения данных

Пример 2: Бюджет $45, 2 креатива (low, medium)
→ Создать 1 adset с 2 креативами ($45/день)
→ Причина: весь бюджет на A/B тест двух креативов

Пример 3: Бюджет $45, 4 креатива (2 low, 2 medium)
→ Создать 1 adset с 4 креативами ($45/день)
→ Причина: 4 креатива - это нормально для одного adset, весь бюджет

Пример 4: Бюджет $45, 6 креативов (3 low, 3 medium)
→ Создать 2 adset по 3 креатива ($22-23 каждый, всего $45)
→ Причина: делим креативы и бюджет поровну для разных тестов

Пример 5: Бюджет $100, 8 креативов (4 low, 4 medium)
→ Создать 2 adset по 4 креатива ($50 каждый)
→ Причина: оптимально для тестирования двух групп с большим бюджетом

Пример 6: Бюджет $20, 3 креатива (1 low, 2 medium)
→ Создать 1 adset с 3 креативами ($20/день)
→ Причина: используем весь доступный бюджет
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
  accessToken: string
): Promise<Array<{ adset_id: string; name?: string; status?: string; effective_status?: string; optimized_goal?: string }>> {
  log.info({ campaignId }, 'Fetching active ad sets for campaign');

  try {
    const response = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/${campaignId}/adsets?fields=id,name,status,effective_status,optimized_goal&limit=200&access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`Facebook API error: ${response.status}`);
    }

    const data = await response.json();
    const adsets: Array<any> = data.data || [];

    const activeAdsets = adsets.filter((adset: any) => {
      const statusStr = String(adset.status || adset.effective_status || '');
      return statusStr.includes('ACTIVE');
    });

    log.info({ count: activeAdsets.length, campaignId }, 'Found active ad sets');

    return activeAdsets.map((adset: any) => ({
      adset_id: adset.id,
      name: adset.name,
      status: adset.status,
      effective_status: adset.effective_status,
      optimized_goal: adset.optimized_goal
    }));
  } catch (error: any) {
    log.error({ err: error, campaignId }, 'Error fetching ad sets');
    throw new Error(`Failed to fetch ad sets: ${error.message}`);
  }
}

export async function pauseAdSetsForCampaign(
  campaignId: string,
  accessToken: string
): Promise<void> {
  const adsets = await getActiveAdSets(campaignId, accessToken);
  log.info({ campaignId, count: adsets.length }, 'Pausing ad sets for campaign');

  for (const adset of adsets) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${adset.adset_id}?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'PAUSED' }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
      }

      log.info({ adsetId: adset.adset_id, campaignId }, 'Paused ad set');
    } catch (error: any) {
      log.warn({ err: error, adsetId: adset.adset_id, campaignId }, 'Failed to pause ad set');
    }
  }
}

/**
 * Получить доступные креативы пользователя с их скорингом
 */
export async function getAvailableCreatives(
  userAccountId: string,
  objective?: CampaignObjective,
  directionId?: string
): Promise<AvailableCreative[]> {
  log.info({ userAccountId, directionId }, 'Fetching available creatives for direction');

  let creatives: any[];

  // Если указано направление - фильтруем креативы по нему
  if (directionId) {
    const { data, error: creativesError } = await supabase
      .from('user_creatives')
      .select(`
        id,
        user_id,
        title,
        fb_video_id,
        fb_creative_id_whatsapp,
        fb_creative_id_instagram_traffic,
        fb_creative_id_site_leads,
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
          return !!c.fb_creative_id_whatsapp;
        case 'instagram_traffic':
          return !!c.fb_creative_id_instagram_traffic;
        case 'site_leads':
          return !!c.fb_creative_id_site_leads;
        default:
          return false;
      }
    });
    log.info({ count: filteredCreatives.length, objective }, 'Filtered creatives for objective');
  }

  // Получаем fb_creative_id для каждого креатива
  const creativeIds = filteredCreatives.map((c) => {
    switch (objective) {
      case 'whatsapp':
        return c.fb_creative_id_whatsapp;
      case 'instagram_traffic':
        return c.fb_creative_id_instagram_traffic;
      case 'site_leads':
        return c.fb_creative_id_site_leads;
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
    .in('creative_id', creativeIds)
    .order('date', { ascending: false });

  // 2. OPTIMIZATION: Сначала пытаемся получить из БД (кэш от agent-brain)
  const metricsMap = await getCreativeMetrics(userAccountId, creativeIds);

  log.info({ 
    fromDB: metricsMap.size,
    total: creativeIds.length 
  }, 'Loaded metrics from DB');

  // 3. FALLBACK: Для креативов без метрик в БД - запрашиваем из Facebook API
  const freshMetricsMap = new Map();
  
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('ad_account_id, access_token')
    .eq('id', userAccountId)
    .single();

  if (userAccount && userAccount.access_token) {
    const missingCreativeIds = creativeIds.filter(id => !metricsMap.has(id));
    
    if (missingCreativeIds.length > 0) {
      log.info({ count: missingCreativeIds.length }, 'Fetching missing metrics from FB API');
      
      // OPTIMIZATION: Запускаем запросы параллельно
      const metricsPromises = missingCreativeIds.map(async (creativeId) => {
        try {
          const insights = await fetchCreativeInsightsLight(
            userAccount.ad_account_id,
            userAccount.access_token,
            creativeId
          );
          
          if (insights) {
            return { creativeId, insights };
          }
        } catch (e) {
          log.warn({ creativeId, err: e }, 'Failed to fetch insights for creative');
        }
        return null;
      });

      // Ждем выполнения всех запросов
      const results = await Promise.all(metricsPromises);
      
      // Сохраняем результаты
      results.forEach(result => {
        if (result) {
          freshMetricsMap.set(result.creativeId, result.insights);
        }
      });
    }
  }

  log.info({ 
    fromDB: metricsMap.size, 
    fromAPI: freshMetricsMap.size,
    total: creativeIds.length
  }, 'Metrics loaded (DB + API)');


  // Объединяем креативы со скорами и метриками
  const result: AvailableCreative[] = filteredCreatives.map((creative) => {
    let fbCreativeId: string | null = null;
    switch (objective) {
      case 'whatsapp':
        fbCreativeId = creative.fb_creative_id_whatsapp;
        break;
      case 'instagram_traffic':
        fbCreativeId = creative.fb_creative_id_instagram_traffic;
        break;
      case 'site_leads':
        fbCreativeId = creative.fb_creative_id_site_leads;
        break;
    }

    const score = scores?.find((s) => s.creative_id === fbCreativeId);
    const metrics = metricsMap.get(fbCreativeId!) || freshMetricsMap.get(fbCreativeId!);

    return {
      user_creative_id: creative.id,
      title: creative.title,
      fb_creative_id_whatsapp: creative.fb_creative_id_whatsapp,
      fb_creative_id_instagram_traffic: creative.fb_creative_id_instagram_traffic,
      fb_creative_id_site_leads: creative.fb_creative_id_site_leads,
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
 */
function preprocessCreativesForLLM(
  creatives: AvailableCreative[],
  maxCreatives: number = 20
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
  log.info({ total: creatives.length, maxCreatives }, 'Preprocessing creatives for LLM');

  // Разделяем на креативы с и без performance данных
  const withPerformance = creatives.filter(c => c.performance !== null);
  const withoutPerformance = creatives.filter(c => c.performance === null);

  log.info({ 
    withPerformance: withPerformance.length, 
    withoutPerformance: withoutPerformance.length 
  }, 'Creatives split by performance data');

  // Сортируем креативы с performance по приоритету:
  // 1. CPL (если есть) - меньше лучше
  // 2. CTR - больше лучше
  // 3. CPM - меньше лучше
  withPerformance.sort((a, b) => {
    const aCpl = a.performance?.avg_cpl;
    const bCpl = b.performance?.avg_cpl;
    const aCtr = a.performance?.avg_ctr || 0;
    const bCtr = b.performance?.avg_ctr || 0;
    const aCpm = a.performance?.avg_cpm || 999999;
    const bCpm = b.performance?.avg_cpm || 999999;

    // Приоритет 1: CPL (если есть у обоих)
    if (aCpl && bCpl) {
      return aCpl - bCpl;
    }
    // Если только у одного есть CPL - он лучше
    if (aCpl && !bCpl) return -1;
    if (!aCpl && bCpl) return 1;

    // Приоритет 2: CTR (выше - лучше)
    if (Math.abs(aCtr - bCtr) > 0.001) {
      return bCtr - aCtr;
    }

    // Приоритет 3: CPM (ниже - лучше)
    return aCpm - bCpm;
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

  // Формируем финальный список: топ креативов с performance + часть новых
  const topPerforming = withPerformance.slice(0, Math.floor(maxCreatives * 0.7)); // 70% - лучшие по метрикам
  const newCreatives = withoutPerformance.slice(0, Math.floor(maxCreatives * 0.3)); // 30% - новые для тестирования

  const filteredCreatives = [...topPerforming, ...newCreatives];

  log.info({ 
    filtered: filteredCreatives.length,
    topPerforming: topPerforming.length,
    newCreatives: newCreatives.length
  }, 'Creatives filtered for LLM');

  return {
    filtered_creatives: filteredCreatives,
    aggregated_metrics: aggregatedMetrics
  };
}

/**
 * Получить метрики креативов из creative_metrics_history
 * ОБНОВЛЕНО для унифицированной системы метрик
 * 
 * Читает метрики за сегодня или вчера (если сегодня еще нет)
 * Агрегирует метрики если у креатива несколько ads
 */
export async function getCreativeMetrics(
  userAccountId: string,
  fbCreativeIds: string[]
): Promise<Map<string, any>> {
  if (fbCreativeIds.length === 0) return new Map();
  
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  log.debug({ today, yesterday }, 'Fetching creative metrics from DB');
  
  // Пытаемся получить за сегодня
  let { data: metrics } = await supabase
    .from('creative_metrics_history')
    .select('*')
    .eq('user_account_id', userAccountId)
    .in('creative_id', fbCreativeIds)
    .eq('date', today);
  
  // Если за сегодня нет - берем за вчера
  if (!metrics || metrics.length === 0) {
    log.debug('No metrics for today, trying yesterday');
    const result = await supabase
      .from('creative_metrics_history')
      .select('*')
      .eq('user_account_id', userAccountId)
      .in('creative_id', fbCreativeIds)
      .eq('date', yesterday);
    metrics = result.data;
  }
  
  if (!metrics || metrics.length === 0) {
    log.debug('No metrics found in DB');
    return new Map();
  }
  
  log.debug({ count: metrics.length }, 'Found metrics in DB');
  
  // Агрегируем по creative_id (может быть несколько ads у одного креатива)
  const aggregated = new Map();
  
  for (const metric of metrics) {
    if (!aggregated.has(metric.creative_id)) {
      aggregated.set(metric.creative_id, {
        impressions: 0,
        reach: 0,
        spend: 0,
        clicks: 0,
        link_clicks: 0,
        leads: 0,
        frequency: 0,
        count: 0
      });
    }
    
    const agg = aggregated.get(metric.creative_id);
    agg.impressions += metric.impressions || 0;
    agg.reach += metric.reach || 0;
    agg.spend += metric.spend || 0;
    agg.clicks += metric.clicks || 0;
    agg.link_clicks += metric.link_clicks || 0;
    agg.leads += metric.leads || 0;
    agg.frequency += metric.frequency || 0;
    agg.count += 1;
  }
  
  // Вычисляем средние метрики
  const metricsMap = new Map();
  for (const [creativeId, agg] of aggregated) {
    const avgFrequency = agg.count > 0 ? agg.frequency / agg.count : 0;
    const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
    const cpl = agg.leads > 0 ? agg.spend / agg.leads : null;
    
    metricsMap.set(creativeId, {
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
      date: metrics[0].date
    });
  }
  
  log.info({ 
    fromDB: metricsMap.size,
    requested: fbCreativeIds.length 
  }, 'Loaded metrics from DB');
  
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
  const { filtered_creatives, aggregated_metrics } = preprocessCreativesForLLM(availableCreatives, 20);

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
 * Конвертировать campaign action в envelope для POST /api/agent/actions
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
        auto_activate: action.params.auto_activate ?? false,
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
    case 'instagram_traffic':
      return 'LINK_CLICKS';
    case 'site_leads':
      return 'OFFSITE_CONVERSIONS';
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
    case 'instagram_traffic':
      return 'IMPRESSIONS';
    case 'site_leads':
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
}) {
  const { campaignId, adAccountId, accessToken, name, dailyBudget, targeting, optimization_goal, billing_event, promoted_object } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

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
    targeting,
    status: 'ACTIVE',
  };

  if ((params.start_mode || 'midnight_almaty') === 'midnight_almaty') {
    body.start_time = start_time;
  }

  // Для WhatsApp добавляем destination_type
  if (optimization_goal === 'CONVERSATIONS') {
    body.destination_type = 'WHATSAPP';
  }

  // Для Instagram Profile добавляем destination_type (как в рабочем n8n workflow)
  if (optimization_goal === 'LINK_CLICKS' && promoted_object?.page_id && !promoted_object?.link) {
    body.destination_type = 'INSTAGRAM_PROFILE';
  }

  // Для Site Leads (OFFSITE_CONVERSIONS) добавляем destination_type
  if (optimization_goal === 'OFFSITE_CONVERSIONS') {
    body.destination_type = 'WEBSITE';
  }

  if (promoted_object) {
    body.promoted_object = promoted_object;
  }

  // Логируем финальные параметры для отладки WhatsApp
  log.info({
    campaignId,
    name,
    optimization_goal,
    destination_type: body.destination_type,
    promoted_object: body.promoted_object,
    has_whatsapp_number: !!body.promoted_object?.whatsapp_phone_number,
    page_id: body.promoted_object?.page_id
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
      return creative.fb_creative_id_whatsapp;
    case 'instagram_traffic':
      return creative.fb_creative_id_instagram_traffic;
    case 'site_leads':
      return creative.fb_creative_id_site_leads;
    default:
      return null;
  }
}

/**
 * Создать Ads в Ad Set
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
}) {
  const { adsetId, adAccountId, creatives, accessToken, objective, userId, directionId, campaignId } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  log.info({ adsetId, creativeCount: creatives.length }, 'Creating ads in ad set');

  const ads = [];

  for (const creative of creatives) {
    const creativeId = getCreativeIdForObjective(creative, objective);

    if (!creativeId) {
      log.warn({
        userCreativeId: creative.user_creative_id,
        creativeTitle: creative.title,
        objective,
        availableCreativeIds: {
          whatsapp: creative.fb_creative_id_whatsapp,
          instagram_traffic: creative.fb_creative_id_instagram_traffic,
          site_leads: creative.fb_creative_id_site_leads
        }
      }, 'No Facebook creative ID for creative');
      continue;
    }

    const adPayload = {
      access_token: accessToken,
      name: `Ad - ${creative.title}`,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'ACTIVE',
    };

    log.info({
      userCreativeId: creative.user_creative_id,
      creativeTitle: creative.title,
      fbCreativeId: creativeId,
      adsetId,
      adAccountId: normalizedAdAccountId,
      objective,
      adPayload: {
        name: adPayload.name,
        adset_id: adPayload.adset_id,
        creative: adPayload.creative,
        status: adPayload.status
      }
    }, 'Attempting to create ad in Facebook');

    try {
      const response = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/ads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adPayload),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        log.error({
          err: error,
          userCreativeId: creative.user_creative_id,
          creativeTitle: creative.title,
          fbCreativeId: creativeId,
          adsetId,
          statusCode: response.status,
          errorCode: error.error?.code,
          errorSubcode: error.error?.error_subcode,
          errorMessage: error.error?.message,
          errorUserTitle: error.error?.error_user_title,
          errorUserMsg: error.error?.error_user_msg
        }, 'Failed to create ad');
        continue;
      }

      const ad = await response.json();
      log.info({
        adId: ad.id,
        adName: ad.name,
        userCreativeId: creative.user_creative_id,
        creativeTitle: creative.title,
        fbCreativeId: creativeId
      }, 'Ad created successfully');
      ads.push(ad);

      // Сохраняем маппинг для трекинга лидов (если есть userId)
      if (userId && ad.id) {
        await saveAdCreativeMapping({
          ad_id: ad.id,
          user_creative_id: creative.user_creative_id,
          direction_id: directionId || null,
          user_id: userId,
          adset_id: adsetId,
          campaign_id: campaignId,
          fb_creative_id: creativeId,
          source: 'campaign_builder'
        });
      }
    } catch (error: any) {
      log.error({
        err: error,
        userCreativeId: creative.user_creative_id,
        creativeTitle: creative.title,
        fbCreativeId: creativeId,
        adsetId,
        errorMessage: error.message,
        errorStack: error.stack
      }, 'Error creating ad (exception caught)');
    }
  }

  log.info({
    adsetId,
    totalCreatives: creatives.length,
    successfulAds: ads.length,
    failedAds: creatives.length - ads.length,
    adsCreated: ads.map(ad => ({ id: ad.id, name: ad.name }))
  }, 'Finished creating ads in ad set');

  return ads;
}

