import { supabase } from './supabase.js';
import { sendWhatsAppMessageWithRetry } from './evolutionApi.js';
import { logger } from './logger.js';

// ==================== INTERFACES ====================

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

interface NotificationResult {
  success: boolean;
  error?: string;
  notificationId?: string;
}

// ==================== CONSTANTS ====================

const DEFAULT_SETTINGS: NotificationSettings = {
  confirmation_enabled: true,
  confirmation_template: 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!',
  reminder_24h_enabled: true,
  reminder_24h_template: 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!',
  reminder_1h_enabled: true,
  reminder_1h_template: 'Через час у вас консультация в {{time}}. До скорой встречи!'
};

// Казахстанский часовой пояс (UTC+5)
const TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000;

// Максимум попыток для failed уведомлений
const MAX_RETRY_ATTEMPTS = 3;

// Минимальное время до консультации для планирования (5 минут)
const MIN_SCHEDULE_AHEAD_MS = 5 * 60 * 1000;

// ==================== UTILITY FUNCTIONS ====================

/**
 * Get current time in local timezone (UTC+5)
 */
function getLocalTime(): Date {
  return new Date(Date.now() + TIMEZONE_OFFSET_MS);
}

/**
 * Parse consultation datetime with local timezone (UTC+5)
 */
function parseConsultationDateTime(dateStr: string, timeStr: string): Date {
  // Предполагаем что дата/время в локальном времени (Казахстан UTC+5)
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Создаём дату как UTC, но с учётом что это локальное время (UTC+5)
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours - 5, minutes));
  return utcDate;
}

/**
 * Validate phone number format
 * Returns normalized phone or null if invalid
 */
function validateAndNormalizePhone(phone: string): string | null {
  if (!phone) return null;

  // Убираем все нецифровые символы
  const digits = phone.replace(/\D/g, '');

  // Минимум 10 цифр (российский номер без кода)
  if (digits.length < 10) {
    return null;
  }

  // Максимум 15 цифр (международный стандарт)
  if (digits.length > 15) {
    return null;
  }

  // Если 10 цифр и не начинается с 7 - добавляем 7 (Россия)
  if (digits.length === 10 && !digits.startsWith('7')) {
    return '7' + digits;
  }

  return digits;
}

/**
 * Format date to Russian format (e.g., "15 января")
 */
function formatDateRussian(dateStr: string): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${day} ${months[month - 1]}`;
}

/**
 * Format time to HH:MM
 */
function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5);
}

/**
 * Replace template variables with actual values
 * Supports:
 * - {{variable}} - simple replacement
 * - {{#variable}}text{{/variable}} - conditional (show text only if variable exists)
 */
function renderTemplate(template: string, variables: Record<string, string | undefined>): string {
  let result = template;

  // Handle conditional sections: {{#variable}}text{{/variable}}
  result = result.replace(/\{\{#(\w+)\}\}(.*?)\{\{\/\1\}\}/gs, (match, varName, content) => {
    const value = variables[varName];
    return value && value.trim() ? content : '';
  });

  // Replace simple variables: {{variable}}
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }

  // Убираем лишние пробелы
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Create a child logger with context
 */
function createNotificationLogger(context: Record<string, any>) {
  return {
    debug: (msg: string, extra?: Record<string, any>) =>
      logger.debug({ ...context, ...extra }, `[Notification] ${msg}`),
    info: (msg: string, extra?: Record<string, any>) =>
      logger.info({ ...context, ...extra }, `[Notification] ${msg}`),
    warn: (msg: string, extra?: Record<string, any>) =>
      logger.warn({ ...context, ...extra }, `[Notification] ${msg}`),
    error: (msg: string, extra?: Record<string, any>) =>
      logger.error({ ...context, ...extra }, `[Notification] ${msg}`)
  };
}

// ==================== DATA ACCESS ====================

/**
 * Get WhatsApp instance name for sending notification
 */
async function getInstanceName(
  userAccountId: string,
  dialogAnalysisId?: string
): Promise<string | null> {
  const log = createNotificationLogger({ userAccountId, dialogAnalysisId });

  // Если есть dialog_analysis_id - берём инстанс оттуда
  if (dialogAnalysisId) {
    log.debug('Looking for instance in dialog_analysis');

    const { data: dialog, error } = await supabase
      .from('dialog_analysis')
      .select('instance_name')
      .eq('id', dialogAnalysisId)
      .single();

    if (error) {
      log.warn('Failed to get instance from dialog_analysis', { error: error.message });
    } else if (dialog?.instance_name) {
      log.debug('Found instance from dialog_analysis', { instanceName: dialog.instance_name });
      return dialog.instance_name;
    }
  }

  // Fallback: первый активный connected инстанс пользователя
  log.debug('Looking for first connected instance');

  const { data: instance, error } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_account_id', userAccountId)
    .eq('status', 'connected')
    .limit(1)
    .single();

  if (error) {
    log.warn('Failed to get connected instance', { error: error.message });
    return null;
  }

  if (instance?.instance_name) {
    log.debug('Found connected instance', { instanceName: instance.instance_name });
    return instance.instance_name;
  }

  log.warn('No WhatsApp instance found');
  return null;
}

/**
 * Get consultant name by ID
 */
async function getConsultantName(consultantId: string): Promise<string> {
  const { data, error } = await supabase
    .from('consultants')
    .select('name')
    .eq('id', consultantId)
    .single();

  if (error) {
    logger.warn({ consultantId, error: error.message }, '[Notification] Failed to get consultant name');
    return '';
  }

  return data?.name || '';
}

/**
 * Get notification settings for user account
 */
async function getNotificationSettings(userAccountId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from('consultation_notification_settings')
    .select('*')
    .eq('user_account_id', userAccountId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.warn({ userAccountId, error: error.message }, '[Notification] Failed to get settings, using defaults');
  }

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
  const { data, error } = await supabase
    .from('consultation_notification_templates')
    .select('*')
    .eq('user_account_id', userAccountId)
    .eq('is_enabled', true);

  if (error) {
    logger.warn({ userAccountId, error: error.message }, '[Notification] Failed to get custom templates');
    return [];
  }

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
  errorMessage?: string,
  retryCount: number = 0
): Promise<string | null> {
  const { data, error } = await supabase
    .from('consultation_notifications')
    .insert({
      consultation_id: consultationId,
      notification_type: notificationType,
      template_id: templateId,
      message_text: messageText,
      instance_name: instanceName,
      phone,
      status,
      scheduled_at: scheduledAt?.toISOString(),
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      error_message: errorMessage,
      retry_count: retryCount
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ consultationId, error: error.message }, '[Notification] Failed to save notification');
    return null;
  }

  return data?.id || null;
}

/**
 * Update notification status
 */
async function updateNotificationStatus(
  notificationId: string,
  updates: {
    status?: 'pending' | 'sent' | 'failed' | 'skipped';
    instanceName?: string;
    sentAt?: Date;
    errorMessage?: string;
    retryCount?: number;
  }
): Promise<void> {
  const updateData: any = {};

  if (updates.status) updateData.status = updates.status;
  if (updates.instanceName) updateData.instance_name = updates.instanceName;
  if (updates.sentAt) updateData.sent_at = updates.sentAt.toISOString();
  if (updates.errorMessage !== undefined) updateData.error_message = updates.errorMessage;
  if (updates.retryCount !== undefined) updateData.retry_count = updates.retryCount;

  const { error } = await supabase
    .from('consultation_notifications')
    .update(updateData)
    .eq('id', notificationId);

  if (error) {
    logger.error({ notificationId, error: error.message }, '[Notification] Failed to update notification');
  }
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Send confirmation notification when consultation is created
 */
export async function sendConfirmationNotification(
  consultation: Consultation
): Promise<NotificationResult> {
  const log = createNotificationLogger({
    consultationId: consultation.id,
    clientPhone: consultation.client_phone,
    operation: 'sendConfirmation'
  });

  log.info('Starting confirmation notification');

  try {
    // Проверка user_account_id
    if (!consultation.user_account_id) {
      log.warn('No user_account_id, skipping');
      return { success: false, error: 'No user_account_id' };
    }

    // Валидация телефона
    const normalizedPhone = validateAndNormalizePhone(consultation.client_phone);
    if (!normalizedPhone) {
      log.error('Invalid phone number', { phone: consultation.client_phone });
      await saveNotification(
        consultation.id,
        'confirmation',
        '',
        null,
        consultation.client_phone,
        'failed',
        undefined,
        undefined,
        'Invalid phone number format'
      );
      return { success: false, error: 'Invalid phone number' };
    }

    log.debug('Phone validated', { normalizedPhone });

    // Получение настроек
    const settings = await getNotificationSettings(consultation.user_account_id);
    log.debug('Settings loaded', { confirmationEnabled: settings.confirmation_enabled });

    if (!settings.confirmation_enabled) {
      log.info('Confirmation disabled in settings');
      const notificationId = await saveNotification(
        consultation.id,
        'confirmation',
        '',
        null,
        normalizedPhone,
        'skipped'
      );
      return { success: true, notificationId: notificationId || undefined };
    }

    // Получение инстанса
    const instanceName = await getInstanceName(
      consultation.user_account_id,
      consultation.dialog_analysis_id
    );

    if (!instanceName) {
      log.error('No WhatsApp instance available');
      const notificationId = await saveNotification(
        consultation.id,
        'confirmation',
        '',
        null,
        normalizedPhone,
        'failed',
        undefined,
        undefined,
        'No WhatsApp instance found'
      );
      return { success: false, error: 'No WhatsApp instance found', notificationId: notificationId || undefined };
    }

    log.debug('Instance found', { instanceName });

    // Получение имени консультанта
    const consultantName = await getConsultantName(consultation.consultant_id);
    log.debug('Consultant name loaded', { consultantName });

    // Рендеринг шаблона
    const messageText = renderTemplate(settings.confirmation_template, {
      client_name: consultation.client_name,
      date: formatDateRussian(consultation.date),
      time: formatTime(consultation.start_time),
      consultant_name: consultantName
    });

    log.debug('Message rendered', { messageLength: messageText.length });

    // Отправка
    log.info('Sending WhatsApp message', { instanceName, phone: normalizedPhone });

    const result = await sendWhatsAppMessageWithRetry({
      instanceName,
      phone: normalizedPhone,
      message: messageText
    });

    // Сохранение результата
    const notificationId = await saveNotification(
      consultation.id,
      'confirmation',
      messageText,
      instanceName,
      normalizedPhone,
      result.success ? 'sent' : 'failed',
      undefined,
      undefined,
      result.error
    );

    if (result.success) {
      log.info('Confirmation sent successfully', { notificationId });
    } else {
      log.error('Failed to send confirmation', { error: result.error, notificationId });
    }

    return { ...result, notificationId: notificationId || undefined };

  } catch (error: any) {
    log.error('Unexpected error', { error: error.message, stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Schedule reminder notifications for a consultation
 */
export async function scheduleReminderNotifications(
  consultation: Consultation
): Promise<{ scheduled: number; skipped: number }> {
  const log = createNotificationLogger({
    consultationId: consultation.id,
    operation: 'scheduleReminders'
  });

  log.info('Starting to schedule reminders');

  let scheduled = 0;
  let skipped = 0;

  try {
    if (!consultation.user_account_id) {
      log.warn('No user_account_id, skipping all reminders');
      return { scheduled: 0, skipped: 0 };
    }

    // Валидация телефона
    const normalizedPhone = validateAndNormalizePhone(consultation.client_phone);
    if (!normalizedPhone) {
      log.error('Invalid phone number, skipping reminders');
      return { scheduled: 0, skipped: 0 };
    }

    const settings = await getNotificationSettings(consultation.user_account_id);
    const consultantName = await getConsultantName(consultation.consultant_id);

    // Расчёт времени консультации
    const consultationDateTime = parseConsultationDateTime(consultation.date, consultation.start_time);
    const now = new Date();

    log.debug('Consultation time calculated', {
      consultationDateTime: consultationDateTime.toISOString(),
      now: now.toISOString()
    });

    const variables = {
      client_name: consultation.client_name,
      date: formatDateRussian(consultation.date),
      time: formatTime(consultation.start_time),
      consultant_name: consultantName
    };

    // Функция для добавления напоминания
    const scheduleReminder = async (
      type: string,
      enabled: boolean,
      template: string,
      minutesBefore: number,
      templateId?: string
    ) => {
      if (!enabled) {
        log.debug(`Reminder ${type} disabled`);
        return;
      }

      const scheduledAt = new Date(consultationDateTime.getTime() - minutesBefore * 60 * 1000);

      // Проверяем что время в будущем (с запасом)
      if (scheduledAt.getTime() <= now.getTime() + MIN_SCHEDULE_AHEAD_MS) {
        log.info(`Reminder ${type} skipped - scheduled time already passed`, {
          scheduledAt: scheduledAt.toISOString(),
          minutesBefore
        });
        skipped++;
        return;
      }

      const messageText = renderTemplate(template, variables);

      const notificationId = await saveNotification(
        consultation.id,
        type,
        messageText,
        null,
        normalizedPhone,
        'pending',
        scheduledAt,
        templateId
      );

      log.info(`Reminder ${type} scheduled`, {
        notificationId,
        scheduledAt: scheduledAt.toISOString(),
        minutesBefore
      });

      scheduled++;
    };

    // Стандартные напоминания
    await scheduleReminder('reminder_24h', settings.reminder_24h_enabled, settings.reminder_24h_template, 24 * 60);
    await scheduleReminder('reminder_1h', settings.reminder_1h_enabled, settings.reminder_1h_template, 60);

    // Кастомные шаблоны
    const customTemplates = await getCustomTemplates(consultation.user_account_id);
    log.debug('Custom templates loaded', { count: customTemplates.length });

    for (const template of customTemplates) {
      await scheduleReminder(
        'custom',
        true,
        template.template,
        template.minutes_before,
        template.id
      );
    }

    log.info('Reminders scheduling completed', { scheduled, skipped });
    return { scheduled, skipped };

  } catch (error: any) {
    log.error('Failed to schedule reminders', { error: error.message, stack: error.stack });
    return { scheduled, skipped };
  }
}

/**
 * Cancel all pending notifications for a consultation
 * Call this when consultation is cancelled
 */
export async function cancelPendingNotifications(consultationId: string): Promise<number> {
  const log = createNotificationLogger({ consultationId, operation: 'cancelNotifications' });

  log.info('Cancelling pending notifications');

  try {
    const { data, error } = await supabase
      .from('consultation_notifications')
      .update({ status: 'skipped', error_message: 'Consultation cancelled' })
      .eq('consultation_id', consultationId)
      .eq('status', 'pending')
      .select('id');

    if (error) {
      log.error('Failed to cancel notifications', { error: error.message });
      return 0;
    }

    const count = data?.length || 0;
    log.info('Notifications cancelled', { count });
    return count;

  } catch (error: any) {
    log.error('Unexpected error', { error: error.message });
    return 0;
  }
}

/**
 * Process pending notifications (called by cron)
 * Uses optimistic locking to prevent race conditions
 */
export async function processPendingNotifications(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const log = createNotificationLogger({ operation: 'processPending' });

  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  try {
    const now = new Date();

    // Получаем pending уведомления со статусом консультации
    // Используем FOR UPDATE SKIP LOCKED для предотвращения race conditions
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
      .order('scheduled_at', { ascending: true })
      .limit(50); // Обрабатываем по 50 за раз

    if (error) {
      log.error('Failed to fetch pending notifications', { error: error.message });
      return stats;
    }

    if (!notifications || notifications.length === 0) {
      return stats;
    }

    log.info('Processing batch', { count: notifications.length });

    for (const notification of notifications) {
      stats.processed++;

      const notifLog = createNotificationLogger({
        notificationId: notification.id,
        consultationId: notification.consultation_id,
        type: notification.notification_type
      });

      try {
        // Проверяем статус консультации
        if (notification.consultation?.status === 'cancelled') {
          notifLog.info('Consultation cancelled, skipping notification');
          await updateNotificationStatus(notification.id, {
            status: 'skipped',
            errorMessage: 'Consultation was cancelled'
          });
          stats.skipped++;
          continue;
        }

        // Проверяем валидность телефона
        const normalizedPhone = validateAndNormalizePhone(notification.phone);
        if (!normalizedPhone) {
          notifLog.error('Invalid phone number');
          await updateNotificationStatus(notification.id, {
            status: 'failed',
            errorMessage: 'Invalid phone number'
          });
          stats.failed++;
          continue;
        }

        // Получаем инстанс
        const instanceName = await getInstanceName(
          notification.consultation.user_account_id,
          notification.consultation.dialog_analysis_id
        );

        if (!instanceName) {
          notifLog.error('No WhatsApp instance found');
          await updateNotificationStatus(notification.id, {
            status: 'failed',
            errorMessage: 'No WhatsApp instance found'
          });
          stats.failed++;
          continue;
        }

        notifLog.info('Sending notification', { instanceName, phone: normalizedPhone });

        // Отправляем
        const result = await sendWhatsAppMessageWithRetry({
          instanceName,
          phone: normalizedPhone,
          message: notification.message_text
        });

        if (result.success) {
          await updateNotificationStatus(notification.id, {
            status: 'sent',
            instanceName,
            sentAt: new Date()
          });
          notifLog.info('Notification sent successfully');
          stats.sent++;
        } else {
          const retryCount = (notification.retry_count || 0) + 1;

          if (retryCount >= MAX_RETRY_ATTEMPTS) {
            await updateNotificationStatus(notification.id, {
              status: 'failed',
              instanceName,
              errorMessage: `Failed after ${MAX_RETRY_ATTEMPTS} attempts: ${result.error}`,
              retryCount
            });
            notifLog.error('Notification failed permanently', { retryCount, error: result.error });
            stats.failed++;
          } else {
            // Оставляем pending для повторной попытки
            await updateNotificationStatus(notification.id, {
              instanceName,
              errorMessage: result.error,
              retryCount
            });
            notifLog.warn('Notification failed, will retry', { retryCount, error: result.error });
            // Не считаем как failed, будет повторная попытка
          }
        }

        // Задержка между сообщениями (1-2 секунды)
        const delay = 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error: any) {
        notifLog.error('Error processing notification', { error: error.message });
        await updateNotificationStatus(notification.id, {
          status: 'failed',
          errorMessage: `Processing error: ${error.message}`
        });
        stats.failed++;
      }
    }

    log.info('Batch processing completed', stats);
    return stats;

  } catch (error: any) {
    log.error('Fatal error in processPendingNotifications', { error: error.message, stack: error.stack });
    return stats;
  }
}

/**
 * Retry failed notifications (can be called manually or by separate cron)
 */
export async function retryFailedNotifications(): Promise<number> {
  const log = createNotificationLogger({ operation: 'retryFailed' });

  try {
    // Получаем failed уведомления с retry_count < MAX
    const { data: notifications, error } = await supabase
      .from('consultation_notifications')
      .select('id')
      .eq('status', 'failed')
      .lt('retry_count', MAX_RETRY_ATTEMPTS)
      .limit(20);

    if (error || !notifications?.length) {
      return 0;
    }

    // Переводим обратно в pending для повторной обработки
    const ids = notifications.map(n => n.id);

    const { error: updateError } = await supabase
      .from('consultation_notifications')
      .update({ status: 'pending' })
      .in('id', ids);

    if (updateError) {
      log.error('Failed to reset notifications for retry', { error: updateError.message });
      return 0;
    }

    log.info('Notifications queued for retry', { count: ids.length });
    return ids.length;

  } catch (error: any) {
    log.error('Error in retryFailedNotifications', { error: error.message });
    return 0;
  }
}

/**
 * Get notification statistics for monitoring
 */
export async function getNotificationStats(userAccountId?: string): Promise<{
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}> {
  let query = supabase.from('consultation_notifications').select('status');

  if (userAccountId) {
    query = query.eq('consultation.user_account_id', userAccountId);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { pending: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
  }

  return {
    pending: data.filter(n => n.status === 'pending').length,
    sent: data.filter(n => n.status === 'sent').length,
    failed: data.filter(n => n.status === 'failed').length,
    skipped: data.filter(n => n.status === 'skipped').length,
    total: data.length
  };
}
