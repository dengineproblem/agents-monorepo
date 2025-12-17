/**
 * Engagement Notification CRON
 *
 * Ежедневно проверяет условия срабатывания уведомлений:
 * - По застреванию на этапе онбординга (3+ дня)
 *
 * Расписание: каждый день в 10:00 по Алматы (04:00 UTC)
 *
 * @module cron/engagementNotificationCron
 */

import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import {
  getNotificationSettings,
  sendEngagementNotification,
  checkNotificationLimits,
  checkCooldown
} from '../lib/notificationService.js';
import {
  getOnboardingReminderTemplate,
  OnboardingStage
} from '../lib/notificationTemplates.js';

const logger = createLogger({ module: 'engagementNotificationCron' });

// =====================================================
// Типы
// =====================================================

interface UserForNotification {
  id: string;
  username: string;
  telegram_id: string | null;
  onboarding_stage: OnboardingStage;
  last_session_at: string | null;
  created_at: string;
}

// =====================================================
// Получение пользователей
// =====================================================

/**
 * Получает всех активных пользователей для проверки уведомлений
 */
async function getActiveUsers(): Promise<UserForNotification[]> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('id, username, telegram_id, onboarding_stage, last_session_at, created_at')
    .eq('is_tech_admin', false)
    .neq('onboarding_stage', 'inactive');

  if (error) {
    logger.error({ error: error.message }, 'Failed to fetch users for notifications');
    return [];
  }

  return data || [];
}

// =====================================================
// Определение уведомления для пользователя
// =====================================================

/**
 * Определяет, какое уведомление отправить пользователю
 * Только онбординг уведомления (остальные отключены)
 */
async function determineNotification(user: UserForNotification): Promise<{
  template: any;
  priority: number;
  metadata?: Record<string, unknown>;
} | null> {
  // Только онбординг: застревание на этапе (3+ дня)
  if (user.onboarding_stage && user.onboarding_stage !== 'active') {
    const template = getOnboardingReminderTemplate(user.onboarding_stage);
    if (template) {
      const daysOnStage = await getDaysOnCurrentStage(user.id);
      if (daysOnStage !== null && daysOnStage >= 3) {
        const canSend = await checkCooldown(user.id, template.type, template.cooldownDays);
        if (canSend) {
          return { template, priority: 1 };
        }
      }
    }
  }

  return null;
}

/**
 * Вычисляет количество дней на текущем этапе онбординга
 * Возвращает null если нет записи в onboarding_history — не отправляем уведомление
 */
async function getDaysOnCurrentStage(userId: string): Promise<number | null> {
  // Берём последнюю запись из onboarding_history
  const { data } = await supabase
    .from('onboarding_history')
    .select('created_at')
    .eq('user_account_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Если нет истории — не можем определить, сколько дней на этапе
  if (!data?.created_at) {
    return null;
  }

  const stageChangedAt = new Date(data.created_at);
  const now = new Date();
  return Math.floor((now.getTime() - stageChangedAt.getTime()) / (1000 * 60 * 60 * 24));
}


// =====================================================
// Основная функция
// =====================================================

/**
 * Основная функция обработки уведомлений
 */
async function processEngagementNotifications(): Promise<void> {
  logger.info('Starting engagement notifications processing');

  // 1. Получить настройки
  const settings = await getNotificationSettings();
  if (!settings?.is_active) {
    logger.info('Engagement notifications are disabled');
    return;
  }

  // 2. Получить всех пользователей
  const users = await getActiveUsers();
  logger.info({ usersCount: users.length }, 'Users to check for notifications');

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  // 3. Для каждого пользователя
  for (const user of users) {
    try {
      // 3.1 Проверить лимиты
      const limits = await checkNotificationLimits(user.id);
      if (!limits.canSend) {
        skipped++;
        continue;
      }

      // 3.2 Определить уведомление
      const notification = await determineNotification(user);
      if (!notification) {
        continue; // Нет подходящего уведомления
      }

      // 3.3 Отправить уведомление
      const result = await sendEngagementNotification({
        userId: user.id,
        template: notification.template,
        metadata: {
          source: 'engagement_cron',
          priority: notification.priority,
          onboarding_stage: user.onboarding_stage,
          ...notification.metadata
        }
      });

      if (result.success) {
        sent++;
        logger.info({
          userId: user.id,
          username: user.username,
          type: notification.template.type,
          telegramSent: result.telegramSent,
          inAppCreated: result.inAppCreated
        }, 'Notification sent');
      } else if (result.error) {
        // Не считаем как ошибку если это cooldown или limit
        if (result.error !== 'In cooldown' && result.error !== 'Limit reached' && result.error !== 'Type disabled') {
          errors++;
        }
      }
    } catch (err) {
      errors++;
      logger.error({
        error: String(err),
        userId: user.id
      }, 'Error processing user for notifications');
    }
  }

  logger.info({
    totalUsers: users.length,
    sent,
    skipped,
    errors
  }, 'Engagement notifications processing completed');
}

// =====================================================
// Экспорт CRON
// =====================================================

/**
 * Запускает CRON для engagement уведомлений
 * Расписание: ежедневно в 04:00 UTC (10:00 по Алматы)
 */
export function startEngagementNotificationCron(app: FastifyInstance): void {
  app.log.info('Engagement notification cron started (runs daily at 10:00 Almaty / 04:00 UTC)');

  // Каждый день в 04:00 UTC = 10:00 Алматы
  cron.schedule('0 4 * * *', async () => {
    try {
      await processEngagementNotifications();
    } catch (err) {
      app.log.error({ error: String(err) }, '[EngagementNotificationCron] Unexpected error');
    }
  });
}

/**
 * Ручной запуск для тестирования
 */
export async function runEngagementNotificationsManually(): Promise<void> {
  await processEngagementNotifications();
}
