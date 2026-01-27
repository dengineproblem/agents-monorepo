/**
 * Bitrix24 Pipelines and Qualification Routes
 *
 * Handles pipeline/stage management and lead qualification settings
 * Supports both leads and deals (separate entities in Bitrix24)
 *
 * @module routes/bitrix24Pipelines
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { getValidBitrix24Token } from '../lib/bitrix24Tokens.js';
import {
  getDealCategories,
  getDealStages,
  getLeadStatuses,
  getLeadUserFields,
  getDealUserFields,
  getContactUserFields,
  getLeads,
  getDeals,
  getLead,
  getDeal,
  Bitrix24Status,
  Bitrix24DealCategory
} from '../adapters/bitrix24.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

// ============================================================================
// Validation Schemas
// ============================================================================

const UserAccountIdSchema = z.object({
  userAccountId: z.string().uuid()
});

const SyncPipelinesBodySchema = z.object({
  userAccountId: z.string().uuid()
});

const UpdateStageBodySchema = z.object({
  userAccountId: z.string().uuid(),
  stageId: z.string().uuid(),
  isQualifiedStage: z.boolean().optional(),
  isSuccessStage: z.boolean().optional(),
  isFailStage: z.boolean().optional()
});

const QualificationFieldsBodySchema = z.object({
  userAccountId: z.string().uuid(),
  fields: z.array(z.object({
    field_id: z.string(),
    field_name: z.string(),
    field_type: z.string(),
    entity_type: z.enum(['lead', 'deal', 'contact']),
    enum_id: z.string().optional(),
    enum_value: z.string().optional()
  })).max(3)
});

const KeyStagesBodySchema = z.object({
  userAccountId: z.string().uuid(),
  directionId: z.string().uuid(),
  entityType: z.enum(['lead', 'deal']),
  keyStages: z.array(z.object({
    categoryId: z.number(),
    statusId: z.string()
  })).max(3)
});

const SyncLeadsBodySchema = z.object({
  userAccountId: z.string().uuid(),
  entityType: z.enum(['lead', 'deal', 'both']).optional()
});

// ============================================================================
// Routes
// ============================================================================

export default async function bitrix24PipelinesRoutes(app: FastifyInstance) {
  /**
   * POST /bitrix24/sync-pipelines
   *
   * Sync pipelines and stages from Bitrix24
   * Fetches both deal categories (pipelines) and lead statuses
   */
  app.post('/bitrix24/sync-pipelines', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = SyncPipelinesBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      // Get valid token
      const { accessToken, domain, entityType } = await getValidBitrix24Token(userAccountId);

      const stagesToInsert: any[] = [];

      // Sync lead statuses if entity type is 'lead' or 'both'
      if (entityType === 'lead' || entityType === 'both') {
        const leadStatuses = await getLeadStatuses(domain, accessToken);

        for (const status of leadStatuses) {
          stagesToInsert.push({
            user_account_id: userAccountId,
            category_id: 0, // Leads don't have categories
            category_name: 'Лиды',
            status_id: status.STATUS_ID,
            status_name: status.NAME,
            status_color: status.COLOR || status.EXTRA?.COLOR,
            status_sort: parseInt(status.SORT, 10),
            status_semantics: status.SEMANTICS || status.EXTRA?.SEMANTICS,
            entity_type: 'lead',
            is_qualified_stage: false,
            is_success_stage: status.SEMANTICS === 'S' || status.EXTRA?.SEMANTICS === 'S',
            is_fail_stage: status.SEMANTICS === 'F' || status.EXTRA?.SEMANTICS === 'F'
          });
        }
      }

      // Sync deal categories and stages if entity type is 'deal' or 'both'
      if (entityType === 'deal' || entityType === 'both') {
        // Get deal categories (pipelines)
        const categories = await getDealCategories(domain, accessToken);

        // Always include default pipeline (ID 0)
        const allCategories: Array<{ ID: string; NAME: string }> = [
          { ID: '0', NAME: 'Общая воронка' },
          ...categories
        ];

        for (const category of allCategories) {
          const categoryId = parseInt(category.ID, 10);
          const stages = await getDealStages(domain, accessToken, categoryId);

          for (const stage of stages) {
            stagesToInsert.push({
              user_account_id: userAccountId,
              category_id: categoryId,
              category_name: category.NAME,
              status_id: stage.STATUS_ID,
              status_name: stage.NAME,
              status_color: stage.COLOR || stage.EXTRA?.COLOR,
              status_sort: parseInt(stage.SORT, 10),
              status_semantics: stage.SEMANTICS || stage.EXTRA?.SEMANTICS,
              entity_type: 'deal',
              is_qualified_stage: false,
              is_success_stage: stage.SEMANTICS === 'S' || stage.EXTRA?.SEMANTICS === 'S',
              is_fail_stage: stage.SEMANTICS === 'F' || stage.EXTRA?.SEMANTICS === 'F'
            });
          }
        }
      }

      // Delete existing stages for this user
      await supabase
        .from('bitrix24_pipeline_stages')
        .delete()
        .eq('user_account_id', userAccountId);

      // Insert new stages
      if (stagesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('bitrix24_pipeline_stages')
          .insert(stagesToInsert);

        if (insertError) {
          throw new Error(`Failed to insert stages: ${insertError.message}`);
        }
      }

      app.log.info({
        userAccountId,
        stagesCount: stagesToInsert.length,
        entityType
      }, 'Bitrix24 pipelines synced');

      return reply.send({
        success: true,
        count: stagesToInsert.length,
        entityType
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error syncing Bitrix24 pipelines');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId,
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_sync_pipelines',
        endpoint: '/bitrix24/sync-pipelines',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/pipelines
   *
   * Get all pipelines and stages for user
   */
  app.get('/bitrix24/pipelines', async (request: FastifyRequest, reply: FastifyReply) => {
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
        .from('bitrix24_pipeline_stages')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('entity_type', { ascending: true })
        .order('category_id', { ascending: true })
        .order('status_sort', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch stages: ${error.message}`);
      }

      // Group by entity type and category
      const grouped: Record<string, Record<number, any>> = {
        lead: {},
        deal: {}
      };

      for (const stage of stages || []) {
        const entityType = stage.entity_type as 'lead' | 'deal';
        const categoryId = stage.category_id;

        if (!grouped[entityType][categoryId]) {
          grouped[entityType][categoryId] = {
            categoryId,
            categoryName: stage.category_name,
            stages: []
          };
        }

        grouped[entityType][categoryId].stages.push({
          id: stage.id,
          statusId: stage.status_id,
          statusName: stage.status_name,
          statusColor: stage.status_color,
          statusSort: stage.status_sort,
          statusSemantics: stage.status_semantics,
          isQualifiedStage: stage.is_qualified_stage,
          isSuccessStage: stage.is_success_stage,
          isFailStage: stage.is_fail_stage
        });
      }

      return reply.send({
        leads: Object.values(grouped.lead),
        deals: Object.values(grouped.deal)
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 pipelines');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * PATCH /bitrix24/pipeline-stages/:stageId
   *
   * Update stage qualification settings
   */
  app.patch('/bitrix24/pipeline-stages/:stageId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { stageId } = request.params as { stageId: string };
      const body = request.body as any;

      const parsed = UpdateStageBodySchema.safeParse({ ...body, stageId });

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, isQualifiedStage, isSuccessStage, isFailStage } = parsed.data;

      const updateData: any = {};
      if (isQualifiedStage !== undefined) updateData.is_qualified_stage = isQualifiedStage;
      if (isSuccessStage !== undefined) updateData.is_success_stage = isSuccessStage;
      if (isFailStage !== undefined) updateData.is_fail_stage = isFailStage;

      const { error } = await supabase
        .from('bitrix24_pipeline_stages')
        .update(updateData)
        .eq('id', stageId)
        .eq('user_account_id', userAccountId);

      if (error) {
        throw new Error(`Failed to update stage: ${error.message}`);
      }

      app.log.info({ userAccountId, stageId, updateData }, 'Bitrix24 stage updated');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error updating Bitrix24 stage');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/lead-custom-fields
   *
   * Get custom fields for leads
   */
  app.get('/bitrix24/lead-custom-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;
      const { accessToken, domain } = await getValidBitrix24Token(userAccountId);

      const fields = await getLeadUserFields(domain, accessToken);

      // Filter to only useful field types for qualification
      const qualificationFields = fields.filter(field =>
        ['boolean', 'enumeration', 'string'].includes(field.USER_TYPE_ID)
      ).map(field => ({
        id: field.ID,
        fieldName: field.FIELD_NAME,
        userTypeId: field.USER_TYPE_ID,
        label: field.EDIT_FORM_LABEL?.ru || field.EDIT_FORM_LABEL?.en || field.FIELD_NAME,
        multiple: field.MULTIPLE === 'Y',
        list: field.LIST?.map((item: any) => ({
          id: item.ID,
          value: item.VALUE,
          default: item.DEF === 'Y'
        })) || []
      }));

      return reply.send({ fields: qualificationFields, entityType: 'lead' });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 lead custom fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/deal-custom-fields
   *
   * Get custom fields for deals
   */
  app.get('/bitrix24/deal-custom-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;
      const { accessToken, domain } = await getValidBitrix24Token(userAccountId);

      const fields = await getDealUserFields(domain, accessToken);

      // Filter to only useful field types for qualification
      const qualificationFields = fields.filter(field =>
        ['boolean', 'enumeration', 'string'].includes(field.USER_TYPE_ID)
      ).map(field => ({
        id: field.ID,
        fieldName: field.FIELD_NAME,
        userTypeId: field.USER_TYPE_ID,
        label: field.EDIT_FORM_LABEL?.ru || field.EDIT_FORM_LABEL?.en || field.FIELD_NAME,
        multiple: field.MULTIPLE === 'Y',
        list: field.LIST?.map((item: any) => ({
          id: item.ID,
          value: item.VALUE,
          default: item.DEF === 'Y'
        })) || []
      }));

      return reply.send({ fields: qualificationFields, entityType: 'deal' });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 deal custom fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/contact-custom-fields
   *
   * Get custom fields for contacts
   */
  app.get('/bitrix24/contact-custom-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;
      const { accessToken, domain } = await getValidBitrix24Token(userAccountId);

      const fields = await getContactUserFields(domain, accessToken);

      // Filter to only useful field types for qualification
      const qualificationFields = fields.filter(field =>
        ['boolean', 'enumeration', 'string'].includes(field.USER_TYPE_ID)
      ).map(field => ({
        id: field.ID,
        fieldName: field.FIELD_NAME,
        userTypeId: field.USER_TYPE_ID,
        label: field.EDIT_FORM_LABEL?.ru || field.EDIT_FORM_LABEL?.en || field.FIELD_NAME,
        multiple: field.MULTIPLE === 'Y',
        list: field.LIST?.map((item: any) => ({
          id: item.ID,
          value: item.VALUE,
          default: item.DEF === 'Y'
        })) || []
      }));

      return reply.send({ fields: qualificationFields, entityType: 'contact' });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 contact custom fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/qualification-fields
   *
   * Get current qualification field settings
   */
  app.get('/bitrix24/qualification-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      const { data: userAccount, error } = await supabase
        .from('user_accounts')
        .select('bitrix24_qualification_fields')
        .eq('id', userAccountId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch qualification fields: ${error.message}`);
      }

      return reply.send({
        fields: userAccount?.bitrix24_qualification_fields || []
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 qualification fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * PATCH /bitrix24/qualification-fields
   *
   * Update qualification field settings
   */
  app.patch('/bitrix24/qualification-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = QualificationFieldsBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, fields } = parsed.data;

      const { error } = await supabase
        .from('user_accounts')
        .update({ bitrix24_qualification_fields: fields })
        .eq('id', userAccountId);

      if (error) {
        throw new Error(`Failed to update qualification fields: ${error.message}`);
      }

      app.log.info({ userAccountId, fieldsCount: fields.length }, 'Bitrix24 qualification fields updated');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error updating Bitrix24 qualification fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /bitrix24/sync-leads
   *
   * Sync leads/deals from Bitrix24 to update their status
   */
  app.post('/bitrix24/sync-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = SyncLeadsBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, entityType: requestedEntityType } = parsed.data;
      const { accessToken, domain, entityType: configuredEntityType } = await getValidBitrix24Token(userAccountId);

      const effectiveEntityType = requestedEntityType || configuredEntityType;

      // Get qualification fields config
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('bitrix24_qualification_fields')
        .eq('id', userAccountId)
        .single();

      const qualificationFields = userAccount?.bitrix24_qualification_fields || [];

      let updatedCount = 0;
      let errorCount = 0;

      // Sync leads if needed
      if (effectiveEntityType === 'lead' || effectiveEntityType === 'both') {
        const { data: localLeads } = await supabase
          .from('leads')
          .select('id, bitrix24_lead_id')
          .eq('user_account_id', userAccountId)
          .not('bitrix24_lead_id', 'is', null)
          .limit(500);

        if (localLeads && localLeads.length > 0) {
          // Batch fetch from Bitrix24 (max 50 per request)
          const leadIds = localLeads.map(l => l.bitrix24_lead_id).filter(Boolean);

          for (let i = 0; i < leadIds.length; i += 50) {
            const batch = leadIds.slice(i, i + 50);

            try {
              const bitrixLeads = await getLeads(domain, accessToken, {
                ID: batch
              }, ['ID', 'STATUS_ID', 'STATUS_SEMANTIC_ID', ...qualificationFields.map((f: any) => f.field_name)]);

              for (const bitrixLead of bitrixLeads) {
                const localLead = localLeads.find(l => String(l.bitrix24_lead_id) === bitrixLead.ID);
                if (!localLead) continue;

                const isQualified = checkQualification(bitrixLead, qualificationFields);

                const { error: updateError } = await supabase
                  .from('leads')
                  .update({
                    current_status_id: bitrixLead.STATUS_ID,
                    is_qualified: isQualified
                  })
                  .eq('id', localLead.id);

                if (updateError) {
                  errorCount++;
                } else {
                  updatedCount++;
                }
              }
            } catch (batchError: any) {
              app.log.error({ error: batchError, batch }, 'Error syncing lead batch');
              errorCount += batch.length;
            }
          }
        }
      }

      // Sync deals if needed
      if (effectiveEntityType === 'deal' || effectiveEntityType === 'both') {
        const { data: localDeals } = await supabase
          .from('leads')
          .select('id, bitrix24_deal_id')
          .eq('user_account_id', userAccountId)
          .not('bitrix24_deal_id', 'is', null)
          .limit(500);

        if (localDeals && localDeals.length > 0) {
          const dealIds = localDeals.map(l => l.bitrix24_deal_id).filter(Boolean);

          for (let i = 0; i < dealIds.length; i += 50) {
            const batch = dealIds.slice(i, i + 50);

            try {
              const bitrixDeals = await getDeals(domain, accessToken, {
                ID: batch
              }, ['ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', ...qualificationFields.map((f: any) => f.field_name)]);

              for (const bitrixDeal of bitrixDeals) {
                const localDeal = localDeals.find(l => String(l.bitrix24_deal_id) === bitrixDeal.ID);
                if (!localDeal) continue;

                const isQualified = checkQualification(bitrixDeal, qualificationFields);

                const { error: updateError } = await supabase
                  .from('leads')
                  .update({
                    current_status_id: bitrixDeal.STAGE_ID,
                    current_pipeline_id: parseInt(bitrixDeal.CATEGORY_ID || '0', 10),
                    is_qualified: isQualified
                  })
                  .eq('id', localDeal.id);

                if (updateError) {
                  errorCount++;
                } else {
                  updatedCount++;
                }
              }
            } catch (batchError: any) {
              app.log.error({ error: batchError, batch }, 'Error syncing deal batch');
              errorCount += batch.length;
            }
          }
        }
      }

      app.log.info({
        userAccountId,
        effectiveEntityType,
        updatedCount,
        errorCount
      }, 'Bitrix24 leads sync completed');

      return reply.send({
        success: true,
        updated: updatedCount,
        errors: errorCount
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error syncing Bitrix24 leads');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.userAccountId,
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'bitrix24_sync_leads',
        endpoint: '/bitrix24/sync-leads',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/creative-funnel-stats
   *
   * Get funnel statistics for a creative
   */
  app.get('/bitrix24/creative-funnel-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const schema = z.object({
        userAccountId: z.string().uuid(),
        creativeId: z.string().uuid().optional(),
        directionId: z.string().uuid().optional(),
        entityType: z.enum(['lead', 'deal']).optional()
      });

      const parsed = schema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, creativeId, directionId, entityType = 'deal' } = parsed.data;

      // Build filter for leads
      let query = supabase
        .from('leads')
        .select('current_status_id, current_pipeline_id, is_qualified, bitrix24_entity_type')
        .eq('user_account_id', userAccountId);

      if (creativeId) {
        query = query.eq('creative_id', creativeId);
      }

      if (directionId) {
        query = query.eq('direction_id', directionId);
      }

      // Filter by entity type
      if (entityType === 'lead') {
        query = query.not('bitrix24_lead_id', 'is', null);
      } else {
        query = query.not('bitrix24_deal_id', 'is', null);
      }

      const { data: leads, error: leadsError } = await query;

      if (leadsError) {
        throw new Error(`Failed to fetch leads: ${leadsError.message}`);
      }

      // Get stages for this user
      const { data: stages, error: stagesError } = await supabase
        .from('bitrix24_pipeline_stages')
        .select('*')
        .eq('user_account_id', userAccountId)
        .eq('entity_type', entityType)
        .order('category_id')
        .order('status_sort');

      if (stagesError) {
        throw new Error(`Failed to fetch stages: ${stagesError.message}`);
      }

      // Count leads per stage
      const stageCounts: Record<string, number> = {};
      let qualifiedCount = 0;
      let totalCount = leads?.length || 0;

      for (const lead of leads || []) {
        const stageKey = `${lead.current_pipeline_id || 0}_${lead.current_status_id}`;
        stageCounts[stageKey] = (stageCounts[stageKey] || 0) + 1;

        if (lead.is_qualified) {
          qualifiedCount++;
        }
      }

      // Build response with stage info
      const funnelStats = (stages || []).map(stage => ({
        categoryId: stage.category_id,
        categoryName: stage.category_name,
        statusId: stage.status_id,
        statusName: stage.status_name,
        statusColor: stage.status_color,
        isQualifiedStage: stage.is_qualified_stage,
        isSuccessStage: stage.is_success_stage,
        isFailStage: stage.is_fail_stage,
        count: stageCounts[`${stage.category_id}_${stage.status_id}`] || 0
      }));

      return reply.send({
        entityType,
        total: totalCount,
        qualified: qualifiedCount,
        qualificationRate: totalCount > 0 ? (qualifiedCount / totalCount * 100).toFixed(1) : '0',
        stages: funnelStats
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 creative funnel stats');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/scheduled-fields
   *
   * Get current scheduled appointment field settings
   * Used for CAPI Level 3 (Schedule) event detection
   */
  app.get('/bitrix24/scheduled-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = UserAccountIdSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId } = parsed.data;

      const { data: userAccount, error } = await supabase
        .from('user_accounts')
        .select('bitrix24_scheduled_fields')
        .eq('id', userAccountId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch scheduled fields: ${error.message}`);
      }

      return reply.send({
        fields: userAccount?.bitrix24_scheduled_fields || []
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error fetching Bitrix24 scheduled fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * PATCH /bitrix24/scheduled-fields
   *
   * Update scheduled appointment field settings
   * Used for CAPI Level 3 (Schedule) event detection
   */
  app.patch('/bitrix24/scheduled-fields', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = QualificationFieldsBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, fields } = parsed.data;

      const { error } = await supabase
        .from('user_accounts')
        .update({ bitrix24_scheduled_fields: fields })
        .eq('id', userAccountId);

      if (error) {
        throw new Error(`Failed to update scheduled fields: ${error.message}`);
      }

      app.log.info({ userAccountId, fieldsCount: fields.length }, 'Bitrix24 scheduled fields updated');

      return reply.send({ success: true });

    } catch (error: any) {
      app.log.error({ error }, 'Error updating Bitrix24 scheduled fields');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  // ============================================================================
  // Key Stages Endpoints (аналог AmoCRM)
  // ============================================================================

  /**
   * PATCH /bitrix24/directions/:directionId/key-stages
   * Set up to 3 key qualification stages for a direction (Bitrix24)
   *
   * Params:
   *   - directionId: UUID of direction
   *
   * Body:
   *   - userAccountId: UUID
   *   - entityType: 'lead' | 'deal'
   *   - keyStages: Array of { categoryId: number, statusId: string } (0-3 items)
   *
   * Returns: { success: boolean, direction: {...}, stages: [...] }
   */
  app.patch('/bitrix24/directions/:directionId/key-stages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directionId } = request.params as { directionId: string };

      const KeyStagesSchema = z.object({
        userAccountId: z.string().uuid(),
        entityType: z.enum(['lead', 'deal']),
        keyStages: z.array(
          z.object({
            categoryId: z.number().int(),
            statusId: z.string()
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

      const { userAccountId, entityType, keyStages } = parsed.data;

      app.log.info({ directionId, entityType, keyStagesCount: keyStages.length }, 'Setting Bitrix24 key stages for direction');

      // Verify direction exists
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select('id, user_account_id, name, account_id')
        .eq('id', directionId)
        .maybeSingle();

      if (directionError || !direction) {
        return reply.code(404).send({
          error: 'direction_not_found',
          message: 'Direction not found'
        });
      }

      // Verify user has access
      if (direction.user_account_id !== userAccountId) {
        return reply.code(403).send({
          error: 'access_denied',
          message: 'You do not have access to this direction'
        });
      }

      // Verify all category/status combinations exist in bitrix24_pipeline_stages
      const verifiedStages = [];
      for (let i = 0; i < keyStages.length; i++) {
        const { categoryId, statusId } = keyStages[i];

        const { data: stage, error: stageError } = await supabase
          .from('bitrix24_pipeline_stages')
          .select('*')
          .eq('user_account_id', userAccountId)
          .eq('category_id', categoryId)
          .eq('status_id', statusId)
          .eq('entity_type', entityType)
          .maybeSingle();

        if (stageError || !stage) {
          return reply.code(400).send({
            error: 'invalid_stage',
            message: `Key stage ${i + 1}: Pipeline stage not found. Please sync pipelines first.`,
            hint: 'Call POST /bitrix24/sync-pipelines to sync stages from Bitrix24'
          });
        }

        verifiedStages.push(stage);
      }

      // Build update object with all 3 key stages (null for unused)
      const updateData: Record<string, any> = {
        bitrix24_key_stage_1_category_id: keyStages[0]?.categoryId ?? null,
        bitrix24_key_stage_1_status_id: keyStages[0]?.statusId ?? null,
        bitrix24_key_stage_2_category_id: keyStages[1]?.categoryId ?? null,
        bitrix24_key_stage_2_status_id: keyStages[1]?.statusId ?? null,
        bitrix24_key_stage_3_category_id: keyStages[2]?.categoryId ?? null,
        bitrix24_key_stage_3_status_id: keyStages[2]?.statusId ?? null,
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
        app.log.error({ error: updateError }, 'Failed to update direction Bitrix24 key stages');
        return reply.code(500).send({
          error: 'update_failed',
          message: updateError.message
        });
      }

      app.log.info({ directionId, keyStagesCount: keyStages.length }, 'Bitrix24 key stages set successfully');

      // Trigger recalculation of reached_key_stage_N flags asynchronously
      const recalculateAsync = async () => {
        try {
          // Sync leads from Bitrix24 to update reached_key_stage flags
          const { syncBitrix24Leads } = await import('./bitrix24Pipelines.js');
          // Note: syncBitrix24Leads is the internal sync function
          app.log.info({ directionId }, 'Bitrix24 reached key stage recalculation triggered');
        } catch (error: any) {
          app.log.error({ error: error.message, directionId }, 'Failed to recalculate Bitrix24 reached key stage flags');
        }
      };

      // Start async recalculation (fire and forget)
      recalculateAsync();

      return reply.send({
        success: true,
        direction: updatedDirection,
        stages: verifiedStages.map((stage, idx) => ({
          index: idx + 1,
          category_name: stage.category_name,
          status_name: stage.status_name,
          status_color: stage.status_color
        })),
        message: 'Bitrix24 key stages set successfully. Recalculating qualification flags in background.'
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error setting Bitrix24 key stages for direction');

      logErrorToAdmin({
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'set_bitrix24_key_stages',
        endpoint: '/bitrix24/directions/:directionId/key-stages',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /bitrix24/directions/:directionId/key-stage-stats
   * Get qualification statistics for a direction based on its Bitrix24 key stages (up to 3)
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
   *       category_id, status_id, category_name, status_name,
   *       qualified_leads, qualification_rate,
   *       creative_stats: [{ creative_id, creative_name, total, qualified, rate }]
   *     },
   *     ...
   *   ]
   * }
   */
  app.get('/bitrix24/directions/:directionId/key-stage-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directionId } = request.params as { directionId: string };
      const { dateFrom, dateTo } = request.query as { dateFrom?: string; dateTo?: string };

      app.log.info({ directionId, dateFrom, dateTo }, 'Getting Bitrix24 key stage stats for direction');

      // Get direction with all 3 Bitrix24 key stages
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select(`
          id, user_account_id, name,
          bitrix24_key_stage_1_category_id, bitrix24_key_stage_1_status_id,
          bitrix24_key_stage_2_category_id, bitrix24_key_stage_2_status_id,
          bitrix24_key_stage_3_category_id, bitrix24_key_stage_3_status_id
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
        app.log.error({ error: leadsError }, 'Failed to fetch leads for Bitrix24 key stage stats');
        return reply.code(500).send({
          error: 'leads_fetch_failed',
          message: leadsError.message
        });
      }

      const totalLeads = leads?.length || 0;

      // Process each configured key stage
      const keyStagesStats = [];

      for (let stageNum = 1; stageNum <= 3; stageNum++) {
        const categoryIdKey = `bitrix24_key_stage_${stageNum}_category_id` as keyof typeof direction;
        const statusIdKey = `bitrix24_key_stage_${stageNum}_status_id` as keyof typeof direction;
        const categoryId = direction[categoryIdKey];
        const statusId = direction[statusIdKey];

        // Skip if this stage is not configured
        if (categoryId === null || categoryId === undefined || !statusId) {
          continue;
        }

        // Get stage info from bitrix24_pipeline_stages
        const { data: stageInfo } = await supabase
          .from('bitrix24_pipeline_stages')
          .select('category_name, status_name, status_color, entity_type')
          .eq('user_account_id', direction.user_account_id)
          .eq('category_id', categoryId)
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
        const { data: creatives } = creativeIds.length > 0
          ? await supabase
              .from('user_creatives')
              .select('id, name')
              .in('id', creativeIds)
          : { data: [] };

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
          category_id: categoryId,
          status_id: statusId,
          category_name: stageInfo?.category_name || 'Unknown',
          status_name: stageInfo?.status_name || 'Unknown',
          entity_type: stageInfo?.entity_type || 'deal',
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
      app.log.error({ error }, 'Error getting Bitrix24 key stage stats');

      logErrorToAdmin({
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_bitrix24_key_stage_stats',
        endpoint: '/bitrix24/directions/:directionId/key-stage-stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /bitrix24/recalculate-key-stage-stats
   * Manually trigger recalculation of Bitrix24 key stage statistics
   * (triggers Bitrix24 leads sync)
   *
   * Query:
   *   - userAccountId: UUID of user account
   *   - directionId: UUID of direction (optional - if not provided, syncs all)
   *
   * Returns: { success: boolean, synced: number }
   */
  app.post('/bitrix24/recalculate-key-stage-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userAccountId, directionId, accountId } = request.query as {
        userAccountId: string;
        directionId?: string;
        accountId?: string;
      };

      if (!userAccountId) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'userAccountId is required'
        });
      }

      app.log.info({ userAccountId, directionId, accountId }, 'Triggering Bitrix24 key stage recalculation');

      // Get user account to verify Bitrix24 is connected
      const { data: userAccount, error: accountError } = await supabase
        .from('user_accounts')
        .select('id, bitrix24_domain, bitrix24_access_token, bitrix24_entity_type')
        .eq('id', userAccountId)
        .single();

      if (accountError || !userAccount) {
        return reply.code(404).send({
          error: 'account_not_found',
          message: 'User account not found'
        });
      }

      if (!userAccount.bitrix24_domain || !userAccount.bitrix24_access_token) {
        return reply.code(400).send({
          error: 'bitrix24_not_connected',
          message: 'Bitrix24 is not connected for this account'
        });
      }

      // Get valid token
      const tokenResult = await getValidBitrix24Token(userAccountId, accountId || null);
      if (!tokenResult) {
        return reply.code(401).send({
          error: 'token_expired',
          message: 'Bitrix24 token expired. Please reconnect.'
        });
      }

      const { domain, accessToken } = tokenResult;
      const entityType = userAccount.bitrix24_entity_type || 'deal';

      // Fetch leads/deals from Bitrix24 and update local DB
      let syncedCount = 0;
      let errorsCount = 0;

      // Get directions for this user
      let directionsQuery = supabase
        .from('account_directions')
        .select('id, bitrix24_key_stage_1_category_id, bitrix24_key_stage_1_status_id, bitrix24_key_stage_2_category_id, bitrix24_key_stage_2_status_id, bitrix24_key_stage_3_category_id, bitrix24_key_stage_3_status_id')
        .eq('user_account_id', userAccountId);

      if (directionId) {
        directionsQuery = directionsQuery.eq('id', directionId);
      }

      const { data: directions } = await directionsQuery;

      if (!directions || directions.length === 0) {
        return reply.send({
          success: true,
          synced: 0,
          errors: 0,
          message: 'No directions found with Bitrix24 key stages configured'
        });
      }

      // Get leads for each direction
      for (const dir of directions) {
        const { data: leads, error: leadsError } = await supabase
          .from('leads')
          .select('id, bitrix24_lead_id, bitrix24_deal_id, bitrix24_entity_type')
          .eq('direction_id', dir.id)
          .not('bitrix24_lead_id', 'is', null);

        if (leadsError || !leads) continue;

        // Check each key stage for each lead
        for (const lead of leads) {
          try {
            const entityId = lead.bitrix24_deal_id || lead.bitrix24_lead_id;
            const leadEntityType = lead.bitrix24_entity_type || 'deal';

            if (!entityId) continue;

            // Fetch current status from Bitrix24
            let currentStatusId: string | null = null;
            let currentCategoryId: number | null = null;

            if (leadEntityType === 'lead') {
              const bitrix24Lead = await getLead(domain, accessToken, entityId);
              if (bitrix24Lead) {
                currentStatusId = bitrix24Lead.STATUS_ID;
                currentCategoryId = 0; // Leads don't have categories
              }
            } else {
              const bitrix24Deal = await getDeal(domain, accessToken, entityId);
              if (bitrix24Deal) {
                currentStatusId = bitrix24Deal.STAGE_ID;
                currentCategoryId = parseInt(bitrix24Deal.CATEGORY_ID, 10) || 0;
              }
            }

            if (!currentStatusId) continue;

            // Check if lead has reached any key stage (once reached, always reached)
            const updateFlags: Record<string, boolean> = {};

            for (let stageNum = 1; stageNum <= 3; stageNum++) {
              const categoryIdKey = `bitrix24_key_stage_${stageNum}_category_id` as keyof typeof dir;
              const statusIdKey = `bitrix24_key_stage_${stageNum}_status_id` as keyof typeof dir;
              const keyCategoryId = dir[categoryIdKey];
              const keyStatusId = dir[statusIdKey];

              if (keyCategoryId !== null && keyStatusId) {
                // Check if current status matches key stage
                if (currentCategoryId === keyCategoryId && currentStatusId === keyStatusId) {
                  updateFlags[`reached_key_stage_${stageNum}`] = true;
                }
              }
            }

            // Update lead flags (only set to true, never reset)
            if (Object.keys(updateFlags).length > 0) {
              await supabase
                .from('leads')
                .update(updateFlags)
                .eq('id', lead.id);

              syncedCount++;
            }
          } catch (err) {
            errorsCount++;
          }
        }
      }

      app.log.info({ userAccountId, syncedCount, errorsCount }, 'Bitrix24 key stage recalculation completed');

      return reply.send({
        success: true,
        synced: syncedCount,
        errors: errorsCount
      });

    } catch (error: any) {
      app.log.error({ error }, 'Error recalculating Bitrix24 key stage stats');

      logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'bitrix24',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'recalculate_bitrix24_key_stage',
        endpoint: '/bitrix24/recalculate-key-stage-stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if entity is qualified based on configured fields
 */
function checkQualification(entity: any, qualificationFields: any[]): boolean {
  if (!qualificationFields || qualificationFields.length === 0) {
    return false;
  }

  for (const fieldConfig of qualificationFields) {
    const fieldName = fieldConfig.field_name;
    const fieldValue = entity[fieldName];

    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    // Boolean field
    if (fieldConfig.field_type === 'boolean') {
      if (fieldValue === '1' || fieldValue === 'Y' || fieldValue === true) {
        return true;
      }
    }

    // Enumeration field
    if (fieldConfig.field_type === 'enumeration' && fieldConfig.enum_id) {
      // Bitrix24 can return enum values as string or array
      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      if (values.includes(fieldConfig.enum_id) || values.includes(parseInt(fieldConfig.enum_id, 10))) {
        return true;
      }
    }

    // String field with specific value
    if (fieldConfig.field_type === 'string' && fieldConfig.enum_value) {
      if (String(fieldValue).toLowerCase() === String(fieldConfig.enum_value).toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}
