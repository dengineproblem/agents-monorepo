/**
 * AmoCRM Pipelines Management Routes
 *
 * API endpoints for syncing pipelines, managing qualification stages, and getting stats
 *
 * @module routes/amocrmPipelines
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { getValidAmoCRMToken } from '../lib/amocrmTokens.js';
import { getPipelines } from '../adapters/amocrm.js';

const UserAccountIdSchema = z.object({
  userAccountId: z.string().uuid()
});

const UpdateStageSchema = z.object({
  is_qualified_stage: z.boolean()
});

export default async function amocrmPipelinesRoutes(app: FastifyInstance) {
  /**
   * POST /amocrm/sync-pipelines
   * Sync all pipelines and stages from amoCRM
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { synced: number, pipelines: [...] }
   */
  app.post('/amocrm/sync-pipelines', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      app.log.info({ userAccountId }, 'Syncing amoCRM pipelines');

      // Get valid token
      const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);

      // Fetch pipelines from amoCRM
      const pipelines = await getPipelines(subdomain, accessToken);

      let syncedCount = 0;

      // Sync each pipeline and its stages
      for (const pipeline of pipelines) {
        if (!pipeline._embedded?.statuses) continue;

        for (const status of pipeline._embedded.statuses) {
          // Check if stage already exists
          const { data: existing } = await supabase
            .from('amocrm_pipeline_stages')
            .select('*')
            .eq('user_account_id', userAccountId)
            .eq('pipeline_id', pipeline.id)
            .eq('status_id', status.id)
            .maybeSingle();

          const stageData = {
            user_account_id: userAccountId,
            pipeline_id: pipeline.id,
            pipeline_name: pipeline.name,
            status_id: status.id,
            status_name: status.name,
            status_color: status.color,
            sort_order: status.sort,
            // Mark won (142) as qualified by default, keep existing setting if already synced
            is_qualified_stage: existing?.is_qualified_stage ?? (status.id === 142)
          };

          if (existing) {
            // Update existing
            await supabase
              .from('amocrm_pipeline_stages')
              .update({
                pipeline_name: stageData.pipeline_name,
                status_name: stageData.status_name,
                status_color: stageData.status_color,
                sort_order: stageData.sort_order,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id);
          } else {
            // Insert new
            await supabase
              .from('amocrm_pipeline_stages')
              .insert(stageData);
          }

          syncedCount++;
        }
      }

      app.log.info({ userAccountId, syncedCount }, 'Pipelines synced successfully');

      return reply.send({
        success: true,
        synced: syncedCount,
        pipelines: pipelines.length
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error syncing pipelines');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/pipelines
   * Get all pipelines and stages for user
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: Array of pipelines with stages
   */
  app.get('/amocrm/pipelines', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      const { data: stages, error } = await supabase
        .from('amocrm_pipeline_stages')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('pipeline_id')
        .order('sort_order');

      if (error) {
        throw new Error(`Failed to fetch pipelines: ${error.message}`);
      }

      // Group by pipeline
      const pipelinesMap = new Map();

      for (const stage of stages || []) {
        if (!pipelinesMap.has(stage.pipeline_id)) {
          pipelinesMap.set(stage.pipeline_id, {
            pipeline_id: stage.pipeline_id,
            pipeline_name: stage.pipeline_name,
            stages: []
          });
        }

        pipelinesMap.get(stage.pipeline_id).stages.push({
          id: stage.id,
          status_id: stage.status_id,
          status_name: stage.status_name,
          status_color: stage.status_color,
          is_qualified_stage: stage.is_qualified_stage,
          sort_order: stage.sort_order
        });
      }

      return reply.send(Array.from(pipelinesMap.values()));

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching pipelines');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * PATCH /amocrm/pipeline-stages/:stageId
   * Update qualification setting for a stage
   *
   * Body:
   *   - is_qualified_stage: boolean
   *
   * Returns: Updated stage
   */
  app.patch('/amocrm/pipeline-stages/:stageId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { stageId } = request.params as { stageId: string };
      const parsed = UpdateStageSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { is_qualified_stage } = parsed.data;

      // Update stage
      const { data: updated, error } = await supabase
        .from('amocrm_pipeline_stages')
        .update({
          is_qualified_stage,
          updated_at: new Date().toISOString()
        })
        .eq('id', stageId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update stage: ${error.message}`);
      }

      if (!updated) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'Pipeline stage not found'
        });
      }

      app.log.info({
        stageId,
        statusId: updated.status_id,
        is_qualified_stage
      }, 'Updated pipeline stage qualification');

      // Update all leads currently in this stage
      const { error: leadsError } = await supabase
        .from('leads')
        .update({
          is_qualified: is_qualified_stage,
          updated_at: new Date().toISOString()
        })
        .eq('user_account_id', updated.user_account_id)
        .eq('current_pipeline_id', updated.pipeline_id)
        .eq('current_status_id', updated.status_id);

      if (leadsError) {
        app.log.error({ error: leadsError }, 'Failed to update leads qualification');
      }

      return reply.send({
        success: true,
        stage: updated
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error updating pipeline stage');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/qualification-stats
   * Get qualification statistics for creatives
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *   - directionId: (optional) Filter by direction
   *
   * Returns: Stats by creative
   */
  app.get('/amocrm/qualification-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, directionId } = request.query as {
        userAccountId?: string;
        directionId?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id'
        });
      }

      let query = supabase
        .from('leads')
        .select('creative_id, is_qualified, amocrm_lead_id')
        .eq('user_account_id', userAccountId)
        .not('amocrm_lead_id', 'is', null);

      if (directionId) {
        query = query.eq('direction_id', directionId);
      }

      const { data: leads, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch leads: ${error.message}`);
      }

      // Group by creative
      const statsMap = new Map();

      for (const lead of leads || []) {
        const creativeId = lead.creative_id || 'unknown';

        if (!statsMap.has(creativeId)) {
          statsMap.set(creativeId, {
            creative_id: creativeId,
            total_leads: 0,
            qualified_leads: 0,
            qualification_rate: 0
          });
        }

        const stats = statsMap.get(creativeId);
        stats.total_leads++;
        if (lead.is_qualified) {
          stats.qualified_leads++;
        }
      }

      // Calculate rates
      const statsArray = Array.from(statsMap.values()).map(stats => ({
        ...stats,
        qualification_rate: stats.total_leads > 0
          ? Math.round((stats.qualified_leads / stats.total_leads) * 100)
          : 0
      }));

      return reply.send({
        stats: statsArray
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching qualification stats');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /amocrm/sync-leads
   * Manually sync leads statuses from AmoCRM
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *
   * Returns: { success: boolean, total: number, updated: number, errors: number }
   */
  app.post('/amocrm/sync-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId } = request.query as { userAccountId?: string };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id'
        });
      }

      app.log.info({ userAccountId }, 'Manual AmoCRM leads sync triggered');

      // Import sync function dynamically to avoid circular dependencies
      const { syncLeadsFromAmoCRM } = await import('../workflows/amocrmLeadsSync.js');

      // Execute sync
      const result = await syncLeadsFromAmoCRM(userAccountId, app);

      return reply.send(result);

    } catch (error: any) {
      app.log.error({ error }, 'Error syncing leads from AmoCRM');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/creative-funnel-stats
   * Get funnel stage distribution for a specific creative
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *   - creativeId: UUID of creative
   *   - directionId: (optional) Filter by direction
   *   - dateFrom: (optional) Filter leads from date
   *   - dateTo: (optional) Filter leads to date
   *
   * Returns: { total_leads, stages: [{stage_name, pipeline_name, count, percentage, color, sort_order}] }
   */
  app.get('/amocrm/creative-funnel-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, creativeId, directionId, dateFrom, dateTo } = request.query as {
        userAccountId?: string;
        creativeId?: string;
        directionId?: string;
        dateFrom?: string;
        dateTo?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id'
        });
      }

      if (!creativeId) {
        return reply.code(400).send({
          error: 'missing_creative_id'
        });
      }

      app.log.info({ userAccountId, creativeId, directionId }, 'Fetching creative funnel stats');

      // Build SQL query for leads
      let query = supabase
        .from('leads')
        .select('current_status_id, current_pipeline_id')
        .eq('user_account_id', userAccountId)
        .eq('creative_id', creativeId)
        .not('amocrm_lead_id', 'is', null)
        .not('current_status_id', 'is', null);

      if (directionId) {
        query = query.eq('direction_id', directionId);
      }

      if (dateFrom) {
        query = query.gte('created_at', dateFrom);
      }

      if (dateTo) {
        query = query.lte('created_at', dateTo);
      }

      const { data: leads, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch leads: ${error.message}`);
      }

      if (!leads || leads.length === 0) {
        return reply.send({
          total_leads: 0,
          stages: []
        });
      }

      // Get unique status IDs
      const statusIds = [...new Set(leads.map(l => l.current_status_id).filter(Boolean))];

      // Fetch stage information for these statuses
      const { data: stages, error: stagesError } = await supabase
        .from('amocrm_pipeline_stages')
        .select('status_id, pipeline_name, status_name, status_color, sort_order')
        .eq('user_account_id', userAccountId)
        .in('status_id', statusIds);

      if (stagesError) {
        throw new Error(`Failed to fetch stages: ${stagesError.message}`);
      }

      // Create stages map
      const stagesMap = new Map(
        (stages || []).map(s => [s.status_id, s])
      );

      // Group by stage
      const stageMap = new Map<number, {
        stage_name: string;
        pipeline_name: string;
        color: string;
        sort_order: number;
        count: number;
      }>();

      for (const lead of leads) {
        const statusId = lead.current_status_id;
        if (!statusId) continue;

        const stageInfo = stagesMap.get(statusId);
        if (!stageInfo) continue;

        if (!stageMap.has(statusId)) {
          stageMap.set(statusId, {
            stage_name: stageInfo.status_name,
            pipeline_name: stageInfo.pipeline_name,
            color: stageInfo.status_color,
            sort_order: stageInfo.sort_order,
            count: 0
          });
        }

        const stage = stageMap.get(statusId)!;
        stage.count++;
      }

      // Convert to array and calculate percentages
      const totalLeads = leads.length;
      const stagesArray = Array.from(stageMap.values()).map(stage => ({
        ...stage,
        percentage: Math.round((stage.count / totalLeads) * 100)
      })).sort((a, b) => a.sort_order - b.sort_order);

      return reply.send({
        total_leads: totalLeads,
        stages: stagesArray
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching creative funnel stats');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/debug-phone-matching
   * Debug endpoint to check phone number matching with AmoCRM
   *
   * Query params:
   *   - userAccountId: UUID of user account
   *   - phone: Phone number to test (optional)
   *   - leadId: Lead ID to test (optional)
   *
   * Returns: Detailed phone matching information for debugging
   */
  app.get('/amocrm/debug-phone-matching', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, phone, leadId } = request.query as {
        userAccountId?: string;
        phone?: string;
        leadId?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'missing_user_account_id'
        });
      }

      app.log.info({ userAccountId, phone, leadId }, 'Debug phone matching');

      // Import normalize function
      const { syncLeadsFromAmoCRM } = await import('../workflows/amocrmLeadsSync.js');

      // Normalize phone function (copy from amocrmLeadsSync.ts)
      function normalizePhone(phone: string | null): string | null {
        if (!phone) return null;
        let cleaned = phone.replace(/@s\.whatsapp\.net|@c\.us/g, '');
        cleaned = cleaned.replace(/\D/g, '');
        if (cleaned.startsWith('8') && cleaned.length === 11) {
          cleaned = '7' + cleaned.substring(1);
        }
        return cleaned || null;
      }

      const debugInfo: any = {
        userAccountId,
        input: { phone, leadId },
        normalized: {},
        amocrmSearch: {},
        localLeads: []
      };

      // 1. If phone provided, normalize and search
      if (phone) {
        const normalized = normalizePhone(phone);
        debugInfo.normalized = {
          raw: phone,
          normalized,
          length: normalized?.length
        };

        // Search in AmoCRM
        try {
          const { getValidAmoCRMToken } = await import('../lib/amocrmTokens.js');
          const { findContactByPhone } = await import('../adapters/amocrm.js');

          const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);

          // Try to find contact
          const contact = await findContactByPhone(phone, subdomain, accessToken);

          debugInfo.amocrmSearch.foundContact = !!contact;
          if (contact) {
            debugInfo.amocrmSearch.contactId = contact.id;
            debugInfo.amocrmSearch.contactName = contact.name;
            debugInfo.amocrmSearch.leads = (contact as any)._embedded?.leads || [];
          }
        } catch (error: any) {
          debugInfo.amocrmSearch.error = error.message;
        }
      }

      // 2. If leadId provided, get lead info
      if (leadId) {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('id', leadId)
          .eq('user_account_id', userAccountId)
          .maybeSingle();

        if (lead) {
          const rawPhone = lead.phone || lead.chat_id;
          const normalized = normalizePhone(rawPhone);

          debugInfo.localLeads.push({
            leadId: lead.id,
            rawPhone,
            normalized,
            amocrmLeadId: lead.amocrm_lead_id,
            currentStatusId: lead.current_status_id,
            creativeId: lead.creative_id
          });
        }
      }

      // 3. Get sample local leads without AmoCRM connection
      const { data: unmatchedLeads } = await supabase
        .from('leads')
        .select('id, phone, chat_id, amocrm_lead_id')
        .eq('user_account_id', userAccountId)
        .is('amocrm_lead_id', null)
        .not('phone', 'is', null)
        .limit(10);

      debugInfo.sampleUnmatchedLeads = (unmatchedLeads || []).map(l => ({
        leadId: l.id,
        rawPhone: l.phone || l.chat_id,
        normalized: normalizePhone(l.phone || l.chat_id)
      }));

      // 4. Get sample AmoCRM phones
      debugInfo.instructions = {
        description: 'Use this endpoint to debug phone number matching issues',
        usage: {
          byPhone: '/amocrm/debug-phone-matching?userAccountId=UUID&phone=+7(123)456-78-90',
          byLeadId: '/amocrm/debug-phone-matching?userAccountId=UUID&leadId=123'
        },
        normalizationRules: {
          step1: 'Remove WhatsApp suffixes (@s.whatsapp.net, @c.us)',
          step2: 'Remove all non-digits',
          step3: 'Replace leading 8 with 7 for Russian numbers (if 11 digits)',
          examples: {
            '+7 (771) 817-19-94': '77718171994',
            '87772339309': '77772339309',
            '+7 (775) 831-95-04': '77758319504'
          }
        }
      };

      return reply.send(debugInfo);

    } catch (error: any) {
      app.log.error({ error }, 'Error in debug phone matching');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * PATCH /amocrm/directions/:directionId/key-stages
   * Set up to 3 key qualification stages for a direction
   *
   * Params:
   *   - directionId: UUID of direction
   *
   * Body:
   *   - keyStages: Array of { pipelineId: number, statusId: number } (0-3 items)
   *     Each item represents a key stage. Can provide 0, 1, 2, or 3 stages.
   *
   * Returns: { success: boolean, direction: {...}, stages: [...] }
   */
  app.patch('/amocrm/directions/:directionId/key-stages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directionId } = request.params as { directionId: string };

      const KeyStagesSchema = z.object({
        keyStages: z.array(
          z.object({
            pipelineId: z.number().int().positive(),
            statusId: z.number().int().positive()
          })
        ).max(3, 'Maximum 3 key stages allowed')
      });

      const parsed = KeyStagesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { keyStages } = parsed.data;

      app.log.info({ directionId, keyStagesCount: keyStages.length }, 'Setting key stages for direction');

      // Verify direction exists
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select('id, user_account_id, name')
        .eq('id', directionId)
        .maybeSingle();

      if (directionError || !direction) {
        return reply.code(404).send({
          error: 'direction_not_found',
          message: 'Direction not found'
        });
      }

      // Verify all pipeline/status combinations exist
      const verifiedStages = [];
      for (let i = 0; i < keyStages.length; i++) {
        const { pipelineId, statusId } = keyStages[i];

        const { data: stage, error: stageError } = await supabase
          .from('amocrm_pipeline_stages')
          .select('*')
          .eq('user_account_id', direction.user_account_id)
          .eq('pipeline_id', pipelineId)
          .eq('status_id', statusId)
          .maybeSingle();

        if (stageError || !stage) {
          return reply.code(400).send({
            error: 'invalid_stage',
            message: `Key stage ${i + 1}: Pipeline stage not found. Please sync pipelines first.`,
            hint: 'Call POST /amocrm/sync-pipelines to sync stages from amoCRM'
          });
        }

        verifiedStages.push(stage);
      }

      // Build update object with all 3 key stages (null for unused)
      const updateData: any = {
        key_stage_1_pipeline_id: keyStages[0]?.pipelineId || null,
        key_stage_1_status_id: keyStages[0]?.statusId || null,
        key_stage_2_pipeline_id: keyStages[1]?.pipelineId || null,
        key_stage_2_status_id: keyStages[1]?.statusId || null,
        key_stage_3_pipeline_id: keyStages[2]?.pipelineId || null,
        key_stage_3_status_id: keyStages[2]?.statusId || null,
        updated_at: new Date().toISOString()
      };

      // Update direction with key stages
      const { data: updatedDirection, error: updateError } = await supabase
        .from('account_directions')
        .update(updateData)
        .eq('id', directionId)
        .select()
        .single();

      if (updateError) {
        app.log.error({ error: updateError }, 'Failed to update direction key stages');
        return reply.code(500).send({
          error: 'update_failed',
          message: updateError.message
        });
      }

      app.log.info({ directionId, keyStagesCount: keyStages.length }, 'Key stages set successfully');

      // Trigger recalculation of reached_key_stage_N flags for all leads in this direction
      app.log.info({ directionId, userAccountId: direction.user_account_id }, 'Triggering reached_key_stage recalculation');

      // Run recalculation asynchronously (don't wait for it)
      const recalculateAsync = async () => {
        try {
          const { syncLeadsFromAmoCRM } = await import('../workflows/amocrmLeadsSync.js');
          await syncLeadsFromAmoCRM(direction.user_account_id, app);
          app.log.info({ directionId }, 'Reached key stage recalculation completed');
        } catch (error: any) {
          app.log.error({ error: error.message, directionId }, 'Failed to recalculate reached key stage flags');
        }
      };

      // Start async recalculation (fire and forget)
      recalculateAsync();

      return reply.send({
        success: true,
        direction: updatedDirection,
        stages: verifiedStages.map((stage, idx) => ({
          index: idx + 1,
          pipeline_name: stage.pipeline_name,
          status_name: stage.status_name,
          status_color: stage.status_color
        })),
        message: 'Key stages set successfully. Recalculating qualification flags in background.'
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error setting key stages for direction');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /amocrm/directions/:directionId/key-stage-stats
   * Get qualification statistics for a direction based on its key stages (up to 3)
   *
   * Params:
   *   - directionId: UUID of direction
   *
   * Query:
   *   - dateFrom: ISO date string (optional)
   *   - dateTo: ISO date string (optional)
   *
   * Returns: {
   *   total_leads: number,
   *   key_stages: [
   *     {
   *       index: 1|2|3,
   *       pipeline_id, status_id, pipeline_name, status_name,
   *       qualified_leads, qualification_rate,
   *       creative_stats: [{ creative_id, creative_name, total, qualified, rate }]
   *     },
   *     ...
   *   ]
   * }
   */
  app.get('/amocrm/directions/:directionId/key-stage-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directionId } = request.params as { directionId: string };
      const { dateFrom, dateTo } = request.query as { dateFrom?: string; dateTo?: string };

      app.log.info({ directionId, dateFrom, dateTo }, 'Getting key stage stats for direction');

      // Get direction with all 3 key stages
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select(`
          id, user_account_id, name,
          key_stage_1_pipeline_id, key_stage_1_status_id,
          key_stage_2_pipeline_id, key_stage_2_status_id,
          key_stage_3_pipeline_id, key_stage_3_status_id
        `)
        .eq('id', directionId)
        .maybeSingle();

      if (directionError || !direction) {
        return reply.code(404).send({
          error: 'direction_not_found',
          message: 'Direction not found'
        });
      }

      // Build leads query with optional date filter
      let leadsQuery = supabase
        .from('leads')
        .select('id, creative_id, reached_key_stage_1, reached_key_stage_2, reached_key_stage_3, created_at')
        .eq('user_account_id', direction.user_account_id)
        .eq('direction_id', directionId);

      if (dateFrom) {
        leadsQuery = leadsQuery.gte('created_at', dateFrom);
      }
      if (dateTo) {
        leadsQuery = leadsQuery.lte('created_at', dateTo);
      }

      const { data: leads, error: leadsError } = await leadsQuery;

      if (leadsError) {
        app.log.error({ error: leadsError }, 'Failed to fetch leads');
        return reply.code(500).send({
          error: 'leads_fetch_failed',
          message: leadsError.message
        });
      }

      const totalLeads = leads?.length || 0;

      // Process each configured key stage
      const keyStagesStats = [];

      for (let stageNum = 1; stageNum <= 3; stageNum++) {
        const pipelineIdKey = `key_stage_${stageNum}_pipeline_id` as keyof typeof direction;
        const statusIdKey = `key_stage_${stageNum}_status_id` as keyof typeof direction;
        const pipelineId = direction[pipelineIdKey];
        const statusId = direction[statusIdKey];

        // Skip if this stage is not configured
        if (!pipelineId || !statusId) {
          continue;
        }

        // Get stage info from amocrm_pipeline_stages
        const { data: stageInfo } = await supabase
          .from('amocrm_pipeline_stages')
          .select('pipeline_name, status_name, status_color')
          .eq('user_account_id', direction.user_account_id)
          .eq('pipeline_id', pipelineId)
          .eq('status_id', statusId)
          .maybeSingle();

        // Calculate overall stats for this key stage
        const reachedFlagKey = `reached_key_stage_${stageNum}` as 'reached_key_stage_1' | 'reached_key_stage_2' | 'reached_key_stage_3';
        const qualifiedLeads = leads?.filter(lead => lead[reachedFlagKey] === true).length || 0;
        const qualificationRate = totalLeads > 0
          ? Math.round((qualifiedLeads / totalLeads) * 1000) / 10
          : 0;

        // Group by creative for this key stage
        const creativeStats: Record<string, { total: number; qualified: number }> = {};

        leads?.forEach(lead => {
          if (!lead.creative_id) return;

          if (!creativeStats[lead.creative_id]) {
            creativeStats[lead.creative_id] = { total: 0, qualified: 0 };
          }

          creativeStats[lead.creative_id].total++;

          if (lead[reachedFlagKey] === true) {
            creativeStats[lead.creative_id].qualified++;
          }
        });

        // Get creative names
        const creativeIds = Object.keys(creativeStats);
        const { data: creatives } = await supabase
          .from('user_creatives')
          .select('id, name')
          .in('id', creativeIds);

        const creativeMap = new Map(creatives?.map(c => [c.id, c.name]) || []);

        const creativeStatsList = creativeIds.map(creativeId => {
          const stats = creativeStats[creativeId];
          const rate = stats.total > 0
            ? Math.round((stats.qualified / stats.total) * 1000) / 10
            : 0;

          return {
            creative_id: creativeId,
            creative_name: creativeMap.get(creativeId) || 'Unknown',
            total: stats.total,
            qualified: stats.qualified,
            rate
          };
        }).sort((a, b) => b.qualified - a.qualified);

        keyStagesStats.push({
          index: stageNum,
          pipeline_id: pipelineId,
          status_id: statusId,
          pipeline_name: stageInfo?.pipeline_name || 'Unknown',
          status_name: stageInfo?.status_name || 'Unknown',
          qualified_leads: qualifiedLeads,
          qualification_rate: qualificationRate,
          creative_stats: creativeStatsList
        });
      }

      return reply.send({
        total_leads: totalLeads,
        key_stages: keyStagesStats
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error getting key stage stats');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /amocrm/recalculate-key-stage
   * Manually trigger recalculation of key stage statistics
   * (triggers amoCRM leads sync)
   *
   * Query:
   *   - userAccountId: UUID of user account
   *   - directionId: UUID of direction (optional - if not provided, syncs all)
   *
   * Returns: { success: boolean, synced: number }
   */
  app.post('/amocrm/recalculate-key-stage', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, directionId } = request.query as {
        userAccountId: string;
        directionId?: string
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'userAccountId is required'
        });
      }

      app.log.info({ userAccountId, directionId }, 'Triggering key stage recalculation');

      // Import sync function
      const { syncLeadsFromAmoCRM } = await import('../workflows/amocrmLeadsSync.js');

      // Trigger sync (this will update current_status_id, current_pipeline_id for all leads)
      const result = await syncLeadsFromAmoCRM(userAccountId, app);

      app.log.info({ result }, 'Key stage recalculation completed');

      return reply.send({
        success: result.success,
        synced: result.updated,
        not_found: result.total - result.updated - result.errors,
        errors: result.errors
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error recalculating key stage stats');
      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}


