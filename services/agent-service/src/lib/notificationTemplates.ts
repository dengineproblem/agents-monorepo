/**
 * Notification Templates
 *
 * Шаблоны уведомлений для вовлечения пользователей
 * Каждый шаблон содержит тексты для Telegram и In-App
 *
 * @module lib/notificationTemplates
 */

import { NotificationTemplate, APP_BASE_URL } from './notificationService.js';

// =====================================================
// Шаблоны по неактивности
// =====================================================

export const INACTIVE_3D: NotificationTemplate = {
  type: 'inactive_3d',
  title: 'Ваши деньги работают. А вы в курсе?',
  message: '3 дня без вас — а реклама крутится. Зайдите посмотреть, что там.',
  telegramMessage: `<b>Ваши деньги работают. А вы в курсе?</b>

3 дня без вас — а реклама крутится. Зайдите посмотреть, что там.

<a href="${APP_BASE_URL}">Посмотреть</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Посмотреть',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const INACTIVE_7D: NotificationTemplate = {
  type: 'inactive_7d',
  title: '7 дней. Сколько лидов вы пропустили?',
  message: 'Реклама работала всю неделю. Результаты ждут вас в личном кабинете.',
  telegramMessage: `<b>7 дней. Сколько лидов вы пропустили?</b>

Реклама работала всю неделю. Результаты ждут вас в личном кабинете.

<a href="${APP_BASE_URL}">Посмотреть результаты</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Посмотреть результаты',
  cooldownDays: 7,
  channels: ['telegram', 'in_app']
};

export const INACTIVE_14D: NotificationTemplate = {
  type: 'inactive_14d',
  title: '2 недели тишины. Конкуренты не спят.',
  message: 'Пока вас не было — данные копились. Зайдите, посмотрите цифры.',
  telegramMessage: `<b>2 недели тишины. Конкуренты не спят.</b>

Пока вас не было — данные копились. Зайдите, посмотрите цифры.

<a href="${APP_BASE_URL}">Посмотреть цифры</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Посмотреть цифры',
  cooldownDays: 14,
  channels: ['telegram', 'in_app']
};

// =====================================================
// Шаблоны по этапам онбординга
// =====================================================

export const ONBOARDING_REGISTERED: NotificationTemplate = {
  type: 'onboarding_registered',
  title: 'Без Facebook — нет рекламы',
  message: 'Первый шаг — подключить бизнес-аккаунт Facebook. Займёт пару минут.',
  telegramMessage: `<b>Без Facebook — нет рекламы</b>

Первый шаг — подключить бизнес-аккаунт Facebook. Займёт пару минут.

<a href="${APP_BASE_URL}/profile">Подключить</a>`,
  ctaUrl: `${APP_BASE_URL}/profile`,
  ctaLabel: 'Подключить',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_FB_PENDING: NotificationTemplate = {
  type: 'onboarding_fb_pending',
  title: 'Facebook висит на полпути',
  message: 'Подключение не завершено. Если что-то пошло не так — напишите, поможем.',
  telegramMessage: `<b>Facebook висит на полпути</b>

Подключение не завершено. Если что-то пошло не так — напишите, поможем.

<a href="${APP_BASE_URL}/profile">Продолжить</a>`,
  ctaUrl: `${APP_BASE_URL}/profile`,
  ctaLabel: 'Продолжить',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_FB_CONNECTED: NotificationTemplate = {
  type: 'onboarding_fb_connected',
  title: 'Facebook есть. Куда лить трафик?',
  message: 'Направление — это ваша аудитория и бюджет. Создайте его.',
  telegramMessage: `<b>Facebook есть. Куда лить трафик?</b>

Направление — это ваша аудитория и бюджет. Создайте его.

<a href="${APP_BASE_URL}/ad-settings">Создать направление</a>`,
  ctaUrl: `${APP_BASE_URL}/ad-settings`,
  ctaLabel: 'Создать направление',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_DIRECTION_CREATED: NotificationTemplate = {
  type: 'onboarding_direction_created',
  title: 'Направление готово. Где креативы?',
  message: 'Без контента реклама не запустится. Загрузите или сгенерируйте креативы.',
  telegramMessage: `<b>Направление готово. Где креативы?</b>

Без контента реклама не запустится. Загрузите или сгенерируйте креативы.

<a href="${APP_BASE_URL}/creatives">Добавить креативы</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Добавить креативы',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_CREATIVE_CREATED: NotificationTemplate = {
  type: 'onboarding_creative_created',
  title: 'Креативы пылятся. Запустите их.',
  message: 'Всё готово, осталось нажать кнопку. Запустите рекламу.',
  telegramMessage: `<b>Креативы пылятся. Запустите их.</b>

Всё готово, осталось нажать кнопку. Запустите рекламу.

<a href="${APP_BASE_URL}/creatives">Запустить</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Запустить',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_ADS_LAUNCHED: NotificationTemplate = {
  type: 'onboarding_ads_launched',
  title: 'Реклама крутится. А окупается?',
  message: 'Без ROI аналитики — работаете вслепую. Настройте и видьте реальную отдачу.',
  telegramMessage: `<b>Реклама крутится. А окупается?</b>

Без ROI аналитики — работаете вслепую. Настройте и видьте реальную отдачу.

<a href="${APP_BASE_URL}/roi">Настроить ROI</a>`,
  ctaUrl: `${APP_BASE_URL}/roi`,
  ctaLabel: 'Настроить ROI',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

// =====================================================
// Мотивационные шаблоны (достижения)
// =====================================================

export const ACHIEVEMENT_FIRST_LEAD: NotificationTemplate = {
  type: 'achievement_first_lead',
  title: 'Первый лид в кармане!',
  message: 'Реклама заработала. Теперь следите за статистикой и масштабируйте.',
  telegramMessage: `<b>Первый лид в кармане!</b>

Реклама заработала. Теперь следите за статистикой и масштабируйте.

<a href="${APP_BASE_URL}/roi">Смотреть статистику</a>`,
  ctaUrl: `${APP_BASE_URL}/roi`,
  ctaLabel: 'Смотреть статистику',
  cooldownDays: 9999, // Только один раз
  channels: ['telegram', 'in_app']
};

export const ACHIEVEMENT_PROFITABLE_WEEK: NotificationTemplate = {
  type: 'achievement_profitable_week',
  title: 'Прибыльная неделя!',
  message: 'ROI за неделю положительный. Реклама окупается!',
  telegramMessage: `<b>Прибыльная неделя!</b>

За последние 7 дней реклама принесла больше, чем было потрачено. Продолжайте в том же духе!

<a href="${APP_BASE_URL}/roi">Детальный отчёт</a>`,
  ctaUrl: `${APP_BASE_URL}/roi`,
  ctaLabel: 'Детальный отчёт',
  cooldownDays: 7, // Раз в неделю можно
  channels: ['telegram']
};

// =====================================================
// Алерты по метрикам
// =====================================================

export const HIGH_CPL_ALERT: NotificationTemplate = {
  type: 'high_cpl_alert',
  title: 'CPL выше плана 3 дня. Креативы устали.',
  message: 'Аудитория видела ваши объявления слишком много раз. Пора обновить креативы.',
  telegramMessage: `<b>CPL выше плана 3 дня. Креативы устали.</b>

Аудитория видела ваши объявления слишком много раз. Пора обновить креативы.

<a href="${APP_BASE_URL}/creatives">Обновить креативы</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Обновить креативы',
  cooldownDays: 7, // Не чаще раза в неделю
  channels: ['telegram', 'in_app']
};

// =====================================================
// Еженедельный отчёт
// =====================================================

export const WEEKLY_REPORT: NotificationTemplate = {
  type: 'weekly_report',
  title: 'Еженедельный отчёт',
  message: 'Ваш отчёт за неделю готов. Посмотрите результаты рекламных кампаний.',
  telegramMessage: '', // Заполняется динамически в sendWeeklyReport
  ctaUrl: `${APP_BASE_URL}/roi`,
  ctaLabel: 'Подробная аналитика',
  cooldownDays: 7,
  channels: ['telegram', 'in_app']
};

// =====================================================
// Маппинг этапов онбординга к шаблонам
// =====================================================

export type OnboardingStage =
  | 'registered'
  | 'fb_pending'
  | 'fb_connected'
  | 'direction_created'
  | 'creative_created'
  | 'ads_launched'
  | 'first_report'
  | 'roi_configured'
  | 'active'
  | 'inactive';

/**
 * Возвращает шаблон напоминания для этапа онбординга
 */
export function getOnboardingReminderTemplate(stage: OnboardingStage): NotificationTemplate | null {
  switch (stage) {
    case 'registered':
      return ONBOARDING_REGISTERED;
    case 'fb_pending':
      return ONBOARDING_FB_PENDING;
    case 'fb_connected':
      return ONBOARDING_FB_CONNECTED;
    case 'direction_created':
      return ONBOARDING_DIRECTION_CREATED;
    case 'creative_created':
      return ONBOARDING_CREATIVE_CREATED;
    case 'ads_launched':
    case 'first_report':
      return ONBOARDING_ADS_LAUNCHED;
    default:
      return null;
  }
}

/**
 * Возвращает шаблон по количеству дней неактивности
 */
export function getInactivityTemplate(daysSinceLastSession: number): NotificationTemplate | null {
  if (daysSinceLastSession >= 14) {
    return INACTIVE_14D;
  }
  if (daysSinceLastSession >= 7) {
    return INACTIVE_7D;
  }
  if (daysSinceLastSession >= 3) {
    return INACTIVE_3D;
  }
  return null;
}

// =====================================================
// Все шаблоны для экспорта
// =====================================================

export const NOTIFICATION_TEMPLATES = {
  // Неактивность
  inactive_3d: INACTIVE_3D,
  inactive_7d: INACTIVE_7D,
  inactive_14d: INACTIVE_14D,

  // Онбординг
  onboarding_registered: ONBOARDING_REGISTERED,
  onboarding_fb_pending: ONBOARDING_FB_PENDING,
  onboarding_fb_connected: ONBOARDING_FB_CONNECTED,
  onboarding_direction_created: ONBOARDING_DIRECTION_CREATED,
  onboarding_creative_created: ONBOARDING_CREATIVE_CREATED,
  onboarding_ads_launched: ONBOARDING_ADS_LAUNCHED,

  // Достижения
  achievement_first_lead: ACHIEVEMENT_FIRST_LEAD,
  achievement_profitable_week: ACHIEVEMENT_PROFITABLE_WEEK,

  // Алерты по метрикам
  high_cpl_alert: HIGH_CPL_ALERT,

  // Отчёты
  weekly_report: WEEKLY_REPORT
};
