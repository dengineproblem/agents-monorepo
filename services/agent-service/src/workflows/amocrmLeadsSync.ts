/**
 * AmoCRM Leads Synchronization
 * 
 * Синхронизирует статусы лидов из AmoCRM:
 * - Получает текущие status_id и pipeline_id для каждого лида
 * - Обновляет current_status_id, current_pipeline_id, is_qualified в таблице leads
 * 
 * @module workflows/amocrmLeadsSync
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getValidAmoCRMToken } from '../lib/amocrmTokens.js';

/**
 * Normalize phone number for comparison
 * Removes all non-digits and WhatsApp suffixes
 */
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  
  // Remove WhatsApp suffixes
  let cleaned = phone.replace(/@s\.whatsapp\.net|@c\.us/g, '');
  
  // Remove all non-digits
  cleaned = cleaned.replace(/\D/g, '');
  
  // Remove leading 8 and replace with 7 for Russian numbers
  if (cleaned.startsWith('8') && cleaned.length === 11) {
    cleaned = '7' + cleaned.substring(1);
  }
  
  return cleaned || null;
}

// OLD FUNCTIONS REMOVED - Now using direct search per lead
// This is much more efficient than downloading ALL leads/contacts from AmoCRM

/**
 * Qualification field configuration from user_accounts.amocrm_qualification_fields
 */
interface QualificationFieldConfig {
  field_id: number;
  field_name: string;
  field_type: 'checkbox' | 'select' | 'multiselect';
  enum_id?: number | null;
  enum_value?: string | null;
}

/**
 * Check if lead is qualified based on custom fields configuration
 * Lead is qualified if ANY of the configured fields matches
 * Supports both lead (deal) fields and contact fields
 *
 * @param amocrmLead - Full AmoCRM lead object (includes _embedded.contacts)
 * @param qualificationFields - array of qualification field configs
 * @returns true if lead is qualified
 */
function checkQualification(
  amocrmLead: any,
  qualificationFields: QualificationFieldConfig[]
): boolean {
  if (!qualificationFields || qualificationFields.length === 0) {
    return false;
  }

  // Collect all custom fields from lead AND contacts
  const allCustomFields: any[] = [];

  // Add lead's custom fields
  if (amocrmLead?.custom_fields_values && Array.isArray(amocrmLead.custom_fields_values)) {
    allCustomFields.push(...amocrmLead.custom_fields_values);
  }

  // Add contact's custom fields (contacts are in _embedded.contacts)
  const contacts = amocrmLead?._embedded?.contacts || [];
  for (const contact of contacts) {
    if (contact?.custom_fields_values && Array.isArray(contact.custom_fields_values)) {
      allCustomFields.push(...contact.custom_fields_values);
    }
  }

  if (allCustomFields.length === 0) {
    return false;
  }

  // Lead is qualified if ANY of the fields matches
  for (const config of qualificationFields) {
    const fieldValue = allCustomFields.find(
      (field: any) => field.field_id === config.field_id
    );

    if (!fieldValue || !fieldValue.values || fieldValue.values.length === 0) {
      continue;
    }

    const value = fieldValue.values[0];

    if (config.field_type === 'select' || config.field_type === 'multiselect') {
      // For select/multiselect: check if enum_id matches
      if (config.enum_id && value.enum_id === config.enum_id) {
        return true;
      }
    } else {
      // For checkbox (or null/undefined field_type for backward compatibility): check if value is true
      if (value.value === true) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sync result statistics
 */
export interface SyncLeadsResult {
  success: boolean;
  total: number;
  updated: number;
  errors: number;
  errorDetails?: Array<{ leadId: number; error: string }>;
}

/**
 * Синхронизирует статусы лидов из AmoCRM для указанного пользователя
 *
 * Логика:
 * 1. Получить все leads с amocrm_lead_id из базы данных
 * 2. Запросить актуальные данные лидов из AmoCRM (батчами по 250)
 * 3. Для каждого лида:
 *    - Получить status_id и pipeline_id
 *    - Проверить квалификацию через amocrm_pipeline_stages
 *    - Обновить current_status_id, current_pipeline_id, is_qualified в базе
 *
 * Supports both legacy mode (user_accounts) and multi-account mode (ad_accounts)
 *
 * @param userAccountId - UUID пользователя
 * @param app - Fastify instance для логирования
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Результат синхронизации
 */
export async function syncLeadsFromAmoCRM(
  userAccountId: string,
  app: FastifyInstance,
  accountId?: string | null
): Promise<SyncLeadsResult> {
  const log = app.log;
  const result: SyncLeadsResult = {
    success: true,
    total: 0,
    updated: 0,
    errors: 0,
    errorDetails: []
  };

  try {
    log.info({ userAccountId, accountId }, 'Starting AmoCRM leads sync');

    // 1. Get valid AmoCRM token (supports both legacy and multi-account mode)
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId, accountId);

    // 1.5 Check if custom qualification fields are configured (supports up to 3 fields)
    // For multi-account mode, check ad_accounts first
    let qualificationFieldsData: any = null;
    if (accountId) {
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', accountId)
        .maybeSingle();
      qualificationFieldsData = adAccount;
    }
    // Fallback to user_accounts
    if (!qualificationFieldsData) {
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', userAccountId)
        .maybeSingle();
      qualificationFieldsData = userAccount;
    }
    const userAccount = qualificationFieldsData;

    const qualificationFields: QualificationFieldConfig[] = userAccount?.amocrm_qualification_fields || [];
    if (qualificationFields.length > 0) {
      log.info({
        userAccountId,
        qualificationFieldsCount: qualificationFields.length,
        fields: qualificationFields.map(f => ({ id: f.field_id, type: f.field_type, enumId: f.enum_id }))
      }, 'Custom qualification fields configured');
    }

    // 2. Get all leads with phone numbers from database
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, phone, chat_id, amocrm_lead_id, current_status_id, current_pipeline_id, direction_id, name, source_type, account_id, is_qualified')
      .eq('user_account_id', userAccountId) as { data: Array<{
        id: any;
        phone: any;
        chat_id: any;
        amocrm_lead_id: any;
        current_status_id: any;
        current_pipeline_id: any;
        direction_id: any;
        name: any;
        source_type: any;
        account_id: string | null;
        is_qualified: boolean | null;
      }> | null, error: any };

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId }, 'No leads with amocrm_lead_id found');
      return result;
    }

    result.total = leads.length;
    log.info({ userAccountId, totalLeads: leads.length }, 'Found leads to sync');

    // NEW EFFICIENT APPROACH: Direct search for leads by phone across ALL pipelines
    // Instead of downloading ALL leads from AmoCRM, we search for each lead individually
    log.info({ userAccountId }, 'Starting efficient phone-by-phone sync (all pipelines)');

    const { findLeadsByPhone } = await import('../adapters/amocrm.js');

    // Get pipeline stages for qualification check
    const { data: pipelineStages, error: stagesError } = await supabase
      .from('amocrm_pipeline_stages')
      .select('status_id, is_qualified_stage')
      .eq('user_account_id', userAccountId);

    if (stagesError) {
      log.warn({ error: stagesError.message }, 'Failed to fetch pipeline stages, will not update is_qualified');
    }

    // Create map for qualification lookup
    const qualificationMap = new Map<number, boolean>();
    if (pipelineStages) {
      for (const stage of pipelineStages) {
        qualificationMap.set(stage.status_id, stage.is_qualified_stage);
      }
    }

    // Process each lead with direct AmoCRM search
    let notFoundCount = 0;
    const notFoundPhones: Array<{ leadId: number; rawPhone: string; normalizedPhone: string }> = [];

    // Track statistics by pipeline
    const pipelineStats = new Map<number, { count: number; pipelineName?: string }>();
    let multipleLeadsCount = 0;

    for (const localLead of leads) {
      try {
        // Normalize phone from our database
        const rawPhone = localLead.phone || localLead.chat_id;
        const ourPhone = normalizePhone(rawPhone);

        if (!ourPhone) {
          continue;
        }

        // Direct search for leads in AmoCRM by phone (searches ALL pipelines)
        let amocrmLeads: any[] = [];
        try {
          amocrmLeads = await findLeadsByPhone(rawPhone, subdomain, accessToken);
        } catch (error: any) {
          log.warn({
            leadId: localLead.id,
            phone: ourPhone,
            error: error.message
          }, 'Error searching leads in AmoCRM');
        }

        if (!amocrmLeads || amocrmLeads.length === 0) {
          notFoundCount++;
          notFoundPhones.push({
            leadId: localLead.id,
            rawPhone: rawPhone || '',
            normalizedPhone: ourPhone
          });

          // Log first 50 not found for debugging
          if (notFoundCount <= 50) {
            log.info({
              leadId: localLead.id,
              rawPhone: rawPhone,
              normalizedPhone: ourPhone
            }, 'Leads not found in AmoCRM by phone');
          }
          continue;
        }

        // Take the first lead (or most recent if multiple)
        // Sort by created_at descending to get most recent lead
        const sortedLeads = amocrmLeads.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const amocrmLeadFromContact = sortedLeads[0];

        // Log if multiple leads found
        if (amocrmLeads.length > 1) {
          multipleLeadsCount++;
          log.info({
            leadId: localLead.id,
            phone: ourPhone,
            foundLeadsCount: amocrmLeads.length,
            pipelines: amocrmLeads.map(l => l.pipeline_id)
          }, 'Multiple leads found for phone, using most recent');
        }

        const newAmoCRMLeadId = amocrmLeadFromContact.id;
        const newStatusId = amocrmLeadFromContact.status_id;
        const newPipelineId = amocrmLeadFromContact.pipeline_id;

        // Update pipeline statistics
        if (newPipelineId) {
          const current = pipelineStats.get(newPipelineId) || { count: 0 };
          current.count++;
          pipelineStats.set(newPipelineId, current);
        }

        // Determine qualification based on custom fields or pipeline stage
        let isQualified = false;

        if (qualificationFields.length > 0) {
          // Use custom fields for qualification (supports checkbox, select, multiselect)
          // Supports both lead fields AND contact fields

          // Fetch full contact data if lead has linked contacts
          const linkedContacts = amocrmLeadFromContact._embedded?.contacts || [];
          const contactsWithFields: any[] = [];

          if (linkedContacts.length > 0) {
            const { getContact } = await import('../adapters/amocrm.js');
            for (const contactRef of linkedContacts) {
              try {
                const fullContact = await getContact(contactRef.id, subdomain, accessToken);
                if (fullContact?.custom_fields_values) {
                  contactsWithFields.push(fullContact);
                }
              } catch (e) {
                // Skip if contact fetch fails
              }
            }
          }

          // Create enriched lead object with full contact data
          const enrichedLead = {
            ...amocrmLeadFromContact,
            _embedded: {
              ...amocrmLeadFromContact._embedded,
              contacts: contactsWithFields
            }
          };

          isQualified = checkQualification(enrichedLead, qualificationFields);
        } else {
          // Fallback to pipeline stage qualification
          isQualified = qualificationMap.get(newStatusId!) || false;
        }

        // Only update if something changed (include is_qualified to catch contact field changes)
        const needsUpdate =
          localLead.current_status_id !== newStatusId ||
          localLead.current_pipeline_id !== newPipelineId ||
          localLead.amocrm_lead_id !== newAmoCRMLeadId ||
          localLead.is_qualified !== isQualified;

        if (!needsUpdate) {
          continue;
        }

        const { error: updateError } = await supabase
          .from('leads')
          .update({
            amocrm_lead_id: newAmoCRMLeadId,
            current_status_id: newStatusId,
            current_pipeline_id: newPipelineId,
            is_qualified: isQualified,
            updated_at: new Date().toISOString()
          })
          .eq('id', localLead.id);

        if (updateError) {
          log.error({
            error: updateError.message,
            leadId: localLead.id
          }, 'Failed to update lead');

          result.errors++;
          result.errorDetails?.push({
            leadId: localLead.id,
            error: updateError.message
          });
        } else {
          result.updated++;

          log.debug({
            leadId: localLead.id,
            oldStatus: localLead.current_status_id,
            newStatus: newStatusId,
            oldPipeline: localLead.current_pipeline_id,
            newPipeline: newPipelineId,
            isQualified
          }, 'Lead updated successfully');

          // Check if lead reached any of the 3 key stages (once qualified, always qualified)
          // Get full lead data to check reached_key_stage_N flags and direction_id
          const { data: fullLead } = await supabase
            .from('leads')
            .select('reached_key_stage_1, reached_key_stage_2, reached_key_stage_3, direction_id')
            .eq('id', localLead.id)
            .maybeSingle();

          if (fullLead) {
            // Get direction with all 3 key stages
            const { data: direction } = await supabase
              .from('account_directions')
              .select(`
                key_stage_1_pipeline_id, key_stage_1_status_id,
                key_stage_2_pipeline_id, key_stage_2_status_id,
                key_stage_3_pipeline_id, key_stage_3_status_id
              `)
              .eq('id', fullLead.direction_id)
              .maybeSingle();

            if (direction) {
              const updateFlags: Record<string, any> = {};

              // Check each of the 3 key stages
              for (let stageNum = 1; stageNum <= 3; stageNum++) {
                const reachedFlagKey = `reached_key_stage_${stageNum}`;
                const pipelineIdKey = `key_stage_${stageNum}_pipeline_id`;
                const statusIdKey = `key_stage_${stageNum}_status_id`;

                // Skip if already reached this stage
                if ((fullLead as any)[reachedFlagKey] === true) {
                  continue;
                }

                const keyPipelineId = (direction as any)[pipelineIdKey];
                const keyStatusId = (direction as any)[statusIdKey];

                // Skip if this key stage is not configured
                if (!keyPipelineId || !keyStatusId) {
                  continue;
                }

                // Check if currently on this key stage
                if (keyPipelineId === newPipelineId && keyStatusId === newStatusId) {
                  updateFlags[reachedFlagKey] = true;
                  log.info({
                    leadId: localLead.id,
                    stageNum,
                    pipelineId: newPipelineId,
                    statusId: newStatusId
                  }, `Lead currently on key stage ${stageNum} - setting flag`);
                } else {
                  // Check if lead was ever on this key stage (check history)
                  const { data: history } = await supabase
                    .from('amocrm_lead_status_history')
                    .select('to_pipeline_id, to_status_id')
                    .eq('lead_id', localLead.id)
                    .eq('to_pipeline_id', keyPipelineId)
                    .eq('to_status_id', keyStatusId)
                    .limit(1)
                    .maybeSingle();

                  if (history) {
                    updateFlags[reachedFlagKey] = true;
                    log.info({
                      leadId: localLead.id,
                      stageNum,
                      pipelineId: newPipelineId,
                      statusId: newStatusId
                    }, `Lead reached key stage ${stageNum} in history - setting flag`);
                  }
                }
              }

              // Update flags if any changed
              if (Object.keys(updateFlags).length > 0) {
                updateFlags.updated_at = new Date().toISOString();
                await supabase
                  .from('leads')
                  .update(updateFlags)
                  .eq('id', localLead.id);
              }
            }
          }
        }

      } catch (error: any) {
        log.error({ 
          error: error.message, 
          leadId: localLead.id 
        }, 'Error processing lead');
        
        result.errors++;
        result.errorDetails?.push({
          leadId: localLead.id,
          error: error.message
        });
      }
    }

    // Prepare pipeline statistics for logging
    const pipelineStatsArray = Array.from(pipelineStats.entries()).map(([pipelineId, stats]) => ({
      pipelineId,
      count: stats.count
    }));

    log.info({
      userAccountId,
      total: result.total,
      updated: result.updated,
      errors: result.errors,
      notFound: notFoundCount,
      multipleLeadsFound: multipleLeadsCount,
      pipelineStats: pipelineStatsArray
    }, 'AmoCRM leads sync completed');

    // Log summary of not found phones for debugging
    if (notFoundPhones.length > 0) {
      log.warn({
        notFoundCount,
        sampleNotFound: notFoundPhones.slice(0, 10),
        totalNotFound: notFoundPhones.length
      }, 'Summary of leads not found in AmoCRM');
    }

    // Log pipeline distribution
    if (pipelineStatsArray.length > 0) {
      log.info({
        userAccountId,
        pipelines: pipelineStatsArray,
        totalPipelines: pipelineStatsArray.length
      }, 'Leads distribution by pipeline');
    }

    return result;

  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'AmoCRM leads sync failed');
    
    result.success = false;
    result.errorDetails?.push({
      leadId: 0,
      error: error.message
    });
    
    return result;
  }
}

/**
 * Синхронизирует статусы лидов конкретного креатива из AmoCRM (с параллелизацией)
 *
 * Оптимизированная версия для быстрой синхронизации лидов одного креатива:
 * - Фильтрует только лиды указанного креатива
 * - Использует параллельные запросы к AmoCRM (до 10 одновременно)
 * - Значительно быстрее, чем синхронизация всех лидов пользователя
 *
 * Supports both legacy mode (user_accounts) and multi-account mode (ad_accounts)
 *
 * @param userAccountId - UUID пользователя
 * @param creativeId - UUID креатива
 * @param app - Fastify instance для логирования
 * @param accountId - Optional ad_account UUID for multi-account mode
 * @returns Результат синхронизации
 */
export async function syncCreativeLeadsFromAmoCRM(
  userAccountId: string,
  creativeId: string,
  app: FastifyInstance,
  accountId?: string | null
): Promise<SyncLeadsResult> {
  const log = app.log;
  const result: SyncLeadsResult = {
    success: true,
    total: 0,
    updated: 0,
    errors: 0,
    errorDetails: []
  };

  try {
    log.info({ userAccountId, creativeId, accountId }, 'Starting AmoCRM creative leads sync');

    // 1. Get valid AmoCRM token (supports both legacy and multi-account mode)
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId, accountId);

    // 2. Get leads for this specific creative only
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, phone, chat_id, amocrm_lead_id, current_status_id, current_pipeline_id, direction_id, name, source_type, is_qualified, account_id')
      .eq('user_account_id', userAccountId)
      .eq('creative_id', creativeId);

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId, creativeId }, 'No leads found for this creative');
      return result;
    }

    result.total = leads.length;
    log.info({ userAccountId, creativeId, totalLeads: leads.length }, 'Found leads to sync for creative');

    // 3. Get qualification fields configuration
    // For multi-account mode, check ad_accounts first
    let qualificationFieldsData: any = null;
    if (accountId) {
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', accountId)
        .maybeSingle();
      qualificationFieldsData = adAccount;
    }
    // Fallback to user_accounts
    if (!qualificationFieldsData) {
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('amocrm_qualification_fields')
        .eq('id', userAccountId)
        .maybeSingle();
      qualificationFieldsData = userAccount;
    }

    const qualificationFields: QualificationFieldConfig[] = qualificationFieldsData?.amocrm_qualification_fields || [];

    // 3.1 Get pipeline stages as fallback if no custom fields configured
    const { data: pipelineStages, error: stagesError } = await supabase
      .from('amocrm_pipeline_stages')
      .select('status_id, is_qualified_stage')
      .eq('user_account_id', userAccountId);

    if (stagesError) {
      log.warn({ error: stagesError.message }, 'Failed to fetch pipeline stages, will not update is_qualified');
    }

    const qualificationMap = new Map<number, boolean>();
    if (pipelineStages) {
      for (const stage of pipelineStages) {
        qualificationMap.set(stage.status_id, stage.is_qualified_stage);
      }
    }

    const { findLeadsByPhone } = await import('../adapters/amocrm.js');

    // 4. Параллельная обработка с ограничением concurrency
    const concurrency = 10; // 10 параллельных запросов
    const queue: Promise<void>[] = [];
    let active = 0;

    const runTask = async (task: () => Promise<void>) => {
      active++;
      try {
        await task();
      } finally {
        active--;
      }
    };

    const schedule = async (task: () => Promise<void>): Promise<void> => {
      while (active >= concurrency) {
        await Promise.race(queue);
      }
      const p = runTask(task);
      queue.push(p);
      p.finally(() => {
        const idx = queue.indexOf(p);
        if (idx >= 0) queue.splice(idx, 1);
      });
      return p;
    };

    // 5. Обрабатываем все лиды параллельно
    await Promise.all(
      leads.map(localLead =>
        schedule(async () => {
          try {
            const rawPhone = localLead.phone || localLead.chat_id;
            const ourPhone = normalizePhone(rawPhone);

            if (!ourPhone) {
              return;
            }

            // Direct search for leads in AmoCRM by phone
            let amocrmLeads: any[] = [];
            try {
              amocrmLeads = await findLeadsByPhone(rawPhone, subdomain, accessToken);
            } catch (error: any) {
              log.warn({
                leadId: localLead.id,
                phone: ourPhone,
                error: error.message
              }, 'Error searching leads in AmoCRM');
              result.errors++;
              return;
            }

            if (!amocrmLeads || amocrmLeads.length === 0) {
              log.debug({
                leadId: localLead.id,
                phone: ourPhone
              }, 'Lead not found in AmoCRM by phone');
              return;
            }

            // Take the most recent lead
            const sortedLeads = amocrmLeads.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            const amocrmLeadFromContact = sortedLeads[0];

            const newAmoCRMLeadId = amocrmLeadFromContact.id;
            const newStatusId = amocrmLeadFromContact.status_id;
            const newPipelineId = amocrmLeadFromContact.pipeline_id;

            // Determine qualification based on custom fields or pipeline stage
            let isQualified = false;
            if (qualificationFields.length > 0) {
              // Use custom fields for qualification (supports checkbox, select, multiselect)
              // Supports both lead fields AND contact fields

              // Fetch full contact data if lead has linked contacts
              // (AmoCRM returns only contact IDs with leads, not full custom_fields_values)
              const linkedContacts = amocrmLeadFromContact._embedded?.contacts || [];
              const contactsWithFields: any[] = [];

              if (linkedContacts.length > 0) {
                const { getContact } = await import('../adapters/amocrm.js');
                for (const contactRef of linkedContacts) {
                  try {
                    const fullContact = await getContact(contactRef.id, subdomain, accessToken);
                    if (fullContact?.custom_fields_values) {
                      contactsWithFields.push(fullContact);
                    }
                  } catch (e) {
                    // Skip if contact fetch fails
                  }
                }
              }

              // Create enriched lead object with full contact data
              const enrichedLead = {
                ...amocrmLeadFromContact,
                _embedded: {
                  ...amocrmLeadFromContact._embedded,
                  contacts: contactsWithFields
                }
              };

              isQualified = checkQualification(enrichedLead, qualificationFields);

              log.info({
                leadId: localLead.id,
                amocrmLeadId: newAmoCRMLeadId,
                isQualified,
                qualificationFieldsCount: qualificationFields.length,
                leadCustomFieldsCount: amocrmLeadFromContact.custom_fields_values?.length || 0,
                contactsCount: contactsWithFields.length
              }, 'Qualification check result');
            } else {
              // Fallback to pipeline stage qualification
              isQualified = qualificationMap.get(newStatusId!) || false;
            }

            // Always sync sales data if we have the lead from AmoCRM
            if (newAmoCRMLeadId) {
              try {
                const amount = amocrmLeadFromContact.price || 0;
                
                // Extract client info
                let clientPhone = '';
                let clientName = 'Unknown';
                
                if (localLead.source_type === 'website' || localLead.source_type === 'manual') {
                  clientPhone = localLead.phone || '';
                  clientName = localLead.name || 'Клиент с сайта';
                } else {
                  clientPhone = localLead.chat_id?.replace('@s.whatsapp.net', '').replace('@c.us', '') || '';
                  clientName = localLead.chat_id || 'Unknown';
                }

                const saleData = {
                  client_phone: clientPhone,
                  // client_name field doesn't exist in purchases table based on schema provided
                  // business_id is optional
                  amount: amount, // No division by 100 for AmoCRM values (usually integers)
                  currency: 'KZT', // Default to KZT
                  // status field doesn't exist in purchases, using notes to store status info if needed
                  purchase_date: new Date().toISOString(),
                  amocrm_deal_id: newAmoCRMLeadId,
                  amocrm_pipeline_id: newPipelineId,
                  amocrm_status_id: newStatusId,
                  user_account_id: userAccountId,
                  account_id: (localLead as any).account_id || null,  // UUID для мультиаккаунтности, NULL для legacy
                  updated_at: new Date().toISOString()
                };

                // Upsert purchase record
                const { data: existingPurchase } = await supabase
                  .from('purchases')
                  .select('id')
                  .eq('amocrm_deal_id', newAmoCRMLeadId)
                  .maybeSingle();

                if (existingPurchase) {
                   await supabase
                     .from('purchases')
                     .update(saleData)
                     .eq('id', existingPurchase.id);
                } else {
                   // Only create purchase if amount > 0 or status is won (142)
                   if (amount > 0 || newStatusId === 142) {
                     await supabase
                       .from('purchases')
                       .insert({
                         ...saleData,
                         created_at: new Date().toISOString()
                       });
                   }
                }
              } catch (saleError: any) {
                log.warn({
                  error: saleError.message,
                  leadId: localLead.id,
                  amocrmLeadId: newAmoCRMLeadId
                }, 'Failed to sync sale data');
                // Don't fail the whole sync for sales error
              }
            }

            // Check if update needed (include is_qualified to catch contact field changes)
            const needsUpdate =
              localLead.current_status_id !== newStatusId ||
              localLead.current_pipeline_id !== newPipelineId ||
              localLead.amocrm_lead_id !== newAmoCRMLeadId ||
              localLead.is_qualified !== isQualified;

            if (!needsUpdate) {
              return;
            }

            // Update in database
            const updateData: any = {
              amocrm_lead_id: newAmoCRMLeadId,
              current_status_id: newStatusId,
              current_pipeline_id: newPipelineId,
              is_qualified: isQualified,
              updated_at: new Date().toISOString()
            };

            // Check and update key stages
            if (localLead.direction_id) {
              const { data: direction } = await supabase
                .from('account_directions')
                .select(`
                  key_stage_1_pipeline_id, key_stage_1_status_id,
                  key_stage_2_pipeline_id, key_stage_2_status_id,
                  key_stage_3_pipeline_id, key_stage_3_status_id
                `)
                .eq('id', localLead.direction_id)
                .maybeSingle();

              if (direction) {
                for (let stageNum = 1; stageNum <= 3; stageNum++) {
                  const pipelineIdKey = `key_stage_${stageNum}_pipeline_id`;
                  const statusIdKey = `key_stage_${stageNum}_status_id`;
                  const reachedFlagKey = `reached_key_stage_${stageNum}`;

                  const keyPipelineId = (direction as any)[pipelineIdKey];
                  const keyStatusId = (direction as any)[statusIdKey];

                  if (keyPipelineId && keyStatusId &&
                      newPipelineId === keyPipelineId &&
                      newStatusId === keyStatusId) {
                    updateData[reachedFlagKey] = true;
                  }
                }
              }
            }

            const { error: updateError } = await supabase
              .from('leads')
              .update(updateData)
              .eq('id', localLead.id);

            if (updateError) {
              log.error({
                error: updateError.message,
                leadId: localLead.id
              }, 'Failed to update lead');
              result.errors++;
              result.errorDetails?.push({
                leadId: localLead.id,
                error: updateError.message
              });
            } else {
              result.updated++;
            }

          } catch (error: any) {
            log.error({
              error: error.message,
              leadId: localLead.id
            }, 'Error processing lead');
            result.errors++;
            result.errorDetails?.push({
              leadId: localLead.id,
              error: error.message
            });
          }
        })
      )
    );

    log.info({
      userAccountId,
      creativeId,
      total: result.total,
      updated: result.updated,
      errors: result.errors
    }, 'Completed AmoCRM creative leads sync');

    return result;

  } catch (error: any) {
    log.error({ error, userAccountId, creativeId }, 'Failed to sync creative leads from AmoCRM');
    
    result.success = false;
    result.errorDetails?.push({
      leadId: 0,
      error: error.message
    });
    
    return result;
  }
}

