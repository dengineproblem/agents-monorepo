/**
 * Budget Forecast API Routes
 *
 * User-facing endpoints для прогнозирования бюджета рекламы.
 * Предоставляет прогнозы на 1-2 недели: baseline (без изменений) и scaling (+10/20/30/50%).
 *
 * @module routes/budgetForecast
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';
import { createLogger } from '../lib/logger.js';
import {
  forecastCampaignBudget,
  forecastAd,
  type CampaignForecastResponse,
  type AdForecast,
  type AccountContext
} from '../services/budgetForecaster.js';

const log = createLogger({ module: 'budgetForecastRoutes' });

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const forecastCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 15 * 60 * 1000; // 15 минут

function getCached<T>(key: string): T | null {
  const entry = forecastCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    forecastCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  forecastCache.set(key, { data, timestamp: Date.now() });
}

// Очистка старых записей каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of forecastCache) {
    if (now - entry.timestamp > CACHE_TTL * 2) {
      forecastCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Резолвит аккаунт для запросов к meta_* таблицам
 *
 * Поддерживает два режима:
 * - Legacy: multi_account_enabled = false/null → используем user_account_id
 * - Multi-account: multi_account_enabled = true → используем ad_account_id
 *
 * @param accountIdParam - может быть UUID (ad_accounts.id) или act_xxx (Facebook format)
 * @returns AccountContext с информацией о режиме
 */
async function resolveUserAdAccount(
  userId: string,
  accountIdParam?: string
): Promise<AccountContext | null> {
  log.info({ userId, accountIdParam }, 'resolveUserAdAccount: start');

  // Получаем информацию о пользователе для определения режима
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('id, multi_account_enabled, ad_account_id')
    .eq('id', userId)
    .single();

  if (!userAccount) {
    log.warn({ userId }, 'User account not found');
    return null;
  }

  const isMultiAccount = userAccount.multi_account_enabled === true;

  // LEGACY MODE: используем user_account_id напрямую
  if (!isMultiAccount) {
    log.info({ userId, mode: 'legacy' }, 'Using legacy mode with user_account_id');
    return {
      user_account_id: userId,
      ad_account_id: null,
      is_legacy: true
    };
  }

  // MULTI-ACCOUNT MODE: ищем ad_account_id

  // Если передан конкретный accountId
  if (accountIdParam) {
    const normalizedId = accountIdParam.replace(/^act_/, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountIdParam);

    if (isUuid) {
      // Проверяем, принадлежит ли этот аккаунт пользователю
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('id', accountIdParam)
        .eq('user_account_id', userId)
        .single();

      if (account) {
        log.info({ userId, accountIdParam, mode: 'multi-account' }, 'Using UUID directly');
        return {
          user_account_id: userId,
          ad_account_id: accountIdParam,
          is_legacy: false
        };
      }
    }

    // accountIdParam это act_xxx - ищем UUID в ad_accounts
    const { data: accounts } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id')
      .eq('user_account_id', userId)
      .or(`ad_account_id.eq.${normalizedId},ad_account_id.eq.${accountIdParam}`);

    log.info({ userId, normalizedId, accountIdParam, foundAccounts: accounts?.length || 0 }, 'Searching by ad_account_id');

    if (accounts && accounts.length > 0) {
      const found = accounts[0];
      log.info({ userId, result: found.id, mode: 'multi-account' }, 'Found UUID by ad_account_id');
      return {
        user_account_id: userId,
        ad_account_id: found.id,
        is_legacy: false
      };
    }

    log.warn({ userId, accountIdParam }, 'Ad account not found');
    return null;
  }

  // Если accountId не передан - ищем активный аккаунт пользователя
  const { data: activeAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('user_account_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (activeAccount) {
    log.info({ userId, result: activeAccount.id, mode: 'multi-account' }, 'Found active account');
    return {
      user_account_id: userId,
      ad_account_id: activeAccount.id,
      is_legacy: false
    };
  }

  // Fallback: первый аккаунт пользователя
  const { data: firstAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('user_account_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (firstAccount) {
    log.info({ userId, result: firstAccount.id, mode: 'multi-account' }, 'Found first account');
    return {
      user_account_id: userId,
      ad_account_id: firstAccount.id,
      is_legacy: false
    };
  }

  log.warn({ userId }, 'No ad accounts found for multi-account user');
  return null;
}

/**
 * Получает fb_campaign_id по внутреннему ID или напрямую
 */
async function resolveCampaignId(
  ctx: AccountContext,
  campaignIdParam: string
): Promise<string | null> {
  // Если это уже fb_campaign_id (числовая строка)
  if (/^\d+$/.test(campaignIdParam)) {
    return campaignIdParam;
  }

  // Иначе пробуем найти по внутреннему ID
  let query = supabase
    .from('meta_campaigns')
    .select('fb_campaign_id')
    .eq('id', campaignIdParam);

  // Применяем фильтр в зависимости от режима
  if (ctx.is_legacy) {
    query = query.eq('user_account_id', ctx.user_account_id).is('ad_account_id', null);
  } else {
    query = query.eq('ad_account_id', ctx.ad_account_id);
  }

  const { data: campaign } = await query.single();
  return campaign?.fb_campaign_id || null;
}

// ============================================================================
// ROUTES
// ============================================================================

interface CampaignParams {
  campaignId: string;
}

interface AdParams {
  adId: string;
}

interface QueryParams {
  accountId?: string;
}

export default async function budgetForecastRoutes(fastify: FastifyInstance) {
  /**
   * GET /budget-forecast/campaign/:campaignId
   *
   * Прогноз бюджета для всех объявлений кампании
   */
  fastify.get<{
    Params: CampaignParams;
    Querystring: QueryParams;
  }>('/budget-forecast/campaign/:campaignId', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { campaignId } = request.params;
    const { accountId } = request.query;

    try {
      // Resolve account context
      const ctx = await resolveUserAdAccount(userId, accountId);
      if (!ctx) {
        return reply.code(403).send({ error: 'No access to ad account' });
      }

      // Resolve campaign ID
      const fbCampaignId = await resolveCampaignId(ctx, campaignId);
      if (!fbCampaignId) {
        return reply.code(404).send({ error: 'Campaign not found' });
      }

      // Check cache - используем user_account_id для legacy, ad_account_id для multi-account
      const cacheAccountId = ctx.is_legacy ? ctx.user_account_id : ctx.ad_account_id;
      const cacheKey = `forecast_campaign_${cacheAccountId}_${fbCampaignId}`;
      const cached = getCached<CampaignForecastResponse>(cacheKey);
      if (cached) {
        log.info({ campaignId: fbCampaignId, cached: true }, 'Returning cached forecast');
        return reply.send(cached);
      }

      // Compute forecast
      const result = await forecastCampaignBudget(ctx, fbCampaignId);

      if (!result) {
        return reply.code(404).send({ error: 'No forecast data available' });
      }

      // Cache result
      setCache(cacheKey, result);

      return reply.send(result);
    } catch (error) {
      log.error({ error, userId, campaignId }, 'Failed to get campaign forecast');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /budget-forecast/ad/:adId
   *
   * Прогноз бюджета для конкретного объявления
   */
  fastify.get<{
    Params: AdParams;
    Querystring: QueryParams;
  }>('/budget-forecast/ad/:adId', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { adId } = request.params;
    const { accountId } = request.query;

    try {
      // Resolve account context
      const ctx = await resolveUserAdAccount(userId, accountId);
      if (!ctx) {
        return reply.code(403).send({ error: 'No access to ad account' });
      }

      // Check cache
      const cacheAccountId = ctx.is_legacy ? ctx.user_account_id : ctx.ad_account_id;
      const cacheKey = `forecast_ad_${cacheAccountId}_${adId}`;
      const cached = getCached<AdForecast>(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      // Получаем информацию об объявлении
      let adQuery = supabase
        .from('meta_ads')
        .select('fb_ad_id, name')
        .or(`fb_ad_id.eq.${adId},id.eq.${adId}`)
        .limit(1);

      // Применяем фильтр в зависимости от режима
      if (ctx.is_legacy) {
        adQuery = adQuery.eq('user_account_id', ctx.user_account_id).is('ad_account_id', null);
      } else {
        adQuery = adQuery.eq('ad_account_id', ctx.ad_account_id);
      }

      const { data: adData } = await adQuery.single();

      if (!adData) {
        return reply.code(404).send({ error: 'Ad not found' });
      }

      // Получаем primary_family (только целевые: messages, leads, purchase)
      const TARGET_RESULT_FAMILIES = ['messages', 'leadgen_form', 'website_lead', 'purchase'];
      let resultQuery = supabase
        .from('meta_weekly_results')
        .select('result_family')
        .eq('fb_ad_id', adData.fb_ad_id)
        .in('result_family', TARGET_RESULT_FAMILIES)
        .gt('result_count', 0)
        .order('week_start_date', { ascending: false })
        .limit(1);

      // Применяем фильтр в зависимости от режима
      if (ctx.is_legacy) {
        resultQuery = resultQuery.eq('user_account_id', ctx.user_account_id).is('ad_account_id', null);
      } else {
        resultQuery = resultQuery.eq('ad_account_id', ctx.ad_account_id);
      }

      const { data: resultData } = await resultQuery.single();
      const resultFamily = resultData?.result_family || 'messages';

      // Compute forecast
      const result = await forecastAd(
        ctx,
        adData.fb_ad_id,
        adData.name || adData.fb_ad_id,
        resultFamily
      );

      if (!result) {
        return reply.code(404).send({ error: 'No forecast data available' });
      }

      // Cache result
      setCache(cacheKey, result);

      return reply.send(result);
    } catch (error) {
      log.error({ error, userId, adId }, 'Failed to get ad forecast');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /budget-forecast/cache
   *
   * Очистка кэша прогнозов (для debug/admin)
   */
  fastify.delete('/budget-forecast/cache', async (request, reply) => {
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Проверяем is_tech_admin
    const { data: user } = await supabase
      .from('user_accounts')
      .select('is_tech_admin')
      .eq('id', userId)
      .single();

    if (!user?.is_tech_admin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }

    const cacheSize = forecastCache.size;
    forecastCache.clear();

    log.info({ userId, clearedEntries: cacheSize }, 'Forecast cache cleared');

    return reply.send({ success: true, cleared: cacheSize });
  });
}
