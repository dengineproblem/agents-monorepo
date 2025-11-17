import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'keyStageTransitionCron' });

/**
 * Calculate days since a date
 */
function calculateDaysSince(date: string | null): number {
  if (!date) return 999;
  
  const now = new Date();
  const past = new Date(date);
  const diffTime = Math.abs(now.getTime() - past.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Trigger reanalysis of a lead via HTTP endpoint
 */
async function triggerReanalysis(leadId: string, userAccountId: string): Promise<boolean> {
  try {
    // Get lead details for reanalysis
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) {
      log.error({ leadId }, 'Lead not found for reanalysis');
      return false;
    }

    // Call reanalysis endpoint (assuming it exists in crm-backend service)
    const response = await fetch('http://localhost:8082/dialogs/reanalyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId,
        userAccountId
      })
    });

    if (!response.ok) {
      log.error({ leadId, status: response.status }, 'Reanalysis request failed');
      return false;
    }

    log.info({ leadId }, 'Reanalysis triggered successfully');
    return true;
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Failed to trigger reanalysis');
    return false;
  }
}

/**
 * Automatic transition check for leads on key stages
 * Runs daily at 03:00
 */
export function startKeyStageTransitionCron() {
  cron.schedule('0 3 * * *', async () => {
    try {
      log.info('Starting key stage transition check');

      // Find all leads on key stages
      const { data: leads, error } = await supabase
        .from('dialog_analysis')
        .select('*')
        .eq('is_on_key_stage', true);

      if (error) {
        throw error;
      }

      if (!leads || leads.length === 0) {
        log.info('No leads on key stages');
        return;
      }

      log.info({ leadsCount: leads.length }, 'Found leads on key stages');

      const results = [];

      // Default threshold: reanalyze after 3 days on any key stage
      // This is universal and works for any custom funnel stage names
      const REANALYSIS_THRESHOLD_DAYS = 3;

      for (const lead of leads) {
        try {
          // Calculate days on key stage
          const daysSinceEntered = calculateDaysSince(lead.key_stage_entered_at);

          // If enough time has passed → reanalyze
          // AI will determine from conversation whether the lead should move to next stage
          if (daysSinceEntered >= REANALYSIS_THRESHOLD_DAYS) {
            log.info({ 
              leadId: lead.id, 
              contactPhone: lead.contact_phone,
              funnel_stage: lead.funnel_stage,
              daysSinceEntered
            }, 'Reanalyzing lead on key stage');

            // Trigger reanalysis
            const success = await triggerReanalysis(lead.id, lead.user_account_id);

            results.push({ 
              leadId: lead.id, 
              success, 
              action: success ? 'reanalyzed' : 'failed' 
            });

            // Small delay between requests to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            log.debug({ 
              leadId: lead.id,
              funnel_stage: lead.funnel_stage,
              daysSinceEntered
            }, 'Lead not ready for reanalysis yet');

            results.push({ 
              leadId: lead.id, 
              success: true, 
              action: 'skipped',
              reason: `Only ${daysSinceEntered} days on stage, waiting for ${REANALYSIS_THRESHOLD_DAYS}` 
            });
          }

        } catch (leadError: any) {
          log.error({ 
            error: leadError.message, 
            leadId: lead.id 
          }, 'Failed to process lead');
          
          results.push({ 
            leadId: lead.id, 
            success: false, 
            error: leadError.message 
          });
        }
      }

      const reanalyzedCount = results.filter(r => r.action === 'reanalyzed').length;
      const failedCount = results.filter(r => r.action === 'failed').length;
      const skippedCount = results.filter(r => r.action === 'skipped').length;

      log.info({ 
        totalLeads: leads.length,
        reanalyzedCount,
        failedCount,
        skippedCount
      }, 'Key stage transition check completed');

    } catch (error: any) {
      log.error({ error: error.message }, 'Key stage transition cron failed');
    }
  });

  log.info('Key stage transition cron scheduled (daily at 03:00)');
}

