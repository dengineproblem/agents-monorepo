/**
 * Analytics API Routes
 *
 * Handles user event tracking, session management, and analytics data retrieval
 *
 * @module routes/analytics
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { eventLogger, UserEvent } from '../lib/eventLogger.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const logger = createLogger({ module: 'analyticsRoutes' });

// =====================================================
// Schemas
// =====================================================

const EventSchema = z.object({
  eventCategory: z.enum(['page_view', 'click', 'form', 'api_call', 'error']),
  eventAction: z.string(),
  eventLabel: z.string().optional(),
  eventValue: z.number().optional(),
  pagePath: z.string().optional(),
  component: z.string().optional(),
  apiEndpoint: z.string().optional(),
  apiMethod: z.string().optional(),
  apiStatusCode: z.number().optional(),
  apiDurationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  errorStack: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  clientTimestamp: z.string()
});

const ClientInfoSchema = z.object({
  userAgent: z.string().optional(),
  screenWidth: z.number().optional(),
  screenHeight: z.number().optional(),
  language: z.string().optional()
});

const BatchEventsSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().nullable().optional(),
  sessionId: z.string(),
  events: z.array(EventSchema),
  clientInfo: ClientInfoSchema.optional()
});

// =====================================================
// Helper Functions
// =====================================================

/**
 * Detect device type from User-Agent string
 */
function detectDeviceType(ua?: string): string {
  if (!ua) return 'unknown';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}

/**
 * Upsert user session - create or update session stats
 */
async function upsertSession(
  userId: string,
  sessionId: string,
  events: z.infer<typeof EventSchema>[],
  clientInfo?: z.infer<typeof ClientInfoSchema>
): Promise<void> {
  const pageViews = events.filter(e => e.eventCategory === 'page_view').length;
  const clicks = events.filter(e => e.eventCategory === 'click').length;
  const apiCalls = events.filter(e => e.eventCategory === 'api_call').length;
  const errors = events.filter(e => e.eventCategory === 'error').length;

  try {
    // Check if session exists
    const { data: existing } = await supabase
      .from('user_sessions')
      .select('id, page_views, clicks, api_calls, errors')
      .eq('session_id', sessionId)
      .single();

    if (existing) {
      // Update existing session
      await supabase.from('user_sessions').update({
        page_views: existing.page_views + pageViews,
        clicks: existing.clicks + clicks,
        api_calls: existing.api_calls + apiCalls,
        errors: existing.errors + errors,
        exit_page: events[events.length - 1]?.pagePath || null,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      // Create new session
      await supabase.from('user_sessions').insert({
        user_account_id: userId,
        session_id: sessionId,
        started_at: new Date().toISOString(),
        page_views: pageViews,
        clicks: clicks,
        api_calls: apiCalls,
        errors: errors,
        entry_page: events[0]?.pagePath || null,
        device_type: detectDeviceType(clientInfo?.userAgent)
      });
    }
  } catch (err) {
    logger.error({ error: String(err), sessionId }, 'Failed to upsert session');
  }
}

// =====================================================
// Routes
// =====================================================

export default async function analyticsRoutes(app: FastifyInstance) {
  /**
   * POST /analytics/events
   *
   * Batch insert events from frontend
   * Called every 5 seconds or when queue reaches 20 events
   */
  app.post('/analytics/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = BatchEventsSchema.safeParse(request.body);

    if (!parsed.success) {
      logger.warn({ errors: parsed.error.errors }, 'Invalid analytics payload');
      return reply.code(400).send({
        error: 'Invalid payload',
        details: parsed.error.errors
      });
    }

    const { userAccountId, accountId, sessionId, events, clientInfo } = parsed.data;

    if (events.length === 0) {
      return reply.send({ success: true, count: 0 });
    }

    // Enrich events with additional data
    const enrichedEvents: UserEvent[] = events.map(e => ({
      ...e,
      userAccountId,
      accountId: accountId || undefined,
      sessionId,
      userAgent: clientInfo?.userAgent,
      deviceType: detectDeviceType(clientInfo?.userAgent)
    }));

    // Log events to database
    await eventLogger.logBatch(enrichedEvents);

    // Upsert session
    await upsertSession(userAccountId, sessionId, events, clientInfo);

    logger.debug({
      userAccountId,
      sessionId,
      count: events.length
    }, 'Analytics events received');

    return reply.send({ success: true, count: events.length });
  });

  /**
   * GET /analytics/users
   *
   * List all users with their engagement scores
   * Used by Admin Analytics dashboard
   */
  app.get('/analytics/users', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { data, error } = await supabase
        .from('user_engagement_scores')
        .select(`
          user_account_id,
          date,
          total_sessions,
          total_page_views,
          total_clicks,
          total_time_seconds,
          campaigns_created,
          creatives_launched,
          leads_received,
          engagement_score,
          activity_score,
          health_score,
          overall_score,
          user_accounts!inner(username)
        `)
        .order('date', { ascending: false })
        .limit(200);

      if (error) {
        logger.error({ error: error.message }, 'Failed to fetch user scores');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ users: data || [] });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in /analytics/users');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_analytics_users',
        endpoint: '/analytics/users',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /analytics/user/:id
   *
   * Get detailed analytics for a specific user
   */
  app.get('/analytics/user/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { days = '30' } = request.query as { days?: string };

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));
    const sinceStr = since.toISOString();

    try {
      // Get scores
      const { data: scores } = await supabase
        .from('user_engagement_scores')
        .select('*')
        .eq('user_account_id', id)
        .gte('date', since.toISOString().split('T')[0])
        .order('date', { ascending: false });

      // Get recent events
      const { data: events } = await supabase
        .from('user_events')
        .select('event_category, event_action, event_label, page_path, created_at')
        .eq('user_account_id', id)
        .gte('created_at', sinceStr)
        .order('created_at', { ascending: false })
        .limit(100);

      // Aggregate page views
      const { data: pageStats } = await supabase
        .from('user_events')
        .select('page_path')
        .eq('user_account_id', id)
        .eq('event_category', 'page_view')
        .gte('created_at', sinceStr);

      const pageViews: Record<string, number> = {};
      pageStats?.forEach(e => {
        if (e.page_path) {
          pageViews[e.page_path] = (pageViews[e.page_path] || 0) + 1;
        }
      });

      // Get sessions
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('started_at, duration_seconds, page_views, entry_page, device_type')
        .eq('user_account_id', id)
        .gte('started_at', sinceStr)
        .order('started_at', { ascending: false })
        .limit(50);

      return reply.send({
        scores: scores || [],
        recentEvents: events || [],
        pageViews,
        sessions: sessions || []
      });
    } catch (err: any) {
      logger.error({ error: String(err), userId: id }, 'Exception in /analytics/user/:id');

      logErrorToAdmin({
        user_account_id: id,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_user_analytics',
        endpoint: '/analytics/user/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /analytics/realtime
   *
   * Get currently active sessions (last 15 minutes)
   * Used for real-time dashboard indicator
   */
  app.get('/analytics/realtime', async (request: FastifyRequest, reply: FastifyReply) => {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .select(`
          user_account_id,
          session_id,
          page_views,
          clicks,
          started_at,
          updated_at,
          entry_page,
          device_type,
          user_accounts!inner(username)
        `)
        .gte('updated_at', fifteenMinAgo)
        .order('updated_at', { ascending: false });

      if (error) {
        logger.error({ error: error.message }, 'Failed to fetch active sessions');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ activeSessions: data || [] });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in /analytics/realtime');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_realtime_analytics',
        endpoint: '/analytics/realtime',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /analytics/summary
   *
   * Get aggregated analytics summary for dashboard
   */
  app.get('/analytics/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const { days = '7' } = request.query as { days?: string };

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));
    const sinceStr = since.toISOString();

    try {
      // Total events by category
      const { data: eventCounts } = await supabase
        .from('user_events')
        .select('event_category')
        .gte('created_at', sinceStr);

      const categoryCounts: Record<string, number> = {};
      eventCounts?.forEach(e => {
        categoryCounts[e.event_category] = (categoryCounts[e.event_category] || 0) + 1;
      });

      // Unique users
      const { data: uniqueUsers } = await supabase
        .from('user_events')
        .select('user_account_id')
        .gte('created_at', sinceStr);

      const uniqueUserIds = new Set(uniqueUsers?.map(e => e.user_account_id) || []);

      // Average scores
      const { data: avgScores } = await supabase
        .from('user_engagement_scores')
        .select('engagement_score, activity_score, health_score, overall_score')
        .gte('date', since.toISOString().split('T')[0]);

      let avgEngagement = 0, avgActivity = 0, avgHealth = 0, avgOverall = 0;
      if (avgScores && avgScores.length > 0) {
        avgEngagement = Math.round(avgScores.reduce((sum, s) => sum + (s.engagement_score || 0), 0) / avgScores.length);
        avgActivity = Math.round(avgScores.reduce((sum, s) => sum + (s.activity_score || 0), 0) / avgScores.length);
        avgHealth = Math.round(avgScores.reduce((sum, s) => sum + (s.health_score || 0), 0) / avgScores.length);
        avgOverall = Math.round(avgScores.reduce((sum, s) => sum + (s.overall_score || 0), 0) / avgScores.length);
      }

      return reply.send({
        period: { days: parseInt(days), since: sinceStr },
        totalEvents: eventCounts?.length || 0,
        eventsByCategory: categoryCounts,
        uniqueUsers: uniqueUserIds.size,
        averageScores: {
          engagement: avgEngagement,
          activity: avgActivity,
          health: avgHealth,
          overall: avgOverall
        }
      });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in /analytics/summary');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_analytics_summary',
        endpoint: '/analytics/summary',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /analytics/capi-stats
   *
   * Get CAPI events statistics for dashboard
   * Returns event counts by level and conversion rates
   */
  app.get('/analytics/capi-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const { user_account_id, since, until } = request.query as {
      user_account_id: string;
      since: string;
      until: string;
    };

    // Validate required parameters
    if (!user_account_id || !since || !until) {
      logger.warn({
        user_account_id,
        since,
        until,
      }, '[capi-stats] Missing required parameters');
      return reply.code(400).send({
        error: 'Missing required parameters: user_account_id, since, until'
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(since) || !dateRegex.test(until)) {
      logger.warn({
        user_account_id,
        since,
        until,
      }, '[capi-stats] Invalid date format');
      return reply.code(400).send({
        error: 'Invalid date format. Expected YYYY-MM-DD'
      });
    }

    logger.info({
      user_account_id,
      since,
      until,
    }, '[capi-stats] Fetching CAPI stats');

    try {
      // Check if user has any direction with CAPI enabled
      const { data: directions, error: dirError } = await supabase
        .from('account_directions')
        .select('id')
        .eq('user_account_id', user_account_id)
        .eq('capi_enabled', true)
        .limit(1);

      if (dirError) {
        logger.warn({
          user_account_id,
          error: dirError.message,
        }, '[capi-stats] Error checking CAPI directions');
      }

      const capiEnabled = !dirError && directions && directions.length > 0;

      // If CAPI is not enabled for any direction, return early with capiEnabled: false
      if (!capiEnabled) {
        logger.debug({
          user_account_id,
          durationMs: Date.now() - startTime,
        }, '[capi-stats] CAPI not enabled for user');
        return reply.send({
          capiEnabled: false,
          lead: 0,
          registration: 0,
          schedule: 0,
          total: 0,
          conversionL1toL2: 0,
          conversionL2toL3: 0
        });
      }

      // Fetch all successful CAPI events for the period
      const { data, error } = await supabase
        .from('capi_events_log')
        .select('event_level')
        .eq('user_account_id', user_account_id)
        .eq('capi_status', 'success')
        .gte('created_at', since + 'T00:00:00.000Z')
        .lte('created_at', until + 'T23:59:59.999Z');

      if (error) {
        logger.error({
          user_account_id,
          error: error.message,
          since,
          until,
        }, '[capi-stats] Failed to fetch CAPI events');
        return reply.code(500).send({ error: error.message });
      }

      // Count events by level
      const counts = { level1: 0, level2: 0, level3: 0 };
      data?.forEach(e => {
        if (e.event_level === 1) counts.level1++;
        else if (e.event_level === 2) counts.level2++;
        else if (e.event_level === 3) counts.level3++;
      });

      // Calculate conversion rates
      const conversionL1toL2 = counts.level1 > 0
        ? Math.round((counts.level2 / counts.level1) * 100 * 10) / 10
        : 0;
      const conversionL2toL3 = counts.level2 > 0
        ? Math.round((counts.level3 / counts.level2) * 100 * 10) / 10
        : 0;

      const result = {
        capiEnabled: true,
        lead: counts.level1,           // Interest (level 1)
        registration: counts.level2,   // Qualified (level 2)
        schedule: counts.level3,       // Scheduled (level 3)
        total: counts.level1 + counts.level2 + counts.level3,
        conversionL1toL2,              // % Lead → Registration
        conversionL2toL3               // % Registration → Schedule
      };

      logger.info({
        user_account_id,
        since,
        until,
        eventsCount: data?.length || 0,
        result,
        durationMs: Date.now() - startTime,
      }, '[capi-stats] Successfully fetched CAPI stats');

      return reply.send(result);
    } catch (err: any) {
      logger.error({
        user_account_id,
        error: String(err),
        stack: err.stack,
        durationMs: Date.now() - startTime,
      }, '[capi-stats] Exception');

      logErrorToAdmin({
        user_account_id,
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_capi_stats',
        endpoint: '/analytics/capi-stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
