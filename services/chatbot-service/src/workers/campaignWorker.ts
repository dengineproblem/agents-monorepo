import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { sendWhatsAppMessageWithRetry } from '../lib/evolutionApi.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'campaignWorker' });

/**
 * Calculate how many messages to send in this slot
 * Based on work hours and daily limit
 */
async function calculateSlotLimit(userAccountId: string): Promise<number> {
  const { data: settings } = await supabase
    .from('campaign_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .single();

  if (!settings) return 0;

  const workHours = settings.work_hours_end - settings.work_hours_start;
  if (workHours <= 0) return 0;

  const messagesPerHour = Math.ceil(settings.daily_message_limit / workHours);
  
  // Split hour into 12 slots (every 5 minutes)
  return Math.ceil(messagesPerHour / 12);
}

/**
 * Check if current time is within work hours for user
 */
async function isWithinWorkHours(userAccountId: string): Promise<boolean> {
  const { data: settings } = await supabase
    .from('campaign_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .single();

  if (!settings) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc

  // Check if current day is in work_days
  if (!settings.work_days.includes(currentDay)) {
    return false;
  }

  // Check if current hour is in work hours
  return currentHour >= settings.work_hours_start && currentHour < settings.work_hours_end;
}

/**
 * Send batch of messages with randomization
 */
async function sendMessageBatch(messages: any[]): Promise<void> {
  for (const msg of messages) {
    try {
      // Get lead and instance info
      const { data: lead } = await supabase
        .from('dialog_analysis')
        .select('contact_phone, instance_name')
        .eq('id', msg.lead_id)
        .single();

      if (!lead) {
        log.error({ messageId: msg.id }, 'Lead not found');
        continue;
      }

      // Get lead analytics data before sending
      const { data: leadAnalytics } = await supabase
        .from('dialog_analysis')
        .select('interest_level, funnel_stage, score')
        .eq('id', msg.lead_id)
        .single();

      // Send message
      const result = await sendWhatsAppMessageWithRetry({
        instanceName: lead.instance_name,
        phone: lead.contact_phone,
        message: msg.message_text,
      });

      // Update message status
      if (result.success) {
        await supabase
          .from('campaign_messages')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            // Save analytics data at send time
            interest_level_at_send: leadAnalytics?.interest_level || null,
            funnel_stage_at_send: leadAnalytics?.funnel_stage || null,
            score_at_send: leadAnalytics?.score || null,
          })
          .eq('id', msg.id);

        // Update lead campaign stats
        const { data: currentLead } = await supabase
          .from('dialog_analysis')
          .select('campaign_messages_count')
          .eq('id', msg.lead_id)
          .single();

        await supabase
          .from('dialog_analysis')
          .update({
            last_campaign_message_at: new Date().toISOString(),
            campaign_messages_count: (currentLead?.campaign_messages_count || 0) + 1,
          })
          .eq('id', msg.lead_id);

        log.info({ messageId: msg.id, leadId: msg.lead_id }, 'Message sent successfully');
      } else {
        await supabase
          .from('campaign_messages')
          .update({
            status: 'failed',
            error_message: result.error || 'Unknown error',
          })
          .eq('id', msg.id);

        log.error({ messageId: msg.id, error: result.error }, 'Failed to send message');
      }

      // Random delay between messages (1-3 seconds)
      const delay = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error: any) {
      log.error({ error: error.message, messageId: msg.id }, 'Error sending message');
    }
  }
}

/**
 * Campaign worker - runs every 5 minutes
 * Sends messages in slots with randomization
 * Handles both autopilot and manual send requests
 */
export function startCampaignWorker() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      log.info('Campaign worker tick - checking for messages to send');

      // Get all users with autopilot enabled OR with manual send requests
      const { data: autopilotUsers, error: autopilotError } = await supabase
        .from('campaign_settings')
        .select('user_account_id')
        .eq('autopilot_enabled', true);

      // Get users with manual send requests
      const { data: manualSendMessages } = await supabase
        .from('campaign_messages')
        .select('user_account_id')
        .in('status', ['pending', 'scheduled'])
        .not('manual_send_requested_at', 'is', null)
        .limit(100);

      // Combine and deduplicate users
      const userAccountIds = new Set<string>();
      
      if (autopilotUsers) {
        autopilotUsers.forEach(u => userAccountIds.add(u.user_account_id));
      }
      
      if (manualSendMessages) {
        manualSendMessages.forEach(m => userAccountIds.add(m.user_account_id));
      }

      if (userAccountIds.size === 0) {
        log.info('No users with autopilot enabled or manual send requests');
        return;
      }

      const users = Array.from(userAccountIds).map(id => ({ user_account_id: id }));
      log.info({ usersCount: users.length }, 'Processing users');

      for (const user of users) {
        try {
          const userAccountId = user.user_account_id;

          // Check if within work hours
          const withinWorkHours = await isWithinWorkHours(userAccountId);
          if (!withinWorkHours) {
            log.info({ userAccountId }, 'Outside work hours, skipping');
            continue;
          }

          // Calculate slot limit
          const slotLimit = await calculateSlotLimit(userAccountId);
          if (slotLimit <= 0) {
            log.info({ userAccountId }, 'Slot limit is 0, skipping');
            continue;
          }

          // Get pending messages
          const { data: messages } = await supabase
            .from('campaign_messages')
            .select('*')
            .eq('user_account_id', userAccountId)
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(slotLimit);

          if (!messages || messages.length === 0) {
            log.info({ userAccountId }, 'No pending messages');
            continue;
          }

          log.info({
            userAccountId,
            messagesCount: messages.length,
            slotLimit,
          }, 'Sending message batch');

          // Send batch
          await sendMessageBatch(messages);
        } catch (userError: any) {
          log.error({
            error: userError.message,
            userAccountId: user.user_account_id,
          }, 'Error processing user');
        }
      }

      log.info('Campaign worker tick completed');
    } catch (error: any) {
      log.error({ error: error.message }, 'Campaign worker failed');
    }
  });

  log.info('Campaign worker started (every 5 minutes)');
}

