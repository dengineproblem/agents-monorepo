import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  generateConversationReport,
  generateAllConversationReports
} from '../scripts/generateConversationReport.js';

// Validation schemas
const GetReportsSchema = z.object({
  userAccountId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const GenerateReportSchema = z.object({
  userAccountId: z.string().uuid(),
  date: z.string().optional(), // ISO date string (e.g., "2024-01-15")
});

export async function conversationReportsRoutes(app: FastifyInstance) {

  /**
   * GET /conversation-reports
   * Get conversation reports for a user
   */
  app.get('/conversation-reports', async (request, reply) => {
    try {
      const query = GetReportsSchema.parse(request.query);
      const { userAccountId, limit, offset } = query;

      const { data, error, count } = await supabase
        .from('conversation_reports')
        .select('*', { count: 'exact' })
        .eq('user_account_id', userAccountId)
        .order('report_date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        reports: data || [],
        total: count || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({ error: error.message }, 'Failed to fetch conversation reports');
      return reply.status(500).send({
        error: 'Failed to fetch reports',
        message: error.message
      });
    }
  });

  /**
   * GET /conversation-reports/:id
   * Get a specific conversation report
   */
  app.get('/conversation-reports/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId } = request.query as { userAccountId?: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { data, error } = await supabase
        .from('conversation_reports')
        .select('*')
        .eq('id', id)
        .eq('user_account_id', userAccountId)
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        return reply.status(404).send({ error: 'Report not found' });
      }

      return reply.send({
        success: true,
        report: data,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch report');
      return reply.status(500).send({
        error: 'Failed to fetch report',
        message: error.message
      });
    }
  });

  /**
   * GET /conversation-reports/latest
   * Get the latest conversation report for a user
   */
  app.get('/conversation-reports/latest', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId?: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { data, error } = await supabase
        .from('conversation_reports')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        report: data,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch latest report');
      return reply.status(500).send({
        error: 'Failed to fetch report',
        message: error.message
      });
    }
  });

  /**
   * POST /conversation-reports/generate
   * Generate a new conversation report for a user
   */
  app.post('/conversation-reports/generate', async (request, reply) => {
    try {
      const body = GenerateReportSchema.parse(request.body);
      const { userAccountId, date } = body;

      app.log.info({ userAccountId, date }, 'Generating conversation report');

      const reportDate = date ? new Date(date) : undefined;
      const result = await generateConversationReport({
        userAccountId,
        date: reportDate
      });

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error
        });
      }

      return reply.send({
        success: true,
        report: result.report,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({ error: error.message }, 'Failed to generate report');
      return reply.status(500).send({
        error: 'Failed to generate report',
        message: error.message
      });
    }
  });

  /**
   * POST /conversation-reports/generate-all
   * Generate conversation reports for all users (admin endpoint)
   */
  app.post('/conversation-reports/generate-all', async (request, reply) => {
    try {
      const { date, adminKey } = request.body as { date?: string; adminKey?: string };

      // Basic admin key check
      const expectedKey = process.env.ADMIN_API_KEY;
      if (expectedKey && adminKey !== expectedKey) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      app.log.info({ date }, 'Generating all conversation reports');

      const reportDate = date ? new Date(date) : undefined;
      const result = await generateAllConversationReports(reportDate);

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to generate all reports');
      return reply.status(500).send({
        error: 'Failed to generate reports',
        message: error.message
      });
    }
  });

  /**
   * GET /conversation-reports/stats
   * Get aggregated stats from recent reports
   */
  app.get('/conversation-reports/stats', async (request, reply) => {
    try {
      const { userAccountId, days } = request.query as {
        userAccountId?: string;
        days?: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const daysCount = parseInt(days || '7', 10);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysCount);

      const { data, error } = await supabase
        .from('conversation_reports')
        .select('*')
        .eq('user_account_id', userAccountId)
        .gte('report_date', startDate.toISOString().split('T')[0])
        .order('report_date', { ascending: true });

      if (error) {
        throw error;
      }

      // Aggregate stats
      const stats = {
        period_days: daysCount,
        reports_count: data?.length || 0,
        total_dialogs: 0,
        total_new_dialogs: 0,
        total_active_dialogs: 0,
        total_incoming_messages: 0,
        total_outgoing_messages: 0,
        avg_response_time: null as number | null,
        interest_trends: {
          hot: [] as number[],
          warm: [] as number[],
          cold: [] as number[],
        },
        dates: [] as string[],
      };

      if (data && data.length > 0) {
        const responseTimes: number[] = [];

        data.forEach(report => {
          stats.total_dialogs += report.total_dialogs || 0;
          stats.total_new_dialogs += report.new_dialogs || 0;
          stats.total_active_dialogs += report.active_dialogs || 0;
          stats.total_incoming_messages += report.total_incoming_messages || 0;
          stats.total_outgoing_messages += report.total_outgoing_messages || 0;

          if (report.avg_response_time_minutes) {
            responseTimes.push(report.avg_response_time_minutes);
          }

          const interest = report.interest_distribution || {};
          stats.interest_trends.hot.push(interest.hot || 0);
          stats.interest_trends.warm.push(interest.warm || 0);
          stats.interest_trends.cold.push(interest.cold || 0);
          stats.dates.push(report.report_date);
        });

        if (responseTimes.length > 0) {
          stats.avg_response_time = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        }
      }

      return reply.send({
        success: true,
        stats,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch report stats');
      return reply.status(500).send({
        error: 'Failed to fetch stats',
        message: error.message
      });
    }
  });
}
