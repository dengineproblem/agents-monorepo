/**
 * RESULT NORMALIZER SERVICE
 *
 * Нормализация результатов по семействам (result_family):
 * - messages: начало переписки
 * - leadgen_form: лиды из форм
 * - website_lead: pixel/capi lead
 * - purchase: покупки
 * - click: link_clicks
 * - video_view: просмотры видео
 * - app_install: установки приложений
 */

import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'resultNormalizer' });

// Маппинг action_type → result_family (fallback если нет в БД)
const ACTION_TYPE_FAMILY_MAP: Record<string, string> = {
  // Messages
  'onsite_conversion.messaging_conversation_started_7d': 'messages',
  'onsite_conversion.messaging_first_reply': 'messages',
  'messaging_first_reply': 'messages',
  'messaging_conversation_started_7d': 'messages',

  // Leadgen form
  'lead': 'leadgen_form',
  'leadgen_grouped': 'leadgen_form',
  'onsite_conversion.lead_grouped': 'leadgen_form',

  // Website lead (pixel)
  'offsite_conversion.fb_pixel_lead': 'website_lead',
  'offsite_conversion.fb_pixel_complete_registration': 'website_lead',
  'offsite_conversion.fb_pixel_submit_application': 'website_lead',

  // Purchase
  'offsite_conversion.fb_pixel_purchase': 'purchase',
  'onsite_conversion.purchase': 'purchase',
  'purchase': 'purchase',

  // Click
  'link_click': 'click',
  'landing_page_view': 'click',
  'outbound_click': 'click',

  // Video
  'video_view': 'video_view',

  // App install
  'app_install': 'app_install',
  'mobile_app_install': 'app_install',
};

// Маппинг optimization_goal → приоритетные семейства
const OPTIMIZATION_GOAL_FAMILIES: Record<string, string[]> = {
  'LEAD_GENERATION': ['leadgen_form', 'website_lead'],
  'CONVERSATIONS': ['messages'],
  'LINK_CLICKS': ['click'],
  'LANDING_PAGE_VIEWS': ['click'],
  'VALUE': ['purchase', 'website_lead'],
  'OFFSITE_CONVERSIONS': ['purchase', 'website_lead', 'leadgen_form'],
  'APP_INSTALLS': ['app_install'],
  'REACH': ['click'],
  'IMPRESSIONS': ['click'],
  'THRUPLAY': ['video_view', 'click'],
  'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS': ['video_view'],
};

interface ActionItem {
  action_type: string;
  value: string;
}

interface CostPerActionItem {
  action_type: string;
  value: string;
}

interface FamilyResult {
  family: string;
  count: number;
  cost: number;
  cpr: number | null;
  actionTypes: { actionType: string; count: number }[];
}

// ============================================================================
// CORE NORMALIZATION
// ============================================================================

/**
 * Загружает маппинг action_type → family из БД
 */
async function loadActionTypeMapping(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('action_type_family_mapping')
    .select('action_type, result_family');

  const map = new Map<string, string>();

  // Сначала загружаем дефолтный маппинг
  for (const [actionType, family] of Object.entries(ACTION_TYPE_FAMILY_MAP)) {
    map.set(actionType, family);
  }

  // Потом перезаписываем значениями из БД
  if (data) {
    for (const row of data) {
      map.set(row.action_type, row.result_family);
    }
  }

  return map;
}

/**
 * Группирует actions по семействам
 */
function groupActionsByFamily(
  actions: ActionItem[],
  costPerAction: CostPerActionItem[],
  spend: number,
  actionTypeMap: Map<string, string>
): Map<string, FamilyResult> {
  const familyResults = new Map<string, FamilyResult>();

  // Создаём map cost по action_type
  const costMap = new Map<string, number>();
  for (const cpa of costPerAction || []) {
    costMap.set(cpa.action_type, parseFloat(cpa.value) || 0);
  }

  // Группируем actions по семействам
  for (const action of actions || []) {
    const family = actionTypeMap.get(action.action_type) || 'other';
    const count = parseInt(action.value) || 0;
    const cost = costMap.get(action.action_type) || 0;

    if (!familyResults.has(family)) {
      familyResults.set(family, {
        family,
        count: 0,
        cost: 0,
        cpr: null,
        actionTypes: [],
      });
    }

    const result = familyResults.get(family)!;
    result.count += count;
    result.cost += cost * count; // cost_per_action * count
    result.actionTypes.push({ actionType: action.action_type, count });
  }

  // Вычисляем CPR для каждого семейства
  for (const [family, result] of familyResults) {
    if (result.count > 0) {
      // Предпочитаем cost из cost_per_action, иначе делим spend пропорционально
      if (result.cost > 0) {
        result.cpr = result.cost / result.count;
      } else {
        // Fallback: весь spend / count (грубо, но лучше чем ничего)
        result.cpr = spend / result.count;
      }
    }
  }

  return familyResults;
}

/**
 * Определяет primary_family для ad на основе optimization_goal и данных
 */
async function determinePrimaryFamily(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string,
  familyResults: Map<string, FamilyResult>
): Promise<string> {
  // 1. Получаем optimization_goal из adset
  const { data: ad } = await supabase
    .from('meta_ads')
    .select('fb_adset_id')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .single();

  let optimizationGoal: string | null = null;
  let allowedFamilies: string[] = [];

  if (ad?.fb_adset_id) {
    const { data: adset } = await supabase
      .from('meta_adsets')
      .select('optimization_goal')
      .eq('ad_account_id', adAccountId)
      .eq('fb_adset_id', ad.fb_adset_id)
      .single();

    optimizationGoal = adset?.optimization_goal;
  }

  // 2. Получаем допустимые семейства для этого optimization_goal
  if (optimizationGoal) {
    allowedFamilies = OPTIMIZATION_GOAL_FAMILIES[optimizationGoal] || [];
  }

  // 3. Выбираем семейство с наибольшим количеством результатов за последние 8 недель
  const { data: historicalResults } = await supabase
    .from('meta_weekly_results')
    .select('result_family, result_count')
    .eq('ad_account_id', adAccountId)
    .eq('fb_ad_id', fbAdId)
    .lt('week_start_date', weekStartDate)
    .order('week_start_date', { ascending: false })
    .limit(8);

  // Суммируем результаты по семействам
  const familyCounts = new Map<string, number>();
  for (const row of historicalResults || []) {
    const current = familyCounts.get(row.result_family) || 0;
    familyCounts.set(row.result_family, current + (row.result_count || 0));
  }

  // Добавляем текущую неделю
  for (const [family, result] of familyResults) {
    const current = familyCounts.get(family) || 0;
    familyCounts.set(family, current + result.count);
  }

  // 4. Выбираем лучшее семейство
  let bestFamily = 'click';
  let bestCount = 0;

  for (const [family, count] of familyCounts) {
    // Если есть allowed families, фильтруем
    if (allowedFamilies.length > 0 && !allowedFamilies.includes(family)) {
      continue;
    }

    if (count > bestCount) {
      bestCount = count;
      bestFamily = family;
    }
  }

  // 5. Fallback логика
  if (bestCount === 0) {
    if (familyResults.has('messages')) return 'messages';
    if (familyResults.has('leadgen_form')) return 'leadgen_form';
    if (familyResults.has('website_lead')) return 'website_lead';
    return 'click';
  }

  return bestFamily;
}

// ============================================================================
// NORMALIZATION PIPELINE
// ============================================================================

/**
 * Нормализует результаты для одной недели одного ad
 */
export async function normalizeWeeklyResults(
  adAccountId: string,
  fbAdId: string,
  weekStartDate: string,
  spend: number,
  actionsJson: ActionItem[],
  costPerActionTypeJson: CostPerActionItem[]
): Promise<void> {
  const actionTypeMap = await loadActionTypeMapping();

  // Группируем по семействам
  const familyResults = groupActionsByFamily(
    actionsJson,
    costPerActionTypeJson,
    spend,
    actionTypeMap
  );

  // Добавляем clicks как отдельное семейство если есть link_clicks в insights
  // (это обрабатывается в sync сервисе)

  // Сохраняем результаты по семействам
  for (const [family, result] of familyResults) {
    if (result.count === 0 && spend === 0) continue;

    const { error } = await supabase
      .from('meta_weekly_results')
      .upsert({
        ad_account_id: adAccountId,
        fb_ad_id: fbAdId,
        week_start_date: weekStartDate,
        result_family: family,
        result_count: result.count,
        spend: result.cost > 0 ? result.cost : spend, // Если нет cost, используем общий spend
        cpr: result.cpr,
        action_types_detail: result.actionTypes,
      }, {
        onConflict: 'ad_account_id,fb_ad_id,week_start_date,result_family'
      });

    if (error) {
      log.error({ error, adAccountId, fbAdId, weekStartDate, family }, 'Failed to upsert weekly result');
    }
  }
}

/**
 * Нормализует все результаты для ad account
 * ОПТИМИЗИРОВАНО: batch upsert, один запрос маппинга
 */
export async function normalizeAllResults(adAccountId: string): Promise<{
  processed: number;
  families: Map<string, number>;
}> {
  log.info({ adAccountId }, 'Starting results normalization');

  // Загружаем маппинг ОДИН раз
  const actionTypeMap = await loadActionTypeMapping();

  // Получаем все insights
  const { data: insights, error } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, week_start_date, spend, actions_json, cost_per_action_type_json')
    .eq('ad_account_id', adAccountId);

  if (error) {
    log.error({ error, adAccountId }, 'Failed to fetch insights');
    throw error;
  }

  const familyCounts = new Map<string, number>();
  let processed = 0;
  const batchSize = 100;
  const allResults: any[] = [];

  for (const insight of insights || []) {
    // Группируем по семействам
    const familyResults = groupActionsByFamily(
      insight.actions_json || [],
      insight.cost_per_action_type_json || [],
      parseFloat(insight.spend) || 0,
      actionTypeMap
    );

    // Собираем записи для batch upsert
    for (const [family, result] of familyResults) {
      if (result.count === 0 && parseFloat(insight.spend) === 0) continue;

      allResults.push({
        ad_account_id: adAccountId,
        fb_ad_id: insight.fb_ad_id,
        week_start_date: insight.week_start_date,
        result_family: family,
        result_count: result.count,
        spend: result.cost > 0 ? result.cost : parseFloat(insight.spend) || 0,
        cpr: result.cpr,
        action_types_detail: result.actionTypes,
      });

      const current = familyCounts.get(family) || 0;
      familyCounts.set(family, current + result.count);
    }

    processed++;
  }

  // Batch upsert
  log.info({ adAccountId, totalRecords: allResults.length }, 'Upserting weekly results in batches');

  for (let i = 0; i < allResults.length; i += batchSize) {
    const batch = allResults.slice(i, i + batchSize);

    // Retry logic для сетевых ошибок
    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error: upsertError } = await supabase
          .from('meta_weekly_results')
          .upsert(batch, {
            onConflict: 'ad_account_id,fb_ad_id,week_start_date,result_family'
          });

        if (upsertError) throw upsertError;
        break; // Успех
      } catch (err: any) {
        lastError = err;
        const isNetworkError =
          err?.message?.includes('fetch failed') ||
          err?.message?.includes('ECONNRESET') ||
          err?.code === 'ECONNRESET';

        if (isNetworkError && attempt < 3) {
          log.warn({ attempt, batch: i/batchSize }, 'Network error, retrying...');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }

    if ((i / batchSize) % 10 === 0) {
      log.info({ adAccountId, progress: `${i}/${allResults.length}` }, 'Upsert progress');
    }
  }

  log.info({ adAccountId, processed, families: Object.fromEntries(familyCounts) }, 'Results normalization completed');

  return { processed, families: familyCounts };
}

/**
 * Добавляет link_clicks как семейство 'click' если его нет в actions
 */
export async function ensureClickFamily(adAccountId: string): Promise<number> {
  // Получаем insights где есть link_clicks но нет click семейства
  const { data: insights, error } = await supabase
    .from('meta_insights_weekly')
    .select('fb_ad_id, week_start_date, spend, link_clicks')
    .eq('ad_account_id', adAccountId)
    .gt('link_clicks', 0);

  if (error) {
    log.error({ error }, 'Failed to fetch insights for click family');
    throw error;
  }

  let added = 0;

  for (const insight of insights || []) {
    // Проверяем, есть ли уже click семейство
    const { data: existing } = await supabase
      .from('meta_weekly_results')
      .select('id')
      .eq('ad_account_id', adAccountId)
      .eq('fb_ad_id', insight.fb_ad_id)
      .eq('week_start_date', insight.week_start_date)
      .eq('result_family', 'click')
      .single();

    if (!existing) {
      const cpr = insight.link_clicks > 0
        ? (parseFloat(insight.spend) || 0) / insight.link_clicks
        : null;

      await supabase
        .from('meta_weekly_results')
        .upsert({
          ad_account_id: adAccountId,
          fb_ad_id: insight.fb_ad_id,
          week_start_date: insight.week_start_date,
          result_family: 'click',
          result_count: insight.link_clicks,
          spend: parseFloat(insight.spend) || 0,
          cpr,
          action_types_detail: [{ actionType: 'link_click', count: insight.link_clicks }],
        }, {
          onConflict: 'ad_account_id,fb_ad_id,week_start_date,result_family'
        });

      added++;
    }
  }

  log.info({ adAccountId, added }, 'Click family ensured');
  return added;
}
