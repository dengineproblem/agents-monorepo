import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'leadSnapshotCron' });

/**
 * Daily snapshot of lead states for analytics
 * Runs every day at 23:55
 */
export function startLeadSnapshotCron() {
  // Run at 23:55 every day
  cron.schedule('55 23 * * *', async () => {
    try {
      log.info('Starting daily lead snapshot');

      // Get all users with autopilot enabled
      const { data: users, error: usersError } = await supabase
        .from('campaign_settings')
        .select('user_account_id')
        .eq('autopilot_enabled', true);

      if (usersError) {
        throw usersError;
      }

      if (!users || users.length === 0) {
        log.info('No users with autopilot enabled');
        return;
      }

      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      let totalSnapshots = 0;
      let successCount = 0;
      let errorCount = 0;

      for (const user of users) {
        try {
          const userAccountId = user.user_account_id;

          // Get all leads with autopilot enabled for this user
          const { data: leads, error: leadsError } = await supabase
            .from('dialog_analysis')
            .select('id, interest_level, score, funnel_stage, campaign_messages_count')
            .eq('user_account_id', userAccountId)
            .eq('autopilot_enabled', true);

          if (leadsError) {
            log.error({ error: leadsError.message, userAccountId }, 'Failed to fetch leads');
            errorCount++;
            continue;
          }

          if (!leads || leads.length === 0) {
            log.debug({ userAccountId }, 'No leads to snapshot');
            continue;
          }

          // Create snapshots for all leads
          const snapshots = leads.map(lead => ({
            user_account_id: userAccountId,
            lead_id: lead.id,
            snapshot_date: today,
            interest_level: lead.interest_level,
            score: lead.score,
            funnel_stage: lead.funnel_stage,
            campaign_messages_count: lead.campaign_messages_count || 0,
          }));

          // Bulk insert snapshots (upsert to handle duplicates)
          const { error: insertError } = await supabase
            .from('lead_daily_snapshot')
            .upsert(snapshots, {
              onConflict: 'lead_id,snapshot_date',
              ignoreDuplicates: false,
            });

          if (insertError) {
            log.error({ 
              error: insertError.message, 
              userAccountId, 
              snapshotsCount: snapshots.length 
            }, 'Failed to insert snapshots');
            errorCount++;
          } else {
            totalSnapshots += snapshots.length;
            successCount++;
            log.info({ 
              userAccountId, 
              snapshotsCount: snapshots.length 
            }, 'Created lead snapshots');
          }

        } catch (userError: any) {
          log.error({ 
            error: userError.message, 
            userAccountId: user.user_account_id 
          }, 'Error processing user snapshots');
          errorCount++;
        }
      }

      log.info({ 
        totalSnapshots, 
        successCount, 
        errorCount,
        date: today
      }, 'Daily lead snapshot completed');

    } catch (error: any) {
      log.error({ error: error.message }, 'Lead snapshot cron failed');
    }
  });

  log.info('Lead snapshot cron started (daily at 23:55)');
}



