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
  type AdForecast
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
 * Резолвит ad_account в UUID для запросов к meta_* таблицам
 *
 * @param accountIdParam - может быть UUID (ad_accounts.id) или act_xxx (Facebook format)
 * @returns UUID из ad_accounts.id
 */
async function resolveUserAdAccount(
  userId: string,
  accountIdParam?: string
): Promise<string | null> {
  log.info({ userId, accountIdParam }, 'resolveUserAdAccount: start');

  // Если передан конкретный accountId
  if (accountIdParam) {
    const normalizedId = accountIdParam.replace(/^act_/, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountIdParam);

    if (isUuid) {
      // accountIdParam это уже UUID - используем напрямую
      log.info({ userId, accountIdParam, result: accountIdParam }, 'Using UUID directly');
      return accountIdParam;
    }

    // accountIdParam это act_xxx - ищем UUID в ad_accounts
    // Пробуем оба формата: с и без act_
    const { data: accounts } = await supabase
      .from('ad_accounts')
      .select('id, ad_account_id')
      .or(`ad_account_id.eq.${normalizedId},ad_account_id.eq.${accountIdParam}`);

    log.info({ userId, normalizedId, accountIdParam, foundAccounts: accounts?.length || 0 }, 'Searching by ad_account_id');

    if (accounts && accounts.length > 0) {
      const found = accounts[0];
      log.info({ userId, result: found.id }, 'Found UUID by ad_account_id');
      return found.id;
    }

    log.warn({ userId, accountIdParam }, 'Ad account not found');
    return null;
  }

  // Если accountId не передан - ищем активный аккаунт пользователя
  // Сначала проверяем multi-account mode
  const { data: activeAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('user_account_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (activeAccount) {
    log.info({ userId, result: activeAccount.id }, 'Found active account');
    return activeAccount.id;
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
    log.info({ userId, result: firstAccount.id }, 'Found first account');
    return firstAccount.id;
  }

  // Legacy fallback: читаем ad_account_id из user_accounts и резолвим в UUID
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('ad_account_id')
    .eq('id', userId)
    .single();

  if (userAccount?.ad_account_id) {
    const legacyId = userAccount.ad_account_id.replace(/^act_/, '');
    const { data: legacyAccount } = await supabase
      .from('ad_accounts')
      .select('id')
      .or(`ad_account_id.eq.${legacyId},ad_account_id.eq.${userAccount.ad_account_id}`)
      .limit(1)
      .single();

    if (legacyAccount) {
      log.info({ userId, result: legacyAccount.id }, 'Found account via legacy ad_account_id');
      return legacyAccount.id;
    }
  }

  log.warn({ userId }, 'No ad accounts found');
  return null;
}

/**
 * Получает fb_campaign_id по внутреннему ID или напрямую
 */
async function resolveCampaignId(
  adAccountId: string,
  campaignIdParam: string
): Promise<string | null> {
  // Если это уже fb_campaign_id (числовая строка)
  if (/^\d+$/.test(campaignIdParam)) {
    return campaignIdParam;
  }

  // Иначе пробуем найти по внутреннему ID
  const { data: campaign } = await supabase
    .from('meta_campaigns')
    .select('fb_campaign_id')
    .eq('ad_account_id', adAccountId)
    .eq('id', campaignIdParam)
    .single();

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
      // Resolve ad account
      const adAccountId = await resolveUserAdAccount(userId, accountId);
      if (!adAccountId) {
        return reply.code(403).send({ error: 'No access to ad account' });
      }

      // Resolve campaign ID
      const fbCampaignId = await resolveCampaignId(adAccountId, campaignId);
      if (!fbCampaignId) {
        return reply.code(404).send({ error: 'Campaign not found' });
      }

      // Check cache
      const cacheKey = `forecast_campaign_${adAccountId}_${fbCampaignId}`;
      const cached = getCached<CampaignForecastResponse>(cacheKey);
      if (cached) {
        log.info({ campaignId: fbCampaignId, cached: true }, 'Returning cached forecast');
        return reply.send(cached);
      }

      // Compute forecast
      const result = await forecastCampaignBudget(adAccountId, fbCampaignId);

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
      // Resolve ad account
      const adAccountId = await resolveUserAdAccount(userId, accountId);
      if (!adAccountId) {
        return reply.code(403).send({ error: 'No access to ad account' });
      }

      // Check cache
      const cacheKey = `forecast_ad_${adAccountId}_${adId}`;
      const cached = getCached<AdForecast>(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      // Получаем информацию об объявлении
      const { data: adData } = await supabase
        .from('meta_ads')
        .select('fb_ad_id, name')
        .eq('ad_account_id', adAccountId)
        .or(`fb_ad_id.eq.${adId},id.eq.${adId}`)
        .limit(1)
        .single();

      if (!adData) {
        return reply.code(404).send({ error: 'Ad not found' });
      }

      // Получаем primary_family
      const { data: resultData } = await supabase
        .from('meta_weekly_results')
        .select('result_family')
        .eq('ad_account_id', adAccountId)
        .eq('fb_ad_id', adData.fb_ad_id)
        .gt('result_count', 0)
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single();

      const resultFamily = resultData?.result_family || 'messages';

      // Compute forecast
      const result = await forecastAd(
        adAccountId,
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
