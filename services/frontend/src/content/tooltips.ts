// Система контекстных подсказок для интерфейса
// Тексты берутся из базы знаний (knowledge-base)

export const TooltipKeys = {
  // Dashboard метрики
  DASHBOARD_SPEND: 'dashboard.spend',
  DASHBOARD_LEADS: 'dashboard.leads',
  DASHBOARD_CPL: 'dashboard.cpl',
  DASHBOARD_QCPL: 'dashboard.qcpl',
  DASHBOARD_IMPRESSIONS: 'dashboard.impressions',
  DASHBOARD_CTR: 'dashboard.ctr',
  DASHBOARD_CLICKS: 'dashboard.clicks',

  // Направления
  DIRECTION_WHAT: 'direction.what',
  DIRECTION_BUDGET: 'direction.budget',
  DIRECTION_TARGET_CPL: 'direction.targetCpl',
  DIRECTION_OBJECTIVE: 'direction.objective',
  DIRECTION_CITIES: 'direction.cities',
  DIRECTION_AGE: 'direction.age',
  DIRECTION_GENDER: 'direction.gender',
  DIRECTION_DESCRIPTION: 'direction.description',
  DIRECTION_INSTAGRAM_URL: 'direction.instagramUrl',
  DIRECTION_SITE_URL: 'direction.siteUrl',
  DIRECTION_PIXEL_ID: 'direction.pixelId',

  // Креативы
  CREATIVE_STYLE: 'creative.style',
  CREATIVE_REFERENCE: 'creative.reference',
  CREATIVE_CAROUSEL_COUNT: 'creative.carouselCount',
  CREATIVE_TEST: 'creative.test',
  CREATIVE_OFFER: 'creative.offer',
  CREATIVE_BULLETS: 'creative.bullets',
  CREATIVE_BENEFIT: 'creative.benefit',

  // ROI
  ROI_OVERVIEW: 'roi.overview',
  ROI_ROAS: 'roi.roas',
  ROI_QUALITY_LEADS: 'roi.qualityLeads',
  ROI_REVENUE: 'roi.revenue',

  // Профиль / Подключения
  PROFILE_FACEBOOK: 'profile.facebook',
  PROFILE_WHATSAPP: 'profile.whatsapp',
  PROFILE_AMOCRM: 'profile.amocrm',
  PROFILE_TILDA: 'profile.tilda',
  PROFILE_TELEGRAM: 'profile.telegram',
  PROFILE_TIKTOK: 'profile.tiktok',

  // Autopilot
  AUTOPILOT_STATUS: 'autopilot.status',
  AUTOPILOT_HEALTH: 'autopilot.health',

  // Загрузка креативов
  UPLOAD_VIDEO_FORMAT: 'upload.videoFormat',
  UPLOAD_IMAGE_FORMAT: 'upload.imageFormat',
  UPLOAD_TRANSCRIPTION: 'upload.transcription',

  // Конкуренты
  COMPETITORS_SCORE: 'competitors.score',
  COMPETITORS_REFERENCE: 'competitors.reference',
} as const;

export type TooltipKey = typeof TooltipKeys[keyof typeof TooltipKeys];

export interface TooltipData {
  content: string;
  title?: string;
  learnMoreLink?: string;
}

export const tooltips: Record<TooltipKey, TooltipData> = {
  // Dashboard метрики
  [TooltipKeys.DASHBOARD_SPEND]: {
    content: 'Общая сумма, потраченная на рекламу за выбранный период.',
  },
  [TooltipKeys.DASHBOARD_LEADS]: {
    content: 'Количество людей, которые нажали на рекламу и начали диалог в WhatsApp или оставили заявку на сайте.',
  },
  [TooltipKeys.DASHBOARD_CPL]: {
    title: 'Стоимость лида (CPL)',
    content: 'Средняя стоимость привлечения одного лида. Рассчитывается как расход ÷ количество лидов.',
  },
  [TooltipKeys.DASHBOARD_QCPL]: {
    title: 'Стоимость качественного лида (QCPL)',
    content: 'Качественный лид — человек, который отправил 3+ сообщений в WhatsApp или имеет заполненные поля в CRM.',
    learnMoreLink: '/knowledge-base/ad-management/dashboard-metrics',
  },
  [TooltipKeys.DASHBOARD_IMPRESSIONS]: {
    content: 'Сколько раз ваша реклама была показана пользователям.',
  },
  [TooltipKeys.DASHBOARD_CTR]: {
    title: 'CTR (Click-Through Rate)',
    content: 'Процент людей, которые кликнули на рекламу после её просмотра. Хороший CTR — от 1%.',
  },
  [TooltipKeys.DASHBOARD_CLICKS]: {
    content: 'Количество кликов по вашей рекламе.',
  },

  // Направления
  [TooltipKeys.DIRECTION_WHAT]: {
    title: 'Что такое направление?',
    content: 'Направление — это контейнер для рекламной кампании. Объединяет цель, бюджет, таргетинг и креативы.',
    learnMoreLink: '/knowledge-base/ad-launch/create-direction',
  },
  [TooltipKeys.DIRECTION_BUDGET]: {
    title: 'Дневной бюджет',
    content: 'Сумма, которую система потратит за день на это направление. Рекомендуем начинать с $10-20 в день.',
  },
  [TooltipKeys.DIRECTION_TARGET_CPL]: {
    title: 'Целевая стоимость лида',
    content: 'Желаемая стоимость привлечения одного клиента. AI Autopilot будет оптимизировать к этому показателю.',
  },
  [TooltipKeys.DIRECTION_OBJECTIVE]: {
    title: 'Тип направления',
    content: 'WhatsApp — лиды пишут в мессенджер. Instagram Traffic — переход на профиль. Site Leads — форма на сайте.',
    learnMoreLink: '/knowledge-base/ad-launch/create-direction',
  },
  [TooltipKeys.DIRECTION_CITIES]: {
    content: 'Города или страны, в которых будет показываться реклама. Можно выбрать несколько.',
  },
  [TooltipKeys.DIRECTION_AGE]: {
    content: 'Возрастной диапазон целевой аудитории. Минимальный возраст — 18 лет.',
  },
  [TooltipKeys.DIRECTION_GENDER]: {
    content: 'Пол целевой аудитории. "Все" — показ и мужчинам, и женщинам.',
  },
  [TooltipKeys.DIRECTION_DESCRIPTION]: {
    content: 'Краткое описание вашего предложения. Используется AI для генерации креативов.',
  },
  [TooltipKeys.DIRECTION_INSTAGRAM_URL]: {
    content: 'Ссылка на ваш Instagram профиль. Используется для цели Instagram Traffic.',
  },
  [TooltipKeys.DIRECTION_SITE_URL]: {
    content: 'URL вашего сайта или лендинга. Используется для цели Site Leads.',
  },
  [TooltipKeys.DIRECTION_PIXEL_ID]: {
    title: 'Facebook Pixel ID',
    content: 'Идентификатор пикселя для отслеживания конверсий на сайте. Нужен для цели Site Leads.',
  },

  // Креативы
  [TooltipKeys.CREATIVE_STYLE]: {
    title: 'Стиль генерации',
    content: 'Визуальный стиль изображений: современная графика, UGC, визуальный зацеп, минимализм, товарный и др.',
    learnMoreLink: '/knowledge-base/ad-launch/creative-generation',
  },
  [TooltipKeys.CREATIVE_REFERENCE]: {
    content: 'Загрузите изображение-референс для генерации похожего креатива. Можно загрузить до 2 изображений.',
  },
  [TooltipKeys.CREATIVE_CAROUSEL_COUNT]: {
    content: 'Количество карточек в карусели. Рекомендуем 3-5 карточек для лучшего вовлечения.',
  },
  [TooltipKeys.CREATIVE_TEST]: {
    title: 'Быстрый тест креатива',
    content: 'Тестирование с бюджетом $20/день и целью 1000 показов. Помогает быстро оценить эффективность.',
    learnMoreLink: '/knowledge-base/ad-launch/creative-upload',
  },
  [TooltipKeys.CREATIVE_OFFER]: {
    content: 'Главное предложение — что получит клиент. Например: "Бесплатная консультация стоматолога".',
  },
  [TooltipKeys.CREATIVE_BULLETS]: {
    content: 'Ключевые преимущества списком. Каждый пункт с новой строки.',
  },
  [TooltipKeys.CREATIVE_BENEFIT]: {
    content: 'Главная выгода для клиента. Например: "Сэкономьте до 30% на лечении".',
  },

  // ROI
  [TooltipKeys.ROI_OVERVIEW]: {
    title: 'ROI Аналитика',
    content: 'Трёхслойная система анализа: креативы → лиды → продажи. Показывает реальную окупаемость рекламы.',
    learnMoreLink: '/knowledge-base/roi-analytics/overview',
  },
  [TooltipKeys.ROI_ROAS]: {
    title: 'ROAS (Return on Ad Spend)',
    content: 'Возврат на рекламные расходы. Формула: выручка ÷ расход на рекламу. ROAS 3 = 300% возврата.',
  },
  [TooltipKeys.ROI_QUALITY_LEADS]: {
    title: 'Качественные лиды',
    content: 'Лиды с 3+ сообщениями в WhatsApp или с заполненными квалификационными полями в CRM.',
    learnMoreLink: '/knowledge-base/roi-analytics/overview',
  },
  [TooltipKeys.ROI_REVENUE]: {
    content: 'Выручка от продаж, привязанных к рекламным лидам. Синхронизируется из AmoCRM.',
  },

  // Профиль / Подключения
  [TooltipKeys.PROFILE_FACEBOOK]: {
    title: 'Подключение Facebook',
    content: 'Необходимо для запуска рекламы в Facebook и Instagram. Требуется выдать партнёрский доступ к Business Portfolio.',
    learnMoreLink: '/knowledge-base/getting-started/facebook-connection',
  },
  [TooltipKeys.PROFILE_WHATSAPP]: {
    title: 'Подключение WhatsApp',
    content: 'Для идентификации лидов и ROI аналитики. Система не читает переписку — только фиксирует факт входящего сообщения.',
    learnMoreLink: '/knowledge-base/getting-started/whatsapp-connection',
  },
  [TooltipKeys.PROFILE_AMOCRM]: {
    title: 'Подключение AmoCRM',
    content: 'Синхронизация лидов и отслеживание статусов сделок для автоматического расчёта ROI.',
    learnMoreLink: '/knowledge-base/getting-started/amocrm-connection',
  },
  [TooltipKeys.PROFILE_TILDA]: {
    title: 'Подключение Tilda',
    content: 'Webhook для автоматического сбора лидов с форм на сайте Tilda.',
    learnMoreLink: '/knowledge-base/getting-started/tilda-connection',
  },
  [TooltipKeys.PROFILE_TELEGRAM]: {
    content: 'Telegram ID для получения ежедневных отчётов AI Autopilot каждое утро в 9:00.',
  },
  [TooltipKeys.PROFILE_TIKTOK]: {
    title: 'Подключение TikTok',
    content: 'Для запуска рекламы в TikTok. Требуется TikTok Business Center и рекламный аккаунт.',
    learnMoreLink: '/knowledge-base/getting-started/tiktok-connection',
  },

  // Autopilot
  [TooltipKeys.AUTOPILOT_STATUS]: {
    title: 'AI Autopilot',
    content: 'Автоматически управляет бюджетами, включает/выключает Ad Set\'ы и создаёт новые на основе лучших креативов. Запускается каждый день в 8:00.',
    learnMoreLink: '/knowledge-base/ad-management/autopilot-how-it-works',
  },
  [TooltipKeys.AUTOPILOT_HEALTH]: {
    title: 'Health Score',
    content: 'Оценка здоровья Ad Set от -100 до +100. Выше +25 — отлично, от +5 до +24 — хорошо, ниже -25 — плохо.',
    learnMoreLink: '/knowledge-base/ad-management/autopilot-how-it-works',
  },

  // Загрузка креативов
  [TooltipKeys.UPLOAD_VIDEO_FORMAT]: {
    content: 'Поддерживаемые форматы: MP4, MOV, WebM. Максимальный размер: 512 МБ.',
  },
  [TooltipKeys.UPLOAD_IMAGE_FORMAT]: {
    content: 'Поддерживаемые форматы: JPG, PNG. Максимальный размер: 10 МБ.',
  },
  [TooltipKeys.UPLOAD_TRANSCRIPTION]: {
    content: 'Система автоматически распознаёт речь в видео и анализирует содержание для оптимизации.',
  },

  // Конкуренты
  [TooltipKeys.COMPETITORS_SCORE]: {
    title: 'Score креатива',
    content: 'Оценка эффективности креатива от 0 до 100 на основе анализа структуры, текста и визуала.',
    learnMoreLink: '/knowledge-base/competitor-monitoring/score-system',
  },
  [TooltipKeys.COMPETITORS_REFERENCE]: {
    content: 'Используйте креатив конкурента как референс для генерации своего объявления.',
    learnMoreLink: '/knowledge-base/competitor-monitoring/use-as-reference',
  },
};

export function getTooltip(key: TooltipKey): TooltipData | undefined {
  return tooltips[key];
}
