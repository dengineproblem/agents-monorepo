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
    log.warn({ err: scoresError, userAccountId }, 'Error fetching scores');
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

  log.info({ count: result.length }, 'Prepared creatives with scoring data');
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
    .select('username')
    .eq('id', user_account_id)
    .single();

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
    requestedBudgetCents: requested_budget_cents,
  }, 'Building campaign action');

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
    objective: objectiveToLLMFormat(objective),
    requested_campaign_name: campaign_name,
    requested_budget_cents,
    user_context: additional_context,
  };

  log.debug({
    creativesCount: llmInput.available_creatives.length,
    budgetConstraints: llmInput.budget_constraints,
  }, 'LLM input prepared');

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
  log.info('OpenAI API response received');

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
  if (action.type !== 'CreateCampaignWithCreative' && action.type !== 'CreateMultipleAdSets') {
    log.error({ action }, 'Invalid action type from LLM');
    throw new Error('LLM returned invalid action type');
  }

  if (!action.params || !action.params.campaign_name) {
    log.error({ action }, 'Invalid action structure from LLM');
    throw new Error('Invalid action structure from LLM');
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
 * Получить дефолтные настройки для направления
 */
export async function getDefaultSettings(directionId: string) {
  const { data, error } = await supabase
    .from('default_ad_settings')
    .select('*')
    .eq('direction_id', directionId)
    .maybeSingle();

  if (error) {
    log.error({ err: error, directionId }, 'Error fetching default settings');
    return null;
  }

  return data;
}

/**
 * Построить таргетинг из дефолтных настроек
 */
export function buildTargeting(defaultSettings: any, objective: CampaignObjective) {
  if (!defaultSettings) {
    // Дефолтный таргетинг если настроек нет
    return {
      geo_locations: { countries: ['RU'] },
      age_min: 18,
      age_max: 65,
    };
  }

  const targeting: any = {
    age_min: defaultSettings.age_min || 18,
    age_max: defaultSettings.age_max || 65,
  };

  // Пол
  if (defaultSettings.gender && defaultSettings.gender !== 'all') {
    targeting.genders = defaultSettings.gender === 'male' ? [1] : [2];
  }

  // Гео-локации (читаем из поля cities в БД)
  if (defaultSettings.cities && Array.isArray(defaultSettings.cities) && defaultSettings.cities.length > 0) {
    const countries: string[] = [];
    const cities: string[] = [];
    
    for (const item of defaultSettings.cities) {
      if (typeof item === 'string' && item.length === 2 && item === item.toUpperCase()) {
        // 2 заглавные буквы = код страны (RU, KZ, BY, US)
        countries.push(item);
      } else {
        // Все остальное = ID города
        cities.push(item);
      }
    }
    
    targeting.geo_locations = {};
    
    if (countries.length > 0) {
      targeting.geo_locations.countries = countries;
    }
    
    if (cities.length > 0) {
      targeting.geo_locations.cities = cities.map((cityId: string) => ({
        key: cityId,
      }));
    }
    
    // Если ничего не распознано - по умолчанию Россия
    if (countries.length === 0 && cities.length === 0) {
      targeting.geo_locations.countries = ['RU'];
    }
  } else {
    // Default: таргетинг на Россию
    targeting.geo_locations = { countries: ['RU'] };
  }

  return targeting;
}

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
      return 'LEAD_GENERATION';
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
  if (optimization_goal === 'CONVERSATIONS' && promoted_object?.whatsapp_phone_number) {
    body.destination_type = 'WHATSAPP';
  }

  if (promoted_object) {
    body.promoted_object = promoted_object;
  }

  const response = await fetch(
    `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/adsets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    log.error({ err: error, campaignId, name }, 'Failed to create ad set');
    throw new Error(`Failed to create ad set: ${JSON.stringify(error)}`);
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
}) {
  const { adsetId, adAccountId, creatives, accessToken, objective } = params;

  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  log.info({ adsetId, creativeCount: creatives.length }, 'Creating ads in ad set');

  const ads = [];

  for (const creative of creatives) {
    const creativeId = getCreativeIdForObjective(creative, objective);
    
    if (!creativeId) {
      log.warn({ creativeId: creative.user_creative_id, objective }, 'No Facebook creative ID for creative');
      continue;
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAdAccountId}/ads`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: accessToken,
            name: `Ad - ${creative.title}`,
            adset_id: adsetId,
            creative: { creative_id: creativeId },
            status: 'ACTIVE',
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        log.error({ err: error, creativeId: creative.user_creative_id }, 'Failed to create ad');
        continue;
      }

      const ad = await response.json();
      log.info({ adId: ad.id, creativeId: creative.user_creative_id }, 'Ad created successfully');
      ads.push(ad);
    } catch (error: any) {
      log.error({ err: error, adsetId, creativeId: creative.user_creative_id }, 'Error creating ad');
    }
  }

  return ads;
}

