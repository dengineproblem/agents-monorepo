import { supabase } from './supabase.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'manualSendScheduler' });

interface ExistingQueueInfo {
  count: number;
  createdAt: string;
  hasSentMessages: boolean;
  leadIds: string[];
}

interface ScheduleInfo {
  mode: 'immediate' | 'scheduled';
  scheduledFor?: string;
  estimatedDuration?: string;
  messagesPerHour?: number;
  nextWorkingTime?: string;
}

/**
 * Check if there's an existing queue for the user
 */
export async function checkExistingQueue(userAccountId: string): Promise<ExistingQueueInfo | null> {
  try {
    // Get pending/scheduled messages
    const { data: messages, error } = await supabase
      .from('campaign_messages')
      .select('id, lead_id, status, created_at')
      .eq('user_account_id', userAccountId)
      .in('status', ['pending', 'scheduled'])
      .order('created_at', { ascending: true });

    if (error) {
      log.error({ error: error.message, userAccountId }, 'Failed to check existing queue');
      return null;
    }

    if (!messages || messages.length === 0) {
      return null;
    }

    // Check if any messages were already sent from this queue
    const oldestCreatedAt = messages[0].created_at;
    const { data: sentMessages } = await supabase
      .from('campaign_messages')
      .select('id')
      .eq('user_account_id', userAccountId)
      .eq('status', 'sent')
      .gte('created_at', oldestCreatedAt)
      .limit(1);

    return {
      count: messages.length,
      createdAt: oldestCreatedAt,
      hasSentMessages: (sentMessages && sentMessages.length > 0) || false,
      leadIds: messages.map(m => m.lead_id),
    };
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Error checking existing queue');
    return null;
  }
}

/**
 * Calculate hours since a timestamp
 */
function getHoursSince(timestamp: string): number {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now.getTime() - past.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Get next working time for the user
 */
async function getNextWorkingTime(userAccountId: string): Promise<Date> {
  const { data: settings } = await supabase
    .from('campaign_settings')
    .select('work_hours_start, work_hours_end, work_days')
    .eq('user_account_id', userAccountId)
    .single();

  if (!settings) {
    // Default: tomorrow at 10:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow;
  }

  const now = new Date();
  let checkDate = new Date(now);

  // Find next working day and time
  for (let i = 0; i < 14; i++) { // Check up to 2 weeks ahead
    const dayOfWeek = checkDate.getDay();
    
    if (settings.work_days.includes(dayOfWeek)) {
      const currentHour = (i === 0) ? now.getHours() : 0;
      
      if (currentHour < settings.work_hours_start) {
        // Today/this day, before work hours
        checkDate.setHours(settings.work_hours_start, 0, 0, 0);
        return checkDate;
      } else if (i > 0) {
        // Future working day
        checkDate.setHours(settings.work_hours_start, 0, 0, 0);
        return checkDate;
      }
    }
    
    // Move to next day
    checkDate.setDate(checkDate.getDate() + 1);
    checkDate.setHours(0, 0, 0, 0);
  }

  // Fallback: tomorrow at work start
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(settings.work_hours_start, 0, 0, 0);
  return fallback;
}

/**
 * Check if current time is within work hours
 */
async function isWithinWorkHours(userAccountId: string): Promise<boolean> {
  const { data: settings } = await supabase
    .from('campaign_settings')
    .select('work_hours_start, work_hours_end, work_days')
    .eq('user_account_id', userAccountId)
    .single();

  if (!settings) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  if (!settings.work_days.includes(currentDay)) {
    return false;
  }

  return currentHour >= settings.work_hours_start && currentHour < settings.work_hours_end;
}

/**
 * Calculate remaining work hours today
 */
async function getRemainingWorkHoursToday(userAccountId: string): Promise<number> {
  const { data: settings } = await supabase
    .from('campaign_settings')
    .select('work_hours_end')
    .eq('user_account_id', userAccountId)
    .single();

  if (!settings) return 0;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();
  
  const remainingHours = settings.work_hours_end - currentHour - (currentMinutes / 60);
  return Math.max(0, remainingHours);
}

/**
 * Determine when to start sending messages
 */
export async function determineSchedule(
  userAccountId: string,
  messageCount: number
): Promise<ScheduleInfo> {
  try {
    const withinWorkHours = await isWithinWorkHours(userAccountId);

    if (withinWorkHours) {
      // Immediate sending
      const remainingHours = await getRemainingWorkHoursToday(userAccountId);
      const messagesPerHour = Math.ceil(messageCount / Math.max(1, remainingHours));

      return {
        mode: 'immediate',
        estimatedDuration: `${Math.ceil(remainingHours)} часов`,
        messagesPerHour,
      };
    } else {
      // Schedule for next working time
      const nextWorkTime = await getNextWorkingTime(userAccountId);
      
      const { data: settings } = await supabase
        .from('campaign_settings')
        .select('work_hours_start, work_hours_end')
        .eq('user_account_id', userAccountId)
        .single();

      const workHours = settings 
        ? settings.work_hours_end - settings.work_hours_start 
        : 10;
      
      const messagesPerHour = Math.ceil(messageCount / workHours);

      return {
        mode: 'scheduled',
        scheduledFor: nextWorkTime.toISOString(),
        nextWorkingTime: nextWorkTime.toLocaleString('ru-RU', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }),
        estimatedDuration: `${workHours} часов`,
        messagesPerHour,
      };
    }
  } catch (error: any) {
    log.error({ error: error.message, userAccountId }, 'Error determining schedule');
    
    // Fallback to scheduled mode
    return {
      mode: 'scheduled',
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      nextWorkingTime: 'завтра',
    };
  }
}

/**
 * Decide what to do with existing queue
 * Returns: 'replace', 'merge', or 'ask'
 */
export function decideQueueAction(existingQueue: ExistingQueueInfo): 'replace' | 'merge' | 'ask' {
  const hoursSinceCreated = getHoursSince(existingQueue.createdAt);

  // If sending already started, always merge
  if (existingQueue.hasSentMessages) {
    log.info({ existingCount: existingQueue.count }, 'Queue already sending, will merge');
    return 'merge';
  }

  // If queue is old (>2 hours), auto-replace
  if (hoursSinceCreated > 2) {
    log.info({ hoursSinceCreated, existingCount: existingQueue.count }, 'Old queue detected, will replace');
    return 'replace';
  }

  // Fresh queue (<2 hours), ask user
  log.info({ hoursSinceCreated, existingCount: existingQueue.count }, 'Fresh queue detected, asking user');
  return 'ask';
}

/**
 * Mark messages for manual send
 */
export async function markForManualSend(userAccountId: string): Promise<number> {
  const now = new Date().toISOString();

  const { error, count } = await supabase
    .from('campaign_messages')
    .update({ manual_send_requested_at: now })
    .eq('user_account_id', userAccountId)
    .in('status', ['pending', 'scheduled'])
    .is('manual_send_requested_at', null);

  if (error) {
    log.error({ error: error.message, userAccountId }, 'Failed to mark messages for manual send');
    return 0;
  }

  log.info({ userAccountId, count }, 'Messages marked for manual send');
  return count || 0;
}

