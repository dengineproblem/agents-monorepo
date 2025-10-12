/**
 * Campaign Builder Agent - Автоматический подбор креативов и формирование кампании
 * 
 * Этот LLM-агент отличается от agent-brain:
 * - agent-brain: управляет существующими кампаниями, оптимизирует бюджеты
 * - campaign-builder: создает НОВЫЕ кампании, подбирает лучшие креативы
 */

import { supabase } from './supabase.js';

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
  type: 'CreateCampaignWithCreative' | 'CreateMultipleAdSets';
  params: {
    user_creative_ids?: string[]; // Для single adset
    objective?: 'WhatsApp' | 'Instagram' | 'SiteLeads'; // Для single adset
    campaign_name: string;
    daily_budget_cents?: number; // Для single adset
    adsets?: Array<{ // Для multiple adsets
      user_creative_ids: string[];
      adset_name: string;
      daily_budget_cents: number;
    }>;
    use_default_settings?: boolean;
    auto_activate?: boolean;
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
2. budget_constraints — ограничения по бюджету пользователя
3. objective — цель кампании (whatsapp/instagram_traffic/site_leads)
4. user_context — дополнительная информация от пользователя

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

ЛОГИКА ФОРМИРОВАНИЯ ADSET:
1. **Минимальный бюджет на adset**: $10/день
2. **Минимум креативов в adset**: 1 креатив (если больше нет)
3. **Оптимально**: 2-3 креатива в adset (для A/B тестирования)
4. **Максимум**: 5 креативов в одном adset

СТРАТЕГИЯ СОЗДАНИЯ ADSETS:
1. **Если креативов 1-4** → создать 1 adset со ВСЕМИ креативами
   - Весь доступный бюджет на этот adset
   - Пример: 1 креатив + $45 = 1 adset с $45/день
   - Пример: 3 креатива + $45 = 1 adset с $45/день
   
2. **Если креативов 5-6** → создать 2 adset:
   - Раздели креативы поровну (по 2-3 в каждом)
   - Раздели бюджет поровну между adset
   - Пример: 6 креативов + $45 = 2 adset по $22.5 (по 3 креатива)
   
3. **Если креативов 7+** → создать 2 adset:
   - Раздели креативы: лучшие (low risk) vs тестовые (medium/high)
   - Раздели бюджет поровну между adset
   - Пример: 8 креативов + $100 = 2 adset по $50 (по 4 креатива)

РАСПРЕДЕЛЕНИЕ БЮДЖЕТА (КРИТИЧЕСКИ ВАЖНО):
1. **ИСПОЛЬЗУЙ ВЕСЬ доступный бюджет (available_budget_cents)** - чем больше бюджет, тем быстрее получим данные!
2. Минимум на КАЖДЫЙ adset: $10/день (1000 центов) - это ограничение Facebook
3. Если не указан requested_budget_cents → используй ВЕСЬ available_budget_cents
4. Если указан requested_budget_cents → используй его полностью (не меньше!)

ПРИМЕРЫ РАСПРЕДЕЛЕНИЯ:
- Бюджет $45, 1 креатив → 1 adset с $45/день ✅
- Бюджет $45, 2 креатива → 1 adset с $45/день (оба креатива) ✅
- Бюджет $45, 3 креатива → 1 adset с $45/день (все 3) ✅
- Бюджет $45, 6 креативов → 2 adset по $22.5 (по 3 креатива в каждом) ✅
- Бюджет $100, 4 креатива → 2 adset по $50 (по 2 креатива в каждом) ✅

ПРАВИЛА:
1. ✅ ОБЯЗАТЕЛЬНО: Выбирай ТОЛЬКО креативы с нужным fb_creative_id для objective
2. ✅ ОБЯЗАТЕЛЬНО: Каждый adset минимум $10/день (1000 центов)
3. ✅ ОБЯЗАТЕЛЬНО: ИСПОЛЬЗУЙ ВЕСЬ доступный бюджет - не экономь!
4. ✅ ОБЯЗАТЕЛЬНО: Не превышай available_budget_cents
5. ✅ Если креативов 1-4 → один adset со ВСЕМ бюджетом
6. ✅ Если креативов 5+ → раздели на 2 adset, распределив бюджет поровну
7. 💡 ПРИОРИТЕТ (при наличии выбора): Low risk > Medium risk > High risk
8. 💡 ПРИОРИТЕТ (при наличии выбора): Креативы со scoring > без scoring
9. ⚠️ ВАЖНО: Если пользователь запросил кампанию и есть хоть один подходящий креатив → создавай кампанию даже без scoring данных!

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
  "reasoning": "Выбрано 3 креатива для теста в одном adset. Бюджет $10/день на 3 креатива.",
  "estimated_cpl": 2.10,
  "confidence": "high"
}

Вариант 2: НЕСКОЛЬКО ADSET (если есть 3+ креатива и бюджет $20+):
{
  "type": "CreateMultipleAdSets",
  "params": {
    "campaign_name": "Название кампании",
    "objective": "WhatsApp",
    "adsets": [
      {
        "user_creative_ids": ["uuid-1", "uuid-2", "uuid-3"],
        "adset_name": "Test 1",
        "daily_budget_cents": 1000
      },
      {
        "user_creative_ids": ["uuid-4", "uuid-5", "uuid-6"],
        "adset_name": "Test 2",
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
  "reasoning": "Создано 2 adset по $10 каждый. Test 1 с проверенными креативами, Test 2 с новыми для теста. Каждый adset будет создан как отдельная кампания.",
  "estimated_cpl": 2.10,
  "confidence": "high"
}

ВАЖНО:
- objective в params должен быть "WhatsApp", "Instagram" или "SiteLeads" (с заглавной буквы!)
- Минимальный бюджет на каждый adset: 1000 центов ($10)
- use_default_settings = true (используем дефолтные настройки таргетинга)
- auto_activate = false (создаем в PAUSED для проверки)
- Используй CreateMultipleAdSets только если есть 3+ креатива И бюджет $20+

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
  console.log('[CampaignBuilder] Fetching active campaigns for ad account:', adAccountId);

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${normalizedAdAccountId}/campaigns?fields=id,name,status,effective_status,daily_budget,created_time&limit=500&access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`Facebook API error: ${response.status}`);
    }

    const data = await response.json();
    const campaigns = data.data || [];

    // Логируем статусы всех кампаний для отладки
    console.log('[CampaignBuilder] All campaigns statuses:', campaigns.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status
    })));

    // Фильтруем только активные (любые статусы содержащие ACTIVE)
    const activeCampaigns = campaigns.filter(
      (c: any) => {
        const statusStr = String(c.status || c.effective_status || '');
        return statusStr.includes('ACTIVE');
      }
    );

    console.log('[CampaignBuilder] Found active campaigns:', {
      total: campaigns.length,
      active: activeCampaigns.length,
      campaign_ids: activeCampaigns.map((c: any) => c.id),
    });

    return activeCampaigns.map((c: any) => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget,
      created_time: c.created_time,
    }));
  } catch (error: any) {
    console.error('[CampaignBuilder] Error fetching campaigns:', error);
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
  console.log('[CampaignBuilder] Pausing', campaigns.length, 'active campaigns');

  const results = [];

  for (const campaign of campaigns) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${campaign.campaign_id}?access_token=${accessToken}`,
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

      console.log('[CampaignBuilder] Paused campaign:', {
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        success: data.success,
      });

      results.push({
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        success: true,
      });
    } catch (error: any) {
      console.error('[CampaignBuilder] Failed to pause campaign:', campaign.campaign_id, error);
      results.push({
        campaign_id: campaign.campaign_id,
        name: campaign.name,
        success: false,
        error: error.message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.log('[CampaignBuilder] Paused campaigns result:', {
    total: campaigns.length,
    success: successCount,
    failed: campaigns.length - successCount,
  });

  return results;
}

/**
 * Получить доступные креативы пользователя с их скорингом
 */
export async function getAvailableCreatives(
  userAccountId: string,
  objective?: CampaignObjective,
  directionId?: string
): Promise<AvailableCreative[]> {
  console.log('[CampaignBuilder] Fetching available creatives for user:', userAccountId, 'direction:', directionId);

  let creatives: any[];

  // Если указано направление - фильтруем креативы по нему
  if (directionId) {
    const { data, error: creativesError } = await supabase
      .from('user_creatives')
      .select(`
        *,
        account_directions!inner(is_active)
      `)
      .eq('user_id', userAccountId)
      .eq('direction_id', directionId)
      .eq('status', 'ready')
      .eq('account_directions.is_active', true)
      .order('created_at', { ascending: false });

    if (creativesError) {
      console.error('[CampaignBuilder] Error fetching direction creatives:', creativesError);
      throw new Error(`Failed to fetch creatives: ${creativesError.message}`);
    }

    if (!data || data.length === 0) {
      console.warn('[CampaignBuilder] No ready creatives found for direction');
      return [];
    }

    console.log('[CampaignBuilder] Found', data.length, 'ready creatives for direction');
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
      console.error('[CampaignBuilder] Error fetching creatives:', creativesError);
      throw new Error(`Failed to fetch creatives: ${creativesError.message}`);
    }

    if (!data || data.length === 0) {
      console.warn('[CampaignBuilder] No ready creatives found for user');
      return [];
    }

    console.log('[CampaignBuilder] Found', data.length, 'ready creatives (legacy)');
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
    console.log('[CampaignBuilder] Filtered to', filteredCreatives.length, 'creatives for objective:', objective);
  }

  // Получаем скоры для креативов (если есть)
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
  }).filter(Boolean);

  const { data: scores, error: scoresError } = await supabase
    .from('creative_scores')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('level', 'creative')
    .in('creative_id', creativeIds as string[])
    .order('date', { ascending: false });

  if (scoresError) {
    console.warn('[CampaignBuilder] Error fetching scores:', scoresError.message);
  }

  // Объединяем креативы со скорами
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

    // Находим последний скор для этого креатива
    const score = scores?.find((s) => s.creative_id === fbCreativeId);

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
      // Performance будет добавлена позже, если нужно
    };
  });

  console.log('[CampaignBuilder] Prepared', result.length, 'creatives with scoring');
  return result;
}

/**
 * Получить бюджетные ограничения пользователя
 */
export async function getBudgetConstraints(
  userAccountId: string, 
  directionId?: string
): Promise<BudgetConstraints> {
  console.log('[CampaignBuilder] Fetching budget constraints for user:', userAccountId, 'direction:', directionId);

  // Если указано направление - берём бюджет и CPL из него
  if (directionId) {
    const { data: direction, error: directionError } = await supabase
      .from('account_directions')
      .select('daily_budget_cents, target_cpl_cents')
      .eq('id', directionId)
      .single();

    if (directionError || !direction) {
      console.error('[CampaignBuilder] Error fetching direction:', directionError);
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

    console.log('[CampaignBuilder] Direction budget constraints:', {
      direction_id: directionId,
      plan_daily: `$${planDailyBudget / 100}`,
      target_cpl: `$${targetCpl / 100}`,
    });

    return constraints;
  }

  // Legacy: берём из user_accounts (если направление не указано)
  const { data: userAccount, error } = await supabase
    .from('user_accounts')
    .select('plan_daily_budget_cents, default_cpl_target_cents')
    .eq('id', userAccountId)
    .single();

  if (error || !userAccount) {
    console.error('[CampaignBuilder] Error fetching user account:', error);
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

  console.log('[CampaignBuilder] Budget constraints:', {
    plan_daily: `$${planDailyBudget / 100}`,
    available: `$${availableBudget / 100}`,
    target_cpl: `$${targetCpl / 100}`,
  });

  return constraints;
}

// ========================================
// LLM INTERACTION
// ========================================

/**
 * Вызов LLM для формирования action для создания кампании
 */
export async function buildCampaignAction(input: CampaignBuilderInput): Promise<CampaignAction> {
  const { user_account_id, objective, campaign_name, requested_budget_cents, additional_context } = input;

  console.log('[CampaignBuilder] Building campaign action:', {
    user_account_id,
    objective,
    campaign_name,
    requested_budget_cents,
  });

  // Собираем данные
  const availableCreatives = await getAvailableCreatives(user_account_id, objective, direction_id);
  const budgetConstraints = await getBudgetConstraints(user_account_id, direction_id);

  if (availableCreatives.length === 0) {
    throw new Error('No ready creatives available for this objective');
  }

  // Формируем input для LLM
  const llmInput = {
    available_creatives: availableCreatives.map((c) => ({
      user_creative_id: c.user_creative_id,
      title: c.title,
      created_at: c.created_at,
      risk_score: c.risk_score,
      risk_level: c.risk_level,
      creative_score: c.creative_score,
      recommendations: c.recommendations,
      performance: c.performance,
    })),
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
    objective: objectiveToLLMFormat(objective), // Конвертируем в формат для LLM
    requested_campaign_name: campaign_name,
    requested_budget_cents,
    user_context: additional_context,
  };

  console.log('[CampaignBuilder] LLM input prepared:', {
    creatives_count: availableCreatives.length,
    objective,
    budget_available: `$${budgetConstraints.available_budget_cents / 100}`,
  });

  // Вызов OpenAI API
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const model = process.env.CAMPAIGN_BUILDER_MODEL || 'gpt-4o';

  console.log('[CampaignBuilder] Calling OpenAI API with model:', model);

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
    console.error('[CampaignBuilder] OpenAI API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const apiResponse = await response.json();
  console.log('[CampaignBuilder] OpenAI API response received');

  // Извлекаем текст из Responses API
  const message = apiResponse.output?.find((o: any) => o.type === 'message');
  const textContent = message?.content?.find((c: any) => c.type === 'output_text');
  const rawText = textContent?.text || '';

  if (!rawText) {
    console.error('[CampaignBuilder] Empty response from LLM');
    throw new Error('Empty response from LLM');
  }

  console.log('[CampaignBuilder] LLM response:', rawText.substring(0, 500));

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
    console.error('[CampaignBuilder] Failed to parse LLM response:', parseError);
    throw new Error(`Failed to parse LLM response: ${parseError.message}`);
  }

  // Проверяем на ошибку
  if (action.error) {
    console.warn('[CampaignBuilder] LLM returned error:', action.error);
    throw new Error(`Campaign Builder: ${action.error}`);
  }

  // Валидация action
  if (action.type !== 'CreateCampaignWithCreative' && action.type !== 'CreateMultipleAdSets') {
    console.error('[CampaignBuilder] Invalid action type:', action.type);
    throw new Error('LLM returned invalid action type');
  }

  if (!action.params || !action.params.campaign_name) {
    console.error('[CampaignBuilder] Invalid action structure:', action);
    throw new Error('Invalid action structure from LLM');
  }

  // Валидация для single adset
  if (action.type === 'CreateCampaignWithCreative') {
    if (!action.params.user_creative_ids || !action.params.objective || !action.params.daily_budget_cents) {
      console.error('[CampaignBuilder] Invalid single adset params:', action.params);
      throw new Error('Invalid single adset params from LLM');
    }
    if (action.params.user_creative_ids.length === 0) {
      throw new Error('No creatives selected by LLM');
    }
    if (action.params.daily_budget_cents < 1000) {
      throw new Error('Budget less than minimum $10 per adset');
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
      if (adset.daily_budget_cents < 1000) {
        throw new Error(`Adset budget less than minimum $10: ${adset.adset_name}`);
      }
    }
  }

  if (action.type === 'CreateCampaignWithCreative') {
    console.log('[CampaignBuilder] Campaign action created (single adset):', {
      type: action.type,
      campaign_name: action.params.campaign_name,
      objective: action.params.objective,
      daily_budget: `$${action.params.daily_budget_cents! / 100}`,
      creatives_count: action.params.user_creative_ids!.length,
      confidence: action.confidence,
    });
  } else {
    console.log('[CampaignBuilder] Campaign action created (multiple adsets):', {
      type: action.type,
      campaign_name: action.params.campaign_name,
      adsets_count: action.params.adsets!.length,
      total_budget: `$${action.params.adsets!.reduce((sum: number, a: any) => sum + a.daily_budget_cents, 0) / 100}`,
      total_creatives: action.params.adsets!.reduce((sum: number, a: any) => sum + a.user_creative_ids.length, 0),
      confidence: action.confidence,
    });
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

