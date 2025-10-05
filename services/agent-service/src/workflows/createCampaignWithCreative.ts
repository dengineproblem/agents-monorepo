import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';

type ObjectiveType = 'WhatsApp' | 'Instagram' | 'SiteLeads';

type CreateCampaignParams = {
  user_creative_id: string;
  objective: ObjectiveType;
  campaign_name: string;
  adset_name?: string;
  ad_name?: string;
  daily_budget_cents: number;
  targeting?: any;
  page_id?: string;
  instagram_id?: string;
};

type CreateCampaignContext = {
  user_account_id: string;
  ad_account_id: string;
};

// Helpers from campaignDuplicate
function toParams(p: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) {
      o[k] = typeof v === 'object' ? JSON.stringify(v) : v;
    }
  }
  return o;
}

function withStep(step: string, payload: Record<string, any>, fn: () => Promise<any>) {
  return fn().catch((e: any) => {
    e.step = step;
    e.payload = payload;
    throw e;
  });
}

/**
 * Workflow: Создание новой кампании с креативом из Supabase
 */
export async function workflowCreateCampaignWithCreative(
  params: CreateCampaignParams,
  context: CreateCampaignContext,
  accessToken: string
) {
  const {
    user_creative_id,
    objective,
    campaign_name,
    adset_name,
    ad_name,
    daily_budget_cents,
    targeting,
    page_id,
    instagram_id
  } = params;

  const { user_account_id, ad_account_id } = context;

  console.log('[CreateCampaignWithCreative] Starting workflow:', {
    user_creative_id,
    objective,
    campaign_name,
    daily_budget_cents
  });

  // ===================================================
  // STEP 1: Получаем креатив из Supabase
  // ===================================================
  const { data: creative, error: creativeError } = await supabase
    .from('user_creatives')
    .select('*')
    .eq('id', user_creative_id)
    .eq('user_id', user_account_id)
    .eq('status', 'ready')
    .single();

  if (creativeError || !creative) {
    throw new Error(`Creative not found or not ready: ${user_creative_id}`);
  }

  console.log('[CreateCampaignWithCreative] Creative found:', {
    id: creative.id,
    title: creative.title
  });

  // ===================================================
  // STEP 2: Определяем fb_creative_id и objective
  // ===================================================
  let fb_creative_id: string | null = null;
  let fb_objective: string = 'OUTCOME_ENGAGEMENT';
  let optimization_goal: string = 'REACH';
  let destination_type: string | undefined = undefined;

  switch (objective) {
    case 'WhatsApp':
      fb_creative_id = creative.fb_creative_id_whatsapp;
      fb_objective = 'OUTCOME_ENGAGEMENT';
      optimization_goal = 'CONVERSATIONS';
      destination_type = 'WHATSAPP';
      break;
    case 'Instagram':
      fb_creative_id = creative.fb_creative_id_instagram_traffic;
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      break;
    case 'SiteLeads':
      fb_creative_id = creative.fb_creative_id_site_leads;
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      break;
    default:
      throw new Error(`Unknown objective: ${objective}`);
  }

  if (!fb_creative_id) {
    throw new Error(`Creative ${user_creative_id} does not have fb_creative_id for ${objective}`);
  }

  console.log('[CreateCampaignWithCreative] Using creative_id:', fb_creative_id);

  // Нормализуем ad_account_id
  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  // ===================================================
  // STEP 3: Создаем Campaign (КАК В ДУБЛИРОВАНИИ)
  // ===================================================
  const campaignBody: any = {
    name: campaign_name,
    objective: fb_objective,
    special_ad_categories: [], // Требуется Facebook, даже если пустой
    status: 'PAUSED'
  };

  console.log('[CreateCampaignWithCreative] Creating campaign:', campaignBody);

  const campaignResult = await withStep(
    'create_campaign',
    { path: `${normalized_ad_account_id}/campaigns`, body: campaignBody },
    () => graph('POST', `${normalized_ad_account_id}/campaigns`, accessToken, toParams(campaignBody))
  );

  const campaign_id = campaignResult?.id;
  if (!campaign_id) {
    throw Object.assign(new Error('create_campaign_failed'), { step: 'create_campaign_no_id' });
  }

  console.log('[CreateCampaignWithCreative] Campaign created:', campaign_id);

  // ===================================================
  // STEP 4: Создаем AdSet (КАК В ДУБЛИРОВАНИИ)
  // ===================================================
  const finalTargeting = targeting || getDefaultTargeting();
  const finalAdsetName = adset_name || `${campaign_name} - AdSet 1`;

  const adsetBody: any = {
    name: finalAdsetName,
    campaign_id,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal,
    daily_budget: daily_budget_cents,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: finalTargeting
  };

  // Для WhatsApp добавляем promoted_object и destination_type
  if (objective === 'WhatsApp' && page_id) {
    adsetBody.destination_type = 'WHATSAPP';
    adsetBody.promoted_object = {
      page_id: String(page_id)
    };
  }

  console.log('[CreateCampaignWithCreative] Creating adset:', {
    campaign_id,
    name: finalAdsetName,
    optimization_goal,
    destination_type: adsetBody.destination_type
  });

  const adsetResult = await withStep(
    'create_adset',
    { payload: adsetBody },
    () => graph('POST', `${normalized_ad_account_id}/adsets`, accessToken, toParams(adsetBody))
  );

  const adset_id = adsetResult?.id;
  if (!adset_id) {
    throw Object.assign(new Error('create_adset_failed'), { step: 'create_adset_no_id' });
  }

  console.log('[CreateCampaignWithCreative] AdSet created:', adset_id);

  // ===================================================
  // STEP 5: Создаем Ad (КАК В ДУБЛИРОВАНИИ)
  // ===================================================
  const finalAdName = ad_name || `${campaign_name} - Ad 1`;

  const adBody: any = {
    name: finalAdName,
    adset_id,
    status: 'PAUSED',
    creative: { creative_id: fb_creative_id }
  };

  console.log('[CreateCampaignWithCreative] Creating ad:', {
    adset_id,
    fb_creative_id
  });

  const adResult = await withStep(
    'create_ad',
    { payload: adBody },
    () => graph('POST', `${normalized_ad_account_id}/ads`, accessToken, toParams(adBody))
  );

  const ad_id = adResult?.id;
  if (!ad_id) {
    throw Object.assign(new Error('create_ad_failed'), { step: 'create_ad_no_id' });
  }

  console.log('[CreateCampaignWithCreative] Ad created:', ad_id);

  // ===================================================
  // RETURN
  // ===================================================
  return {
    success: true,
    campaign_id: String(campaign_id),
    adset_id: String(adset_id),
    ad_id: String(ad_id),
    fb_creative_id,
    objective,
    message: `Campaign "${campaign_name}" created successfully with adset and ad (all PAUSED)`,
  };
}

/**
 * Дефолтный таргетинг (Россия, 18-65, все гендеры)
 */
function getDefaultTargeting() {
  return {
    geo_locations: {
      countries: ['KZ'], // Казахстан (RU заблокирована Meta)
    },
    age_min: 18,
    age_max: 65,
    genders: [1, 2],
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'right_hand_column', 'instant_article', 'instream_video', 'marketplace'],
    instagram_positions: ['stream', 'story', 'explore', 'reels'],
  };
}