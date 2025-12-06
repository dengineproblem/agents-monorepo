/**
 * User Scoring CRON
 *
 * Ежедневно рассчитывает скоры вовлечённости пользователей
 * Запускается каждый день в 03:00 (когда нагрузка минимальна)
 *
 * Скоры:
 * - engagement_score: page views, clicks, время на сайте
 * - activity_score: API calls, бизнес-действия
 * - health_score: процент успешных операций
 * - overall_score: взвешенная сумма
 *
 * @module cron/userScoringCron
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ module: 'userScoringCron' });

// =====================================================
// Константы для расчёта скоров
// =====================================================

// Максимальные значения для нормализации (100%)
const MAX_PAGE_VIEWS = 50;      // 50 page views в день = 100%
const MAX_CLICKS = 100;         // 100 кликов в день = 100%
const MAX_SESSION_TIME = 3600;  // 1 час в день = 100%
const MAX_API_CALLS = 200;      // 200 API calls в день = 100%
const MAX_BUSINESS_ACTIONS = 10; // 10 бизнес-действий в день = 100%

// Веса для overall_score
const WEIGHT_ENGAGEMENT = 0.3;
const WEIGHT_ACTIVITY = 0.4;
const WEIGHT_HEALTH = 0.3;

// =====================================================
// Типы
// =====================================================

interface UserDayStats {
  userAccountId: string;
  accountId: string | null;
  date: string;
  pageViews: number;
  clicks: number;
  totalTimeSeconds: number;
  apiCallsSuccess: number;
  apiCallsFailure: number;
  totalSessions: number;
  campaignsCreated: number;
  creativesLaunched: number;
  leadsReceived: number;
}

// =====================================================
// Функции расчёта скоров
// =====================================================

/**
 * Нормализует значение в диапазон 0-100
 */
function normalize(value: number, max: number): number {
  return Math.min(Math.round((value / max) * 100), 100);
}

/**
 * Рассчитывает engagement score
 * Основан на: page views, clicks, время на сайте
 */
function calculateEngagementScore(stats: UserDayStats): number {
  const pageViewScore = normalize(stats.pageViews, MAX_PAGE_VIEWS);
  const clickScore = normalize(stats.clicks, MAX_CLICKS);
  const timeScore = normalize(stats.totalTimeSeconds, MAX_SESSION_TIME);

  // Средневзвешенное: page views (30%) + clicks (30%) + time (40%)
  return Math.round(pageViewScore * 0.3 + clickScore * 0.3 + timeScore * 0.4);
}

/**
 * Рассчитывает activity score
 * Основан на: API calls, бизнес-действия
 */
function calculateActivityScore(stats: UserDayStats): number {
  const apiScore = normalize(stats.apiCallsSuccess, MAX_API_CALLS);

  // Бизнес-действия: campaigns + creatives + leads
  const businessActions = stats.campaignsCreated + stats.creativesLaunched + stats.leadsReceived;
  const businessScore = normalize(businessActions, MAX_BUSINESS_ACTIONS);

  // API (40%) + Business (60%)
  return Math.round(apiScore * 0.4 + businessScore * 0.6);
}

/**
 * Рассчитывает health score
 * Основан на: процент успешных операций, отсутствие ошибок
 */
function calculateHealthScore(stats: UserDayStats): number {
  const totalApiCalls = stats.apiCallsSuccess + stats.apiCallsFailure;

  if (totalApiCalls === 0) {
    // Нет API calls - нейтральный скор
    return 50;
  }

  // Процент успешных API calls
  const successRate = (stats.apiCallsSuccess / totalApiCalls) * 100;

  return Math.round(successRate);
}

/**
 * Рассчитывает overall score
 */
function calculateOverallScore(engagement: number, activity: number, health: number): number {
  return Math.round(
    engagement * WEIGHT_ENGAGEMENT +
    activity * WEIGHT_ACTIVITY +
    health * WEIGHT_HEALTH
  );
}

// =====================================================
// Основная логика
// =====================================================

/**
 * Агрегирует статистику за день для всех пользователей
 */
async function aggregateDailyStats(date: string): Promise<UserDayStats[]> {
  const startOfDay = `${date}T00:00:00Z`;
  const endOfDay = `${date}T23:59:59Z`;

  // Получаем события за день
  const { data: events, error: eventsError } = await supabase
    .from('user_events')
    .select('user_account_id, account_id, event_category, event_action, api_status_code')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  if (eventsError) {
    logger.error({ error: eventsError.message, date }, 'Failed to fetch events for scoring');
    return [];
  }

  // Получаем сессии за день
  const { data: sessions, error: sessionsError } = await supabase
    .from('user_sessions')
    .select('user_account_id, duration_seconds, page_views, clicks')
    .gte('started_at', startOfDay)
    .lte('started_at', endOfDay);

  if (sessionsError) {
    logger.error({ error: sessionsError.message, date }, 'Failed to fetch sessions for scoring');
  }

  // Получаем бизнес-события (campaigns, creatives, leads)
  const { data: businessEvents } = await supabase
    .from('user_events')
    .select('user_account_id, account_id, event_action')
    .eq('event_category', 'business')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  // Агрегируем по пользователям
  const userStatsMap = new Map<string, UserDayStats>();

  // Обработка событий
  events?.forEach(event => {
    const key = `${event.user_account_id}:${event.account_id || 'null'}`;

    if (!userStatsMap.has(key)) {
      userStatsMap.set(key, {
        userAccountId: event.user_account_id,
        accountId: event.account_id,
        date,
        pageViews: 0,
        clicks: 0,
        totalTimeSeconds: 0,
        apiCallsSuccess: 0,
        apiCallsFailure: 0,
        totalSessions: 0,
        campaignsCreated: 0,
        creativesLaunched: 0,
        leadsReceived: 0
      });
    }

    const stats = userStatsMap.get(key)!;

    if (event.event_category === 'page_view') {
      stats.pageViews++;
    } else if (event.event_category === 'click') {
      stats.clicks++;
    } else if (event.event_category === 'api_call') {
      if (event.api_status_code && event.api_status_code >= 400) {
        stats.apiCallsFailure++;
      } else {
        stats.apiCallsSuccess++;
      }
    }
  });

  // Обработка сессий
  sessions?.forEach(session => {
    // Для сессий нет account_id напрямую, используем только user_account_id
    const key = `${session.user_account_id}:null`;

    if (!userStatsMap.has(key)) {
      userStatsMap.set(key, {
        userAccountId: session.user_account_id,
        accountId: null,
        date,
        pageViews: 0,
        clicks: 0,
        totalTimeSeconds: 0,
        apiCallsSuccess: 0,
        apiCallsFailure: 0,
        totalSessions: 0,
        campaignsCreated: 0,
        creativesLaunched: 0,
        leadsReceived: 0
      });
    }

    const stats = userStatsMap.get(key)!;
    stats.totalSessions++;
    stats.totalTimeSeconds += session.duration_seconds || 0;

    // Добавляем page views и clicks из сессий (если не были посчитаны из событий)
    if (stats.pageViews === 0) {
      stats.pageViews = session.page_views || 0;
    }
    if (stats.clicks === 0) {
      stats.clicks = session.clicks || 0;
    }
  });

  // Обработка бизнес-событий
  businessEvents?.forEach(event => {
    const key = `${event.user_account_id}:${event.account_id || 'null'}`;

    if (!userStatsMap.has(key)) {
      userStatsMap.set(key, {
        userAccountId: event.user_account_id,
        accountId: event.account_id,
        date,
        pageViews: 0,
        clicks: 0,
        totalTimeSeconds: 0,
        apiCallsSuccess: 0,
        apiCallsFailure: 0,
        totalSessions: 0,
        campaignsCreated: 0,
        creativesLaunched: 0,
        leadsReceived: 0
      });
    }

    const stats = userStatsMap.get(key)!;

    if (event.event_action === 'campaign_created') {
      stats.campaignsCreated++;
    } else if (event.event_action === 'creative_launched') {
      stats.creativesLaunched++;
    } else if (event.event_action === 'lead_received') {
      stats.leadsReceived++;
    }
  });

  return Array.from(userStatsMap.values());
}

/**
 * Сохраняет скоры в БД
 */
async function saveScores(stats: UserDayStats[]): Promise<number> {
  if (stats.length === 0) return 0;

  const rows = stats.map(s => {
    const engagementScore = calculateEngagementScore(s);
    const activityScore = calculateActivityScore(s);
    const healthScore = calculateHealthScore(s);
    const overallScore = calculateOverallScore(engagementScore, activityScore, healthScore);

    return {
      user_account_id: s.userAccountId,
      account_id: s.accountId,
      date: s.date,
      total_sessions: s.totalSessions,
      total_page_views: s.pageViews,
      total_clicks: s.clicks,
      total_time_seconds: s.totalTimeSeconds,
      api_calls_success: s.apiCallsSuccess,
      api_calls_failure: s.apiCallsFailure,
      campaigns_created: s.campaignsCreated,
      creatives_launched: s.creativesLaunched,
      leads_received: s.leadsReceived,
      engagement_score: engagementScore,
      activity_score: activityScore,
      health_score: healthScore,
      overall_score: overallScore
    };
  });

  // Upsert - обновляем если запись уже есть
  const { error } = await supabase
    .from('user_engagement_scores')
    .upsert(rows, {
      onConflict: 'user_account_id,account_id,date'
    });

  if (error) {
    logger.error({ error: error.message, count: rows.length }, 'Failed to save scores');
    return 0;
  }

  return rows.length;
}

/**
 * Основная функция расчёта скоров за вчера
 */
async function calculateYesterdayScores(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  logger.info({ date: dateStr }, 'Starting daily user scoring');

  try {
    const stats = await aggregateDailyStats(dateStr);

    if (stats.length === 0) {
      logger.info({ date: dateStr }, 'No user activity found for scoring');
      return;
    }

    const savedCount = await saveScores(stats);
    logger.info({ date: dateStr, usersScored: savedCount }, 'Daily user scoring completed');
  } catch (err) {
    logger.error({ error: String(err), date: dateStr }, 'Error in daily user scoring');
  }
}

// =====================================================
// Экспорт CRON
// =====================================================

/**
 * Запускает CRON для ежедневного скоринга
 * Расписание: каждый день в 03:00
 */
export function startUserScoringCron(app: FastifyInstance): void {
  app.log.info('📊 User scoring cron started (runs daily at 03:00)');

  // Каждый день в 03:00
  cron.schedule('0 3 * * *', async () => {
    try {
      await calculateYesterdayScores();
    } catch (err) {
      app.log.error({ error: String(err) }, '[UserScoringCron] Unexpected error');
    }
  });

  // Также можно вызвать вручную для тестирования
  // calculateYesterdayScores();
}

/**
 * Ручной запуск скоринга (для тестирования)
 */
export async function runScoringManually(date?: string): Promise<void> {
  if (date) {
    const stats = await aggregateDailyStats(date);
    await saveScores(stats);
  } else {
    await calculateYesterdayScores();
  }
}
