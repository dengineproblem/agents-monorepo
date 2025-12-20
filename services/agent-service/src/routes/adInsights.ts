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
import { fullSync, syncWeeklyInsights, syncCampaigns, syncAdsets, syncAds } from '../services/adInsightsSync.js';
import { normalizeAllResults, ensureClickFamily } from '../services/resultNormalizer.js';
import { processAdAccount, getAnomalies, updateAnomalyStatus, getAnomalySummary } from '../services/anomalyDetector.js';
import { runQuantileAnalysis, predictBurnout, predictAllAds, computeCorrelations } from '../services/burnoutAnalyzer.js';
import { supabase } from '../lib/supabaseClient.js';
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
      // 1. Проверяем что аккаунт существует
      const { data: account, error: accountError } = await supabase
        .from('ad_accounts')
        .select('id, fb_ad_account_id, connection_status')
        .eq('id', accountId)
        .single();

      if (accountError || !account) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      if (account.connection_status !== 'connected') {
        return reply.status(400).send({ error: 'Ad account not connected' });
      }

      // 2. Запускаем полную синхронизацию
      const syncResult = await fullSync(accountId);

      // 3. Нормализуем результаты
      const normalizeResult = await normalizeAllResults(accountId);

      // 4. Добавляем clicks как семейство
      const clicksAdded = await ensureClickFamily(accountId);

      // 5. Детектируем аномалии
      const anomalyResult = await processAdAccount(accountId);

      log.info({ adminId, accountId, syncResult, anomalyResult }, 'Full sync completed');

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
      log.error({ error, adminId, accountId }, 'Sync failed');
      return reply.status(500).send({
        error: 'Sync failed',
        message: error.message,
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
      const { data: account } = await supabase
        .from('ad_accounts')
        .select('fb_ad_account_id, fb_access_token')
        .eq('id', accountId)
        .single();

      if (!account?.fb_access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const cleanFbAccountId = account.fb_ad_account_id.replace('act_', '');

      const campaigns = await syncCampaigns(accountId, account.fb_access_token, cleanFbAccountId);
      const adsets = await syncAdsets(accountId, account.fb_access_token, cleanFbAccountId);
      const ads = await syncAds(accountId, account.fb_access_token, cleanFbAccountId);

      log.info({ adminId, accountId, campaigns, adsets, ads }, 'Catalogs synced');

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
        .select('fb_ad_account_id, fb_access_token')
        .eq('id', accountId)
        .single();

      if (!account?.fb_access_token) {
        return reply.status(400).send({ error: 'No access token' });
      }

      const cleanFbAccountId = account.fb_ad_account_id.replace('act_', '');
      const result = await syncWeeklyInsights(accountId, account.fb_access_token, cleanFbAccountId, months);

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
    const { status, type, minScore, limit = 50, offset = 0 } = request.query;

    try {
      const anomalies = await getAnomalies(accountId, {
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
      const summary = await getAnomalySummary(accountId);

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
      let predictions = await predictAllAds(accountId);

      // Фильтруем по risk level если указан
      if (riskLevel) {
        predictions = predictions.filter(p => p.riskLevel === riskLevel);
      }

      // Лимит
      predictions = predictions.slice(0, limit);

      return reply.send({
        success: true,
        count: predictions.length,
        predictions,
        summary: {
          total: predictions.length,
          byRisk: {
            critical: predictions.filter(p => p.riskLevel === 'critical').length,
            high: predictions.filter(p => p.riskLevel === 'high').length,
            medium: predictions.filter(p => p.riskLevel === 'medium').length,
            low: predictions.filter(p => p.riskLevel === 'low').length,
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
  // AD ACCOUNTS LIST (Admin Only)
  // ============================================================================

  /**
   * GET /admin/ad-insights/accounts
   * Список всех ad accounts для админки
   */
  fastify.get('/admin/ad-insights/accounts', async (request, reply) => {
    const adminId = await requireTechAdmin(request, reply);
    if (!adminId) return;

    try {
      const { data, error } = await supabase
        .from('ad_accounts')
        .select(`
          id,
          fb_ad_account_id,
          connection_status,
          user_account_id,
          created_at,
          updated_at,
          user_accounts!inner(email, name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return reply.send({
        success: true,
        count: data?.length || 0,
        accounts: data,
      });
    } catch (error: any) {
      log.error({ error, adminId }, 'Failed to fetch ad accounts');
      return reply.status(500).send({ error: error.message });
    }
  });
}
