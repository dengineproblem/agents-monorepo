import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { analyzeDialogs, reanalyzeSingleLead } from '../scripts/analyzeDialogs.js';
import { transcribeAudio, validateAudioFile } from '../lib/whisperTranscription.js';
import { reanalyzeWithAudioContext, reanalyzeWithNotes } from '../lib/reanalyzeWithContext.js';

// Validation schemas
const AnalyzeDialogsSchema = z.object({
  instanceName: z.string().optional().transform(val => val || undefined), // Опциональный - автоматически определяется по userAccountId
  userAccountId: z.string().uuid(),
  minIncoming: z.number().int().min(1).optional().default(3), // Минимум входящих сообщений для анализа
  maxDialogs: z.number().int().min(1).optional(), // ВАЖНО: это лимит УЖЕ ОТФИЛЬТРОВАННЫХ диалогов (>= minIncoming)
  maxContacts: z.number().int().min(1).optional(), // Лимит топ N самых активных контактов из БД (до фильтрации)
});

const GetAnalysisSchema = z.object({
  userAccountId: z.string().uuid(),
  instanceName: z.string().optional(),
  interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  funnelStage: z.enum(['new_lead', 'not_qualified', 'qualified', 'consultation_booked', 'consultation_completed', 'deal_closed', 'deal_lost']).optional(),
  qualificationComplete: z.boolean().optional(),
  search: z.string().optional(),
});

const ExportCsvSchema = z.object({
  userAccountId: z.string().uuid(),
  instanceName: z.string().optional(),
  interestLevel: z.enum(['hot', 'warm', 'cold']).optional(),
});

export async function dialogsRoutes(app: FastifyInstance) {
  
  /**
   * GET /dialogs/test-instance
   * Test endpoint to check Supabase connection
   */
  app.get('/dialogs/test-instance', async (request, reply) => {
    try {
      const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';
      const instanceName = 'instance_0f559eb0_1761736509038';
      
      // Test 1: Get all instances
      const { data: allInstances, error: allError } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .limit(5);
      
      // Test 2: Get specific instance
      const { data: specificInstance, error: specificError } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_name', instanceName)
        .eq('user_account_id', userAccountId)
        .maybeSingle();
      
      return reply.send({
        allInstances: {
          data: allInstances,
          error: allError?.message,
          count: allInstances?.length || 0
        },
        specificInstance: {
          data: specificInstance,
          error: specificError?.message,
          found: !!specificInstance
        }
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
  
  /**
   * POST /dialogs/analyze
   * Analyze WhatsApp dialogs for a specific instance
   */
  app.post('/dialogs/analyze', async (request, reply) => {
    try {
      const body = AnalyzeDialogsSchema.parse(request.body);
      let { instanceName, userAccountId, minIncoming, maxDialogs, maxContacts } = body;

      app.log.info({ instanceName, userAccountId, minIncoming, maxDialogs, maxContacts }, 'Starting dialog analysis');

      // If instanceName not provided, get it automatically from user's whatsapp_instances
      if (!instanceName) {
        app.log.info({ userAccountId }, 'Instance name not provided, fetching from database');
        
        const { data: userInstance, error: fetchError } = await supabase
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('user_account_id', userAccountId)
          .limit(1)
          .maybeSingle();
        
        if (fetchError || !userInstance) {
          app.log.error({ fetchError, userAccountId }, 'No WhatsApp instance found for user');
          return reply.status(404).send({
            success: false,
            error: 'WhatsApp instance не найден для этого пользователя. Подключите WhatsApp сначала.'
          });
        }
        
        instanceName = userInstance.instance_name;
        app.log.info({ instanceName, userAccountId }, 'Auto-detected instance name');
      }

      // Verify that instance belongs to user
      app.log.info({ instanceName, userAccountId }, 'Checking instance in database');
      
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name')
        .eq('instance_name', instanceName)
        .eq('user_account_id', userAccountId)
        .maybeSingle();

      app.log.info({ 
        instance, 
        instanceError: instanceError?.message, 
        hasError: !!instanceError,
        hasInstance: !!instance 
      }, 'Instance check result');

      if (instanceError || !instance) {
        app.log.error({ instanceError, instanceName, userAccountId }, 'Instance verification failed');
        return reply.status(404).send({ 
          error: 'Instance not found or does not belong to user',
          details: instanceError?.message,
          debug: {
            instanceName,
            userAccountId,
            hasInstance: !!instance,
            hasError: !!instanceError,
            errorMessage: instanceError?.message
          }
        });
      }

      // Run analysis (instanceName guaranteed to be defined at this point)
      const stats = await analyzeDialogs({
        instanceName: instanceName!, // Non-null assertion after auto-detection
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
      
      app.log.error({ 
        error: error.message, 
        stack: error.stack,
        name: error.name,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      }, 'Dialog analysis failed');
      
      return reply.status(500).send({ 
        error: 'Analysis failed', 
        message: error.message || 'Unknown error',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        details: error.toString()
      });
    }
  });

  /**
   * GET /dialogs/analysis
   * Get analysis results for a user
   */
  app.get('/dialogs/analysis', async (request, reply) => {
    try {
      const query = GetAnalysisSchema.parse(request.query);
      const { userAccountId, instanceName, interestLevel, minScore, funnelStage, qualificationComplete, search } = query;

      // Fetch ALL results using pagination (Supabase has 1000 limit per request)
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        let dbQuery = supabase
          .from('dialog_analysis')
          .select('*')
          .eq('user_account_id', userAccountId)
          .order('score', { ascending: false })
          .order('last_message', { ascending: false })
          .range(from, to);

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

        if (data && data.length > 0) {
          allData.push(...data);
          hasMore = data.length === PAGE_SIZE;
          page++;
        } else {
          hasMore = false;
        }
      }

      // Apply search filter (client-side) if provided
      if (search) {
        const searchLower = search.toLowerCase();
        allData = allData.filter(lead => {
          const phoneMatch = lead.contact_phone?.toLowerCase().includes(searchLower);
          const nameMatch = lead.contact_name?.toLowerCase().includes(searchLower);
          return phoneMatch || nameMatch;
        });
      }

      return reply.send({
        success: true,
        results: allData,
        count: allData.length,
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
   * GET /dialogs/export-csv
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
   * GET /dialogs/stats
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

      // Fetch ALL results using pagination (Supabase has 1000 limit per request)
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        let dbQuery = supabase
          .from('dialog_analysis')
          .select('interest_level, score, incoming_count, funnel_stage, qualification_complete')
          .eq('user_account_id', userAccountId)
          .range(from, to);

        if (instanceName) {
          dbQuery = dbQuery.eq('instance_name', instanceName);
        }

        const { data, error } = await dbQuery;

        if (error) {
          throw error;
        }

        if (data && data.length > 0) {
          allData.push(...data);
          hasMore = data.length === PAGE_SIZE;
          page++;
        } else {
          hasMore = false;
        }
      }

      const data = allData;

      // Calculate statistics
      const stats = {
        total: data?.length || 0,
        hot: data?.filter(d => d.interest_level === 'hot').length || 0,
        warm: data?.filter(d => d.interest_level === 'warm').length || 0,
        cold: data?.filter(d => d.interest_level === 'cold' || !d.interest_level || d.interest_level === '').length || 0,
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
   * POST /dialogs/leads
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
      return reply.status(500).send({ 
        error: 'Failed to create lead', 
        message: error.message 
      });
    }
  });

  /**
   * PATCH /dialogs/leads/:id
   * Update a lead
   */
  app.patch('/dialogs/leads/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      
      const UpdateLeadSchema = z.object({
        userAccountId: z.string().uuid(),
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

      const { data, error } = await supabase
        .from('dialog_analysis')
        .update(updateData)
        .eq('id', id)
        .eq('user_account_id', body.userAccountId)
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
      return reply.status(500).send({ 
        error: 'Failed to update lead', 
        message: error.message 
      });
    }
  });

  /**
   * DELETE /dialogs/analysis/:id
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

      app.log.info({ leadId: id }, 'Lead deleted');

      return reply.send({ success: true });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete analysis');
      return reply.status(500).send({ 
        error: 'Delete failed', 
        message: error.message 
      });
    }
  });

  /**
   * POST /dialogs/leads/:id/audio
   * Upload audio file, transcribe with Whisper, and reanalyze lead
   */
  app.post('/dialogs/leads/:id/audio', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Validate file
      const validation = validateAudioFile(data.filename, data.file.bytesRead || 0);
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error });
      }

      app.log.info({ leadId: id, filename: data.filename }, 'Processing audio upload');

      // Read file buffer
      const buffer = await data.toBuffer();

      // Transcribe audio with Whisper API
      const transcript = await transcribeAudio(buffer, data.filename);

      // Get current lead data
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('audio_transcripts')
        .eq('id', id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      // Add transcript to array
      const audioTranscripts = Array.isArray(lead.audio_transcripts) ? lead.audio_transcripts : [];
      audioTranscripts.push({
        filename: data.filename,
        transcript,
        uploaded_at: new Date().toISOString()
      });

      // Reanalyze with audio context
      const updatedAnalysis = await reanalyzeWithAudioContext(id, transcript);

      // Update lead in database
      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          audio_transcripts: audioTranscripts,
          ...updatedAnalysis,
          analyzed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      app.log.info({ leadId: id, transcriptLength: transcript.length }, 'Audio transcribed and lead reanalyzed');

      return reply.send({
        success: true,
        transcript,
        transcriptLength: transcript.length,
        analysis: updatedAnalysis
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to process audio upload');
      return reply.status(500).send({
        error: 'Audio processing failed',
        message: error.message
      });
    }
  });

  /**
   * PATCH /dialogs/leads/:id/notes
   * Update manual notes and reanalyze lead
   */
  app.patch('/dialogs/leads/:id/notes', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { notes, userAccountId } = request.body as { notes: string; userAccountId: string };

      if (!notes) {
        return reply.status(400).send({ error: 'notes field is required' });
      }

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId field is required' });
      }

      app.log.info({ leadId: id, notesLength: notes.length }, 'Updating lead notes');

      // Verify lead belongs to user
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, user_account_id')
        .eq('id', id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Reanalyze with notes
      const updatedAnalysis = await reanalyzeWithNotes(id, notes);

      // Update lead in database
      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          manual_notes: notes,
          ...updatedAnalysis,
          analyzed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      app.log.info({ leadId: id }, 'Notes updated and lead reanalyzed');

      return reply.send({
        success: true,
        analysis: updatedAnalysis
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to update notes');
      return reply.status(500).send({
        error: 'Notes update failed',
        message: error.message
      });
    }
  });

  /**
   * PATCH /dialogs/leads/:id/autopilot
   * Toggle autopilot for specific lead
   */
  app.patch('/dialogs/leads/:id/autopilot', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { autopilotEnabled, userAccountId } = request.body as { 
        autopilotEnabled: boolean; 
        userAccountId: string; 
      };

      if (typeof autopilotEnabled !== 'boolean') {
        return reply.status(400).send({ error: 'autopilotEnabled field is required (boolean)' });
      }

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId field is required' });
      }

      // Verify lead belongs to user
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('id, user_account_id')
        .eq('id', id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Update autopilot setting
      const { error: updateError } = await supabase
        .from('dialog_analysis')
        .update({
          autopilot_enabled: autopilotEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      app.log.info({ leadId: id, autopilotEnabled }, 'Autopilot setting updated');

      return reply.send({ success: true, autopilotEnabled });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to update autopilot');
      return reply.status(500).send({
        error: 'Autopilot update failed',
        message: error.message
      });
    }
  });

  /**
   * POST /dialogs/leads/:id/generate-message
   * Generate AI message for specific lead
   */
  app.post('/dialogs/leads/:id/generate-message', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId } = request.body as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId field is required' });
      }

      // Get lead data
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('id', id)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Call chatbot-service to generate message
      const chatbotServiceUrl = process.env.CHATBOT_SERVICE_URL || 'http://chatbot-service:8083';
      const response = await fetch(`${chatbotServiceUrl}/campaign/generate-single-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAccountId,
          leadId: id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chatbot service returned ${response.status}`);
      }

      const result = await response.json();

      app.log.info({ leadId: id }, 'Message generated');

      return reply.send({
        message: result.message,
        messageType: result.messageType,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to generate message');
      return reply.status(500).send({
        error: 'Message generation failed',
        message: error.message
      });
    }
  });

  /**
   * POST /dialogs/leads/:id/send-message
   * Send WhatsApp message to lead
   */
  app.post('/dialogs/leads/:id/send-message', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { userAccountId, message } = request.body as { 
        userAccountId: string; 
        message: string;
      };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId field is required' });
      }

      if (!message || !message.trim()) {
        return reply.status(400).send({ error: 'message field is required' });
      }

      // Get lead data (without join)
      const { data: lead, error: leadError } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('id', id)
        .single();

      if (leadError) {
        app.log.error({ leadError, id }, 'Error fetching lead');
        return reply.status(404).send({ error: 'Lead not found', details: leadError.message });
      }

      if (!lead) {
        app.log.error({ id }, 'Lead not found in database');
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.user_account_id !== userAccountId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Get instance data separately
      const { data: instance, error: instanceError } = await supabase
        .from('whatsapp_instances')
        .select('instance_name')
        .eq('instance_name', lead.instance_name)
        .single();

      if (instanceError || !instance) {
        app.log.error({ instanceError, instance_name: lead.instance_name }, 'Error fetching WhatsApp instance');
        return reply.status(400).send({ error: 'WhatsApp instance not found' });
      }

      // Send message via Evolution API - use environment variables
      const evolutionUrl = process.env.EVOLUTION_API_URL || 'https://n8n.performanteaiagency.com';
      const apiKey = process.env.EVOLUTION_API_KEY;

      const sendMessageUrl = `${evolutionUrl}/message/sendText/${instance.instance_name}`;
      
      const sendResponse = await fetch(sendMessageUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
        },
        body: JSON.stringify({
          number: lead.contact_phone,
          text: message,
        }),
      });

      if (!sendResponse.ok) {
        const errorText = await sendResponse.text();
        throw new Error(`Evolution API returned ${sendResponse.status}: ${errorText}`);
      }

      // Add message to dialog history
      const newMessage = {
        text: message,
        timestamp: new Date().toISOString(),
        from_me: true,
        is_system: false,
      };

      const updatedMessages = [...(lead.messages || []), newMessage];

      await supabase
        .from('dialog_analysis')
        .update({
          messages: updatedMessages,
          last_message: new Date().toISOString(),
          outgoing_count: lead.outgoing_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      app.log.info({ leadId: id, phone: lead.contact_phone }, 'Message sent');

      return reply.send({ 
        success: true,
        message: 'Message sent successfully',
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to send message');
      return reply.status(500).send({
        error: 'Message sending failed',
        message: error.message
      });
    }
  });

  /**
   * POST /dialogs/reanalyze/:leadId
   * Reanalyze specific lead with fresh data from Evolution DB
   * This forcefully updates the lead analysis
   */
  app.post('/dialogs/reanalyze/:leadId', async (request, reply) => {
    try {
      const { leadId } = request.params as { leadId: string };
      const { userAccountId } = request.body as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ 
          success: false,
          error: 'userAccountId field is required' 
        });
      }

      app.log.info({ leadId, userAccountId }, 'Reanalyzing lead');

      // Call reanalysis function
      const result = await reanalyzeSingleLead({
        leadId,
        userAccountId,
      });

      if (!result.success) {
        return reply.status(400).send(result);
      }

      app.log.info({ leadId, lead: result.lead }, 'Lead reanalyzed successfully');

      return reply.send(result);
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to reanalyze lead');
      return reply.status(500).send({
        success: false,
        error: 'Lead reanalysis failed',
        message: error.message
      });
    }
  });
}


