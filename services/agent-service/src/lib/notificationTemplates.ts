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
  title: 'Как дела с рекламой?',
  message: 'Вы не заходили 3 дня. Проверьте статистику ваших кампаний.',
  telegramMessage: `<b>Как дела с рекламой?</b>

Вы не заходили 3 дня. Рекомендуем проверить статистику ваших кампаний.

<a href="${APP_BASE_URL}">Открыть дашборд</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Открыть дашборд',
  cooldownDays: 3,
  channels: ['in_app'] // Только in-app для 3 дней
};

export const INACTIVE_7D: NotificationTemplate = {
  type: 'inactive_7d',
  title: 'Мы скучаем!',
  message: 'Вы не заходили в систему уже 7 дней. Ваши рекламные кампании ждут оптимизации.',
  telegramMessage: `<b>Давно не видели вас в системе</b>

Вы не заходили уже 7 дней.

За это время могли появиться новые лиды, а кампании требуют оптимизации.

<a href="${APP_BASE_URL}">Посмотреть статистику</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Посмотреть статистику',
  cooldownDays: 7,
  channels: ['telegram', 'in_app']
};

export const INACTIVE_14D: NotificationTemplate = {
  type: 'inactive_14d',
  title: 'Не упускайте клиентов',
  message: 'Вы не заходили 14 дней. Каждый день без оптимизации — это потерянные лиды.',
  telegramMessage: `<b>Не упускайте клиентов</b>

Вы не заходили в систему 14 дней. Конкуренты не ждут.

Проверьте статистику и оптимизируйте кампании.

<a href="${APP_BASE_URL}">Открыть дашборд</a>`,
  ctaUrl: APP_BASE_URL,
  ctaLabel: 'Открыть дашборд',
  cooldownDays: 14,
  channels: ['telegram', 'in_app']
};

// =====================================================
// Шаблоны по этапам онбординга
// =====================================================

export const ONBOARDING_REGISTERED: NotificationTemplate = {
  type: 'onboarding_reminder',
  title: 'Подключите Facebook',
  message: 'Для запуска рекламы необходимо подключить Facebook аккаунт. Это займет пару минут.',
  telegramMessage: `<b>Подключите Facebook</b>

Для запуска рекламы необходимо подключить бизнес-аккаунт Facebook. Это займет пару минут.

<a href="${APP_BASE_URL}/profile">Подключить сейчас</a>`,
  ctaUrl: `${APP_BASE_URL}/profile`,
  ctaLabel: 'Подключить сейчас',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_FB_CONNECTED: NotificationTemplate = {
  type: 'onboarding_reminder',
  title: 'Создайте направление',
  message: 'Facebook подключен. Следующий шаг — создать направление для настройки таргетинга.',
  telegramMessage: `<b>Создайте направление</b>

Facebook успешно подключен.

Следующий шаг — создать направление. Направление определяет целевую аудиторию и бюджет рекламы.

<a href="${APP_BASE_URL}/ad-settings">Создать направление</a>`,
  ctaUrl: `${APP_BASE_URL}/ad-settings`,
  ctaLabel: 'Создать направление',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_DIRECTION_CREATED: NotificationTemplate = {
  type: 'onboarding_reminder',
  title: 'Добавьте креативы',
  message: 'Направление создано. Теперь загрузите или сгенерируйте креативы для рекламы.',
  telegramMessage: `<b>Добавьте креативы</b>

Направление создано. Теперь нужны креативы.

Варианты:
- Загрузить свои видео/изображения
- Сгенерировать с помощью AI

<a href="${APP_BASE_URL}/creatives">Добавить креативы</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Добавить креативы',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_CREATIVE_CREATED: NotificationTemplate = {
  type: 'onboarding_reminder',
  title: 'Запустите рекламу',
  message: 'Креативы готовы. Осталось запустить рекламную кампанию.',
  telegramMessage: `<b>Запустите рекламу</b>

Креативы готовы. Осталось запустить рекламу.

Выберите креативы и нажмите "Запустить" — мы создадим кампанию автоматически.

<a href="${APP_BASE_URL}/creatives">Запустить рекламу</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Запустить рекламу',
  cooldownDays: 3,
  channels: ['telegram', 'in_app']
};

export const ONBOARDING_ADS_LAUNCHED: NotificationTemplate = {
  type: 'onboarding_reminder',
  title: 'Настройте ROI аналитику',
  message: 'Реклама работает. Настройте ROI аналитику для отслеживания эффективности.',
  telegramMessage: `<b>Настройте ROI аналитику</b>

Реклама работает.

Чтобы видеть реальную отдачу от рекламы, настройте ROI аналитику:
- Подключите WhatsApp для сбора лидов
- Или настройте интеграцию с CRM

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
  title: 'Первый лид получен!',
  message: 'Поздравляем! Ваша реклама начала работать. Продолжайте тестировать креативы.',
  telegramMessage: `<b>Первый лид получен!</b>

Поздравляем! Ваша реклама начала работать. Продолжайте тестировать креативы для лучших результатов.

<a href="${APP_BASE_URL}/roi">Смотреть аналитику</a>`,
  ctaUrl: `${APP_BASE_URL}/roi`,
  ctaLabel: 'Смотреть аналитику',
  cooldownDays: 9999, // Только один раз
  channels: ['telegram', 'in_app']
};

export const ACHIEVEMENT_5_CREATIVES: NotificationTemplate = {
  type: 'achievement_5_creatives',
  title: '5 креативов создано!',
  message: 'Отличный старт. Тестирование разных вариантов помогает найти самый эффективный.',
  telegramMessage: `<b>Уже 5 креативов!</b>

Отличный старт. Тестирование разных вариантов помогает найти самый эффективный.

<a href="${APP_BASE_URL}/creatives">Создать ещё</a>`,
  ctaUrl: `${APP_BASE_URL}/creatives`,
  ctaLabel: 'Создать ещё',
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
    case 'fb_pending':
      return ONBOARDING_REGISTERED;
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
  onboarding_fb_connected: ONBOARDING_FB_CONNECTED,
  onboarding_direction_created: ONBOARDING_DIRECTION_CREATED,
  onboarding_creative_created: ONBOARDING_CREATIVE_CREATED,
  onboarding_ads_launched: ONBOARDING_ADS_LAUNCHED,

  // Достижения
  achievement_first_lead: ACHIEVEMENT_FIRST_LEAD,
  achievement_5_creatives: ACHIEVEMENT_5_CREATIVES,
  achievement_profitable_week: ACHIEVEMENT_PROFITABLE_WEEK
};
