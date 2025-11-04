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

    // 3. Create or update sale record
    const { data: existingSale } = await supabase
      .from('sales')
      .select('*')
      .eq('amocrm_deal_id', dealId)
      .maybeSingle();

    // Extract client info based on lead source type
    let clientPhone = '';
    let clientName = 'Unknown';
    
    if (ourLead.source_type === 'website' || ourLead.source_type === 'manual') {
      clientPhone = ourLead.phone || '';
      clientName = ourLead.name || 'Клиент с сайта';
    } else {
      clientPhone = ourLead.chat_id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || '';
      clientName = ourLead.chat_id || 'Unknown';
    }

    const saleData = {
      client_phone: clientPhone,
      client_name: clientName,
      amount: amount / 100, // Convert cents to rubles (if needed)
      currency: 'RUB',
      status: dealStatus === 142 ? 'paid' : 'pending', // 142 is typical "Won" status
      sale_date: new Date().toISOString().split('T')[0],
      amocrm_deal_id: dealId,
      amocrm_pipeline_id: pipelineId,
      amocrm_status_id: dealStatus,
      created_by: userAccountId,
      updated_at: new Date().toISOString()
    };

    if (existingSale) {
      // Update existing sale
      await supabase
        .from('sales')
        .update(saleData)
        .eq('id', existingSale.id);

      app.log.info({ saleId: existingSale.id, dealId }, 'Updated sale from AmoCRM deal');
    } else {
      // Create new sale
      const { data: newSale } = await supabase
        .from('sales')
        .insert({
          ...saleData,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      app.log.info({ saleId: newSale?.id, dealId }, 'Created sale from AmoCRM deal');
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
