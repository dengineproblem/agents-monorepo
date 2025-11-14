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

/**
 * Fetch ALL contacts from AmoCRM with pagination
 */
async function fetchAllContactsFromAmoCRM(
  subdomain: string,
  accessToken: string,
  log: any
): Promise<Map<number, string | null>> {
  const phoneMap = new Map<number, string | null>();
  
  let page = 1;
  const limit = 250;
  let hasMore = true;
  let totalContacts = 0;
  let totalWithPhone = 0;

  while (hasMore) {
    try {
      const url = `https://${subdomain}.amocrm.ru/api/v4/contacts?limit=${limit}&page=${page}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`AmoCRM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const contacts = data._embedded?.contacts || [];

      totalContacts += contacts.length;

      for (const contact of contacts) {
        const phoneField = contact.custom_fields_values?.find(
          (field: any) => field.field_code === 'PHONE'
        );
        
        const phone = phoneField?.values?.[0]?.value ? String(phoneField.values[0].value) : null;
        phoneMap.set(contact.id, phone);
        if (phone) totalWithPhone++;
      }

      log.info({ page, contactsOnPage: contacts.length, totalContacts, totalWithPhone }, 'Fetched contacts page from AmoCRM');

      // Check if there are more pages
      hasMore = contacts.length === limit;
      page++;

      // Safety limit
      if (page > 100) {
        log.warn('Reached page limit of 100 for contacts, stopping');
        break;
      }

    } catch (error: any) {
      log.error({ error: error.message, page }, 'Failed to fetch contacts from AmoCRM');
      hasMore = false;
    }
  }

  log.info({ totalContacts, totalWithPhone }, 'Fetched all contacts from AmoCRM');
  return phoneMap;
}

/**
 * Fetch unsorted leads from AmoCRM
 */
async function fetchUnsortedFromAmoCRM(
  subdomain: string,
  accessToken: string,
  log: any
): Promise<Array<{ id: number; phone: string | null; contact_id: number | null }>> {
  const unsortedLeads: Array<{ id: number; phone: string | null; contact_id: number | null }> = [];

  try {
    let page = 1;
    const limit = 250;
    let hasMore = true;

    while (hasMore && page <= 10) { // Limit to 10 pages of unsorted
      try {
        const url = `https://${subdomain}.amocrm.ru/api/v4/leads/unsorted?limit=${limit}&page=${page}`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 204) {
            // No unsorted leads
            log.info('No unsorted leads found in AmoCRM');
            break;
          }
          throw new Error(`AmoCRM API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const unsorted = data._embedded?.unsorted || [];

        log.info({ page, count: unsorted.length }, 'Fetched page of unsorted from AmoCRM');

        for (const item of unsorted) {
          // Extract phone from unsorted item
          const phoneField = item.custom_fields_values?.find(
            (field: any) => field.field_code === 'PHONE'
          );

          const phone = phoneField?.values?.[0]?.value ? String(phoneField.values[0].value) : null;

          unsortedLeads.push({
            id: item.id,
            phone: normalizePhone(phone),
            contact_id: null
          });
        }

        hasMore = unsorted.length === limit;
        page++;

      } catch (error: any) {
        log.error({ error: error.message, page }, 'Failed to fetch unsorted from AmoCRM');
        hasMore = false;
      }
    }

    log.info({ totalUnsorted: unsortedLeads.length }, 'Fetched all unsorted from AmoCRM');
  } catch (error: any) {
    log.warn({ error: error.message }, 'Error fetching unsorted, will skip');
  }

  return unsortedLeads;
}

/**
 * Fetch all leads from AmoCRM with their contacts and phones
 */
async function fetchAllLeadsFromAmoCRM(
  subdomain: string,
  accessToken: string,
  log: any
): Promise<Array<{ id: number; status_id: number; pipeline_id: number; phone: string | null; contact_id: number | null }>> {
  const allLeads: Array<{ id: number; status_id: number; pipeline_id: number; phone: string | null; contact_id: number | null }> = [];
  const leadsWithContactIds: Array<{ lead: any; contactId: number }> = [];
  
  let page = 1;
  const limit = 250;
  let hasMore = true;

  // Step 1: Fetch all leads and collect contact IDs
  while (hasMore) {
    try {
      const url = `https://${subdomain}.amocrm.ru/api/v4/leads?with=contacts&limit=${limit}&page=${page}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`AmoCRM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const leads = data._embedded?.leads || [];

      log.info({ page, count: leads.length }, 'Fetched page of leads from AmoCRM');

      // Collect lead info and contact IDs
      for (const lead of leads) {
        const contactId = lead._embedded?.contacts?.[0]?.id;
        if (contactId) {
          leadsWithContactIds.push({ lead, contactId });
        } else {
          // No contact - add lead without phone
          allLeads.push({
            id: lead.id,
            status_id: lead.status_id,
            pipeline_id: lead.pipeline_id,
            phone: null,
            contact_id: null
          });
        }
      }

      // Check if there are more pages
      hasMore = leads.length === limit;
      page++;

      // Safety limit to prevent infinite loops
      if (page > 100) {
        log.warn('Reached page limit of 100, stopping');
        break;
      }

    } catch (error: any) {
      log.error({ error: error.message, page }, 'Failed to fetch leads from AmoCRM');
      hasMore = false;
    }
  }

  log.info({ totalLeads: leadsWithContactIds.length + allLeads.length, withContacts: leadsWithContactIds.length }, 'Fetched all leads, now fetching ALL contacts');

  // Step 2: Fetch ALL contacts from AmoCRM (simpler and more reliable than batch requests by ID)
  const contactsPhoneMap = await fetchAllContactsFromAmoCRM(subdomain, accessToken, log);
  
  // Step 3: Match phones to leads
  for (const { lead, contactId } of leadsWithContactIds) {
    const rawPhone = contactsPhoneMap.get(contactId) || null;
    allLeads.push({
      id: lead.id,
      status_id: lead.status_id,
      pipeline_id: lead.pipeline_id,
      phone: normalizePhone(rawPhone),
      contact_id: contactId
    });
  }

  log.info({ totalLeads: allLeads.length }, 'Fetched all leads with phones');
  return allLeads;
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
 * @param userAccountId - UUID пользователя
 * @param app - Fastify instance для логирования
 * @returns Результат синхронизации
 */
export async function syncLeadsFromAmoCRM(
  userAccountId: string,
  app: FastifyInstance
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
    log.info({ userAccountId }, 'Starting AmoCRM leads sync');

    // 1. Get valid AmoCRM token
    const { accessToken, subdomain } = await getValidAmoCRMToken(userAccountId);

    // 2. Get all leads with phone numbers from database
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, phone, chat_id, amocrm_lead_id, current_status_id, current_pipeline_id')
      .eq('user_account_id', userAccountId);

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    if (!leads || leads.length === 0) {
      log.info({ userAccountId }, 'No leads with amocrm_lead_id found');
      return result;
    }

    result.total = leads.length;
    log.info({ userAccountId, totalLeads: leads.length }, 'Found leads to sync');

    // 3. Fetch ALL leads from AmoCRM (we'll match by phone)
    log.info({ userAccountId }, 'Fetching ALL leads from AmoCRM');

    // AmoCRM API: get leads with contacts
    const amocrmLeads = await fetchAllLeadsFromAmoCRM(subdomain, accessToken, log);

    // Also fetch unsorted leads
    log.info({ userAccountId }, 'Fetching unsorted leads from AmoCRM');
    const unsortedLeads = await fetchUnsortedFromAmoCRM(subdomain, accessToken, log);

    // Create map by phone for quick lookup
    const amocrmLeadsByPhone = new Map<string, typeof amocrmLeads[0]>();
    for (const lead of amocrmLeads) {
      if (lead.phone) {
        amocrmLeadsByPhone.set(lead.phone, lead);
      }
    }

    // Add unsorted to map (with null status/pipeline since they're not processed yet)
    const unsortedByPhone = new Map<string, typeof unsortedLeads[0]>();
    for (const unsorted of unsortedLeads) {
      if (unsorted.phone) {
        unsortedByPhone.set(unsorted.phone, unsorted);
      }
    }

  log.info({
    userAccountId,
    totalAmoCRMLeads: amocrmLeads.length,
    totalUnsorted: unsortedLeads.length,
    withPhone: amocrmLeadsByPhone.size,
    unsortedWithPhone: unsortedByPhone.size,
    samplePhones: Array.from(amocrmLeadsByPhone.keys()).slice(0, 5),
    sampleUnsortedPhones: Array.from(unsortedByPhone.keys()).slice(0, 5)
  }, 'Received leads from AmoCRM');

  // Log first 5 local lead phones for comparison
  const sampleLocalPhones = leads.slice(0, 5).map(l => ({
    id: l.id,
    phone: l.phone,
    chat_id: l.chat_id,
    normalized: normalizePhone(l.phone || l.chat_id)
  }));
  log.info({ userAccountId, sampleLocalPhones }, 'Sample local lead phones');

  // 5. Get pipeline stages for qualification check
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

    // 6. Update each lead in database by matching phone numbers
    let notFoundCount = 0;
    const notFoundPhones: Array<{ leadId: number; rawPhone: string; normalizedPhone: string }> = [];

    for (const localLead of leads) {
      try {
        // Normalize phone from our database
        const rawPhone = localLead.phone || localLead.chat_id;
        const ourPhone = normalizePhone(rawPhone);

        if (!ourPhone) {
          continue;
        }

        // Find matching lead in AmoCRM by phone
        let amocrmLead = amocrmLeadsByPhone.get(ourPhone);
        let foundInUnsorted = false;

        // If not found in leads, check unsorted
        if (!amocrmLead) {
          const unsortedItem = unsortedByPhone.get(ourPhone);
          if (unsortedItem) {
            foundInUnsorted = true;
            log.info({
              leadId: localLead.id,
              phone: ourPhone,
              unsortedId: unsortedItem.id
            }, 'Lead found in AmoCRM unsorted');

            // Create a pseudo-lead object for unsorted (no status/pipeline yet)
            amocrmLead = {
              id: unsortedItem.id,
              status_id: null as any,
              pipeline_id: null as any,
              phone: unsortedItem.phone,
              contact_id: unsortedItem.contact_id
            };
          }
        }

        if (!amocrmLead) {
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
            }, 'Lead not found in AmoCRM by phone (neither in leads nor unsorted)');
          }
          continue;
        }

        const newStatusId = amocrmLead.status_id;
        const newPipelineId = amocrmLead.pipeline_id;
        const newAmoCRMLeadId = amocrmLead.id;
        const isQualified = qualificationMap.get(newStatusId!) || false;

        // Only update if something changed
        const needsUpdate = 
          localLead.current_status_id !== newStatusId ||
          localLead.current_pipeline_id !== newPipelineId ||
          localLead.amocrm_lead_id !== newAmoCRMLeadId;

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

    log.info({
      userAccountId,
      total: result.total,
      updated: result.updated,
      errors: result.errors,
      notFound: notFoundCount
    }, 'AmoCRM leads sync completed');

    // Log summary of not found phones for debugging
    if (notFoundPhones.length > 0) {
      log.warn({
        notFoundCount,
        sampleNotFound: notFoundPhones.slice(0, 10),
        totalNotFound: notFoundPhones.length
      }, 'Summary of leads not found in AmoCRM');
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

