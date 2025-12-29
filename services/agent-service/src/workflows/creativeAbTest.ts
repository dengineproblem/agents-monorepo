import { graph } from '../adapters/facebook.js';
import { supabase } from '../lib/supabase.js';
import { getDirectionSettings, buildTargeting } from '../lib/settingsHelpers.js';
import { createLogger } from '../lib/logger.js';
import { saveAdCreativeMapping } from '../lib/adCreativeMapping.js';

const log = createLogger({ module: 'creativeAbTestWorkflow' });

function toParams(p: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) {
      o[k] = typeof v === 'object' ? JSON.stringify(v) : v;
    }
  }
  return o;
}

type StartAbTestParams = {
  creative_ids: string[];
  user_id: string;
  db_ad_account_id?: string;
  direction_id: string;
  total_budget_cents?: number;
  total_impressions?: number;
};

type AbTestContext = {
  ad_account_id: string;
  page_id?: string;
  instagram_id?: string;
};

type CreativeData = {
  id: string;
  direction_id: string;
  fb_creative_id: string;
  title: string;
  image_url: string;
  ocr_text: string | null;
  image_description: string | null;
  status: string;
};

type DirectionData = {
  id: string;
  name: string;
  objective: string;
};

/**
 * Workflow: Запуск A/B теста креативов
 *
 * Создаёт 1 кампанию + N adset-ов (по одному на креатив)
 * Бюджет $20 делится на N креативов
 */
export async function workflowStartAbTest(
  params: StartAbTestParams,
  context: AbTestContext,
  accessToken: string,
  creatives: CreativeData[],
  direction: DirectionData
) {
  const {
    creative_ids,
    user_id,
    db_ad_account_id,
    direction_id,
    total_budget_cents = 2000,
    total_impressions = 1000
  } = params;
  const { ad_account_id, page_id, instagram_id } = context;

  const workflowStartTime = Date.now();
  const creativesCount = creatives.length;
  const totalBudgetCents = total_budget_cents;
  const budgetPerCreative = Math.floor(totalBudgetCents / creativesCount);
  const impressionsPerCreative = Math.floor(total_impressions / creativesCount);

  log.info({
    user_id,
    direction_id,
    direction_name: direction.name,
    creatives_count: creativesCount,
    total_budget_cents: totalBudgetCents,
    budget_per_creative: budgetPerCreative,
    total_impressions,
    impressions_per_creative: impressionsPerCreative,
    creative_ids
  }, '[Workflow] Starting A/B test workflow');

  const normalized_ad_account_id = ad_account_id.startsWith('act_')
    ? ad_account_id
    : `act_${ad_account_id}`;

  const today = new Date().toISOString().split('T')[0];

  // Получаем настройки направления
  const defaultSettings = await getDirectionSettings(direction_id);

  // Определяем Facebook параметры по objective
  let fb_objective: string;
  let optimization_goal: string;
  let destination_type: string | undefined;
  let promoted_object: any;

  switch (direction.objective) {
    case 'whatsapp':
      fb_objective = 'OUTCOME_ENGAGEMENT';
      optimization_goal = 'CONVERSATIONS';
      destination_type = 'WHATSAPP';
      promoted_object = { page_id: String(page_id) };
      break;

    case 'instagram_traffic':
      fb_objective = 'OUTCOME_TRAFFIC';
      optimization_goal = 'LINK_CLICKS';
      destination_type = undefined;
      promoted_object = { page_id: String(page_id) };
      break;

    case 'site_leads':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'OFFSITE_CONVERSIONS';
      destination_type = 'WEBSITE';
      if (defaultSettings?.pixel_id) {
        promoted_object = {
          pixel_id: String(defaultSettings.pixel_id),
          custom_event_type: 'LEAD'
        };
      } else {
        promoted_object = { custom_event_type: 'LEAD' };
      }
      break;

    case 'lead_forms':
      fb_objective = 'OUTCOME_LEADS';
      optimization_goal = 'LEAD_GENERATION';
      destination_type = 'ON_AD';
      promoted_object = { page_id: String(page_id) };
      break;

    default:
      throw new Error(`Unsupported objective: ${direction.objective}`);
  }

  // Строим таргетинг
  const targeting = buildTargeting(defaultSettings, direction.objective);

  // Создаём кампанию
  const campaign_name = `A/B ТЕСТ | ${direction.objective} | ${creativesCount} креативов | ${today}`;

  log.info({
    campaign_name,
    fb_objective,
    optimization_goal,
    destination_type: destination_type || 'none',
    ad_account_id: normalized_ad_account_id
  }, '[Workflow] Creating campaign');

  let campaign_id: string;
  try {
    const campaignResult = await graph(
      'POST',
      `${normalized_ad_account_id}/campaigns`,
      accessToken,
      toParams({
        name: campaign_name,
        objective: fb_objective,
        special_ad_categories: [],
        status: 'ACTIVE',
        is_adset_budget_sharing_enabled: false
      })
    );

    campaign_id = campaignResult?.id;
    if (!campaign_id) {
      throw new Error('No campaign_id returned from Facebook API');
    }
  } catch (err: any) {
    log.error({
      error: err.message,
      fb_error: err.fb,
      elapsed_ms: Date.now() - workflowStartTime
    }, '[Workflow] Failed to create campaign');
    throw new Error(`Failed to create A/B test campaign: ${err.message}`);
  }

  log.info({
    campaign_id,
    elapsed_ms: Date.now() - workflowStartTime
  }, '[Workflow] Campaign created successfully');

  // Создаём запись теста в БД
  const { data: testRecord, error: testError } = await supabase
    .from('creative_ab_tests')
    .insert({
      user_id,
      account_id: db_ad_account_id || null,
      direction_id,
      campaign_id,
      status: 'running',
      total_budget_cents: totalBudgetCents,
      impressions_per_creative: impressionsPerCreative,
      creatives_count: creativesCount,
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (testError || !testRecord) {
    log.error({ err: testError }, 'Failed to create A/B test record');
    throw new Error('Failed to create A/B test record');
  }

  const test_id = testRecord.id;
  log.info({ test_id }, 'A/B test record created');

  // Создаём adset и ad для каждого креатива
  const createdItems: Array<{
    creative_id: string;
    adset_id: string;
    ad_id: string;
    item_id?: string;
  }> = [];

  // Функция для rollback в случае ошибки
  const rollbackCreatedItems = async () => {
    log.warn({
      campaign_id,
      created_items_count: createdItems.length
    }, '[Workflow] Rolling back created adsets/ads');

    for (const item of createdItems) {
      try {
        if (item.adset_id) {
          await graph('POST', item.adset_id, accessToken, { status: 'PAUSED' });
          log.info({ adset_id: item.adset_id }, '[Workflow] Rollback: AdSet paused');
        }
      } catch (err: any) {
        log.warn({ adset_id: item.adset_id, error: err.message }, '[Workflow] Rollback: Failed to pause AdSet');
      }
    }

    // Паузим кампанию
    try {
      await graph('POST', campaign_id, accessToken, { status: 'PAUSED' });
      log.info({ campaign_id }, '[Workflow] Rollback: Campaign paused');
    } catch (err: any) {
      log.warn({ campaign_id, error: err.message }, '[Workflow] Rollback: Failed to pause campaign');
    }
  };

  for (let i = 0; i < creatives.length; i++) {
    const creative = creatives[i];
    const itemIndex = i + 1;
    const itemStartTime = Date.now();

    log.info({
      creative_id: creative.id,
      creative_title: creative.title,
      item_index: itemIndex,
      total_items: creatives.length,
      fb_creative_id: creative.fb_creative_id
    }, '[Workflow] Creating adset for creative');

    // Создаём AdSet
    const adset_name = `${campaign_name} | Креатив ${itemIndex}`;
    const adsetBody: any = {
      name: adset_name,
      campaign_id,
      status: 'ACTIVE',
      billing_event: 'IMPRESSIONS',
      optimization_goal,
      daily_budget: budgetPerCreative,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      promoted_object
    };

    if (destination_type) {
      adsetBody.destination_type = destination_type;
    }

    let adset_id: string;
    try {
      const adsetResult = await graph(
        'POST',
        `${normalized_ad_account_id}/adsets`,
        accessToken,
        toParams(adsetBody)
      );

      adset_id = adsetResult?.id;
      if (!adset_id) {
        throw new Error('No adset_id returned from Facebook API');
      }
    } catch (err: any) {
      log.error({
        creative_id: creative.id,
        error: err.message,
        fb_error: err.fb,
        item_index: itemIndex
      }, '[Workflow] Failed to create AdSet');

      // Rollback previously created items
      await rollbackCreatedItems();
      throw new Error(`Failed to create adset for creative ${creative.id}: ${err.message}`);
    }

    log.info({
      adset_id,
      creative_id: creative.id,
      elapsed_ms: Date.now() - itemStartTime
    }, '[Workflow] AdSet created');

    // Создаём Ad
    const ad_name = `${adset_name} - Ad`;
    let ad_id: string;
    try {
      const adResult = await graph(
        'POST',
        `${normalized_ad_account_id}/ads`,
        accessToken,
        toParams({
          name: ad_name,
          adset_id,
          status: 'ACTIVE',
          creative: { creative_id: creative.fb_creative_id }
        })
      );

      ad_id = adResult?.id;
      if (!ad_id) {
        throw new Error('No ad_id returned from Facebook API');
      }
    } catch (err: any) {
      log.error({
        creative_id: creative.id,
        adset_id,
        error: err.message,
        fb_error: err.fb
      }, '[Workflow] Failed to create Ad');

      // Rollback including the just-created adset
      createdItems.push({ creative_id: creative.id, adset_id, ad_id: '' });
      await rollbackCreatedItems();
      throw new Error(`Failed to create ad for creative ${creative.id}: ${err.message}`);
    }

    log.info({
      ad_id,
      adset_id,
      creative_id: creative.id,
      elapsed_ms: Date.now() - itemStartTime
    }, '[Workflow] Ad created');

    // Сохраняем маппинг
    await saveAdCreativeMapping({
      ad_id,
      user_creative_id: creative.id,
      direction_id,
      user_id,
      account_id: db_ad_account_id || null,
      adset_id,
      campaign_id,
      fb_creative_id: creative.fb_creative_id,
      source: 'creative_test'
    });

    // Создаём запись item в БД
    const { data: itemRecord, error: itemError } = await supabase
      .from('creative_ab_test_items')
      .insert({
        test_id,
        user_creative_id: creative.id,
        adset_id,
        ad_id,
        budget_cents: budgetPerCreative,
        impressions_limit: impressionsPerCreative,
        extracted_offer_text: creative.ocr_text || null,
        extracted_image_description: creative.image_description || null
      })
      .select()
      .single();

    if (itemError) {
      log.warn({ err: itemError, creative_id: creative.id }, 'Failed to create test item record');
    }

    createdItems.push({
      creative_id: creative.id,
      adset_id,
      ad_id,
      item_id: itemRecord?.id
    });

    log.info({
      creative_id: creative.id,
      item_index: itemIndex,
      item_id: itemRecord?.id,
      elapsed_ms: Date.now() - itemStartTime
    }, '[Workflow] Item created and saved');
  }

  const totalElapsed = Date.now() - workflowStartTime;

  log.info({
    test_id,
    campaign_id,
    items_count: createdItems.length,
    total_budget_cents: totalBudgetCents,
    budget_per_creative_cents: budgetPerCreative,
    impressions_per_creative: impressionsPerCreative,
    elapsed_ms: totalElapsed
  }, '[Workflow] A/B test workflow completed successfully');

  return {
    success: true,
    test_id,
    campaign_id,
    items: createdItems.map(item => ({
      id: item.item_id,
      user_creative_id: item.creative_id,
      adset_id: item.adset_id,
      ad_id: item.ad_id,
      impressions_limit: impressionsPerCreative
    })),
    budget_per_creative_cents: budgetPerCreative,
    impressions_per_creative: impressionsPerCreative,
    message: `A/B test started with ${creativesCount} creatives. Budget: $${(budgetPerCreative / 100).toFixed(2)}/creative, Target: ${impressionsPerCreative} impressions each`
  };
}

/**
 * Собирает метрики для одного ad
 */
export async function fetchAbTestInsights(ad_id: string, accessToken: string) {
  const fetchStartTime = Date.now();

  try {
    const fields = [
      'impressions',
      'reach',
      'clicks',
      'actions',
      'spend',
      'cpm',
      'cpc',
      'ctr'
    ].join(',');

    log.debug({ ad_id }, '[Insights] Fetching insights for ad');

    const result = await graph(
      'GET',
      `${ad_id}/insights`,
      accessToken,
      { fields, date_preset: 'today' }
    );

    const data = result?.data?.[0] || {};

    // Извлекаем link_clicks из actions
    let link_clicks = 0;
    let leads = 0;
    if (data.actions) {
      for (const action of data.actions) {
        if (action.action_type === 'link_click') {
          link_clicks = parseInt(action.value, 10) || 0;
        }
        if (action.action_type === 'lead' ||
            action.action_type === 'offsite_conversion.fb_pixel_lead' ||
            action.action_type === 'onsite_conversion.total_messaging_connection') {
          leads += parseInt(action.value, 10) || 0;
        }
      }
    }

    const impressions = parseInt(data.impressions, 10) || 0;
    const clicks = parseInt(data.clicks, 10) || 0;
    const spend_cents = Math.round((parseFloat(data.spend) || 0) * 100);
    const ctr = parseFloat(data.ctr) || 0;
    const link_ctr = impressions > 0 ? (link_clicks / impressions) * 100 : 0;
    const cpm_cents = Math.round((parseFloat(data.cpm) || 0) * 100);
    const cpc_cents = Math.round((parseFloat(data.cpc) || 0) * 100);
    const cpl_cents = leads > 0 ? Math.round(spend_cents / leads) : null;

    const insights = {
      impressions,
      reach: parseInt(data.reach, 10) || 0,
      clicks,
      link_clicks,
      ctr,
      link_ctr,
      leads,
      spend_cents,
      cpm_cents,
      cpc_cents,
      cpl_cents
    };

    log.debug({
      ad_id,
      impressions,
      clicks,
      leads,
      spend_cents,
      elapsed_ms: Date.now() - fetchStartTime
    }, '[Insights] Fetched insights successfully');

    return insights;
  } catch (error: any) {
    log.warn({
      ad_id,
      error: error.message,
      elapsed_ms: Date.now() - fetchStartTime
    }, '[Insights] Failed to fetch insights');
    return {
      impressions: 0,
      reach: 0,
      clicks: 0,
      link_clicks: 0,
      ctr: 0,
      link_ctr: 0,
      leads: 0,
      spend_cents: 0,
      cpm_cents: null,
      cpc_cents: null,
      cpl_cents: null
    };
  }
}

/**
 * Анализирует результаты A/B теста и сохраняет инсайты
 */
export async function analyzeAbTestResults(test_id: string) {
  const analyzeStartTime = Date.now();

  log.info({ test_id }, '[Analyze] Starting A/B test analysis');

  // Получаем тест с items
  const { data: test, error: testError } = await supabase
    .from('creative_ab_tests')
    .select(`
      *,
      items:creative_ab_test_items(
        *,
        creative:user_creatives(id, title, ocr_text, image_description)
      )
    `)
    .eq('id', test_id)
    .single();

  if (testError || !test) {
    log.error({ test_id, error: testError?.message }, '[Analyze] A/B test not found');
    throw new Error('A/B test not found');
  }

  log.info({
    test_id,
    items_count: test.items?.length,
    total_impressions: test.items?.reduce((sum: number, i: any) => sum + (i.impressions || 0), 0)
  }, '[Analyze] Test data loaded');

  // Ранжируем по CTR (или CPL если есть лиды)
  const hasLeads = test.items.some((item: any) => item.leads > 0);
  const sortedItems = [...test.items].sort((a: any, b: any) => {
    if (hasLeads) {
      // По CPL (меньше = лучше), null = хуже всех
      const aCpl = a.cpl_cents ?? Infinity;
      const bCpl = b.cpl_cents ?? Infinity;
      return aCpl - bCpl;
    }
    // По CTR (больше = лучше)
    return (b.ctr || 0) - (a.ctr || 0);
  });

  // Присваиваем ранги и обновляем в БД
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const rank = i + 1;

    await supabase
      .from('creative_ab_test_items')
      .update({ rank })
      .eq('id', item.id);
  }

  const winner = sortedItems[0];
  const winnerId = winner?.user_creative_id;

  log.info({
    test_id,
    metric_used: hasLeads ? 'cpl' : 'ctr',
    winner_creative_id: winnerId,
    winner_ctr: winner?.ctr,
    winner_cpl_cents: winner?.cpl_cents,
    ranking: sortedItems.map((item: any, idx: number) => ({
      rank: idx + 1,
      creative_id: item.user_creative_id,
      ctr: item.ctr,
      cpl_cents: item.cpl_cents
    }))
  }, '[Analyze] Ranking calculated');

  // Формируем анализ
  const analysisJson = {
    ranking: sortedItems.map((item: any, idx: number) => ({
      rank: idx + 1,
      creative_id: item.user_creative_id,
      title: item.creative?.title,
      ocr_text: item.extracted_offer_text,
      image_description: item.extracted_image_description,
      impressions: item.impressions,
      ctr: item.ctr,
      leads: item.leads,
      cpl_cents: item.cpl_cents
    })),
    winner: {
      creative_id: winnerId,
      ocr_text: winner?.extracted_offer_text,
      image_description: winner?.extracted_image_description
    },
    metric_used: hasLeads ? 'cpl' : 'ctr',
    analyzed_at: new Date().toISOString()
  };

  // Обновляем тест
  await supabase
    .from('creative_ab_tests')
    .update({
      status: 'completed',
      winner_creative_id: winnerId,
      analysis_json: analysisJson,
      completed_at: new Date().toISOString()
    })
    .eq('id', test_id);

  // Сохраняем инсайты в conversation_insights
  log.info({ test_id }, '[Analyze] Saving insights to conversation_insights');
  await saveAbTestInsights(test, sortedItems);

  const totalElapsed = Date.now() - analyzeStartTime;

  log.info({
    test_id,
    winner_id: winnerId,
    metric: hasLeads ? 'cpl' : 'ctr',
    insights_saved: sortedItems.length * 2, // offer_text + creative_image per item
    elapsed_ms: totalElapsed
  }, '[Analyze] A/B test analysis completed');

  return analysisJson;
}

/**
 * Сохраняет инсайты из A/B теста в conversation_insights
 */
async function saveAbTestInsights(test: any, rankedItems: any[]) {
  // Получаем user_account_id
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('id')
    .eq('id', test.user_id)
    .single();

  if (!userAccount) {
    log.warn({ user_id: test.user_id }, 'User account not found for saving insights');
    return;
  }

  for (const item of rankedItems) {
    const isWinner = item.rank === 1;

    // Сохраняем оффер (текст)
    if (item.extracted_offer_text) {
      await saveOrUpdateInsight({
        user_account_id: userAccount.id,
        category: 'offer_text',
        content: item.extracted_offer_text,
        metadata: {
          last_ctr: item.ctr,
          last_cpl_cents: item.cpl_cents,
          last_rank: item.rank,
          is_winner: isWinner,
          test_id: test.id
        }
      });
    }

    // Сохраняем образ (описание)
    if (item.extracted_image_description) {
      await saveOrUpdateInsight({
        user_account_id: userAccount.id,
        category: 'creative_image',
        content: item.extracted_image_description,
        metadata: {
          last_ctr: item.ctr,
          last_cpl_cents: item.cpl_cents,
          last_rank: item.rank,
          is_winner: isWinner,
          test_id: test.id
        }
      });
    }
  }
}

/**
 * Сохраняет или обновляет инсайт (с подсчётом occurrence_count)
 */
async function saveOrUpdateInsight(params: {
  user_account_id: string;
  category: 'offer_text' | 'creative_image';
  content: string;
  metadata: any;
}) {
  const { user_account_id, category, content, metadata } = params;

  // Ищем похожий инсайт (простое сравнение, без embeddings для MVP)
  const { data: existing } = await supabase
    .from('conversation_insights')
    .select('id, occurrence_count, metadata')
    .eq('user_account_id', user_account_id)
    .eq('category', category)
    .eq('content', content)
    .maybeSingle();

  if (existing) {
    // Обновляем существующий
    const newMetadata = {
      ...existing.metadata,
      ...metadata,
      wins: (existing.metadata?.wins || 0) + (metadata.is_winner ? 1 : 0),
      tests: (existing.metadata?.tests || 0) + 1
    };

    await supabase
      .from('conversation_insights')
      .update({
        occurrence_count: existing.occurrence_count + 1,
        metadata: newMetadata,
        last_seen_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    log.info({
      insight_id: existing.id,
      category,
      occurrence_count: existing.occurrence_count + 1
    }, 'Updated existing insight');
  } else {
    // Создаём новый
    const newMetadata = {
      ...metadata,
      wins: metadata.is_winner ? 1 : 0,
      tests: 1
    };

    const { error } = await supabase
      .from('conversation_insights')
      .insert({
        user_account_id,
        category,
        content,
        metadata: newMetadata,
        occurrence_count: 1,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      });

    if (error) {
      log.warn({ error: error.message, category, content: content.substring(0, 50) }, 'Failed to create insight');
    } else {
      log.info({ category, content: content.substring(0, 50) }, 'Created new insight');
    }
  }
}
