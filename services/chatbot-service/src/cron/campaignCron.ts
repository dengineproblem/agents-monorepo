import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { generateDailyCampaignQueue } from '../lib/campaignScoringAgent.js';
import { generateBatchMessages } from '../lib/messageGenerator.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'campaignCron' });

/**
 * Daily campaign queue generation cron job
 * Runs every day at 9:00 AM
 */
export function startCampaignCron() {
  // Cron expression: '0 9 * * *' = every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      log.info('Starting daily campaign queue generation cron job');

      // 1. Get all users with autopilot enabled
      const { data: settings, error } = await supabase
        .from('campaign_settings')
        .select('user_account_id, autopilot_enabled')
        .eq('autopilot_enabled', true);

      if (error) {
        throw error;
      }

      if (!settings || settings.length === 0) {
        log.info('No users with autopilot enabled');
        return;
      }

      log.info({ userCount: settings.length }, 'Processing campaign queues for users');

      // 2. Process each user
      const results = [];
      for (const setting of settings) {
        try {
          const userAccountId = setting.user_account_id;
          
          log.info({ userAccountId }, 'Generating queue for user');

          // Generate queue
          const queue = await generateDailyCampaignQueue(userAccountId);

          if (queue.length === 0) {
            log.info({ userAccountId }, 'No eligible leads');
            results.push({ userAccountId, success: true, queueSize: 0 });
            continue;
          }

          // Generate messages
          const messages = await generateBatchMessages(queue, userAccountId);

          // Save to database
          const campaignMessages = Array.from(messages.entries()).map(([leadId, msg]) => ({
            user_account_id: userAccountId,
            lead_id: leadId,
            message_text: msg.message,
            message_type: msg.type,
            status: 'pending',
            scheduled_at: new Date().toISOString(),
          }));

          const { error: insertError } = await supabase
            .from('campaign_messages')
            .insert(campaignMessages);

          if (insertError) {
            throw insertError;
          }

          log.info({ 
            userAccountId, 
            queueSize: queue.length,
            messagesGenerated: messages.size 
          }, 'Queue generated successfully');

          results.push({ 
            userAccountId, 
            success: true, 
            queueSize: queue.length,
            messagesGenerated: messages.size 
          });
        } catch (userError: any) {
          log.error({ 
            error: userError.message, 
            userAccountId: setting.user_account_id 
          }, 'Failed to generate queue for user');
          
          results.push({ 
            userAccountId: setting.user_account_id, 
            success: false, 
            error: userError.message 
          });
        }
      }

      // Log summary
      const successCount = results.filter(r => r.success).length;
      const totalQueued = results.reduce((sum, r) => sum + (r.queueSize || 0), 0);

      log.info({ 
        totalUsers: settings.length,
        successCount,
        totalQueued,
        results 
      }, 'Daily campaign queue generation completed');
    } catch (error: any) {
      log.error({ error: error.message }, 'Campaign cron job failed');
    }
  });

  log.info('Campaign cron job scheduled (daily at 9:00 AM)');
}

