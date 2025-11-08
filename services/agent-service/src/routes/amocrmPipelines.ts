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

      return reply.send({
        pipelines: Array.from(pipelinesMap.values())
      });

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
}


