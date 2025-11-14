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

    // NEW EFFICIENT APPROACH: Direct search for each lead by phone
    // Instead of downloading ALL leads from AmoCRM, we search for each lead individually
    log.info({ userAccountId }, 'Starting efficient phone-by-phone sync');

    const { findContactByPhone } = await import('../adapters/amocrm.js');

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

    for (const localLead of leads) {
      try {
        // Normalize phone from our database
        const rawPhone = localLead.phone || localLead.chat_id;
        const ourPhone = normalizePhone(rawPhone);

        if (!ourPhone) {
          continue;
        }

        // Direct search in AmoCRM by phone (much faster than bulk download)
        let contact = null;
        try {
          contact = await findContactByPhone(rawPhone, subdomain, accessToken);
        } catch (error: any) {
          log.warn({
            leadId: localLead.id,
            phone: ourPhone,
            error: error.message
          }, 'Error searching contact in AmoCRM');
        }

        if (!contact) {
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
            }, 'Contact not found in AmoCRM by phone');
          }
          continue;
        }

        // Get lead from contact
        const amocrmLeadFromContact = (contact as any)._embedded?.leads?.[0];

        if (!amocrmLeadFromContact) {
          log.info({
            leadId: localLead.id,
            contactId: contact.id,
            phone: ourPhone
          }, 'Contact found but has no leads');
          continue;
        }

        const newAmoCRMLeadId = amocrmLeadFromContact.id;
        const newStatusId = amocrmLeadFromContact.status_id;
        const newPipelineId = amocrmLeadFromContact.pipeline_id;
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

