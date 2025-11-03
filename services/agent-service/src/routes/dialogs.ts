import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { analyzeDialogs } from '../scripts/analyzeDialogs.js';

// Validation schemas
const AnalyzeDialogsSchema = z.object({
  instanceName: z.string().min(1),
  userAccountId: z.string().uuid(),
  minIncoming: z.number().int().min(1).optional().default(3),
  maxDialogs: z.number().int().min(1).optional(),
  maxContacts: z.number().int().min(1).optional(),
});

const GetAnalysisSchema = z.object({
  userAccountId: z.string().uuid(),
  instanceName: z.string().optional(),
  interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  funnelStage: z.enum(['new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost']).optional(),
  qualificationComplete: z.boolean().optional(),
});

const ExportCsvSchema = z.object({
  userAccountId: z.string().uuid(),
  instanceName: z.string().optional(),
  interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
});

export async function dialogsRoutes(app: FastifyInstance) {
  
  /**
   * POST /api/dialogs/analyze
   * Analyze WhatsApp dialogs for a specific instance
   */
  app.post('/dialogs/analyze', async (request, reply) => {
    try {
      const body = AnalyzeDialogsSchema.parse(request.body);
      const { instanceName, userAccountId, minIncoming, maxDialogs, maxContacts } = body;

      app.log.info({ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts }, 'Starting dialog analysis');

      // Verify that instance belongs to user
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name')
        .eq('instance_name', instanceName)
        .eq('user_account_id', userAccountId)
        .maybeSingle();

      if (instanceError || !instance) {
        return reply.status(404).send({ 
          error: 'Instance not found or does not belong to user' 
        });
      }

      // Run analysis
      const stats = await analyzeDialogs({
        instanceName,
        userAccountId,
        minIncoming,
        maxDialogs,
        maxContacts,
      });

      app.log.info({ stats }, 'Dialog analysis completed');

      return reply.send({
        success: true,
        stats,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Dialog analysis failed');
      return reply.status(500).send({ 
        error: 'Analysis failed', 
        message: error.message 
      });
    }
  });

  /**
   * GET /api/dialogs/analysis
   * Get analysis results for a user
   */
  app.get('/dialogs/analysis', async (request, reply) => {
    try {
      const query = GetAnalysisSchema.parse(request.query);
      const { userAccountId, instanceName, interestLevel, minScore, funnelStage, qualificationComplete } = query;

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('score', { ascending: false })
        .order('last_message', { ascending: false });

      if (instanceName) {
        dbQuery = dbQuery.eq('instance_name', instanceName);
      }

      if (interestLevel) {
        dbQuery = dbQuery.eq('interest_level', interestLevel);
      }

      if (minScore !== undefined) {
        dbQuery = dbQuery.gte('score', minScore);
      }

      if (funnelStage) {
        dbQuery = dbQuery.eq('funnel_stage', funnelStage);
      }

      if (qualificationComplete !== undefined) {
        dbQuery = dbQuery.eq('qualification_complete', qualificationComplete);
      }

      const { data, error } = await dbQuery;

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        results: data || [],
        count: data?.length || 0,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to fetch analysis results');
      return reply.status(500).send({ 
        error: 'Failed to fetch results', 
        message: error.message 
      });
    }
  });

  /**
   * GET /api/dialogs/export-csv
   * Export analysis results as CSV
   */
  app.get('/dialogs/export-csv', async (request, reply) => {
    try {
      const query = ExportCsvSchema.parse(request.query);
      const { userAccountId, instanceName, interestLevel } = query;

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('contact_phone, contact_name, interest_level, score, business_type, funnel_stage, instagram_url, ad_budget, qualification_complete, is_owner, has_sales_dept, uses_ads_now, objection, next_message, incoming_count, outgoing_count, last_message')
        .eq('user_account_id', userAccountId)
        .order('score', { ascending: false });

      if (instanceName) {
        dbQuery = dbQuery.eq('instance_name', instanceName);
      }

      if (interestLevel) {
        dbQuery = dbQuery.eq('interest_level', interestLevel);
      }

      const { data, error } = await dbQuery;

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return reply.status(404).send({ error: 'No results found' });
      }

      // Generate CSV
      const headers = [
        'contact_phone',
        'contact_name',
        'interest_level',
        'score',
        'business_type',
        'funnel_stage',
        'instagram_url',
        'ad_budget',
        'qualification_complete',
        'is_owner',
        'has_sales_dept',
        'uses_ads_now',
        'objection',
        'next_message',
        'incoming_count',
        'outgoing_count',
        'last_message',
      ];

      const csvRows = [
        headers.join(','),
        ...data.map(row => {
          return headers.map(header => {
            const value = row[header as keyof typeof row];
            if (value === null || value === undefined) return '';
            
            // Escape quotes and wrap in quotes if contains comma or newline
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          }).join(',');
        }),
      ];

      const csv = csvRows.join('\n');

      // Set headers for file download
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="dialog-analysis-${Date.now()}.csv"`);

      return reply.send(csv);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to export CSV');
      return reply.status(500).send({ 
        error: 'Export failed', 
        message: error.message 
      });
    }
  });

  /**
   * GET /api/dialogs/stats
   * Get statistics about analyzed dialogs
   */
  app.get('/dialogs/stats', async (request, reply) => {
    try {
      const { userAccountId, instanceName } = request.query as { 
        userAccountId?: string; 
        instanceName?: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('interest_level, score, incoming_count, funnel_stage, qualification_complete')
        .eq('user_account_id', userAccountId);

      if (instanceName) {
        dbQuery = dbQuery.eq('instance_name', instanceName);
      }

      const { data, error } = await dbQuery;

      if (error) {
        throw error;
      }

      // Calculate statistics
      const stats = {
        total: data?.length || 0,
        hot: data?.filter(d => d.interest_level === 'hot').length || 0,
        warm: data?.filter(d => d.interest_level === 'warm').length || 0,
        cold: data?.filter(d => d.interest_level === 'cold').length || 0,
        avgScore: data?.length 
          ? Math.round(data.reduce((sum, d) => sum + (d.score || 0), 0) / data.length)
          : 0,
        totalMessages: data?.reduce((sum, d) => sum + (d.incoming_count || 0), 0) || 0,
        // Funnel stages
        new_lead: data?.filter(d => d.funnel_stage === 'new_lead').length || 0,
        not_qualified: data?.filter(d => d.funnel_stage === 'not_qualified').length || 0,
        qualified: data?.filter(d => d.funnel_stage === 'qualified').length || 0,
        consultation_booked: data?.filter(d => d.funnel_stage === 'consultation_booked').length || 0,
        consultation_completed: data?.filter(d => d.funnel_stage === 'consultation_completed').length || 0,
        deal_closed: data?.filter(d => d.funnel_stage === 'deal_closed').length || 0,
        deal_lost: data?.filter(d => d.funnel_stage === 'deal_lost').length || 0,
        // Qualification
        qualified_count: data?.filter(d => d.qualification_complete === true).length || 0,
      };

      return reply.send({
        success: true,
        stats,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch stats');
      return reply.status(500).send({ 
        error: 'Failed to fetch stats', 
        message: error.message 
      });
    }
  });

  /**
   * DELETE /api/dialogs/analysis/:id
   * Delete a specific analysis result
   */
  app.delete('/dialogs/analysis/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId } = request.query as { userAccountId?: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { error } = await supabase
        .from('dialog_analysis')
        .delete()
        .eq('id', id)
        .eq('user_account_id', userAccountId);

      if (error) {
        throw error;
      }

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete analysis');
      return reply.status(500).send({ 
        error: 'Delete failed', 
        message: error.message 
      });
    }
  });
}

