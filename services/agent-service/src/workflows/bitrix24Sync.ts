/**
 * Bitrix24 Synchronization Workflow
 *
 * Handles syncing leads from Facebook Lead Forms to Bitrix24 CRM
 * Creates leads/deals in Bitrix24 or links to existing ones by phone
 *
 * Features:
 * - Phone-based deduplication (finds existing leads/contacts)
 * - Multi-account mode support
 * - Configurable default pipeline/stage
 * - Detailed logging for debugging
 * - Retry logic for transient errors
 *
 * @module workflows/bitrix24Sync
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getValidBitrix24Token } from '../lib/bitrix24Tokens.js';
import {
  createLead as createBitrix24Lead,
  createDeal as createBitrix24Deal,
  createContact as createBitrix24Contact,
  findByPhone,
  normalizePhone,
  Bitrix24Lead,
  Bitrix24Deal,
  Bitrix24Contact
} from '../adapters/bitrix24.js';

/** Max retries for transient errors */
const MAX_RETRIES = 2;
/** Delay between retries in ms */
const RETRY_DELAY_MS = 1000;

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (network issues, rate limits)
 */
function isRetryableError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code;

  // Network errors
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return true;
  }

  // Bitrix24 rate limit errors
  if (message.includes('too many requests') || message.includes('rate limit')) {
    return true;
  }

  // HTTP 429 or 503
  if (error?.statusCode === 429 || error?.statusCode === 503) {
    return true;
  }

  return false;
}

/**
 * Log sync operation to bitrix24_sync_log table
 */
async function logSync(data: {
  userAccountId: string;
  accountId?: string | null;
  leadId?: number;
  bitrix24LeadId?: number;
  bitrix24ContactId?: number;
  bitrix24DealId?: number;
  syncType: 'lead_to_bitrix24' | 'contact_to_bitrix24' | 'deal_to_bitrix24' | 'link_existing';
  syncStatus: 'success' | 'failed' | 'pending' | 'retrying';
  requestJson?: any;
  responseJson?: any;
  errorMessage?: string;
  errorCode?: string;
}) {
  try {
    await supabase.from('bitrix24_sync_log').insert({
      user_account_id: data.userAccountId,
      account_id: data.accountId || null,
      lead_id: data.leadId || null,
      bitrix24_lead_id: data.bitrix24LeadId || null,
      bitrix24_contact_id: data.bitrix24ContactId || null,
      bitrix24_deal_id: data.bitrix24DealId || null,
      sync_type: data.syncType,
      sync_status: data.syncStatus,
      request_json: data.requestJson || null,
      response_json: data.responseJson || null,
      error_message: data.errorMessage || null,
      error_code: data.errorCode || null,
      retry_count: 0
    });
  } catch (error) {
    console.error('Failed to log Bitrix24 sync operation:', error);
  }
}

/**
 * Extract name from various formats
 *
 * @param name - Name string (can be "First Last" or just "First")
 * @returns Object with NAME, SECOND_NAME, LAST_NAME
 */
/**
 * Get default stage settings for auto-created leads/deals
 */
async function getDefaultStageSettings(
  userAccountId: string,
  accountId: string | null
): Promise<{
  leadStatus: string | null;
  dealCategory: number | null;
  dealStage: string | null;
}> {
  try {
    // Check if multi-account mode is enabled
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('multi_account_enabled, bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage')
      .eq('id', userAccountId)
      .single();

    if (!userAccount) {
      return { leadStatus: null, dealCategory: null, dealStage: null };
    }

    const isMultiAccountMode = userAccount.multi_account_enabled && accountId;

    if (isMultiAccountMode) {
      // Multi-account mode: get from ad_accounts
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('bitrix24_default_lead_status, bitrix24_default_deal_category, bitrix24_default_deal_stage')
        .eq('id', accountId)
        .eq('user_account_id', userAccountId)
        .single();

      if (!adAccount) {
        return { leadStatus: null, dealCategory: null, dealStage: null };
      }

      return {
        leadStatus: adAccount.bitrix24_default_lead_status || null,
        dealCategory: adAccount.bitrix24_default_deal_category || null,
        dealStage: adAccount.bitrix24_default_deal_stage || null
      };
    }

    // Legacy mode: get from user_accounts
    return {
      leadStatus: userAccount.bitrix24_default_lead_status || null,
      dealCategory: userAccount.bitrix24_default_deal_category || null,
      dealStage: userAccount.bitrix24_default_deal_stage || null
    };

  } catch (error) {
    console.error('Error getting default stage settings:', error);
    return { leadStatus: null, dealCategory: null, dealStage: null };
  }
}

function extractName(name: string): { NAME: string; LAST_NAME?: string } {
  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return { NAME: parts[0] };
  }

  return {
    NAME: parts[0],
    LAST_NAME: parts.slice(1).join(' ')
  };
}

/**
 * Sync a lead from our system to Bitrix24
 *
 * Steps:
 * 1. Get valid Bitrix24 token
 * 2. Find existing entity by phone or create new
 * 3. Update our database with Bitrix24 IDs
 *
 * @param leadId - Our internal lead ID
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @param app - Fastify instance for logging
 */
export async function syncLeadToBitrix24(
  leadId: number,
  userAccountId: string,
  accountId: string | null,
  app: FastifyInstance,
  retryCount: number = 0
): Promise<void> {
  const syncStartTime = Date.now();

  try {
    app.log.info({
      leadId,
      userAccountId,
      accountId,
      retryCount,
      timestamp: new Date().toISOString()
    }, '[Bitrix24Sync] Starting lead sync');

    // 1. Get lead from database
    app.log.debug({ leadId }, '[Bitrix24Sync] Fetching lead from database');
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      app.log.error({ leadId, error: leadError }, '[Bitrix24Sync] Lead not found in database');
      throw new Error(`Lead not found: ${leadId}`);
    }

    app.log.debug({
      leadId,
      leadName: lead.name,
      leadPhone: lead.phone ? `${lead.phone.slice(0, 4)}***` : null,
      sourceType: lead.source_type
    }, '[Bitrix24Sync] Lead loaded from database');

    // Check if already synced
    if (lead.bitrix24_lead_id || lead.bitrix24_deal_id) {
      app.log.info({
        leadId,
        bitrix24LeadId: lead.bitrix24_lead_id,
        bitrix24DealId: lead.bitrix24_deal_id,
        bitrix24ContactId: lead.bitrix24_contact_id
      }, '[Bitrix24Sync] Lead already synced - skipping');
      return;
    }

    // 2. Get valid token, entity type, and default stage settings
    app.log.debug({ userAccountId, accountId }, '[Bitrix24Sync] Fetching Bitrix24 token');
    const { accessToken, domain, entityType } = await getValidBitrix24Token(userAccountId, accountId);
    app.log.debug({
      domain,
      entityType,
      tokenLength: accessToken?.length
    }, '[Bitrix24Sync] Token retrieved successfully');

    // Get default stage settings
    const defaultStageSettings = await getDefaultStageSettings(userAccountId, accountId);
    app.log.debug({
      leadStatus: defaultStageSettings.leadStatus,
      dealCategory: defaultStageSettings.dealCategory,
      dealStage: defaultStageSettings.dealStage
    }, '[Bitrix24Sync] Default stage settings loaded');

    // 3. Extract contact info
    let phone: string | null = null;
    let displayName: string = 'Лид';
    let rawPhone: string | null = null;

    if (lead.source_type === 'leadgen' || lead.source_type === 'website' || lead.source_type === 'manual') {
      // Lead form or website lead - use phone and name fields directly
      rawPhone = lead.phone;
      phone = lead.phone ? normalizePhone(lead.phone) : null;
      displayName = lead.name || 'Лид из Facebook';
    } else {
      // WhatsApp lead - extract from chat_id
      rawPhone = lead.chat_id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || null;
      phone = rawPhone ? normalizePhone(rawPhone) : null;
      displayName = lead.name || lead.chat_id || 'Лид';
    }

    app.log.debug({
      leadId,
      sourceType: lead.source_type,
      rawPhone: rawPhone ? `${rawPhone.slice(0, 4)}***` : null,
      normalizedPhone: phone ? `${phone.slice(0, 4)}***` : null,
      displayName
    }, '[Bitrix24Sync] Contact info extracted');

    if (!phone) {
      app.log.warn({ leadId, sourceType: lead.source_type }, '[Bitrix24Sync] Lead has no phone number');
      throw new Error('Lead has no phone number');
    }

    // 4. Check for existing entity by phone
    let bitrix24LeadId: number | null = null;
    let bitrix24DealId: number | null = null;
    let bitrix24ContactId: number | null = null;
    let linkedExisting = false;

    app.log.info({
      leadId,
      entityType,
      phone: `${phone.slice(0, 4)}***`
    }, '[Bitrix24Sync] Searching for existing entity by phone');

    if (entityType === 'lead') {
      // Search for existing LEAD
      const existingLeads = await findByPhone(domain, accessToken, [phone], 'LEAD');
      app.log.debug({
        leadId,
        searchResult: existingLeads,
        foundCount: existingLeads.LEAD?.length || 0
      }, '[Bitrix24Sync] Lead search completed');

      if (existingLeads.LEAD && existingLeads.LEAD.length > 0) {
        // Found existing lead - link to it
        bitrix24LeadId = existingLeads.LEAD[0];
        linkedExisting = true;

        app.log.info({
          leadId,
          bitrix24LeadId,
          phone: `${phone.slice(0, 4)}***`
        }, '[Bitrix24Sync] Found existing Bitrix24 lead - linking');

        await logSync({
          userAccountId,
          accountId,
          leadId,
          bitrix24LeadId,
          syncType: 'link_existing',
          syncStatus: 'success',
          responseJson: { linkedLeadId: bitrix24LeadId }
        });
      }
    } else {
      // Search for existing CONTACT (for deal mode)
      const existingContacts = await findByPhone(domain, accessToken, [phone], 'CONTACT');
      app.log.debug({
        leadId,
        searchResult: existingContacts,
        foundCount: existingContacts.CONTACT?.length || 0
      }, '[Bitrix24Sync] Contact search completed');

      if (existingContacts.CONTACT && existingContacts.CONTACT.length > 0) {
        bitrix24ContactId = existingContacts.CONTACT[0];
        app.log.info({
          leadId,
          bitrix24ContactId,
          phone: `${phone.slice(0, 4)}***`
        }, '[Bitrix24Sync] Found existing Bitrix24 contact');
      }
    }

    // 5. Create entities if not found
    if (!linkedExisting) {
      const { NAME, LAST_NAME } = extractName(displayName);
      app.log.debug({ NAME, LAST_NAME }, '[Bitrix24Sync] Name extracted');

      if (entityType === 'lead') {
        // Create Bitrix24 Lead
        const leadFields: Partial<Bitrix24Lead> = {
          TITLE: `Лид: ${displayName}`,
          NAME,
          LAST_NAME,
          PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
          SOURCE_ID: 'WEB',
          SOURCE_DESCRIPTION: 'Facebook Lead Forms',
          UTM_SOURCE: lead.utm_source || undefined,
          UTM_MEDIUM: lead.utm_medium || undefined,
          UTM_CAMPAIGN: lead.utm_campaign || undefined,
          UTM_CONTENT: lead.utm_content || undefined,
          UTM_TERM: lead.utm_term || undefined,
          COMMENTS: lead.email ? `Email: ${lead.email}` : undefined
        };

        // Apply default lead status if configured
        if (defaultStageSettings.leadStatus) {
          leadFields.STATUS_ID = defaultStageSettings.leadStatus;
          app.log.debug({ statusId: defaultStageSettings.leadStatus }, '[Bitrix24Sync] Applying default lead status');
        }

        app.log.info({
          leadId,
          title: leadFields.TITLE,
          statusId: leadFields.STATUS_ID
        }, '[Bitrix24Sync] Creating Bitrix24 lead');

        bitrix24LeadId = await createBitrix24Lead(domain, accessToken, leadFields);

        app.log.info({
          leadId,
          bitrix24LeadId,
          elapsedMs: Date.now() - syncStartTime
        }, '[Bitrix24Sync] Bitrix24 lead created successfully');

        await logSync({
          userAccountId,
          accountId,
          leadId,
          bitrix24LeadId,
          syncType: 'lead_to_bitrix24',
          syncStatus: 'success',
          requestJson: leadFields,
          responseJson: { id: bitrix24LeadId }
        });

      } else {
        // Create Contact (if not exists) then Deal
        if (!bitrix24ContactId) {
          const contactFields: Partial<Bitrix24Contact> = {
            NAME,
            LAST_NAME,
            PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
            SOURCE_ID: 'WEB'
          };

          if (lead.email) {
            contactFields.EMAIL = [{ VALUE: lead.email, VALUE_TYPE: 'WORK' }];
          }

          app.log.info({ leadId, name: NAME }, '[Bitrix24Sync] Creating Bitrix24 contact');

          bitrix24ContactId = await createBitrix24Contact(domain, accessToken, contactFields);

          app.log.info({
            leadId,
            bitrix24ContactId,
            elapsedMs: Date.now() - syncStartTime
          }, '[Bitrix24Sync] Bitrix24 contact created successfully');

          await logSync({
            userAccountId,
            accountId,
            leadId,
            bitrix24ContactId,
            syncType: 'contact_to_bitrix24',
            syncStatus: 'success',
            requestJson: contactFields,
            responseJson: { id: bitrix24ContactId }
          });
        }

        // Create Deal linked to Contact
        const dealFields: Partial<Bitrix24Deal> = {
          TITLE: `Сделка: ${displayName}`,
          CONTACT_ID: String(bitrix24ContactId),
          SOURCE_ID: 'WEB',
          SOURCE_DESCRIPTION: 'Facebook Lead Forms',
          UTM_SOURCE: lead.utm_source || undefined,
          UTM_MEDIUM: lead.utm_medium || undefined,
          UTM_CAMPAIGN: lead.utm_campaign || undefined,
          UTM_CONTENT: lead.utm_content || undefined,
          UTM_TERM: lead.utm_term || undefined,
          COMMENTS: lead.email ? `Email: ${lead.email}` : undefined
        };

        // Apply default deal pipeline and stage if configured
        if (defaultStageSettings.dealCategory !== null) {
          dealFields.CATEGORY_ID = String(defaultStageSettings.dealCategory);
          app.log.debug({ categoryId: defaultStageSettings.dealCategory }, '[Bitrix24Sync] Applying default deal category');
        }
        if (defaultStageSettings.dealStage) {
          dealFields.STAGE_ID = defaultStageSettings.dealStage;
          app.log.debug({ stageId: defaultStageSettings.dealStage }, '[Bitrix24Sync] Applying default deal stage');
        }

        app.log.info({
          leadId,
          title: dealFields.TITLE,
          contactId: bitrix24ContactId,
          categoryId: dealFields.CATEGORY_ID,
          stageId: dealFields.STAGE_ID
        }, '[Bitrix24Sync] Creating Bitrix24 deal');

        bitrix24DealId = await createBitrix24Deal(domain, accessToken, dealFields);

        app.log.info({
          leadId,
          bitrix24DealId,
          bitrix24ContactId,
          elapsedMs: Date.now() - syncStartTime
        }, '[Bitrix24Sync] Bitrix24 deal created successfully');

        await logSync({
          userAccountId,
          accountId,
          leadId,
          bitrix24DealId,
          bitrix24ContactId,
          syncType: 'deal_to_bitrix24',
          syncStatus: 'success',
          requestJson: dealFields,
          responseJson: { id: bitrix24DealId }
        });
      }
    }

    // 6. Update our database with Bitrix24 IDs
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (bitrix24LeadId) {
      updateData.bitrix24_lead_id = bitrix24LeadId;
    }
    if (bitrix24DealId) {
      updateData.bitrix24_deal_id = bitrix24DealId;
    }
    if (bitrix24ContactId) {
      updateData.bitrix24_contact_id = bitrix24ContactId;
    }

    app.log.debug({ leadId, updateData }, '[Bitrix24Sync] Updating local database with Bitrix24 IDs');

    const { error: updateError } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', leadId);

    if (updateError) {
      app.log.error({ leadId, updateError }, '[Bitrix24Sync] Failed to update local database');
      // Don't throw - the sync to Bitrix24 was successful
    }

    const totalElapsedMs = Date.now() - syncStartTime;

    app.log.info({
      leadId,
      bitrix24LeadId,
      bitrix24DealId,
      bitrix24ContactId,
      linkedExisting,
      totalElapsedMs,
      retryCount
    }, '[Bitrix24Sync] Lead synced to Bitrix24 successfully');

  } catch (error: any) {
    const totalElapsedMs = Date.now() - syncStartTime;

    app.log.error({
      error: error.message,
      errorCode: error.code,
      errorStack: error.stack?.split('\n').slice(0, 3).join('\n'),
      leadId,
      userAccountId,
      accountId,
      retryCount,
      totalElapsedMs
    }, '[Bitrix24Sync] Failed to sync lead to Bitrix24');

    // Retry logic for transient errors
    if (isRetryableError(error) && retryCount < MAX_RETRIES) {
      app.log.warn({
        leadId,
        retryCount: retryCount + 1,
        maxRetries: MAX_RETRIES,
        delayMs: RETRY_DELAY_MS
      }, '[Bitrix24Sync] Retrying after transient error');

      await sleep(RETRY_DELAY_MS * (retryCount + 1)); // Exponential backoff
      return syncLeadToBitrix24(leadId, userAccountId, accountId, app, retryCount + 1);
    }

    await logSync({
      userAccountId,
      accountId,
      leadId,
      syncType: 'lead_to_bitrix24',
      syncStatus: 'failed',
      errorMessage: error.message,
      errorCode: error.code
    });

    throw error;
  }
}

/**
 * Check if Bitrix24 auto-create is enabled for the account
 *
 * @param userAccountId - User account UUID
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Object with enabled flag
 */
export async function checkBitrix24AutoCreate(
  userAccountId: string,
  accountId: string | null
): Promise<{ enabled: boolean }> {
  try {
    // Check if multi-account mode is enabled
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('multi_account_enabled, bitrix24_auto_create_leads, bitrix24_domain')
      .eq('id', userAccountId)
      .single();

    if (!userAccount) {
      return { enabled: false };
    }

    const isMultiAccountMode = userAccount.multi_account_enabled && accountId;

    if (isMultiAccountMode) {
      // Multi-account mode: check ad_accounts
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('bitrix24_auto_create_leads, bitrix24_domain')
        .eq('id', accountId)
        .eq('user_account_id', userAccountId)
        .single();

      if (!adAccount || !adAccount.bitrix24_domain) {
        return { enabled: false };
      }

      return { enabled: adAccount.bitrix24_auto_create_leads === true };
    }

    // Legacy mode: check user_accounts
    if (!userAccount.bitrix24_domain) {
      return { enabled: false };
    }

    return { enabled: userAccount.bitrix24_auto_create_leads === true };

  } catch (error) {
    console.error('Error checking Bitrix24 auto-create setting:', error);
    return { enabled: false };
  }
}
