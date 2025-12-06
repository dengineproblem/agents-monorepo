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
    } catch (err) {
      logger.error({ error: String(err) }, 'Exception in /analytics/users');
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
    } catch (err) {
      logger.error({ error: String(err), userId: id }, 'Exception in /analytics/user/:id');
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
    } catch (err) {
      logger.error({ error: String(err) }, 'Exception in /analytics/realtime');
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
    } catch (err) {
      logger.error({ error: String(err) }, 'Exception in /analytics/summary');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
