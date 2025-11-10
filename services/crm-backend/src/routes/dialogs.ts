import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { analyzeDialogs } from '../scripts/analyzeDialogs.js';
import { transcribeAudio, validateAudioFile } from '../lib/whisperTranscription.js';
import { reanalyzeWithAudioContext, reanalyzeWithNotes } from '../lib/reanalyzeWithContext.js';

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
   * POST /dialogs/analyze
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
   * GET /dialogs/analysis
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
}


