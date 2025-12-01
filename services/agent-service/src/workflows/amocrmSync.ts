/**
 * AmoCRM Synchronization Workflow
 *
 * Handles syncing leads and deals between our system and AmoCRM
 *
 * @module workflows/amocrmSync
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getValidAmoCRMToken } from '../lib/amocrmTokens.js';
import {
  findContactByPhone,
  createContact,
  createLead,
  getLead,
  getContact,
  extractPhoneFromContact,
  AmoCRMContact,
  AmoCRMLead,
  AmoCRMCustomFieldValue
} from '../adapters/amocrm.js';

/**
 * Normalize phone number to standard format
 * Removes all non-digit characters except leading +
 *
 * @param phone - Raw phone number
 * @returns Normalized phone number
 */
function normalizePhone(phone: string): string {
  // Remove all non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, '');

  // If starts with 8, replace with +7 (Russia)
  if (normalized.startsWith('8')) {
    normalized = '+7' + normalized.substring(1);
  }

  // If starts with 7 (not +7), add +
  if (normalized.startsWith('7') && !normalized.startsWith('+7')) {
    normalized = '+' + normalized;
  }

  // If doesn't start with +, add it
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  return normalized;
}

/**
 * Extract name from various formats
 *
 * @param name - Name string (can be "First Last" or just "First")
 * @returns Object with first_name and last_name
 */
function extractName(name: string): { first_name: string; last_name?: string } {
  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return { first_name: parts[0] };
  }

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' ')
  };
}

/**
 * Log sync operation to amocrm_sync_log table
 */
async function logSync(data: {
  userAccountId: string;
  leadId?: number;
  saleId?: string;
  amocrmLeadId?: number;
  amocrmContactId?: number;
  amocrmDealId?: number;
  syncType: 'lead_to_amocrm' | 'contact_to_amocrm' | 'deal_from_amocrm' | 'lead_from_amocrm';
  syncStatus: 'success' | 'failed' | 'pending' | 'retrying';
  requestJson?: any;
  responseJson?: any;
  errorMessage?: string;
  errorCode?: string;
}) {
  try {
    await supabase.from('amocrm_sync_log').insert({
      user_account_id: data.userAccountId,
      lead_id: data.leadId || null,
      sale_id: data.saleId || null,
      amocrm_lead_id: data.amocrmLeadId || null,
      amocrm_contact_id: data.amocrmContactId || null,
      amocrm_deal_id: data.amocrmDealId || null,
      sync_type: data.syncType,
      sync_status: data.syncStatus,
      request_json: data.requestJson || null,
      response_json: data.responseJson || null,
      error_message: data.errorMessage || null,
      error_code: data.errorCode || null,
      retry_count: 0
    });
  } catch (error) {
    console.error('Failed to log sync operation:', error);
  }
}

/**
 * Sync a lead from our system to AmoCRM
 *
 * Steps:
 * 1. Get valid AmoCRM token
 * 2. Find or create contact by phone
 * 3. Create lead with UTM tracking
 * 4. Update our database with AmoCRM IDs
 *
 * @param leadId - Our internal lead ID
 * @param userAccountId - User account UUID
 * @param app - Fastify instance for logging
 */
export async function syncLeadToAmoCRM(
  leadId: number,
  userAccountId: string,
  app: FastifyInstance
): Promise<void> {
  try {
    app.log.info({ leadId, userAccountId }, 'Starting AmoCRM lead sync');

    // 1. Get lead from database
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    // Check if already synced
    if (lead.amocrm_lead_id) {
      app.log.info({ leadId, amocrmLeadId: lead.amocrm_lead_id }, 'Lead already synced to AmoCRM');
      return;
    }

    // 2. Get valid token
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);

    // 3. Extract contact info
    // For website/manual leads use phone field, for WhatsApp use chat_id
    let phone: string | null = null;
    let displayName: string = 'Лид';

    if (lead.source_type === 'website' || lead.source_type === 'manual') {
      // Website lead - use phone and name fields directly
      phone = lead.phone ? normalizePhone(lead.phone) : null;
      displayName = lead.name || 'Лид с сайта';
    } else {
      // WhatsApp lead - extract from chat_id
      phone = lead.chat_id 
        ? normalizePhone(lead.chat_id.replace('@s.whatsapp.net', '').replace('@c.us', ''))
        : null;
      displayName = lead.chat_id || 'Лид';
    }

    if (!phone) {
      throw new Error('Lead has no phone number');
    }

    // 4. Find or create contact
    let contact = await findContactByPhone(phone, subdomain, accessToken);
    let contactId: number;

    if (!contact) {
      // Create new contact
      const { first_name, last_name } = extractName(displayName);

      const newContact: AmoCRMContact = {
        name: `${first_name}${last_name ? ' ' + last_name : ''}`,
        first_name,
        last_name,
        custom_fields_values: [
          {
            field_code: 'PHONE',
            values: [{ value: phone }]
          }
        ]
      };

      contact = await createContact(newContact, subdomain, accessToken);
      contactId = contact.id!;

      app.log.info({ contactId, phone }, 'Created new AmoCRM contact');

      await logSync({
        userAccountId,
        leadId,
        amocrmContactId: contactId,
        syncType: 'contact_to_amocrm',
        syncStatus: 'success',
        requestJson: newContact,
        responseJson: contact
      });
    } else {
      contactId = contact.id!;
      app.log.info({ contactId, phone }, 'Found existing AmoCRM contact');
    }

    // 5. Build custom fields with UTM data
    const customFields: AmoCRMCustomFieldValue[] = [];

    // Note: You'll need to get actual field IDs from your AmoCRM account
    // For now, we'll just include them in the lead name
    const leadName = lead.utm_campaign
      ? `Лид: ${lead.utm_campaign}`
      : `Лид с сайта от ${new Date().toLocaleDateString('ru-RU')}`;

    // 6. Create lead in AmoCRM
    const amocrmLead: AmoCRMLead = {
      name: leadName,
      price: 0, // Can be set based on direction or creative value
      custom_fields_values: customFields,
      _embedded: {
        contacts: [
          {
            id: contactId
          }
        ]
      }
    };

    // Add UTM as tags (alternative to custom fields)
    const tags: string[] = [];
    if (lead.utm_source) tags.push(`utm_source:${lead.utm_source}`);
    if (lead.utm_medium) tags.push(`utm_medium:${lead.utm_medium}`);
    if (lead.utm_campaign) tags.push(`utm_campaign:${lead.utm_campaign}`);
    if (lead.utm_term) tags.push(`utm_term:${lead.utm_term}`);
    if (lead.utm_content) tags.push(`utm_content:${lead.utm_content}`);

    if (tags.length > 0) {
      amocrmLead._embedded = {
        ...amocrmLead._embedded,
        tags: tags.map(name => ({ name })) as any
      };
    }

    const createdLead = await createLead(amocrmLead, subdomain, accessToken);
    const amocrmLeadId = createdLead.id!;

    app.log.info({ leadId, amocrmLeadId, contactId }, 'Created AmoCRM lead');

    // 7. Update our database
    await supabase
      .from('leads')
      .update({
        amocrm_lead_id: amocrmLeadId,
        amocrm_contact_id: contactId,
        updated_at: new Date().toISOString()
      })
      .eq('id', leadId);

    // 8. Log success
    await logSync({
      userAccountId,
      leadId,
      amocrmLeadId,
      amocrmContactId: contactId,
      syncType: 'lead_to_amocrm',
      syncStatus: 'success',
      requestJson: amocrmLead,
      responseJson: createdLead
    });

    app.log.info({ leadId, amocrmLeadId }, 'Lead synced to AmoCRM successfully');

  } catch (error: any) {
    app.log.error({ error, leadId, userAccountId }, 'Failed to sync lead to AmoCRM');

    await logSync({
      userAccountId,
      leadId,
      syncType: 'lead_to_amocrm',
      syncStatus: 'failed',
      errorMessage: error.message,
      errorCode: error.code
    });

    throw error;
  }
}

/**
 * Process AmoCRM deal webhook
 *
 * When a deal is created/updated in AmoCRM:
 * 1. Find corresponding lead by AmoCRM lead ID or phone
 * 2. Extract deal details (amount, status, etc.)
 * 3. Create/update sale record in our database
 *
 * @param dealData - Deal data from AmoCRM webhook
 * @param userAccountId - User account UUID
 * @param app - Fastify instance for logging
 */
export async function processDealWebhook(
  dealData: any,
  userAccountId: string,
  app: FastifyInstance
): Promise<void> {
  try {
    app.log.info({ dealData, userAccountId }, 'Processing AmoCRM deal webhook');

    const dealId = dealData.id;
    const dealStatus = dealData.status_id;
    const amount = dealData.price || 0;
    const pipelineId = dealData.pipeline_id;

    // Get embedded data
    const leadId = dealData.lead_id || dealData._embedded?.leads?.[0]?.id;
    const contacts = dealData._embedded?.contacts || [];

    // 1. Find our lead by AmoCRM lead ID
    let ourLead = null;

    if (leadId) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('amocrm_lead_id', leadId)
        .eq('user_account_id', userAccountId)
        .maybeSingle();

      ourLead = data;
    }

    // 2. If not found by lead ID, try to find by phone
    if (!ourLead && contacts.length > 0) {
      for (const contact of contacts) {
        const phones = contact.custom_fields_values?.find(
          (f: any) => f.field_code === 'PHONE'
        );

        if (phones?.values?.[0]?.value) {
          const phone = normalizePhone(phones.values[0].value);

          const { data } = await supabase
            .from('leads')
            .select('*')
            .eq('user_account_id', userAccountId)
            .or(`chat_id.ilike.%${phone}%`)
            .limit(1)
            .maybeSingle();

          if (data) {
            ourLead = data;
            break;
          }
        }
      }
    }

    if (!ourLead) {
      app.log.warn({ dealId, leadId }, 'Could not find corresponding lead for deal');

      await logSync({
        userAccountId,
        amocrmDealId: dealId,
        syncType: 'deal_from_amocrm',
        syncStatus: 'failed',
        errorMessage: 'Lead not found',
        requestJson: dealData
      });

      return;
    }

    // 3. Create or update purchase record (using purchases table instead of sales)
    const { data: existingPurchase } = await supabase
      .from('purchases')
      .select('id')
      .eq('amocrm_deal_id', dealId)
      .maybeSingle();

    // Extract client info based on lead source type
    let clientPhone = '';
    
    if (ourLead.source_type === 'website' || ourLead.source_type === 'manual') {
      clientPhone = ourLead.phone || '';
    } else {
      clientPhone = ourLead.chat_id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || '';
    }

    const purchaseData = {
      client_phone: clientPhone,
      amount: amount, // No division by 100
      currency: 'KZT', // Default to KZT
      purchase_date: new Date().toISOString(),
      amocrm_deal_id: dealId,
      amocrm_pipeline_id: pipelineId,
      amocrm_status_id: dealStatus,
      user_account_id: userAccountId,
      account_id: ourLead.account_id || null,  // UUID для мультиаккаунтности
      updated_at: new Date().toISOString()
    };

    if (existingPurchase) {
      // Update existing purchase
      await supabase
        .from('purchases')
        .update(purchaseData)
        .eq('id', existingPurchase.id);

      app.log.info({ purchaseId: existingPurchase.id, dealId }, 'Updated purchase from AmoCRM deal');
    } else {
      // Create new purchase only if meaningful (amount > 0 or Won status)
      if (amount > 0 || dealStatus === 142) {
        const { data: newPurchase } = await supabase
          .from('purchases')
          .insert({
            ...purchaseData,
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        app.log.info({ purchaseId: newPurchase?.id, dealId }, 'Created purchase from AmoCRM deal');
      }
    }

    // 4. Log success
    await logSync({
      userAccountId,
      leadId: ourLead.id,
      amocrmDealId: dealId,
      amocrmLeadId: leadId,
      syncType: 'deal_from_amocrm',
      syncStatus: 'success',
      requestJson: dealData
    });

  } catch (error: any) {
    app.log.error({ error, dealData, userAccountId }, 'Failed to process deal webhook');

    await logSync({
      userAccountId,
      amocrmDealId: dealData.id,
      syncType: 'deal_from_amocrm',
      syncStatus: 'failed',
      errorMessage: error.message,
      errorCode: error.code,
      requestJson: dealData
    });

    throw error;
  }
}

/**
 * Process lead status change webhook (status_lead event)
 * 
 * Updates lead's current pipeline/status and qualification status
 * Records change in history table
 * 
 * @param statusChange - Status change data from webhook
 * @param userAccountId - User account UUID
 * @param app - Fastify instance for logging
 */
export async function processLeadStatusChange(
  statusChange: any,
  userAccountId: string,
  app: FastifyInstance
): Promise<void> {
  try {
    const amocrmLeadId = statusChange.id;
    const oldPipelineId = statusChange.old_pipeline_id;
    const newPipelineId = statusChange.pipeline_id;
    const oldStatusId = statusChange.old_status_id;
    const newStatusId = statusChange.status_id;

    app.log.info({
      amocrmLeadId,
      oldStatusId,
      newStatusId,
      oldPipelineId,
      newPipelineId,
      userAccountId
    }, 'Processing lead status change');

    // 1. Find our lead by amocrm_lead_id
    let { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('amocrm_lead_id', amocrmLeadId)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    if (leadError) {
      throw new Error(`Error finding lead: ${leadError.message}`);
    }

    // 2. If not found by amocrm_lead_id, try to find by phone number
    if (!lead) {
      app.log.info({ amocrmLeadId }, 'Lead not found by amocrm_lead_id, trying to find by phone');
      
      try {
        const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);
        const amocrmLead = await getLead(amocrmLeadId, subdomain, accessToken);
        
        // Get phone from contact
        const contactId = amocrmLead._embedded?.contacts?.[0]?.id;
        if (contactId) {
          const contact = await getContact(contactId, subdomain, accessToken);
          const rawPhone = extractPhoneFromContact(contact);
          
          if (rawPhone) {
            const normalizedPhone = normalizePhone(rawPhone);
            
            app.log.info({ 
              amocrmLeadId, 
              contactId, 
              normalizedPhone 
            }, 'Found phone for lead, searching in local database');
            
            // Search by phone or chat_id containing phone
            const { data: foundLead } = await supabase
              .from('leads')
              .select('*')
              .eq('user_account_id', userAccountId)
              .or(`phone.eq.${normalizedPhone},chat_id.like.%${normalizedPhone}%`)
              .maybeSingle();
            
            if (foundLead) {
              lead = foundLead;
              
              // Update amocrm_lead_id for future webhook processing
              await supabase
                .from('leads')
                .update({ amocrm_lead_id: amocrmLeadId })
                .eq('id', foundLead.id);
              
              app.log.info({ 
                leadId: foundLead.id, 
                amocrmLeadId, 
                phone: normalizedPhone 
              }, 'Found lead by phone and linked amocrm_lead_id');
            }
          }
        }
      } catch (error: any) {
        app.log.warn({ 
          error: error.message, 
          amocrmLeadId 
        }, 'Failed to find lead by phone');
      }
    }

    if (!lead) {
      app.log.info({
        amocrmLeadId,
        userAccountId
      }, 'Lead not found in local database - skipping');
      return;
    }

    // 2. Check if new status is qualified
    const { data: stageData } = await supabase
      .from('amocrm_pipeline_stages')
      .select('is_qualified_stage')
      .eq('user_account_id', userAccountId)
      .eq('pipeline_id', newPipelineId)
      .eq('status_id', newStatusId)
      .maybeSingle();

    const isQualified = stageData?.is_qualified_stage || false;

    // 3. Update lead's current status and qualification
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        current_pipeline_id: newPipelineId,
        current_status_id: newStatusId,
        is_qualified: isQualified,
        updated_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    if (updateError) {
      throw new Error(`Failed to update lead status: ${updateError.message}`);
    }

    app.log.info({
      leadId: lead.id,
      amocrmLeadId,
      newStatusId,
      isQualified
    }, 'Updated lead status and qualification');

    // 3b. Check if lead reached any of the 3 key stages (once qualified, always qualified)
    // Get direction with all 3 key stages
    const { data: direction } = await supabase
      .from('account_directions')
      .select(`
        key_stage_1_pipeline_id, key_stage_1_status_id,
        key_stage_2_pipeline_id, key_stage_2_status_id,
        key_stage_3_pipeline_id, key_stage_3_status_id
      `)
      .eq('id', lead.direction_id)
      .maybeSingle();

    if (direction) {
      const updateFlags: Record<string, any> = {};

      // Check each of the 3 key stages
      for (let stageNum = 1; stageNum <= 3; stageNum++) {
        const reachedFlagKey = `reached_key_stage_${stageNum}`;
        const pipelineIdKey = `key_stage_${stageNum}_pipeline_id`;
        const statusIdKey = `key_stage_${stageNum}_status_id`;

        // Skip if already reached this stage (performance optimization)
        if ((lead as any)[reachedFlagKey] === true) {
          continue;
        }

        const keyPipelineId = (direction as any)[pipelineIdKey];
        const keyStatusId = (direction as any)[statusIdKey];

        // Skip if this key stage is not configured
        if (!keyPipelineId || !keyStatusId) {
          continue;
        }

        // Check if lead reached this key stage
        if (keyPipelineId === newPipelineId && keyStatusId === newStatusId) {
          updateFlags[reachedFlagKey] = true;
          app.log.info({
            leadId: lead.id,
            amocrmLeadId,
            stageNum,
            pipelineId: newPipelineId,
            statusId: newStatusId
          }, `Lead reached key stage ${stageNum} - setting flag`);
        }
      }

      // Update flags if any changed
      if (Object.keys(updateFlags).length > 0) {
        updateFlags.updated_at = new Date().toISOString();
        const { error: keyStageError } = await supabase
          .from('leads')
          .update(updateFlags)
          .eq('id', lead.id);

        if (keyStageError) {
          app.log.error({
            error: keyStageError.message,
            leadId: lead.id
          }, 'Failed to set reached_key_stage flags - continuing anyway');
        }
      }
    }

    // 4. Record status change in history
    const { error: historyError } = await supabase
      .from('amocrm_lead_status_history')
      .insert({
        lead_id: lead.id,
        amocrm_lead_id: amocrmLeadId,
        from_pipeline_id: oldPipelineId,
        to_pipeline_id: newPipelineId,
        from_status_id: oldStatusId,
        to_status_id: newStatusId,
        webhook_data: statusChange,
        changed_at: new Date().toISOString()
      });

    if (historyError) {
      app.log.error({
        error: historyError.message,
        leadId: lead.id
      }, 'Failed to record status history - continuing anyway');
    }

    // 5. If moved to won/lost status, also update sales
    if (newStatusId === 142 || newStatusId === 143) {
      // Status 142 = won, 143 = lost
      await handleDealClosureFromStatusChange(
        amocrmLeadId,
        newStatusId,
        userAccountId,
        app
      );
    }

  } catch (error: any) {
    app.log.error({
      error: error.message,
      statusChange,
      userAccountId
    }, 'Error processing lead status change');
    throw error;
  }
}

/**
 * Handle deal closure when status changes to won (142) or lost (143)
 * 
 * @param amocrmLeadId - AmoCRM lead ID
 * @param statusId - New status ID (142 or 143)
 * @param userAccountId - User account UUID
 * @param app - Fastify instance for logging
 */
async function handleDealClosureFromStatusChange(
  amocrmLeadId: number,
  statusId: number,
  userAccountId: string,
  app: FastifyInstance
): Promise<void> {
  try {
    // Get full lead data from amoCRM to get price and contacts
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);
    const amocrmLead = await getLead(amocrmLeadId, subdomain, accessToken);

    // Find our lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('amocrm_lead_id', amocrmLeadId)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    if (!lead) {
      app.log.warn({ amocrmLeadId }, 'Lead not found for deal closure');
      return;
    }

    // Extract client info
    let clientPhone = '';
    let clientName = 'Unknown';
    
    if (lead.source_type === 'website' || lead.source_type === 'manual') {
      clientPhone = lead.phone || '';
      clientName = lead.name || 'Клиент с сайта';
    } else {
      clientPhone = lead.chat_id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || '';
      clientName = lead.chat_id || 'Unknown';
    }

    // If no phone yet, try to get from amoCRM contacts
    if (!clientPhone && amocrmLead._embedded?.contacts?.[0]) {
      const contactId = amocrmLead._embedded.contacts[0].id;
      if (contactId) {
        const contact = await getContact(contactId, subdomain, accessToken);
        const phone = extractPhoneFromContact(contact);
        if (phone) {
          clientPhone = phone;
        }
      }
    }

    const amount = amocrmLead.price || 0;
    const status = statusId === 142 ? 'paid' : 'pending'; // 142 = won

    // Create or update sale
    const { data: existingSale } = await supabase
      .from('sales')
      .select('*')
      .eq('amocrm_deal_id', amocrmLeadId)
      .maybeSingle();

    const saleData = {
      client_phone: clientPhone,
      client_name: clientName,
      amount: amount / 100, // Convert cents if needed
      currency: 'RUB',
      status,
      sale_date: new Date().toISOString().split('T')[0],
      amocrm_deal_id: amocrmLeadId,
      amocrm_pipeline_id: amocrmLead.pipeline_id,
      amocrm_status_id: statusId,
      created_by: userAccountId,
      account_id: lead.account_id || null,  // UUID для мультиаккаунтности, NULL для legacy
      updated_at: new Date().toISOString()
    };

    if (existingSale) {
      await supabase
        .from('sales')
        .update(saleData)
        .eq('id', existingSale.id);

      app.log.info({ saleId: existingSale.id, statusId }, 'Updated sale from status change');
    } else {
      const { data: newSale } = await supabase
        .from('sales')
        .insert({
          ...saleData,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      app.log.info({ saleId: newSale?.id, statusId }, 'Created sale from status change');
    }

  } catch (error: any) {
    app.log.error({
      error: error.message,
      amocrmLeadId,
      statusId
    }, 'Error handling deal closure from status change');
    // Don't throw - this is a secondary operation
  }
}
