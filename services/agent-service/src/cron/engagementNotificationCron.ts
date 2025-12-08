/**
 * Engagement Notification CRON
 *
 * Ежедневно проверяет условия срабатывания уведомлений:
 * - По неактивности (3, 7, 14 дней без сессии)
 * - По застреванию на этапе онбординга
 * - Мотивационные (достижения)
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
  getDaysSinceLastSession,
  checkNotificationLimits,
  checkCooldown
} from '../lib/notificationService.js';
import {
  getInactivityTemplate,
  getOnboardingReminderTemplate,
  ACHIEVEMENT_FIRST_LEAD,
  ACHIEVEMENT_5_CREATIVES,
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
 * Приоритет: неактивность > онбординг > достижения
 */
async function determineNotification(user: UserForNotification): Promise<{
  template: any;
  priority: number;
} | null> {
  // Приоритет 1: Неактивность
  const daysSinceSession = await getDaysSinceLastSession(user.id);

  if (daysSinceSession !== null && daysSinceSession >= 3) {
    const template = getInactivityTemplate(daysSinceSession);
    if (template) {
      // Проверяем cooldown для конкретного типа неактивности
      const canSend = await checkCooldown(user.id, template.type, template.cooldownDays);
      if (canSend) {
        return { template, priority: 1 };
      }
    }
  }

  // Приоритет 2: Застревание на этапе онбординга (3+ дня)
  if (user.onboarding_stage && user.onboarding_stage !== 'active') {
    const template = getOnboardingReminderTemplate(user.onboarding_stage);
    if (template) {
      // Проверяем, сколько дней на текущем этапе
      const daysOnStage = await getDaysOnCurrentStage(user.id);
      if (daysOnStage !== null && daysOnStage >= 3) {
        const canSend = await checkCooldown(user.id, template.type, template.cooldownDays);
        if (canSend) {
          return { template, priority: 2 };
        }
      }
    }
  }

  // Приоритет 3: Достижения
  const achievementTemplate = await checkAchievements(user.id);
  if (achievementTemplate) {
    return { template: achievementTemplate, priority: 3 };
  }

  return null;
}

/**
 * Вычисляет количество дней на текущем этапе онбординга
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

  if (!data?.created_at) {
    // Если нет истории — берём дату регистрации
    const { data: user } = await supabase
      .from('user_accounts')
      .select('created_at')
      .eq('id', userId)
      .single();

    if (!user?.created_at) return null;

    const createdAt = new Date(user.created_at);
    const now = new Date();
    return Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  }

  const stageChangedAt = new Date(data.created_at);
  const now = new Date();
  return Math.floor((now.getTime() - stageChangedAt.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Проверяет достижения пользователя
 */
async function checkAchievements(userId: string): Promise<any | null> {
  // Проверка первого лида
  const canSendFirstLead = await checkCooldown(userId, 'achievement_first_lead', 9999);
  if (canSendFirstLead) {
    const { count: leadsCount } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('user_account_id', userId);

    if ((leadsCount ?? 0) > 0) {
      return ACHIEVEMENT_FIRST_LEAD;
    }
  }

  // Проверка 5 креативов
  const canSend5Creatives = await checkCooldown(userId, 'achievement_5_creatives', 9999);
  if (canSend5Creatives) {
    const { count: creativesCount } = await supabase
      .from('generated_creatives')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((creativesCount ?? 0) >= 5) {
      return ACHIEVEMENT_5_CREATIVES;
    }
  }

  return null;
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
          onboarding_stage: user.onboarding_stage
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
 * Расписание: каждый день в 04:00 UTC (10:00 по Алматы)
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
