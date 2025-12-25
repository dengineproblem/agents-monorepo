/**
 * AD INSIGHTS API ROUTES (Admin Only)
 *
 * Внутренний сервис для анализа Meta Ads:
 * - Синхронизация weekly insights
 * - Нормализация результатов по семействам
 * - Детекция аномалий CPR
 * - Анализ зависимостей выгорания
 *
 * ВАЖНО: Доступ только для tech_admin!
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  fullSync,
  syncWeeklyInsights,
  syncWeeklyInsightsCampaign,
  syncWeeklyInsightsAdset,
  syncCampaigns,
  syncAdsets,
  syncAds
} from '../services/adInsightsSync.js';
import { normalizeAllResults, ensureClickFamily } from '../services/resultNormalizer.js';
import { processAdAccount, getAnomalies, updateAnomalyStatus, getAnomalySummary, updateMissingPrecedingDeviations } from '../services/anomalyDetector.js';
import {
  runQuantileAnalysis,
  predictBurnout,
  predictAllAds,
  computeCorrelations,
  predictRecovery,
  predictAllRecovery,
  analyzeDecayRecovery
} from '../services/burnoutAnalyzer.js';
import {
  runYearlyAudit,
  analyzeCreativeLifecycle,
  findWaste,
  analyzeResponseCurve,
  analyzeGoalDrift
} from '../services/yearlyAnalyzer.js';
import { analyzeTrackingHealth, getTrackingIssuesHistory } from '../services/trackingHealth.js';
import { enrichDailyBreakdown } from '../services/dailyBreakdownEnricher.js';
import { supabase } from '../lib/supabaseClient.js';
import { getCredentials } from '../lib/adAccountHelper.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adInsightsRoutes' });

// ============================================================================
// AUTH HELPERS
// ============================================================================

/**
 * Проверяет, является ли пользователь техадмином
 */
async function isTechAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('is_tech_admin')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  return data.is_tech_admin === true;
}

/**
 * Middleware: проверка доступа tech_admin
 */
async function requireTechAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const userId = request.headers['x-user-id'] as string;

  if (!userId) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }

  const isAdmin = await isTechAdmin(userId);
  if (!isAdmin) {
    log.warn({ userId }, 'Non-admin attempted to access ad insights');
    reply.code(403).send({ error: 'Access denied. Tech admin only.' });
    return null;
  }

  return userId;
}

// ============================================================================
// ACCOUNT ID RESOLVER
// ============================================================================

/**
 * Резолвит accountId (legacy_xxx или UUID) в реальный ad_account_id (UUID)
 * Для использования в запросах к таблицам с аномалиями и features
 */
async function resolveAdAccountUuid(accountId: string): Promise<string | null> {
  const isLegacy = accountId.startsWith('legacy_');

  if (isLegacy) {
    // Legacy режим: извлекаем user_account_id и ищем ad_account
    const userAccountId = accountId.replace('legacy_', '');

    // Сначала получаем ad_account_id из user_accounts
    const { data: user } = await supabase
      .from('user_accounts')
      .select('ad_account_id')
      .eq('id', userAccountId)
      .single();

    if (!user?.ad_account_id) return null;

    // Ищем ad_account с этим fb ad_account_id и user_account_id
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id')
      .eq('user_account_id', userAccountId)
      .eq('ad_account_id', user.ad_account_id)
      .single();

    return adAccount?.id || null;
  } else {
    // Multi-account режим: accountId это UUID ad_account
    const isUuid = accountId.includes('-');
    if (isUuid) {
      return accountId;
    }

    // Если передан fb ad_account_id (act_xxx), ищем UUID
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id')
      .eq('ad_account_id', accountId)
      .single();

    return adAccount?.id || null;
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface SyncParams {
  accountId: string;
}

interface SyncQuery {
  months?: number;
}

interface AnomaliesQuery {
  status?: string;
  type?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

interface UpdateAnomalyBody {
  status: 'acknowledged' | 'resolved' | 'false_positive';
  notes?: string;
}

// ============================================================================
// ROUTES
// ============================================================================

export default async function adInsightsRoutes(fastify: FastifyInstance) {
  // ============================================================================
  // SYNC ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * POST /admin/ad-insights/:accountId/sync
   * Полная синхронизация: справочники + weekly insights + нормализация + аномалии
   * Поддерживает legacy и multi-account режимы
   */
  fastify.post<{
    Params: SyncParams;
    Querystring: SyncQuery;
  }>('/admin/ad-insights/:accountId/sync', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { months = 12 } = request.query;

    log.info({ adminId, accountId, months }, 'Admin starting full sync');

    try {
      // Определяем режим по формату accountId
      const isLegacy = accountId.startsWith('legacy_');
      let userAccountId: string;
      let adAccountUuid: string;
      let fbAdAccountId: string;
      let accessToken: string;

      if (isLegacy) {
        // Legacy режим: credentials в user_accounts
        userAccountId = accountId.replace('legacy_', '');

        const { data: user, error: userError } = await supabase
          .from('user_accounts')
          .select('id, ad_account_id, access_token, username')
          .eq('id', userAccountId)
          .single();

        if (userError || !user) {
          return reply.status(404).send({ error: 'User account not found', accountId });
        }

        if (!user.access_token || !user.ad_account_id) {
          return reply.status(400).send({ error: 'Missing credentials in user account' });
        }

        fbAdAccountId = user.ad_account_id;
        accessToken = user.access_token;

        // Для legacy нужна запись в ad_accounts (из-за FK constraints)
        // Проверяем/создаём ad_account для этого legacy пользователя
        const { data: existingAdAccount } = await supabase
          .from('ad_accounts')
          .select('id')
          .eq('user_account_id', userAccountId)
          .eq('ad_account_id', fbAdAccountId)
          .single();

        if (existingAdAccount) {
          adAccountUuid = existingAdAccount.id;
        } else {
          // Создаём ad_account для legacy пользователя
          const { data: newAdAccount, error: createError } = await supabase
            .from('ad_accounts')
            .insert({
              user_account_id: userAccountId,
              ad_account_id: fbAdAccountId,
              access_token: accessToken,
              name: user.username || fbAdAccountId,
              connection_status: 'connected',
              is_active: true,
            })
            .select('id')
            .single();

          if (createError || !newAdAccount) {
            log.error({ error: createError, userAccountId }, 'Failed to create ad_account for legacy user');
            return reply.status(500).send({ error: 'Failed to initialize ad account' });
          }

          adAccountUuid = newAdAccount.id;
          log.info({ adAccountUuid, userAccountId, fbAdAccountId }, 'Created ad_account for legacy user');
        }
      } else {
        // Multi-account режим: credentials в ad_accounts
        const isUuid = accountId.includes('-');
        const { data: account, error: accountError } = await supabase
          .from('ad_accounts')
          .select('id, ad_account_id, access_token, connection_status, user_account_id')
          .eq(isUuid ? 'id' : 'ad_account_id', accountId)
          .single();

        if (accountError || !account) {
          return reply.status(404).send({ error: 'Ad account not found', accountId });
        }

        // Разрешаем sync если есть access_token (независимо от connection_status)
        if (!account.access_token) {
          return reply.status(400).send({ error: 'Missing access token', status: account.connection_status });
        }

        userAccountId = account.user_account_id;
        adAccountUuid = account.id;
        fbAdAccountId = account.ad_account_id;
        accessToken = account.access_token;
      }

      // Для fullSync передаём credentials
      const cleanFbAccountId = fbAdAccountId.replace('act_', '');

      // 2. Запускаем полную синхронизацию с credentials
      const syncResult = await fullSync(adAccountUuid, {
        accessToken,
        fbAdAccountId: cleanFbAccountId,
        isLegacy,
      });

      // 3. Нормализуем результаты
      const normalizeResult = await normalizeAllResults(adAccountUuid);

      // 4. Добавляем clicks как семейство
      const clicksAdded = await ensureClickFamily(adAccountUuid);

      // 5. Детектируем аномалии
      const anomalyResult = await processAdAccount(adAccountUuid);

      log.info({ adminId, accountId, syncResult, anomalyResult, isLegacy }, 'Full sync completed');

      return reply.send({
        success: true,
        sync: syncResult,
        normalization: {
          processed: normalizeResult.processed,
          families: Object.fromEntries(normalizeResult.families),
          clicksAdded,
        },
        anomalies: anomalyResult,
      });
    } catch (error: any) {
      log.error({
        errorMessage: error?.message,
        errorStack: error?.stack,
        errorName: error?.name,
        adminId,
        accountId
      }, 'Sync failed');
      return reply.status(500).send({
        error: 'Sync failed',
        message: error?.message || 'Unknown error',
      });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/sync/catalogs
   * Синхронизация только справочников (campaigns, adsets, ads)
   */
  fastify.post<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/sync/catalogs', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      // accountId может быть UUID или ad_account_id (act_xxx)
      const isUuid = accountId.includes('-');
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('id, ad_account_id, access_token')
        .eq(isUuid ? 'id' : 'ad_account_id', accountId)
        .single();

      if (!account?.access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const dbAccountId = account.id;
      const cleanFbAccountId = account.ad_account_id.replace('act_', '');

      const campaigns = await syncCampaigns(dbAccountId, account.access_token, cleanFbAccountId);
      const adsets = await syncAdsets(dbAccountId, account.access_token, cleanFbAccountId);
      const ads = await syncAds(dbAccountId, account.access_token, cleanFbAccountId);

      log.info({ adminId, accountId: dbAccountId, campaigns, adsets, ads }, 'Catalogs synced');

      return reply.send({
        success: true,
        campaigns,
        adsets,
        ads,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Catalog sync failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/sync/insights
   * Синхронизация только weekly insights
   */
  fastify.post<{
    Params: SyncParams;
    Querystring: SyncQuery;
  }>('/admin/ad-insights/:accountId/sync/insights', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { months = 12 } = request.query;

    try {
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('ad_account_id, access_token')
        .eq('id', accountId)
        .single();

      if (!account?.access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const cleanFbAccountId = account.ad_account_id.replace('act_', '');
      const result = await syncWeeklyInsights(accountId, account.access_token, cleanFbAccountId, months);

      log.info({ adminId, accountId, months, result }, 'Insights synced');

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Insights sync failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/normalize
   * Нормализация результатов по семействам
   */
  fastify.post<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/normalize', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const result = await normalizeAllResults(accountId);
      const clicksAdded = await ensureClickFamily(accountId);

      return reply.send({
        success: true,
        processed: result.processed,
        families: Object.fromEntries(result.families),
        clicksAdded,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Normalization failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/detect-anomalies
   * Детекция аномалий
   */
  fastify.post<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/detect-anomalies', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const result = await processAdAccount(accountId);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Anomaly detection failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // ANOMALIES ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/anomalies
   * Получить список аномалий
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: AnomaliesQuery;
  }>('/admin/ad-insights/:accountId/anomalies', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { status, type, minScore, limit, offset = 0 } = request.query;

    try {
      // Резолвим accountId (legacy_xxx или UUID) в реальный ad_account UUID
      const resolvedAccountId = await resolveAdAccountUuid(accountId);
      if (!resolvedAccountId) {
        return reply.status(404).send({ error: 'Ad account not found', accountId });
      }

      const anomalies = await getAnomalies(resolvedAccountId, {
        status,
        anomalyType: type,
        minScore,
        limit,
        offset,
      });

      return reply.send({
        success: true,
        count: anomalies.length,
        anomalies,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch anomalies');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/anomalies/summary
   * Summary аномалий
   */
  fastify.get<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/anomalies/summary', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      // Резолвим accountId в реальный ad_account UUID
      const resolvedAccountId = await resolveAdAccountUuid(accountId);
      if (!resolvedAccountId) {
        return reply.status(404).send({ error: 'Ad account not found', accountId });
      }

      const summary = await getAnomalySummary(resolvedAccountId);

      return reply.send({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch anomaly summary');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /admin/ad-insights/anomalies/:anomalyId
   * Обновить статус аномалии
   */
  fastify.patch<{
    Params: { anomalyId: string };
    Body: UpdateAnomalyBody;
  }>('/admin/ad-insights/anomalies/:anomalyId', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { anomalyId } = request.params;
    const { status, notes } = request.body;

    try {
      await updateAnomalyStatus(anomalyId, status, adminId, notes);

      log.info({ adminId, anomalyId, status }, 'Anomaly status updated');

      return reply.send({
        success: true,
        message: `Anomaly status updated to ${status}`,
      });
    } catch (error: any) {
      log.error({ error, adminId, anomalyId }, 'Failed to update anomaly');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/update-preceding-deviations
   * Обновить preceding_deviations для всех аномалий (заполнить пропущенные)
   */
  fastify.post<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/update-preceding-deviations', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      // Резолвим accountId (legacy_xxx или UUID) в реальный ad_account UUID
      const resolvedAccountId = await resolveAdAccountUuid(accountId);
      if (!resolvedAccountId) {
        return reply.status(404).send({ error: 'Ad account not found', accountId });
      }

      log.info({ adminId, accountId: resolvedAccountId }, 'Starting update of preceding deviations');

      const result = await updateMissingPrecedingDeviations(resolvedAccountId);

      log.info({ adminId, accountId: resolvedAccountId, ...result }, 'Preceding deviations updated');

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to update preceding deviations');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/enrich-daily-breakdown
   * Обогатить аномалии детализацией по дням
   * Если данных нет в БД — запрашивает из Facebook API
   */
  fastify.post<{
    Params: SyncParams;
    Querystring: {
      forceRefresh?: boolean;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/enrich-daily-breakdown', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { forceRefresh = false, limit } = request.query;

    try {
      // Резолвим accountId (legacy_xxx или UUID) в реальный ad_account UUID
      const resolvedAccountId = await resolveAdAccountUuid(accountId);
      if (!resolvedAccountId) {
        return reply.status(404).send({ error: 'Ad account not found', accountId });
      }

      log.info({ adminId, accountId: resolvedAccountId, forceRefresh, limit }, 'Starting daily breakdown enrichment');

      const result = await enrichDailyBreakdown(resolvedAccountId, { forceRefresh, limit });

      log.info({ adminId, accountId: resolvedAccountId, ...result }, 'Daily breakdown enrichment completed');

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to enrich daily breakdown');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // DATA ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/weekly
   * Получить weekly insights
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      adId?: string;
      weekStart?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/weekly', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { adId, weekStart, limit = 100 } = request.query;

    try {
      let query = supabase
        .from('meta_insights_weekly')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('week_start_date', { ascending: false })
        .limit(limit);

      if (adId) {
        query = query.eq('fb_ad_id', adId);
      }
      if (weekStart) {
        query = query.eq('week_start_date', weekStart);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        data,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch weekly insights');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/results
   * Получить нормализованные результаты по семействам
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      adId?: string;
      family?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/results', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { adId, family, limit = 100 } = request.query;

    try {
      let query = supabase
        .from('meta_weekly_results')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('week_start_date', { ascending: false })
        .limit(limit);

      if (adId) {
        query = query.eq('fb_ad_id', adId);
      }
      if (family) {
        query = query.eq('result_family', family);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        data,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch results');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/features
   * Получить вычисленные features
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      adId?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/features', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { adId, limit = 100 } = request.query;

    try {
      let query = supabase
        .from('ad_weekly_features')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('week_start_date', { ascending: false })
        .limit(limit);

      if (adId) {
        query = query.eq('fb_ad_id', adId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        data,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch features');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // RATE LIMIT STATUS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/rate-limit
   * Получить состояние rate limit
   */
  fastify.get<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/rate-limit', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const { data } = await supabase
        .from('fb_rate_limit_state')
        .select('*')
        .eq('ad_account_id', accountId)
        .single();

      const isThrottled = data?.throttle_until
        ? new Date(data.throttle_until) > new Date()
        : false;

      return reply.send({
        success: true,
        isThrottled,
        throttleUntil: data?.throttle_until,
        throttleReason: data?.throttle_reason,
        usage: data?.usage_headers,
        lastRequest: data?.last_request_at,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch rate limit state');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // BURNOUT ANALYSIS ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/burnout/quantiles
   * Квантильный анализ: как метрики влияют на CPR через 1-2 недели
   */
  fastify.get<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/burnout/quantiles', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const { metrics, insights } = await runQuantileAnalysis(accountId);

      return reply.send({
        success: true,
        metrics: Object.fromEntries(metrics),
        insights,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Quantile analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/burnout/correlations
   * Корреляции метрик с будущим CPR
   */
  fastify.get<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/burnout/correlations', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const { correlations } = await computeCorrelations(accountId);

      return reply.send({
        success: true,
        correlations,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Correlation analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/burnout/predictions
   * Предсказания выгорания для всех активных ads
   * Читает из БД ad_burnout_predictions (формат snake_case для frontend)
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      riskLevel?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/burnout/predictions', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { riskLevel, limit = 50 } = request.query;

    try {
      // Читаем из БД (уже в snake_case формате)
      let query = supabase
        .from('ad_burnout_predictions')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('burnout_score', { ascending: false })
        .limit(limit);

      if (riskLevel) {
        query = query.eq('burnout_level', riskLevel);
      }

      const { data: predictions, error } = await query;

      if (error) throw error;

      const total = predictions?.length || 0;

      return reply.send({
        success: true,
        count: total,
        predictions: predictions || [],
        summary: {
          total,
          byRisk: {
            critical: predictions?.filter(p => p.burnout_level === 'critical').length || 0,
            high: predictions?.filter(p => p.burnout_level === 'high').length || 0,
            medium: predictions?.filter(p => p.burnout_level === 'medium').length || 0,
            low: predictions?.filter(p => p.burnout_level === 'low').length || 0,
          },
        },
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Predictions failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/burnout/predict/:adId
   * Предсказание выгорания для конкретного ad
   */
  fastify.get<{
    Params: SyncParams & { adId: string };
    Querystring: { weekStart?: string };
  }>('/admin/ad-insights/:accountId/burnout/predict/:adId', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId, adId } = request.params;
    const { weekStart } = request.query;

    try {
      // Если weekStart не указан, берём последнюю неделю
      let targetWeek = weekStart;

      if (!targetWeek) {
        const { data: latest } = await supabase
          .from('ad_weekly_features')
          .select('week_start_date')
          .eq('ad_account_id', accountId)
          .eq('fb_ad_id', adId)
          .order('week_start_date', { ascending: false })
          .limit(1)
          .single();

        targetWeek = latest?.week_start_date;
      }

      if (!targetWeek) {
        return reply.status(404).send({ error: 'No data found for this ad' });
      }

      const prediction = await predictBurnout(accountId, adId, targetWeek);

      if (!prediction) {
        return reply.status(404).send({ error: 'Unable to generate prediction' });
      }

      return reply.send({
        success: true,
        prediction,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId, adId }, 'Ad prediction failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // RECOVERY PREDICTIONS (Admin Only) - Iteration 2
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/recovery/predictions
   * Предсказания recovery для всех degraded/burned ads
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      recoveryLevel?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/recovery/predictions', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { recoveryLevel, limit = 50 } = request.query;

    try {
      let predictions = await predictAllRecovery(accountId);

      // Фильтруем по recovery level если указан
      if (recoveryLevel) {
        predictions = predictions.filter(p => p.recoveryLevel === recoveryLevel);
      }

      // Лимит
      predictions = predictions.slice(0, limit);

      return reply.send({
        success: true,
        count: predictions.length,
        predictions,
        summary: {
          total: predictions.length,
          byLevel: {
            very_likely: predictions.filter(p => p.recoveryLevel === 'very_likely').length,
            likely: predictions.filter(p => p.recoveryLevel === 'likely').length,
            possible: predictions.filter(p => p.recoveryLevel === 'possible').length,
            unlikely: predictions.filter(p => p.recoveryLevel === 'unlikely').length,
          },
          byStatus: {
            burned_out: predictions.filter(p => p.currentStatus === 'burned_out').length,
            degraded: predictions.filter(p => p.currentStatus === 'degraded').length,
          },
        },
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Recovery predictions failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/recovery/predict/:adId
   * Предсказание recovery для конкретного ad
   */
  fastify.get<{
    Params: SyncParams & { adId: string };
    Querystring: { weekStart?: string };
  }>('/admin/ad-insights/:accountId/recovery/predict/:adId', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId, adId } = request.params;
    const { weekStart } = request.query;

    try {
      let targetWeek = weekStart;

      if (!targetWeek) {
        const { data: latest } = await supabase
          .from('ad_weekly_features')
          .select('week_start_date')
          .eq('ad_account_id', accountId)
          .eq('fb_ad_id', adId)
          .order('week_start_date', { ascending: false })
          .limit(1)
          .single();

        targetWeek = latest?.week_start_date;
      }

      if (!targetWeek) {
        return reply.status(404).send({ error: 'No data found for this ad' });
      }

      const prediction = await predictRecovery(accountId, adId, targetWeek);

      if (!prediction) {
        return reply.status(404).send({ error: 'Unable to generate recovery prediction' });
      }

      return reply.send({
        success: true,
        prediction,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId, adId }, 'Recovery prediction failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/decay-recovery
   * Комбинированный анализ decay и recovery
   */
  fastify.get<{
    Params: SyncParams;
  }>('/admin/ad-insights/:accountId/decay-recovery', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;

    try {
      const analysis = await analyzeDecayRecovery(accountId);

      return reply.send({
        success: true,
        ...analysis,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Decay/Recovery analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // AD ACCOUNTS LIST (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/accounts
   * Список всех ad accounts для админки (legacy + multi-account)
   */
  fastify.get('/admin/ad-insights/accounts', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    try {
      // 1. Получаем legacy аккаунты (credentials в user_accounts)
      const { data: legacyUsers, error: legacyError } = await supabase
        .from('user_accounts')
        .select('id, ad_account_id, username, access_token, created_at')
        .or('multi_account_enabled.is.null,multi_account_enabled.eq.false')
        .not('access_token', 'is', null)
        .not('ad_account_id', 'is', null)
        .neq('ad_account_id', '');  // Исключаем пустые ad_account_id

      if (legacyError) {
        log.warn({ error: legacyError }, 'Failed to fetch legacy users');
      }

      // 2. Получаем multi-account аккаунты
      const { data: multiAccounts, error: multiError } = await supabase
        .from('ad_accounts')
        .select('id, ad_account_id, name, connection_status, user_account_id, created_at')
        .order('created_at', { ascending: false });

      if (multiError) {
        log.warn({ error: multiError }, 'Failed to fetch multi accounts');
      }

      // 3. Объединяем с пометкой типа
      const accounts = [
        // Legacy аккаунты
        ...(legacyUsers || []).map(user => ({
          id: `legacy_${user.id}`,  // Префикс для идентификации legacy
          ad_account_id: user.ad_account_id,
          name: user.username || user.ad_account_id,
          connection_status: 'connected',  // Legacy всегда connected если есть токен
          user_account_id: user.id,
          type: 'legacy' as const,
          created_at: user.created_at,
        })),
        // Multi-account аккаунты
        ...(multiAccounts || []).map(acc => ({
          id: acc.id,
          ad_account_id: acc.ad_account_id,
          name: acc.name || acc.ad_account_id,
          connection_status: acc.connection_status,
          user_account_id: acc.user_account_id,
          type: 'multi' as const,
          created_at: acc.created_at,
        })),
      ];

      // Сортируем по дате создания
      accounts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return reply.send({
        success: true,
        count: accounts.length,
        accounts,
      });
    } catch (error: any) {
      log.error({ error, adminId }, 'Failed to fetch ad accounts');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // CAMPAIGN/ADSET LEVEL SYNC (Admin Only)
  // ============================================================================

  /**
   * POST /admin/ad-insights/:accountId/sync/campaigns
   * Синхронизация campaign-level insights
   */
  fastify.post<{
    Params: SyncParams;
    Querystring: SyncQuery;
  }>('/admin/ad-insights/:accountId/sync/campaigns', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { months = 12 } = request.query;

    try {
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('ad_account_id, access_token')
        .eq('id', accountId)
        .single();

      if (!account?.access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const cleanFbAccountId = account.ad_account_id.replace('act_', '');
      const result = await syncWeeklyInsightsCampaign(accountId, account.access_token, cleanFbAccountId, months);

      log.info({ adminId, accountId, result }, 'Campaign insights synced');

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Campaign insights sync failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /admin/ad-insights/:accountId/sync/adsets
   * Синхронизация adset-level insights
   */
  fastify.post<{
    Params: SyncParams;
    Querystring: SyncQuery;
  }>('/admin/ad-insights/:accountId/sync/adsets', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { months = 12 } = request.query;

    try {
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('ad_account_id, access_token')
        .eq('id', accountId)
        .single();

      if (!account?.access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const cleanFbAccountId = account.ad_account_id.replace('act_', '');
      const result = await syncWeeklyInsightsAdset(accountId, account.access_token, cleanFbAccountId, months);

      log.info({ adminId, accountId, result }, 'Adset insights synced');

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Adset insights sync failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // YEARLY ANALYSIS ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/yearly/audit
   * Годовой аудит (Pareto, waste, stability)
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      family?: string;
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/admin/ad-insights/:accountId/yearly/audit', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { family = 'messages', periodStart, periodEnd } = request.query;

    try {
      const result = await runYearlyAudit(accountId, family, periodStart, periodEnd);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Yearly audit failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/yearly/creatives
   * Creative Lifecycle Report
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      family?: string;
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/admin/ad-insights/:accountId/yearly/creatives', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { family = 'messages', periodStart, periodEnd } = request.query;

    try {
      const result = await analyzeCreativeLifecycle(accountId, family, periodStart, periodEnd);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Creative lifecycle analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/yearly/waste
   * Waste Finder
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      family?: string;
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/admin/ad-insights/:accountId/yearly/waste', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { family = 'messages', periodStart, periodEnd } = request.query;

    try {
      const result = await findWaste(accountId, family, periodStart, periodEnd);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Waste finder failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/response-curve
   * Response Curve Analysis
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      family?: string;
      level?: 'account' | 'campaign' | 'adset';
      entityId?: string;
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/admin/ad-insights/:accountId/response-curve', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { family = 'messages', level = 'account', entityId, periodStart, periodEnd } = request.query;

    try {
      const result = await analyzeResponseCurve(accountId, family, level, entityId, periodStart, periodEnd);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Response curve analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/goal-drift
   * Goal Drift Analysis
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      periodType?: 'month' | 'quarter';
    };
  }>('/admin/ad-insights/:accountId/goal-drift', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { periodType = 'month' } = request.query;

    try {
      const result = await analyzeGoalDrift(accountId, periodType);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Goal drift analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // TRACKING HEALTH ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/tracking-health
   * Анализ проблем с трекингом
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/admin/ad-insights/:accountId/tracking-health', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { periodStart, periodEnd } = request.query;

    try {
      const result = await analyzeTrackingHealth(accountId, periodStart, periodEnd);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Tracking health analysis failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/tracking-health/history
   * История проблем с трекингом
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: { limit?: number };
  }>('/admin/ad-insights/:accountId/tracking-health/history', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { limit = 50 } = request.query;

    try {
      const issues = await getTrackingIssuesHistory(accountId, limit);

      return reply.send({
        success: true,
        count: issues.length,
        issues,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch tracking health history');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ============================================================================
  // CAMPAIGN/ADSET DATA ENDPOINTS (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/:accountId/weekly/campaigns
   * Получить campaign-level weekly insights
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      campaignId?: string;
      weekStart?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/weekly/campaigns', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { campaignId, weekStart, limit = 100 } = request.query;

    try {
      let query = supabase
        .from('meta_insights_weekly_campaign')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('week_start_date', { ascending: false })
        .limit(limit);

      if (campaignId) {
        query = query.eq('fb_campaign_id', campaignId);
      }
      if (weekStart) {
        query = query.eq('week_start_date', weekStart);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        data,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch campaign insights');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /admin/ad-insights/:accountId/weekly/adsets
   * Получить adset-level weekly insights
   */
  fastify.get<{
    Params: SyncParams;
    Querystring: {
      adsetId?: string;
      campaignId?: string;
      weekStart?: string;
      limit?: number;
    };
  }>('/admin/ad-insights/:accountId/weekly/adsets', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    const { accountId } = request.params;
    const { adsetId, campaignId, weekStart, limit = 100 } = request.query;

    try {
      let query = supabase
        .from('meta_insights_weekly_adset')
        .select('*')
        .eq('ad_account_id', accountId)
        .order('week_start_date', { ascending: false })
        .limit(limit);

      if (adsetId) {
        query = query.eq('fb_adset_id', adsetId);
      }
      if (campaignId) {
        query = query.eq('fb_campaign_id', campaignId);
      }
      if (weekStart) {
        query = query.eq('week_start_date', weekStart);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        data,
      });
    } catch (error: any) {
      log.error({ error, adminId, accountId }, 'Failed to fetch adset insights');
      return reply.status(500).send({ error: error.message });
    }
  });
}
