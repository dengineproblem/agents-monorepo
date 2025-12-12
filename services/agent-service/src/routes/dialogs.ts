import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { analyzeDialogs } from '../scripts/analyzeDialogs.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

// Validation schemas
const AnalyzeDialogsSchema = z.object({
  instanceName: z.string().min(1),
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(),  // UUID для мультиаккаунтности
  minIncoming: z.number().int().min(1).optional().default(3),
  maxDialogs: z.number().int().min(1).optional(),
  maxContacts: z.number().int().min(1).optional(),
});

const GetAnalysisSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(),  // UUID для мультиаккаунтности
  instanceName: z.string().optional(),
  interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  funnelStage: z.enum(['new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost']).optional(),
  qualificationComplete: z.boolean().optional(),
});

const ExportCsvSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(),  // UUID для мультиаккаунтности
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
      const { instanceName, userAccountId, accountId, minIncoming, maxDialogs, maxContacts } = body;

      app.log.info({ instanceName, userAccountId, accountId, minIncoming, maxDialogs, maxContacts }, 'Starting dialog analysis');

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
        accountId,  // UUID для мультиаккаунтности
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

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_analyze',
        endpoint: '/dialogs/analyze',
        severity: 'warning'
      }).catch(() => {});

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
      const { userAccountId, accountId, instanceName, interestLevel, minScore, funnelStage, qualificationComplete } = query;

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('score', { ascending: false })
        .order('last_message', { ascending: false });

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        dbQuery = dbQuery.eq('account_id', accountId);
      }

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

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_get_analysis',
        endpoint: '/dialogs/analysis',
        severity: 'warning'
      }).catch(() => {});

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
      const { userAccountId, accountId, instanceName, interestLevel } = query;

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('contact_phone, contact_name, interest_level, score, business_type, funnel_stage, instagram_url, ad_budget, qualification_complete, is_owner, has_sales_dept, uses_ads_now, objection, next_message, incoming_count, outgoing_count, last_message')
        .eq('user_account_id', userAccountId)
        .order('score', { ascending: false });

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        dbQuery = dbQuery.eq('account_id', accountId);
      }

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

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_export_csv',
        endpoint: '/dialogs/export-csv',
        severity: 'warning'
      }).catch(() => {});

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
      const { userAccountId, accountId, instanceName } = request.query as {
        userAccountId?: string;
        accountId?: string;  // UUID для мультиаккаунтности
        instanceName?: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      let dbQuery = supabase
        .from('dialog_analysis')
        .select('interest_level, score, incoming_count, funnel_stage, qualification_complete')
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        dbQuery = dbQuery.eq('account_id', accountId);
      }

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

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_get_stats',
        endpoint: '/dialogs/stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({
        error: 'Failed to fetch stats',
        message: error.message
      });
    }
  });

  /**
   * POST /api/dialogs/leads
   * Create a new lead manually
   */
  app.post('/dialogs/leads', async (request, reply) => {
    try {
      const CreateLeadSchema = z.object({
        phone: z.string().min(1),
        contactName: z.string().optional(),
        businessType: z.string().optional(),
        isMedical: z.boolean().optional(),
        funnelStage: z.enum(['new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost']),
        userAccountId: z.string().uuid(),
        accountId: z.string().uuid().optional(),  // UUID для мультиаккаунтности
        instanceName: z.string().min(1),
        notes: z.string().optional(),
      });

      const body = CreateLeadSchema.parse(request.body);

      // Verify that instance belongs to user
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', body.instanceName)
        .eq('user_account_id', body.userAccountId)
        .maybeSingle();

      if (instanceError || !instance) {
        return reply.status(404).send({ 
          error: 'Instance not found or does not belong to user' 
        });
      }

      const { data, error } = await supabase
        .from('dialog_analysis')
        .insert({
          contact_phone: body.phone,
          contact_name: body.contactName || null,
          business_type: body.businessType || null,
          is_medical: body.isMedical || false,
          funnel_stage: body.funnelStage,
          user_account_id: body.userAccountId,
          account_id: body.accountId || null,  // UUID для мультиаккаунтности
          instance_name: body.instanceName,
          interest_level: 'cold',
          score: 5,
          incoming_count: 0,
          outgoing_count: 0,
          next_message: '',
          notes: body.notes || null,
          analyzed_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      app.log.info({ leadId: data.id, phone: body.phone }, 'Lead created manually');

      return reply.send({ success: true, lead: data });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to create lead');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_create_lead',
        endpoint: '/dialogs/leads',
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({
        error: 'Failed to create lead',
        message: error.message
      });
    }
  });

  /**
   * PATCH /api/dialogs/leads/:id
   * Update a lead
   */
  app.patch('/dialogs/leads/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      
      const UpdateLeadSchema = z.object({
        userAccountId: z.string().uuid(),
        accountId: z.string().uuid().optional(),  // UUID для мультиаккаунтности
        contactName: z.string().optional(),
        businessType: z.string().optional(),
        isMedical: z.boolean().optional(),
        isOwner: z.boolean().optional(),
        hasSalesDept: z.boolean().optional(),
        usesAdsNow: z.boolean().optional(),
        adBudget: z.string().optional(),
        sentInstagram: z.boolean().optional(),
        instagramUrl: z.string().optional(),
        hasBooking: z.boolean().optional(),
        funnelStage: z.enum(['new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost']).optional(),
        interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
        objection: z.string().optional(),
        nextMessage: z.string().optional(),
        notes: z.string().optional(),
        score: z.number().min(0).max(100).optional(),
      });

      const body = UpdateLeadSchema.parse(request.body);
      const { accountId } = body;

      // Build update object
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (body.contactName !== undefined) updateData.contact_name = body.contactName;
      if (body.businessType !== undefined) updateData.business_type = body.businessType;
      if (body.isMedical !== undefined) updateData.is_medical = body.isMedical;
      if (body.isOwner !== undefined) updateData.is_owner = body.isOwner;
      if (body.hasSalesDept !== undefined) updateData.has_sales_dept = body.hasSalesDept;
      if (body.usesAdsNow !== undefined) updateData.uses_ads_now = body.usesAdsNow;
      if (body.adBudget !== undefined) updateData.ad_budget = body.adBudget;
      if (body.sentInstagram !== undefined) updateData.sent_instagram = body.sentInstagram;
      if (body.instagramUrl !== undefined) updateData.instagram_url = body.instagramUrl;
      if (body.hasBooking !== undefined) updateData.has_booking = body.hasBooking;
      if (body.funnelStage !== undefined) updateData.funnel_stage = body.funnelStage;
      if (body.interestLevel !== undefined) updateData.interest_level = body.interestLevel;
      if (body.objection !== undefined) updateData.objection = body.objection;
      if (body.nextMessage !== undefined) updateData.next_message = body.nextMessage;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.score !== undefined) updateData.score = body.score;

      let updateQuery = supabase
        .from('dialog_analysis')
        .update(updateData)
        .eq('id', id)
        .eq('user_account_id', body.userAccountId);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        updateQuery = updateQuery.eq('account_id', accountId);
      }

      const { data, error } = await updateQuery
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      app.log.info({ leadId: id }, 'Lead updated');

      return reply.send({ success: true, lead: data });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to update lead');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_update_lead',
        endpoint: '/dialogs/leads/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({
        error: 'Failed to update lead',
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
      const { userAccountId, accountId } = request.query as {
        userAccountId?: string;
        accountId?: string;  // UUID для мультиаккаунтности
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      let deleteQuery = supabase
        .from('dialog_analysis')
        .delete()
        .eq('id', id)
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id для мультиаккаунтности
      if (accountId) {
        deleteQuery = deleteQuery.eq('account_id', accountId);
      }

      const { error } = await deleteQuery;

      if (error) {
        throw error;
      }

      app.log.info({ leadId: id }, 'Lead deleted');

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete analysis');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'dialogs_delete_analysis',
        endpoint: '/dialogs/analysis/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({
        error: 'Delete failed',
        message: error.message
      });
    }
  });
}

