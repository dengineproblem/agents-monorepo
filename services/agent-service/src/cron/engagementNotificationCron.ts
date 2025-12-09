/**
 * Engagement Notification CRON
 *
 * Ежедневно проверяет условия срабатывания уведомлений:
 * - По неактивности (3, 7, 14 дней без сессии)
 * - По застреванию на этапе онбординга
 * - Мотивационные (достижения)
 * - Алерт по высокой стоимости заявки (3+ дня выше плановой)
 *
 * Еженедельно (понедельник):
 * - Еженедельный отчёт по рекламе
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
  checkCooldown,
  APP_BASE_URL
} from '../lib/notificationService.js';
import {
  getInactivityTemplate,
  getOnboardingReminderTemplate,
  ACHIEVEMENT_FIRST_LEAD,
  HIGH_CPL_ALERT,
  WEEKLY_REPORT,
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
 * Приоритет: неактивность > онбординг > высокий CPL > достижения
 */
async function determineNotification(user: UserForNotification): Promise<{
  template: any;
  priority: number;
  metadata?: Record<string, unknown>;
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

  // Приоритет 3: Высокая стоимость заявки 3+ дня
  const canSendHighCPL = await checkCooldown(user.id, 'high_cpl_alert', HIGH_CPL_ALERT.cooldownDays);
  if (canSendHighCPL) {
    const highCplDirection = await checkHighCPL(user.id);
    if (highCplDirection) {
      return {
        template: HIGH_CPL_ALERT,
        priority: 3,
        metadata: {
          direction_id: highCplDirection.direction_id,
          direction_name: highCplDirection.direction_name,
          target_cpl: highCplDirection.target_cpl_cents / 100,
          avg_cpl: highCplDirection.avg_cpl_cents / 100,
          days_above_target: highCplDirection.days_above_target
        }
      };
    }
  }

  // Приоритет 4: Достижения
  const achievementTemplate = await checkAchievements(user.id);
  if (achievementTemplate) {
    return { template: achievementTemplate, priority: 4 };
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

  return null;
}

// =====================================================
// Проверка высокой стоимости заявки
// =====================================================

interface DirectionWithMetrics {
  direction_id: string;
  direction_name: string;
  target_cpl_cents: number;
  avg_cpl_cents: number;
  days_above_target: number;
}

/**
 * Проверяет, есть ли у пользователя направления с высоким CPL 3+ дня подряд
 */
async function checkHighCPL(userId: string): Promise<DirectionWithMetrics | null> {
  // Получаем направления пользователя с целевым CPL
  const { data: directions } = await supabase
    .from('account_directions')
    .select('id, name, target_cpl_cents')
    .eq('user_account_id', userId)
    .eq('is_active', true);

  if (!directions || directions.length === 0) return null;

  // Для каждого направления проверяем последние 3 дня
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

  for (const direction of directions) {
    // Получаем метрики за последние 3 дня по кампаниям этого направления
    const { data: metrics } = await supabase
      .from('creative_metrics_history')
      .select('date, spend, leads')
      .eq('user_account_id', userId)
      .gte('date', threeDaysAgoStr)
      .eq('source', 'production');

    if (!metrics || metrics.length === 0) continue;

    // Группируем по дням и считаем CPL
    const dailyMetrics: Record<string, { spend: number; leads: number }> = {};
    for (const m of metrics) {
      if (!dailyMetrics[m.date]) {
        dailyMetrics[m.date] = { spend: 0, leads: 0 };
      }
      dailyMetrics[m.date].spend += parseFloat(m.spend) || 0;
      dailyMetrics[m.date].leads += m.leads || 0;
    }

    // Проверяем, что все 3 дня CPL выше целевого
    const days = Object.keys(dailyMetrics).sort();
    if (days.length < 3) continue;

    let daysAboveTarget = 0;
    let totalSpend = 0;
    let totalLeads = 0;

    for (const day of days.slice(-3)) {
      const { spend, leads } = dailyMetrics[day];
      totalSpend += spend;
      totalLeads += leads;

      if (leads > 0) {
        const cplCents = Math.round((spend / leads) * 100);
        if (cplCents > direction.target_cpl_cents) {
          daysAboveTarget++;
        }
      } else if (spend > 0) {
        // Нет лидов, но есть траты — тоже плохо
        daysAboveTarget++;
      }
    }

    if (daysAboveTarget >= 3) {
      const avgCplCents = totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) : 0;
      return {
        direction_id: direction.id,
        direction_name: direction.name,
        target_cpl_cents: direction.target_cpl_cents,
        avg_cpl_cents: avgCplCents,
        days_above_target: daysAboveTarget
      };
    }
  }

  return null;
}

// =====================================================
// Еженедельный отчёт
// =====================================================

interface WeeklyStats {
  totalSpend: number;
  totalLeads: number;
  qualifiedLeads: number;
  qualityPercent: number;
  avgCpl: number;
  revenue: number;
  roi: number | null;
}

/**
 * Собирает статистику за неделю для пользователя
 */
async function getWeeklyStats(userId: string): Promise<WeeklyStats | null> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  // Получаем метрики из creative_metrics_history
  const { data: metrics } = await supabase
    .from('creative_metrics_history')
    .select('spend, leads')
    .eq('user_account_id', userId)
    .gte('date', sevenDaysAgoStr)
    .eq('source', 'production');

  if (!metrics || metrics.length === 0) return null;

  let totalSpend = 0;
  let totalLeads = 0;

  for (const m of metrics) {
    totalSpend += parseFloat(m.spend) || 0;
    totalLeads += m.leads || 0;
  }

  // Если не было трат — не отправляем отчёт
  if (totalSpend === 0) return null;

  // Получаем лиды из таблицы leads для качества
  const { data: leadsData, count: leadsCount } = await supabase
    .from('leads')
    .select('id, is_qualified, reached_key_stage', { count: 'exact' })
    .eq('user_account_id', userId)
    .gte('created_at', sevenDaysAgo.toISOString());

  const qualifiedLeads = leadsData?.filter(l => l.is_qualified || l.reached_key_stage).length ?? 0;
  const actualLeadsCount = leadsCount ?? totalLeads;
  const qualityPercent = actualLeadsCount > 0 ? Math.round((qualifiedLeads / actualLeadsCount) * 100) : 0;

  // Получаем продажи для ROI
  const { data: purchases } = await supabase
    .from('purchases')
    .select('amount')
    .eq('user_account_id', userId)
    .gte('created_at', sevenDaysAgo.toISOString());

  let revenue = 0;
  for (const p of purchases || []) {
    revenue += parseFloat(p.amount) || 0;
  }

  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const roi = totalSpend > 0 ? ((revenue - totalSpend) / totalSpend) * 100 : null;

  return {
    totalSpend,
    totalLeads: actualLeadsCount,
    qualifiedLeads,
    qualityPercent,
    avgCpl,
    revenue,
    roi
  };
}

/**
 * Форматирует число как валюту
 */
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Отправляет еженедельный отчёт пользователю
 */
async function sendWeeklyReport(userId: string): Promise<boolean> {
  const canSend = await checkCooldown(userId, 'weekly_report', 7);
  if (!canSend) return false;

  const stats = await getWeeklyStats(userId);
  if (!stats) return false;

  // Формируем динамическое сообщение для Telegram
  const roiText = stats.roi !== null
    ? `ROI: ${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`
    : 'ROI: нет данных о продажах';

  const telegramMessage = `<b>📊 Еженедельный отчёт</b>

<b>Расходы:</b> ${formatCurrency(stats.totalSpend)}
<b>Лиды:</b> ${stats.totalLeads}
<b>Качество лидов:</b> ${stats.qualityPercent}% (${stats.qualifiedLeads} квалифицированных)
<b>Средний CPL:</b> ${formatCurrency(stats.avgCpl)}
${stats.revenue > 0 ? `<b>Доход:</b> ${formatCurrency(stats.revenue)}\n` : ''}<b>${roiText}</b>

<a href="${APP_BASE_URL}/roi">Подробная аналитика</a>`;

  // Создаём кастомный шаблон с динамическим сообщением
  const customTemplate = {
    ...WEEKLY_REPORT,
    telegramMessage,
    message: `За неделю: ${formatCurrency(stats.totalSpend)} потрачено, ${stats.totalLeads} лидов, ${stats.qualityPercent}% качество`
  };

  const result = await sendEngagementNotification({
    userId,
    template: customTemplate,
    metadata: {
      source: 'weekly_report_cron',
      stats
    }
  });

  return result.success;
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

/**
 * Отправка еженедельных отчётов всем пользователям
 */
async function processWeeklyReports(): Promise<void> {
  logger.info('Starting weekly reports processing');

  // 1. Получить настройки
  const settings = await getNotificationSettings();
  if (!settings?.is_active) {
    logger.info('Notifications are disabled, skipping weekly reports');
    return;
  }

  // 2. Получить всех активных пользователей
  const users = await getActiveUsers();
  logger.info({ usersCount: users.length }, 'Users to send weekly reports');

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  // 3. Для каждого пользователя
  for (const user of users) {
    try {
      // Проверить лимиты
      const limits = await checkNotificationLimits(user.id);
      if (!limits.canSend) {
        skipped++;
        continue;
      }

      // Отправить еженедельный отчёт
      const success = await sendWeeklyReport(user.id);
      if (success) {
        sent++;
        logger.info({
          userId: user.id,
          username: user.username
        }, 'Weekly report sent');
      }
    } catch (err) {
      errors++;
      logger.error({
        error: String(err),
        userId: user.id
      }, 'Error sending weekly report');
    }
  }

  logger.info({
    totalUsers: users.length,
    sent,
    skipped,
    errors
  }, 'Weekly reports processing completed');
}

// =====================================================
// Экспорт CRON
// =====================================================

/**
 * Запускает CRON для engagement уведомлений
 * Расписание:
 * - Ежедневно в 04:00 UTC (10:00 по Алматы) — engagement уведомления
 * - Понедельник в 05:00 UTC (11:00 по Алматы) — еженедельные отчёты
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

  // Каждый понедельник в 05:00 UTC = 11:00 Алматы (еженедельные отчёты)
  app.log.info('Weekly reports cron started (runs Monday at 11:00 Almaty / 05:00 UTC)');
  cron.schedule('0 5 * * 1', async () => {
    try {
      await processWeeklyReports();
    } catch (err) {
      app.log.error({ error: String(err) }, '[WeeklyReportsCron] Unexpected error');
    }
  });
}

/**
 * Ручной запуск для тестирования
 */
export async function runEngagementNotificationsManually(): Promise<void> {
  await processEngagementNotifications();
}

/**
 * Ручной запуск еженедельных отчётов для тестирования
 */
export async function runWeeklyReportsManually(): Promise<void> {
  await processWeeklyReports();
}
