import { supabase } from './supabase.js';
import { sendWhatsAppMessageWithRetry } from './evolutionApi.js';
import { logger } from './logger.js';

interface Consultation {
  id: string;
  consultant_id: string;
  user_account_id: string;
  client_phone: string;
  client_name?: string;
  dialog_analysis_id?: string;
  date: string;
  start_time: string;
  end_time: string;
}

interface NotificationSettings {
  confirmation_enabled: boolean;
  confirmation_template: string;
  reminder_24h_enabled: boolean;
  reminder_24h_template: string;
  reminder_1h_enabled: boolean;
  reminder_1h_template: string;
}

interface CustomTemplate {
  id: string;
  name: string;
  minutes_before: number;
  template: string;
  is_enabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  confirmation_enabled: true,
  confirmation_template: 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!',
  reminder_24h_enabled: true,
  reminder_24h_template: 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!',
  reminder_1h_enabled: true,
  reminder_1h_template: 'Через час у вас консультация в {{time}}. До скорой встречи!'
};

/**
 * Format date to Russian format (e.g., "15 января")
 */
function formatDateRussian(dateStr: string): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const date = new Date(dateStr);
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Format time to HH:MM
 */
function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5);
}

/**
 * Replace template variables with actual values
 */
function renderTemplate(template: string, variables: Record<string, string | undefined>): string {
  let result = template;

  // Handle conditional sections: {{#variable}}text{{/variable}}
  // Only show text if variable exists
  result = result.replace(/\{\{#(\w+)\}\}(.*?)\{\{\/\1\}\}/gs, (match, varName, content) => {
    return variables[varName] ? content : '';
  });

  // Replace simple variables: {{variable}}
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }

  return result.trim();
}

/**
 * Get WhatsApp instance name for sending notification
 */
async function getInstanceName(
  userAccountId: string,
  dialogAnalysisId?: string
): Promise<string | null> {
  // If we have dialog_analysis_id, get instance from there
  if (dialogAnalysisId) {
    const { data: dialog } = await supabase
      .from('dialog_analysis')
      .select('instance_name')
      .eq('id', dialogAnalysisId)
      .single();

    if (dialog?.instance_name) {
      return dialog.instance_name;
    }
  }

  // Fallback: get first active connected instance for user
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_account_id', userAccountId)
    .eq('status', 'connected')
    .limit(1)
    .single();

  return instance?.instance_name || null;
}

/**
 * Get consultant name by ID
 */
async function getConsultantName(consultantId: string): Promise<string> {
  const { data } = await supabase
    .from('consultants')
    .select('name')
    .eq('id', consultantId)
    .single();

  return data?.name || '';
}

/**
 * Get notification settings for user account
 */
async function getNotificationSettings(userAccountId: string): Promise<NotificationSettings> {
  const { data } = await supabase
    .from('consultation_notification_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .single();

  if (!data) {
    return DEFAULT_SETTINGS;
  }

  return {
    confirmation_enabled: data.confirmation_enabled ?? DEFAULT_SETTINGS.confirmation_enabled,
    confirmation_template: data.confirmation_template || DEFAULT_SETTINGS.confirmation_template,
    reminder_24h_enabled: data.reminder_24h_enabled ?? DEFAULT_SETTINGS.reminder_24h_enabled,
    reminder_24h_template: data.reminder_24h_template || DEFAULT_SETTINGS.reminder_24h_template,
    reminder_1h_enabled: data.reminder_1h_enabled ?? DEFAULT_SETTINGS.reminder_1h_enabled,
    reminder_1h_template: data.reminder_1h_template || DEFAULT_SETTINGS.reminder_1h_template
  };
}

/**
 * Get custom notification templates
 */
async function getCustomTemplates(userAccountId: string): Promise<CustomTemplate[]> {
  const { data } = await supabase
    .from('consultation_notification_templates')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('is_enabled', true);

  return data || [];
}

/**
 * Save notification to history
 */
async function saveNotification(
  consultationId: string,
  notificationType: string,
  messageText: string,
  instanceName: string | null,
  phone: string,
  status: 'pending' | 'sent' | 'failed' | 'skipped',
  scheduledAt?: Date,
  templateId?: string,
  errorMessage?: string
): Promise<void> {
  await supabase.from('consultation_notifications').insert({
    consultation_id: consultationId,
    notification_type: notificationType,
    template_id: templateId,
    message_text: messageText,
    instance_name: instanceName,
    phone,
    status,
    scheduled_at: scheduledAt?.toISOString(),
    sent_at: status === 'sent' ? new Date().toISOString() : null,
    error_message: errorMessage
  });
}

/**
 * Send confirmation notification when consultation is created
 */
export async function sendConfirmationNotification(
  consultation: Consultation
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!consultation.user_account_id) {
      logger.warn({ consultationId: consultation.id }, 'No user_account_id for consultation, skipping notification');
      return { success: false, error: 'No user_account_id' };
    }

    const settings = await getNotificationSettings(consultation.user_account_id);

    if (!settings.confirmation_enabled) {
      logger.info({ consultationId: consultation.id }, 'Confirmation notification disabled');
      await saveNotification(
        consultation.id,
        'confirmation',
        '',
        null,
        consultation.client_phone,
        'skipped'
      );
      return { success: true };
    }

    const instanceName = await getInstanceName(
      consultation.user_account_id,
      consultation.dialog_analysis_id
    );

    if (!instanceName) {
      logger.error({ consultationId: consultation.id }, 'No WhatsApp instance found');
      await saveNotification(
        consultation.id,
        'confirmation',
        '',
        null,
        consultation.client_phone,
        'failed',
        undefined,
        undefined,
        'No WhatsApp instance found'
      );
      return { success: false, error: 'No WhatsApp instance found' };
    }

    const consultantName = await getConsultantName(consultation.consultant_id);

    const messageText = renderTemplate(settings.confirmation_template, {
      client_name: consultation.client_name,
      date: formatDateRussian(consultation.date),
      time: formatTime(consultation.start_time),
      consultant_name: consultantName
    });

    const result = await sendWhatsAppMessageWithRetry({
      instanceName,
      phone: consultation.client_phone,
      message: messageText
    });

    await saveNotification(
      consultation.id,
      'confirmation',
      messageText,
      instanceName,
      consultation.client_phone,
      result.success ? 'sent' : 'failed',
      undefined,
      undefined,
      result.error
    );

    return result;
  } catch (error: any) {
    logger.error({ error: error.message, consultationId: consultation.id }, 'Failed to send confirmation');
    return { success: false, error: error.message };
  }
}

/**
 * Schedule reminder notifications for a consultation
 */
export async function scheduleReminderNotifications(
  consultation: Consultation
): Promise<void> {
  try {
    if (!consultation.user_account_id) {
      return;
    }

    const settings = await getNotificationSettings(consultation.user_account_id);
    const consultantName = await getConsultantName(consultation.consultant_id);

    // Calculate consultation datetime
    const consultationDateTime = new Date(`${consultation.date}T${consultation.start_time}`);

    const variables = {
      client_name: consultation.client_name,
      date: formatDateRussian(consultation.date),
      time: formatTime(consultation.start_time),
      consultant_name: consultantName
    };

    // 24 hours before
    if (settings.reminder_24h_enabled) {
      const scheduledAt = new Date(consultationDateTime.getTime() - 24 * 60 * 60 * 1000);
      const messageText = renderTemplate(settings.reminder_24h_template, variables);

      await saveNotification(
        consultation.id,
        'reminder_24h',
        messageText,
        null,
        consultation.client_phone,
        'pending',
        scheduledAt
      );
    }

    // 1 hour before
    if (settings.reminder_1h_enabled) {
      const scheduledAt = new Date(consultationDateTime.getTime() - 60 * 60 * 1000);
      const messageText = renderTemplate(settings.reminder_1h_template, variables);

      await saveNotification(
        consultation.id,
        'reminder_1h',
        messageText,
        null,
        consultation.client_phone,
        'pending',
        scheduledAt
      );
    }

    // Custom templates
    const customTemplates = await getCustomTemplates(consultation.user_account_id);

    for (const template of customTemplates) {
      const scheduledAt = new Date(
        consultationDateTime.getTime() - template.minutes_before * 60 * 1000
      );
      const messageText = renderTemplate(template.template, variables);

      await saveNotification(
        consultation.id,
        'custom',
        messageText,
        null,
        consultation.client_phone,
        'pending',
        scheduledAt,
        template.id
      );
    }

    logger.info({ consultationId: consultation.id }, 'Reminder notifications scheduled');
  } catch (error: any) {
    logger.error({ error: error.message, consultationId: consultation.id }, 'Failed to schedule reminders');
  }
}

/**
 * Process pending notifications (called by cron)
 */
export async function processPendingNotifications(): Promise<void> {
  try {
    const now = new Date();

    // Get pending notifications that should be sent now
    const { data: notifications, error } = await supabase
      .from('consultation_notifications')
      .select(`
        *,
        consultation:consultations!inner(
          id,
          consultant_id,
          user_account_id,
          client_phone,
          dialog_analysis_id,
          status
        )
      `)
      .eq('status', 'pending')
      .lte('scheduled_at', now.toISOString())
      .limit(100);

    if (error) {
      logger.error({ error }, 'Failed to fetch pending notifications');
      return;
    }

    if (!notifications || notifications.length === 0) {
      return;
    }

    logger.info({ count: notifications.length }, 'Processing pending notifications');

    for (const notification of notifications) {
      // Skip if consultation was cancelled
      if (notification.consultation?.status === 'cancelled') {
        await supabase
          .from('consultation_notifications')
          .update({ status: 'skipped' })
          .eq('id', notification.id);
        continue;
      }

      const instanceName = await getInstanceName(
        notification.consultation.user_account_id,
        notification.consultation.dialog_analysis_id
      );

      if (!instanceName) {
        await supabase
          .from('consultation_notifications')
          .update({
            status: 'failed',
            error_message: 'No WhatsApp instance found'
          })
          .eq('id', notification.id);
        continue;
      }

      const result = await sendWhatsAppMessageWithRetry({
        instanceName,
        phone: notification.phone,
        message: notification.message_text
      });

      await supabase
        .from('consultation_notifications')
        .update({
          instance_name: instanceName,
          status: result.success ? 'sent' : 'failed',
          sent_at: result.success ? new Date().toISOString() : null,
          error_message: result.error
        })
        .eq('id', notification.id);

      // Small delay between messages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to process pending notifications');
  }
}
