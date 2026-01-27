/**
 * Unified CRM Routes
 *
 * Provides CRM-agnostic endpoints that automatically detect the connected CRM
 * (AmoCRM or Bitrix24) and route requests accordingly.
 *
 * This allows frontend components to work with any CRM without needing to know
 * which specific CRM is connected.
 *
 * @module routes/crmUnified
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

const uuidSchema = z.string().uuid('Invalid UUID format');

const statusQuerySchema = z.object({
  userAccountId: uuidSchema,
  accountId: uuidSchema.optional(),
});

const funnelStatsQuerySchema = z.object({
  userAccountId: uuidSchema,
  creativeId: uuidSchema.optional(), // Optional - if not provided, returns stats for all creatives
  directionId: uuidSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  accountId: uuidSchema.optional(),
});

const syncLeadsQuerySchema = z.object({
  userAccountId: uuidSchema,
  creativeId: uuidSchema,
  accountId: uuidSchema.optional(),
});

// ============================================================================
// Types
// ============================================================================

export type CRMType = 'amocrm' | 'bitrix24' | 'none';

export interface CRMStatus {
  crmType: CRMType;
  connected: boolean;
  domain?: string;
  entityType?: string;
}

export interface UnifiedFunnelStage {
  stage_name: string;
  pipeline_name: string;
  count: number;
  percentage: number;
  color: string;
  sort_order: number;
}

export interface UnifiedFunnelStats {
  crmType: CRMType;
  total_leads: number;
  stages: UnifiedFunnelStage[];
}

// ============================================================================
// Helper: Detect connected CRM
// ============================================================================

/**
 * Detect which CRM is connected for a user account
 *
 * Checks both user_accounts and ad_accounts tables based on multi-account mode
 */
async function detectConnectedCRM(
  log: FastifyInstance['log'],
  userAccountId: string,
  accountId?: string | null
): Promise<CRMStatus> {
  const startTime = Date.now();

  log.debug({ userAccountId, accountId }, '[CRM] Starting CRM detection');

  // If accountId provided, check ad_accounts first (multi-account mode)
  if (accountId) {
    const isMultiAccount = await shouldFilterByAccountId(supabase, userAccountId, accountId);

    log.debug({ isMultiAccount, accountId }, '[CRM] Multi-account mode check');

    if (isMultiAccount) {
      const { data: adAccount, error: adAccountError } = await supabase
        .from('ad_accounts')
        .select('amocrm_subdomain, bitrix24_domain, bitrix24_entity_type')
        .eq('id', accountId)
        .single();

      if (adAccountError) {
        log.warn({ error: adAccountError, accountId }, '[CRM] Failed to fetch ad_account');
      }

      if (adAccount?.bitrix24_domain) {
        const result: CRMStatus = {
          crmType: 'bitrix24',
          connected: true,
          domain: adAccount.bitrix24_domain,
          entityType: adAccount.bitrix24_entity_type || 'deal'
        };
        log.info({ ...result, duration: Date.now() - startTime }, '[CRM] Detected Bitrix24 from ad_account');
        return result;
      }

      if (adAccount?.amocrm_subdomain) {
        const result: CRMStatus = {
          crmType: 'amocrm',
          connected: true,
          domain: adAccount.amocrm_subdomain
        };
        log.info({ ...result, duration: Date.now() - startTime }, '[CRM] Detected AmoCRM from ad_account');
        return result;
      }
    }
  }

  // Check user_accounts (legacy mode or fallback)
  const { data: userAccount, error: userAccountError } = await supabase
    .from('user_accounts')
    .select('amocrm_subdomain, bitrix24_domain, bitrix24_entity_type')
    .eq('id', userAccountId)
    .single();

  if (userAccountError) {
    log.warn({ error: userAccountError, userAccountId }, '[CRM] Failed to fetch user_account');
  }

  if (userAccount?.bitrix24_domain) {
    const result: CRMStatus = {
      crmType: 'bitrix24',
      connected: true,
      domain: userAccount.bitrix24_domain,
      entityType: userAccount.bitrix24_entity_type || 'deal'
    };
    log.info({ ...result, duration: Date.now() - startTime }, '[CRM] Detected Bitrix24 from user_account');
    return result;
  }

  if (userAccount?.amocrm_subdomain) {
    const result: CRMStatus = {
      crmType: 'amocrm',
      connected: true,
      domain: userAccount.amocrm_subdomain
    };
    log.info({ ...result, duration: Date.now() - startTime }, '[CRM] Detected AmoCRM from user_account');
    return result;
  }

  log.info({ userAccountId, accountId, duration: Date.now() - startTime }, '[CRM] No CRM connected');
  return {
    crmType: 'none',
    connected: false
  };
}

// ============================================================================
// Routes
// ============================================================================

export default async function crmUnifiedRoutes(app: FastifyInstance) {
  /**
   * GET /crm/status
   *
   * Get the connected CRM status for a user
   */
  app.get('/crm/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Validate query params
      const parseResult = statusQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        const errorMsg = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        request.log.warn({ errors: parseResult.error.errors }, '[CRM] Invalid query params for /crm/status');
        return reply.code(400).send({
          error: 'validation_error',
          message: errorMsg
        });
      }

      const { userAccountId, accountId } = parseResult.data;

      request.log.info({ userAccountId, accountId }, '[CRM] GET /crm/status');

      const status = await detectConnectedCRM(request.log, userAccountId, accountId);

      request.log.info({ status, duration: Date.now() - startTime }, '[CRM] /crm/status completed');

      return reply.send(status);
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM] Failed /crm/status');

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * GET /crm/creative-funnel-stats
   *
   * Get funnel statistics for a creative - automatically detects connected CRM
   */
  app.get('/crm/creative-funnel-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Validate query params
      const parseResult = funnelStatsQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        const errorMsg = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        request.log.warn({ errors: parseResult.error.errors }, '[CRM] Invalid query params for /crm/creative-funnel-stats');
        return reply.code(400).send({
          error: 'validation_error',
          message: errorMsg
        });
      }

      const { userAccountId, creativeId, directionId, dateFrom, dateTo, accountId } = parseResult.data;

      request.log.info({ userAccountId, creativeId, directionId, dateFrom, dateTo, accountId }, '[CRM] GET /crm/creative-funnel-stats');

      // Detect connected CRM
      const crmStatus = await detectConnectedCRM(request.log, userAccountId, accountId);

      if (!crmStatus.connected || crmStatus.crmType === 'none') {
        request.log.info({ duration: Date.now() - startTime }, '[CRM] No CRM connected, returning empty result');
        return reply.send({
          crmType: 'none',
          total_leads: 0,
          stages: [],
          message: 'No CRM connected'
        });
      }

      // Route to appropriate CRM handler
      if (crmStatus.crmType === 'bitrix24') {
        return await getBitrix24FunnelStats(
          request.log,
          reply,
          userAccountId,
          creativeId,
          directionId,
          dateFrom,
          dateTo,
          accountId,
          crmStatus.entityType || 'deal',
          startTime
        );
      } else {
        return await getAmoCRMFunnelStats(
          request.log,
          reply,
          userAccountId,
          creativeId,
          directionId,
          dateFrom,
          dateTo,
          accountId,
          startTime
        );
      }
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM] Failed /crm/creative-funnel-stats');

      await logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'amocrm',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_unified_funnel_stats',
        endpoint: '/crm/creative-funnel-stats',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        error: 'internal_error',
        message: error.message
      });
    }
  });

  /**
   * POST /crm/sync-creative-leads
   *
   * Sync leads for a specific creative - automatically detects connected CRM
   */
  app.post('/crm/sync-creative-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Validate query params
      const parseResult = syncLeadsQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        const errorMsg = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        request.log.warn({ errors: parseResult.error.errors }, '[CRM] Invalid query params for /crm/sync-creative-leads');
        return reply.code(400).send({
          error: 'validation_error',
          message: errorMsg
        });
      }

      const { userAccountId, creativeId, accountId } = parseResult.data;

      request.log.info({ userAccountId, creativeId, accountId }, '[CRM] POST /crm/sync-creative-leads');

      // Detect connected CRM
      const crmStatus = await detectConnectedCRM(request.log, userAccountId, accountId);

      if (!crmStatus.connected || crmStatus.crmType === 'none') {
        request.log.info({ duration: Date.now() - startTime }, '[CRM] No CRM connected for sync');
        return reply.send({
          success: false,
          crmType: 'none',
          message: 'No CRM connected'
        });
      }

      // Route to appropriate CRM handler
      if (crmStatus.crmType === 'bitrix24') {
        return await syncBitrix24CreativeLeads(
          request.log,
          reply,
          userAccountId,
          creativeId,
          accountId,
          crmStatus.entityType || 'deal',
          startTime
        );
      } else {
        return await syncAmoCRMCreativeLeads(
          request.log,
          reply,
          userAccountId,
          creativeId,
          accountId,
          startTime
        );
      }
    } catch (error: any) {
      request.log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM] Failed /crm/sync-creative-leads');

      await logErrorToAdmin({
        user_account_id: (request.query as any)?.userAccountId,
        error_type: 'amocrm',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'sync_creative_leads',
        endpoint: '/crm/sync-creative-leads',
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
// AmoCRM Handlers
// ============================================================================

async function getAmoCRMFunnelStats(
  log: FastifyInstance['log'],
  reply: FastifyReply,
  userAccountId: string,
  creativeId?: string, // Optional - if not provided, returns stats for all creatives
  directionId?: string,
  dateFrom?: string,
  dateTo?: string,
  accountId?: string,
  startTime: number = Date.now()
): Promise<any> {
  log.info({ userAccountId, creativeId: creativeId || 'ALL', directionId, dateFrom, dateTo, accountId }, '[CRM/AmoCRM] Fetching funnel stats');

  try {
    // Build SQL query for leads
    let query = supabase
      .from('leads')
      .select('current_status_id, current_pipeline_id')
      .eq('user_account_id', userAccountId)
      .not('amocrm_lead_id', 'is', null)
      .not('current_status_id', 'is', null);

    // Filter by specific creative if provided
    if (creativeId) {
      query = query.eq('creative_id', creativeId);
    }

    // Filter by account_id in multi-account mode
    if (accountId && await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
      query = query.eq('account_id', accountId);
      log.debug({ accountId }, '[CRM/AmoCRM] Filtering by account_id');
    }

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
      log.error({ error }, '[CRM/AmoCRM] Failed to fetch leads from DB');
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }

    log.debug({ leadsCount: leads?.length || 0 }, '[CRM/AmoCRM] Fetched leads from DB');

    if (!leads || leads.length === 0) {
      log.info({ duration: Date.now() - startTime }, '[CRM/AmoCRM] No leads found');
      return reply.send({
        crmType: 'amocrm',
        total_leads: 0,
        stages: []
      });
    }

    // Get unique status IDs
    const statusIds = [...new Set(leads.map(l => l.current_status_id).filter(Boolean))];

    log.debug({ statusIds }, '[CRM/AmoCRM] Unique status IDs');

    // Fetch stage information for these statuses
    const { data: stages, error: stagesError } = await supabase
      .from('amocrm_pipeline_stages')
      .select('status_id, pipeline_name, status_name, status_color, sort_order')
      .eq('user_account_id', userAccountId)
      .in('status_id', statusIds);

    if (stagesError) {
      log.error({ error: stagesError }, '[CRM/AmoCRM] Failed to fetch stages');
      throw new Error(`Failed to fetch stages: ${stagesError.message}`);
    }

    log.debug({ stagesCount: stages?.length || 0 }, '[CRM/AmoCRM] Fetched stages from DB');

    // Create stages map
    const stagesMap = new Map(
      (stages || []).map(s => [s.status_id, s])
    );

    // Count leads per status
    const statusCounts = new Map<number, number>();
    for (const lead of leads) {
      const count = statusCounts.get(lead.current_status_id) || 0;
      statusCounts.set(lead.current_status_id, count + 1);
    }

    // Build response stages
    const responseStages: UnifiedFunnelStage[] = [];
    for (const [statusId, count] of statusCounts) {
      const stageInfo = stagesMap.get(statusId);
      responseStages.push({
        stage_name: stageInfo?.status_name || `Status ${statusId}`,
        pipeline_name: stageInfo?.pipeline_name || 'Unknown Pipeline',
        count,
        percentage: Math.round((count / leads.length) * 100 * 10) / 10,
        color: stageInfo?.status_color || '#999999',
        sort_order: stageInfo?.sort_order || 0
      });
    }

    // Sort by sort_order
    responseStages.sort((a, b) => a.sort_order - b.sort_order);

    log.info({
      totalLeads: leads.length,
      stagesCount: responseStages.length,
      duration: Date.now() - startTime
    }, '[CRM/AmoCRM] Funnel stats completed');

    return reply.send({
      crmType: 'amocrm',
      total_leads: leads.length,
      stages: responseStages
    });
  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM/AmoCRM] Error in getAmoCRMFunnelStats');
    throw error;
  }
}

async function syncAmoCRMCreativeLeads(
  log: FastifyInstance['log'],
  reply: FastifyReply,
  userAccountId: string,
  creativeId: string,
  accountId?: string,
  startTime: number = Date.now()
): Promise<any> {
  log.info({ userAccountId, creativeId, accountId }, '[CRM/AmoCRM] Starting creative leads sync');

  try {
    // Import and call the existing AmoCRM sync function
    const { syncCreativeLeadsFromAmoCRM } = await import('../workflows/amocrmLeadsSync.js');

    const result = await syncCreativeLeadsFromAmoCRM(userAccountId, creativeId, { log } as any, accountId);

    log.info({
      ...result,
      duration: Date.now() - startTime
    }, '[CRM/AmoCRM] Sync completed');

    return reply.send({
      ...result,
      crmType: 'amocrm'
    });
  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM/AmoCRM] Error in syncAmoCRMCreativeLeads');
    throw error;
  }
}

// ============================================================================
// Bitrix24 Handlers
// ============================================================================

async function getBitrix24FunnelStats(
  log: FastifyInstance['log'],
  reply: FastifyReply,
  userAccountId: string,
  creativeId?: string, // Optional - if not provided, returns stats for all creatives
  directionId?: string,
  dateFrom?: string,
  dateTo?: string,
  accountId?: string,
  entityType: string = 'deal',
  startTime: number = Date.now()
): Promise<any> {
  log.info({ userAccountId, creativeId: creativeId || 'ALL', directionId, dateFrom, dateTo, accountId, entityType }, '[CRM/Bitrix24] Fetching funnel stats');

  try {
    // Build filter for leads
    let query = supabase
      .from('leads')
      .select('current_status_id, current_pipeline_id, is_qualified, bitrix24_entity_type')
      .eq('user_account_id', userAccountId);

    // Filter by specific creative if provided
    if (creativeId) {
      query = query.eq('creative_id', creativeId);
    }

    // Filter by account_id in multi-account mode
    if (accountId && await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
      query = query.eq('account_id', accountId);
      log.debug({ accountId }, '[CRM/Bitrix24] Filtering by account_id');
    }

    if (directionId) {
      query = query.eq('direction_id', directionId);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Filter by entity type AND ensure the lead was actually synced from Bitrix24
    // (not just has an ID but might have AmoCRM status still)
    if (entityType === 'lead') {
      query = query
        .not('bitrix24_lead_id', 'is', null)
        .eq('bitrix24_entity_type', 'lead');
    } else if (entityType === 'deal') {
      query = query
        .not('bitrix24_deal_id', 'is', null)
        .eq('bitrix24_entity_type', 'deal');
    } else {
      // entityType === 'both' - include leads with any Bitrix24 entity_type set
      query = query
        .not('bitrix24_entity_type', 'is', null);
    }

    const { data: leads, error: leadsError } = await query;

    if (leadsError) {
      log.error({ error: leadsError }, '[CRM/Bitrix24] Failed to fetch leads from DB');
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    log.info({ leadsCount: leads?.length || 0, entityType }, '[CRM/Bitrix24] Fetched leads from DB');

    if (!leads || leads.length === 0) {
      log.info({ duration: Date.now() - startTime }, '[CRM/Bitrix24] No leads found');
      return reply.send({
        crmType: 'bitrix24',
        total_leads: 0,
        stages: []
      });
    }

    // Get stages for this user
    // entityType can be 'deal', 'lead', or 'both' - filter accordingly
    let stagesQuery = supabase
      .from('bitrix24_pipeline_stages')
      .select('*')
      .eq('user_account_id', userAccountId);

    if (entityType !== 'both') {
      stagesQuery = stagesQuery.eq('entity_type', entityType);
    }
    // When entityType is 'both', we fetch all stages (no entity_type filter)

    const { data: stages, error: stagesError } = await stagesQuery;

    if (stagesError) {
      log.error({ error: stagesError }, '[CRM/Bitrix24] Failed to fetch stages');
      throw new Error(`Failed to fetch stages: ${stagesError.message}`);
    }

    log.debug({ stagesCount: stages?.length || 0, entityType }, '[CRM/Bitrix24] Fetched stages from DB');

    // Debug: Log first few stages to understand the data format
    if (stages && stages.length > 0) {
      log.info({
        sampleStages: stages.slice(0, 5).map(s => ({
          category_id: s.category_id,
          status_id: s.status_id,
          status_name: s.status_name,
          category_name: s.category_name
        }))
      }, '[CRM/Bitrix24] Sample stages from DB');
    } else {
      log.warn({ userAccountId, entityType }, '[CRM/Bitrix24] No stages found in bitrix24_pipeline_stages!');
    }

    // Create stages map (category_id:status_id -> stage)
    const stagesMap = new Map<string, any>();
    for (const stage of (stages || [])) {
      const key = `${stage.category_id}:${stage.status_id}`;
      stagesMap.set(key, stage);
    }

    log.debug({ stagesMapKeys: Array.from(stagesMap.keys()).slice(0, 10) }, '[CRM/Bitrix24] Stages map keys');

    // Count leads per status
    const statusCounts = new Map<string, number>();
    for (const lead of leads) {
      if (lead.current_status_id && lead.current_pipeline_id !== undefined) {
        const key = `${lead.current_pipeline_id}:${lead.current_status_id}`;
        statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
      }
    }

    log.debug({
      statusCountsKeys: Array.from(statusCounts.keys()),
      sampleLeads: leads.slice(0, 5).map(l => ({
        current_status_id: l.current_status_id,
        current_pipeline_id: l.current_pipeline_id,
        bitrix24_entity_type: l.bitrix24_entity_type
      }))
    }, '[CRM/Bitrix24] Leads status keys');

    // Build response stages
    const responseStages: UnifiedFunnelStage[] = [];
    for (const [key, count] of statusCounts) {
      const stageInfo = stagesMap.get(key);
      responseStages.push({
        stage_name: stageInfo?.status_name || key,
        pipeline_name: stageInfo?.category_name || 'Unknown Pipeline',
        count,
        percentage: Math.round((count / leads.length) * 100 * 10) / 10,
        color: stageInfo?.status_color || '#999999',
        sort_order: stageInfo?.status_sort || 0
      });
    }

    // Sort by sort_order
    responseStages.sort((a, b) => a.sort_order - b.sort_order);

    log.info({
      totalLeads: leads.length,
      stagesCount: responseStages.length,
      duration: Date.now() - startTime
    }, '[CRM/Bitrix24] Funnel stats completed');

    return reply.send({
      crmType: 'bitrix24',
      total_leads: leads.length,
      stages: responseStages
    });
  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM/Bitrix24] Error in getBitrix24FunnelStats');
    throw error;
  }
}

async function syncBitrix24CreativeLeads(
  log: FastifyInstance['log'],
  reply: FastifyReply,
  userAccountId: string,
  creativeId: string,
  accountId?: string,
  entityType: string = 'deal',
  startTime: number = Date.now()
): Promise<any> {
  log.info({ userAccountId, creativeId, accountId, entityType }, '[CRM/Bitrix24] Starting creative leads sync');

  try {
    // Get leads for this creative that are linked to Bitrix24
    let query = supabase
      .from('leads')
      .select('id, phone, bitrix24_lead_id, bitrix24_deal_id, bitrix24_contact_id')
      .eq('user_account_id', userAccountId)
      .eq('creative_id', creativeId);

    // Filter by account_id in multi-account mode
    if (accountId && await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
      query = query.eq('account_id', accountId);
      log.debug({ accountId }, '[CRM/Bitrix24] Filtering by account_id');
    }

    // Filter by entity type AND ensure the lead was actually synced from Bitrix24
    if (entityType === 'lead') {
      query = query
        .not('bitrix24_lead_id', 'is', null)
        .eq('bitrix24_entity_type', 'lead');
    } else {
      query = query
        .not('bitrix24_deal_id', 'is', null)
        .eq('bitrix24_entity_type', 'deal');
    }

    const { data: leads, error: leadsError } = await query;

    if (leadsError) {
      log.error({ error: leadsError }, '[CRM/Bitrix24] Failed to fetch leads');
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    log.debug({ leadsCount: leads?.length || 0 }, '[CRM/Bitrix24] Fetched leads to sync');

    if (!leads || leads.length === 0) {
      log.info({ duration: Date.now() - startTime }, '[CRM/Bitrix24] No linked leads to sync');
      return reply.send({
        success: true,
        crmType: 'bitrix24',
        total: 0,
        updated: 0,
        errors: 0,
        message: 'No linked leads to sync'
      });
    }

    // Get valid Bitrix24 token
    const { getValidBitrix24Token } = await import('../lib/bitrix24Tokens.js');
    const { getLead, getDeal } = await import('../adapters/bitrix24.js');

    let tokenInfo;
    try {
      tokenInfo = await getValidBitrix24Token(userAccountId, accountId || null);
      log.debug({ domain: tokenInfo.domain }, '[CRM/Bitrix24] Got valid token');
    } catch (err: any) {
      log.error({ error: err.message }, '[CRM/Bitrix24] Failed to get Bitrix24 token');
      return reply.send({
        success: false,
        crmType: 'bitrix24',
        error: err.message
      });
    }

    const { accessToken, domain } = tokenInfo;

    let updated = 0;
    let errors = 0;

    // Update status for each lead
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];

      // Log progress every 10 leads
      if (i > 0 && i % 10 === 0) {
        log.debug({ progress: `${i}/${leads.length}`, updated, errors }, '[CRM/Bitrix24] Sync progress');
      }

      try {
        let statusId: string | null = null;
        let pipelineId: number | null = null;

        if (entityType === 'lead' && lead.bitrix24_lead_id) {
          const b24Lead = await getLead(domain, accessToken, lead.bitrix24_lead_id);
          if (b24Lead) {
            statusId = b24Lead.STATUS_ID ?? null;
            pipelineId = 0; // Leads don't have pipelines in Bitrix24
          }
        } else if (lead.bitrix24_deal_id) {
          const b24Deal = await getDeal(domain, accessToken, lead.bitrix24_deal_id);
          if (b24Deal) {
            statusId = b24Deal.STAGE_ID ?? null;
            pipelineId = b24Deal.CATEGORY_ID ? parseInt(b24Deal.CATEGORY_ID, 10) : 0;
          }
        }

        if (statusId) {
          const { error: updateError } = await supabase
            .from('leads')
            .update({
              current_status_id: statusId,
              current_pipeline_id: pipelineId,
              updated_at: new Date().toISOString()
            })
            .eq('id', lead.id);

          if (updateError) {
            log.warn({ leadId: lead.id, error: updateError.message }, '[CRM/Bitrix24] Failed to update lead in DB');
            errors++;
          } else {
            updated++;
          }
        }
      } catch (err: any) {
        log.warn({ leadId: lead.id, error: err.message }, '[CRM/Bitrix24] Failed to sync lead status');
        errors++;
      }
    }

    log.info({
      total: leads.length,
      updated,
      errors,
      duration: Date.now() - startTime
    }, '[CRM/Bitrix24] Sync completed');

    return reply.send({
      success: true,
      crmType: 'bitrix24',
      total: leads.length,
      updated,
      errors
    });
  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack, duration: Date.now() - startTime }, '[CRM/Bitrix24] Error in syncBitrix24CreativeLeads');
    throw error;
  }
}
