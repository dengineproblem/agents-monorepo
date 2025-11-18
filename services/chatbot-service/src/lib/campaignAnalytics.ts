import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'campaignAnalytics' });

/**
 * Mark reply on campaign message when lead responds
 * Called when incoming message is received from lead
 */
export async function markCampaignReply(
  leadId: string,
  replyTime: Date = new Date()
): Promise<void> {
  try {
    // Find last sent campaign message for this lead
    const { data: lastMessage, error } = await supabase
      .from('campaign_messages')
      .select('id, has_reply')
      .eq('lead_id', leadId)
      .eq('status', 'sent')
      .is('has_reply', false)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      log.error({ error: error.message, leadId }, 'Error finding last campaign message');
      return;
    }

    // If no unreplied message found, nothing to do
    if (!lastMessage) {
      return;
    }

    // Mark as replied
    const { error: updateError } = await supabase
      .from('campaign_messages')
      .update({
        has_reply: true,
        first_reply_at: replyTime.toISOString(),
      })
      .eq('id', lastMessage.id);

    if (updateError) {
      log.error({ error: updateError.message, messageId: lastMessage.id }, 'Error marking reply');
      return;
    }

    log.info({ messageId: lastMessage.id, leadId }, 'Marked campaign message as replied');
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Failed to mark campaign reply');
  }
}

/**
 * Mark target action (key stage transition) when lead moves to key stage
 * Called when funnel_stage is updated
 */
export async function markTargetAction(
  leadId: string,
  userAccountId: string,
  newStage: string,
  actionTime: Date = new Date()
): Promise<void> {
  try {
    // Check if new stage is a key stage
    const { data: profile } = await supabase
      .from('business_profile')
      .select('key_funnel_stages')
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    const keyStages = profile?.key_funnel_stages || [];
    
    // If not a key stage, nothing to do
    if (!keyStages.includes(newStage)) {
      return;
    }

    // Find last sent campaign message within attribution window (7 days)
    const attributionWindow = new Date(actionTime);
    attributionWindow.setDate(attributionWindow.getDate() - 7);

    const { data: lastMessage, error } = await supabase
      .from('campaign_messages')
      .select('id, led_to_target_action')
      .eq('lead_id', leadId)
      .eq('status', 'sent')
      .is('led_to_target_action', false)
      .gte('sent_at', attributionWindow.toISOString())
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      log.error({ error: error.message, leadId }, 'Error finding campaign message for attribution');
      return;
    }

    // If no message in attribution window, nothing to attribute
    if (!lastMessage) {
      log.debug({ leadId, newStage }, 'No campaign message in attribution window');
      return;
    }

    // Mark as led to target action
    const { error: updateError } = await supabase
      .from('campaign_messages')
      .update({
        led_to_target_action: true,
        target_action_type: 'key_stage_transition',
        target_action_at: actionTime.toISOString(),
      })
      .eq('id', lastMessage.id);

    if (updateError) {
      log.error({ error: updateError.message, messageId: lastMessage.id }, 'Error marking target action');
      return;
    }

    log.info({ 
      messageId: lastMessage.id, 
      leadId, 
      newStage 
    }, 'Marked campaign message as led to target action');
  } catch (error: any) {
    log.error({ error: error.message, leadId }, 'Failed to mark target action');
  }
}

