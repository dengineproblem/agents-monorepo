import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'leadAssignment' });

/**
 * Автоматически назначает лида консультанту при первом сообщении
 * Использует round-robin алгоритм из SQL функции assign_lead_to_consultant
 * (выбирает консультанта с минимальным количеством лидов)
 *
 * @param dialogAnalysisId - ID лида в dialog_analysis
 * @param userAccountId - ID аккаунта пользователя
 * @returns consultantId или null если консультанты не найдены
 */
export async function assignLeadToConsultant(
  dialogAnalysisId: string,
  userAccountId: string
): Promise<string | null> {
  log.info({
    dialogAnalysisId,
    userAccountId
  }, '[assignLeadToConsultant] Assigning lead to consultant');

  try {
    // Проверяем, не назначен ли уже лид
    const { data: existingLead, error: checkError } = await supabase
      .from('dialog_analysis')
      .select('assigned_consultant_id')
      .eq('id', dialogAnalysisId)
      .single();

    if (checkError) {
      log.error({ error: checkError, dialogAnalysisId }, '[assignLeadToConsultant] Error checking existing lead');
      return null;
    }

    if (existingLead?.assigned_consultant_id) {
      log.info({
        dialogAnalysisId,
        consultantId: existingLead.assigned_consultant_id
      }, '[assignLeadToConsultant] Lead already assigned');
      return existingLead.assigned_consultant_id;
    }

    // Вызываем SQL функцию round-robin
    const { data: consultantId, error } = await supabase
      .rpc('assign_lead_to_consultant', {
        p_user_account_id: userAccountId
      });

    if (error) {
      log.error({ error }, '[assignLeadToConsultant] Error calling assign function');
      return null;
    }

    if (!consultantId) {
      log.warn({
        userAccountId
      }, '[assignLeadToConsultant] No active consultants found for user_account');
      return null;
    }

    // Обновляем dialog_analysis
    const { error: updateError } = await supabase
      .from('dialog_analysis')
      .update({ assigned_consultant_id: consultantId })
      .eq('id', dialogAnalysisId);

    if (updateError) {
      log.error({ error: updateError }, '[assignLeadToConsultant] Error updating lead');
      return null;
    }

    log.info({
      dialogAnalysisId,
      consultantId,
      userAccountId
    }, '[assignLeadToConsultant] Lead successfully assigned to consultant');

    return consultantId;
  } catch (error) {
    log.error({ error }, '[assignLeadToConsultant] Unexpected error');
    return null;
  }
}

/**
 * Получить консультанта закреплённого за лидом
 *
 * @param dialogAnalysisId - ID лида в dialog_analysis
 * @returns consultantId или null
 */
export async function getAssignedConsultant(
  dialogAnalysisId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('dialog_analysis')
      .select('assigned_consultant_id')
      .eq('id', dialogAnalysisId)
      .single();

    if (error || !data) {
      log.debug({ error, dialogAnalysisId }, '[getAssignedConsultant] Lead not found or error');
      return null;
    }

    return data.assigned_consultant_id;
  } catch (error) {
    log.error({ error, dialogAnalysisId }, '[getAssignedConsultant] Unexpected error');
    return null;
  }
}

/**
 * Переназначить лида другому консультанту (только для админов)
 *
 * @param dialogAnalysisId - ID лида
 * @param newConsultantId - ID нового консультанта
 * @returns success boolean
 */
export async function reassignLead(
  dialogAnalysisId: string,
  newConsultantId: string
): Promise<boolean> {
  log.info({
    dialogAnalysisId,
    newConsultantId
  }, '[reassignLead] Reassigning lead to new consultant');

  try {
    // Проверяем что консультант существует и активен
    const { data: consultant, error: consultantError } = await supabase
      .from('consultants')
      .select('id, name, is_active')
      .eq('id', newConsultantId)
      .single();

    if (consultantError || !consultant) {
      log.warn({ newConsultantId }, '[reassignLead] Consultant not found');
      return false;
    }

    if (!consultant.is_active) {
      log.warn({ newConsultantId }, '[reassignLead] Consultant is not active');
      return false;
    }

    // Переназначаем лида
    const { error: updateError } = await supabase
      .from('dialog_analysis')
      .update({ assigned_consultant_id: newConsultantId })
      .eq('id', dialogAnalysisId);

    if (updateError) {
      log.error({ error: updateError }, '[reassignLead] Error updating lead');
      return false;
    }

    log.info({
      dialogAnalysisId,
      newConsultantId,
      consultantName: consultant.name
    }, '[reassignLead] Lead successfully reassigned');

    return true;
  } catch (error) {
    log.error({ error }, '[reassignLead] Unexpected error');
    return false;
  }
}

/**
 * Получить статистику распределения лидов по консультантам
 *
 * @param userAccountId - ID аккаунта пользователя
 * @returns массив с консультантами и количеством лидов
 */
export async function getLeadDistributionStats(
  userAccountId: string
): Promise<Array<{ consultantId: string; consultantName: string; leadCount: number }>> {
  try {
    const { data, error } = await supabase
      .from('consultants')
      .select(`
        id,
        name,
        dialog_analysis:dialog_analysis(count)
      `)
      .eq('user_account_id', userAccountId)
      .eq('is_active', true);

    if (error) {
      log.error({ error }, '[getLeadDistributionStats] Error fetching stats');
      return [];
    }

    return (data || []).map(consultant => ({
      consultantId: consultant.id,
      consultantName: consultant.name,
      leadCount: (consultant.dialog_analysis as any)?.[0]?.count || 0
    }));
  } catch (error) {
    log.error({ error }, '[getLeadDistributionStats] Unexpected error');
    return [];
  }
}
