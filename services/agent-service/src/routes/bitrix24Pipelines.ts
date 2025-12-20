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
