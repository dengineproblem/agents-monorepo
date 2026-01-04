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

  // Dashboard платформы и баннеры
  PLATFORM_INSTAGRAM: 'platform.instagram',
  PLATFORM_TIKTOK: 'platform.tiktok',
  FACEBOOK_CONNECT_BANNER: 'banner.facebookConnect',
  TIKTOK_CONNECT_BANNER: 'banner.tiktokConnect',
  PAYMENT_FAILED_BANNER: 'banner.paymentFailed',
  CAMPAIGN_STATUS_ACTIVE: 'campaign.statusActive',
  CAMPAIGN_STATUS_PAUSED: 'campaign.statusPaused',
  CAMPAIGN_STATUS_ERROR: 'campaign.statusError',
  DATE_PERIOD_FILTER: 'filter.datePeriod',
  BUDGET_REMAINING: 'budget.remaining',

  // Направления
  DIRECTION_WHAT: 'direction.what',
  DIRECTION_BUDGET: 'direction.budget',
  DIRECTION_TARGET_CPL: 'direction.targetCpl',
  DIRECTION_TARGET_CPC: 'direction.targetCpc',
  DIRECTION_OBJECTIVE: 'direction.objective',
  DIRECTION_CITIES: 'direction.cities',
  DIRECTION_AGE: 'direction.age',
  DIRECTION_GENDER: 'direction.gender',
  DIRECTION_DESCRIPTION: 'direction.description',
  DIRECTION_INSTAGRAM_URL: 'direction.instagramUrl',
  DIRECTION_SITE_URL: 'direction.siteUrl',
  DIRECTION_PIXEL_ID: 'direction.pixelId',

  // Настройки рекламы (AdSettings)
  AD_WHATSAPP_QUESTION: 'ad.whatsappQuestion',
  AD_TEXT_UNDER_VIDEO: 'ad.textUnderVideo',
  AD_TARGETING_GEOGRAPHY: 'ad.targetingGeography',
  AD_TARGETING_COUNTRY: 'ad.targetingCountry',
  AD_TARGETING_CITY: 'ad.targetingCity',
  AD_TARGETING_RADIUS: 'ad.targetingRadius',
  AD_AGE_MIN: 'ad.ageMin',
  AD_AGE_MAX: 'ad.ageMax',
  AD_GENDER_ALL: 'ad.genderAll',
  AD_GENDER_MALE: 'ad.genderMale',
  AD_GENDER_FEMALE: 'ad.genderFemale',
  AD_INSTAGRAM_URL_FORMAT: 'ad.instagramUrlFormat',
  AD_SITE_URL_FORMAT: 'ad.siteUrlFormat',
  AD_PIXEL_HOW_TO_GET: 'ad.pixelHowToGet',
  AD_UTM_TAGS: 'ad.utmTags',

  // Креативы
  CREATIVE_STYLE: 'creative.style',
  CREATIVE_REFERENCE: 'creative.reference',
  CREATIVE_CAROUSEL_COUNT: 'creative.carouselCount',
  CREATIVE_TEST: 'creative.test',
  CREATIVE_OFFER: 'creative.offer',
  CREATIVE_BULLETS: 'creative.bullets',
  CREATIVE_BENEFIT: 'creative.benefit',

  // Загрузка и управление креативами
  UPLOAD_VIDEO_FORMAT: 'upload.videoFormat',
  UPLOAD_IMAGE_FORMAT: 'upload.imageFormat',
  UPLOAD_TRANSCRIPTION: 'upload.transcription',
  UPLOAD_VIDEO_TITLE: 'upload.videoTitle',
  UPLOAD_VIDEO_DESCRIPTION: 'upload.videoDescription',
  UPLOAD_SELECT_DIRECTION: 'upload.selectDirection',
  UPLOAD_SELECT_OBJECTIVE: 'upload.selectObjective',
  UPLOAD_DAILY_BUDGET: 'upload.dailyBudget',
  UPLOAD_CREATE_CAMPAIGN: 'upload.createCampaign',
  TEST_CAMPAIGN_WHAT: 'test.campaignWhat',
  TEST_CAMPAIGN_BUDGET: 'test.campaignBudget',
  TEST_CAMPAIGN_DURATION: 'test.campaignDuration',
  TEST_STATUS_PENDING: 'test.statusPending',
  TEST_STATUS_RUNNING: 'test.statusRunning',
  TEST_STATUS_COMPLETED: 'test.statusCompleted',
  TEST_STATUS_FAILED: 'test.statusFailed',
  CREATIVE_LLM_SCORE: 'creative.llmScore',
  CREATIVE_LLM_VERDICT: 'creative.llmVerdict',

  // Генерация креативов
  GEN_STYLE_MODERN: 'gen.styleModern',
  GEN_STYLE_UGC: 'gen.styleUgc',
  GEN_STYLE_HOOK: 'gen.styleHook',
  GEN_STYLE_MINIMAL: 'gen.styleMinimal',
  GEN_STYLE_PRODUCT: 'gen.styleProduct',
  GEN_STYLE_FREESTYLE: 'gen.styleFreestyle',
  GEN_REFERENCE_LIMIT: 'gen.referenceLimit',
  GEN_COMPETITOR_REFERENCE: 'gen.competitorReference',
  GEN_CHARACTER_LIMIT: 'gen.characterLimit',
  GEN_4K_UPSCALE: 'gen.4kUpscale',
  GEN_SELECT_DIRECTION: 'gen.selectDirection',
  GEN_CREATE_IN_FACEBOOK: 'gen.createInFacebook',

  // ROI
  ROI_OVERVIEW: 'roi.overview',
  ROI_ROAS: 'roi.roas',
  ROI_QUALITY_LEADS: 'roi.qualityLeads',
  ROI_REVENUE: 'roi.revenue',
  ROI_TOTAL_REVENUE: 'roi.totalRevenue',
  ROI_TOTAL_SPEND: 'roi.totalSpend',
  ROI_TOTAL_PERCENT: 'roi.totalPercent',
  ROI_CPL: 'roi.cpl',
  ROI_QUALIFICATION_RATE: 'roi.qualificationRate',
  ROI_CONVERSION_RATE: 'roi.conversionRate',
  ROI_KEY_STAGES: 'roi.keyStages',
  ROI_FUNNEL_FILTER: 'roi.funnelFilter',
  ROI_MEDIA_TYPE_FILTER: 'roi.mediaTypeFilter',
  ROI_VIDEO_WATCH_25: 'roi.videoWatch25',
  ROI_VIDEO_WATCH_50: 'roi.videoWatch50',
  ROI_VIDEO_WATCH_95: 'roi.videoWatch95',

  // Конкуренты
  COMPETITORS_SCORE: 'competitors.score',
  COMPETITORS_REFERENCE: 'competitors.reference',
  COMPETITOR_ADD_HOW: 'competitor.addHow',
  COMPETITOR_URL_FORMAT: 'competitor.urlFormat',
  COMPETITOR_COUNTRY: 'competitor.country',
  COMPETITOR_REFRESH: 'competitor.refresh',
  COMPETITOR_DELETE: 'competitor.delete',
  COMPETITOR_EXTRACT_TEXT: 'competitor.extractText',
  COMPETITOR_MEDIA_FILTER: 'competitor.mediaFilter',
  COMPETITOR_SORT: 'competitor.sort',
  COMPETITOR_USE_REFERENCE: 'competitor.useReference',
  COMPETITOR_TOP_10: 'competitor.top10',

  // WhatsApp Аналитика
  WA_FUNNEL_HOT: 'wa.funnelHot',
  WA_FUNNEL_WARM: 'wa.funnelWarm',
  WA_FUNNEL_COLD: 'wa.funnelCold',
  WA_QUALITY_LEAD: 'wa.qualityLead',
  WA_ADD_LEAD: 'wa.addLead',
  WA_VIEW_KANBAN: 'wa.viewKanban',
  WA_VIEW_LIST: 'wa.viewList',
  WA_VIEW_TABLE: 'wa.viewTable',
  WA_LEAD_CARD: 'wa.leadCard',
  WA_UPDATE_STAGE: 'wa.updateStage',

  // Профиль / Подключения
  PROFILE_FACEBOOK: 'profile.facebook',
  PROFILE_WHATSAPP: 'profile.whatsapp',
  PROFILE_AMOCRM: 'profile.amocrm',
  PROFILE_TILDA: 'profile.tilda',
  PROFILE_TELEGRAM: 'profile.telegram',
  PROFILE_TIKTOK: 'profile.tiktok',
  PROFILE_TARIFF: 'profile.tariff',
  PROFILE_PASSWORD: 'profile.password',
  PROFILE_USERNAME: 'profile.username',
  PROFILE_TELEGRAM_IDS: 'profile.telegramIds',
  PROFILE_MAX_BUDGET: 'profile.maxBudget',
  PROFILE_PLANNED_CPL: 'profile.plannedCpl',
  PROFILE_OPENAI_KEY: 'profile.openaiKey',
  PROFILE_AUDIENCE_ID: 'profile.audienceId',
  PROFILE_AD_ACCOUNTS: 'profile.adAccounts',
  PROFILE_BUSINESS_PORTFOLIO: 'profile.businessPortfolio',

  // Autopilot
  AUTOPILOT_STATUS: 'autopilot.status',
  AUTOPILOT_HEALTH: 'autopilot.health',
  AUTOPILOT_TOGGLE: 'autopilot.toggle',
  AUTOPILOT_LAST_RUN: 'autopilot.lastRun',
  AUTOPILOT_NEXT_RUN: 'autopilot.nextRun',
  AUTOPILOT_ACTIONS: 'autopilot.actions',
  AUTOPILOT_BUDGET_CHANGE: 'autopilot.budgetChange',
  AUTOPILOT_ADSET_CREATED: 'autopilot.adsetCreated',
  AUTOPILOT_ADSET_PAUSED: 'autopilot.adsetPaused',
  AUTOPILOT_REPORT: 'autopilot.report',

  // Консультации
  CONSULT_ADD: 'consult.add',
  CONSULT_TIME_SLOT: 'consult.timeSlot',
  CONSULT_BLOCKED_SLOT: 'consult.blockedSlot',
  CONSULT_CLIENT_PHONE: 'consult.clientPhone',
  CONSULT_SERVICE: 'consult.service',
  CONSULT_CREATE_SALE: 'consult.createSale',

  // Карусели
  CAROUSEL_IDEA: 'carousel.idea',
  CAROUSEL_IDEA_INPUT: 'carousel.ideaInput',
  CAROUSEL_CARDS_COUNT: 'carousel.cardsCount',
  CAROUSEL_GENERATE_TEXTS: 'carousel.generateTexts',
  CAROUSEL_VISUAL_STYLE: 'carousel.visualStyle',
  CAROUSEL_STYLE_MINIMAL: 'carousel.styleMinimal',
  CAROUSEL_STYLE_STORY: 'carousel.styleStory',
  CAROUSEL_STYLE_UGC: 'carousel.styleUgc',
  CAROUSEL_STYLE_ASSET: 'carousel.styleAsset',
  CAROUSEL_STYLE_FREESTYLE: 'carousel.styleFreestyle',
  CAROUSEL_CUSTOM_PROMPTS: 'carousel.customPrompts',
  CAROUSEL_REFERENCES: 'carousel.references',
  CAROUSEL_REGENERATE_CARD: 'carousel.regenerateCard',
  CAROUSEL_DOWNLOAD: 'carousel.download',
  CAROUSEL_CREATE_FB: 'carousel.createFb',
  CAROUSEL_HOOK_BADGE: 'carousel.hookBadge',
  CAROUSEL_CTA_BADGE: 'carousel.ctaBadge',

  // Генерация текста
  TEXT_GENERATION_OVERVIEW: 'text.overview',
  TEXT_TYPE_SELECT: 'text.typeSelect',
  TEXT_TYPE_STORYTELLING: 'text.typeStorytelling',
  TEXT_TYPE_DIRECT_OFFER: 'text.typeDirectOffer',
  TEXT_TYPE_EXPERT_VIDEO: 'text.typeExpertVideo',
  TEXT_TYPE_TELEGRAM: 'text.typeTelegram',
  TEXT_TYPE_THREADS: 'text.typeThreads',
  TEXT_TYPE_REFERENCE: 'text.typeReference',
  TEXT_USER_PROMPT: 'text.userPrompt',
  TEXT_EDIT_WITH_AI: 'text.editWithAi',

  // Дополнительные для генерации картинок
  GEN_TEXT_AI_BUTTON: 'gen.textAiButton',
  GEN_FREESTYLE_PROMPT: 'gen.freestylePrompt',
  GEN_EDIT_MODE: 'gen.editMode',

  // Загрузка креативов (дополнительные)
  CREATIVES_PAGE_OVERVIEW: 'creatives.pageOverview',
  UPLOAD_DROPZONE: 'upload.dropzone',
  CREATIVE_ANALYTICS: 'creative.analytics',
  CREATIVE_LAUNCH_AD: 'creative.launchAd',
} as const;

export type TooltipKey = typeof TooltipKeys[keyof typeof TooltipKeys];

export interface TooltipData {
  content: string;
  title?: string;
  learnMoreLink?: string;
}

export const tooltips: Record<TooltipKey, TooltipData> = {
  // ==========================================
  // Dashboard метрики
  // ==========================================
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

  // ==========================================
  // Dashboard платформы и баннеры
  // ==========================================
  [TooltipKeys.PLATFORM_INSTAGRAM]: {
    title: 'Instagram / Facebook',
    content: 'Просмотр статистики рекламы в Instagram и Facebook. Требуется подключённый рекламный аккаунт Meta.',
  },
  [TooltipKeys.PLATFORM_TIKTOK]: {
    title: 'TikTok',
    content: 'Просмотр статистики рекламы в TikTok. Требуется подключённый TikTok Business Center.',
  },
  [TooltipKeys.FACEBOOK_CONNECT_BANNER]: {
    title: 'Подключите Facebook',
    content: 'Для запуска рекламы необходимо подключить Facebook Business Portfolio и выдать партнёрский доступ.',
    learnMoreLink: '/knowledge-base/getting-started/facebook-connection',
  },
  [TooltipKeys.TIKTOK_CONNECT_BANNER]: {
    title: 'Подключите TikTok',
    content: 'Для запуска рекламы в TikTok подключите свой TikTok Business Center и рекламный аккаунт.',
    learnMoreLink: '/knowledge-base/getting-started/tiktok-connection',
  },
  [TooltipKeys.PAYMENT_FAILED_BANNER]: {
    title: 'Задолженность по оплате',
    content: 'У рекламного аккаунта есть задолженность. Реклама не будет показываться, пока долг не погашен.',
  },
  [TooltipKeys.CAMPAIGN_STATUS_ACTIVE]: {
    title: 'Кампания активна',
    content: 'Реклама показывается пользователям. Расходуется дневной бюджет.',
  },
  [TooltipKeys.CAMPAIGN_STATUS_PAUSED]: {
    title: 'Кампания на паузе',
    content: 'Показ рекламы приостановлен. Бюджет не расходуется.',
  },
  [TooltipKeys.CAMPAIGN_STATUS_ERROR]: {
    title: 'Ошибка кампании',
    content: 'Произошла ошибка при запуске или показе рекламы. Проверьте настройки и креативы.',
  },
  [TooltipKeys.DATE_PERIOD_FILTER]: {
    title: 'Период статистики',
    content: 'Выберите период для просмотра статистики: сегодня, вчера, 7 дней, 30 дней или произвольный диапазон.',
  },
  [TooltipKeys.BUDGET_REMAINING]: {
    title: 'Остаток бюджета',
    content: 'Сколько денег осталось на рекламном аккаунте. При нуле реклама останавливается.',
  },

  // ==========================================
  // Направления
  // ==========================================
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
  [TooltipKeys.DIRECTION_TARGET_CPC]: {
    title: 'Целевая стоимость перехода',
    content: 'Желаемая стоимость одного перехода в Instagram профиль. AI Autopilot будет оптимизировать к этому показателю.',
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

  // ==========================================
  // Настройки рекламы (AdSettings)
  // ==========================================
  [TooltipKeys.AD_WHATSAPP_QUESTION]: {
    title: 'Вопрос клиенту',
    content: 'Текст первого сообщения, которое автоматически подставляется клиенту в WhatsApp. Например: "Здравствуйте! Хочу записаться на консультацию".',
  },
  [TooltipKeys.AD_TEXT_UNDER_VIDEO]: {
    title: 'Текст под видео',
    content: 'Описание, которое отображается под видео в ленте Facebook/Instagram. До 125 символов для мобильных устройств.',
  },
  [TooltipKeys.AD_TARGETING_GEOGRAPHY]: {
    title: 'География показов',
    content: 'Выберите страны, города или регионы, где будет показываться реклама. Можно добавить несколько локаций.',
    learnMoreLink: '/knowledge-base/ad-launch/create-direction',
  },
  [TooltipKeys.AD_TARGETING_COUNTRY]: {
    title: 'Страна',
    content: 'Выберите страну для таргетинга. Реклама будет показываться только жителям этой страны.',
  },
  [TooltipKeys.AD_TARGETING_CITY]: {
    title: 'Город',
    content: 'Выберите конкретный город. Можно добавить несколько городов для расширения охвата.',
  },
  [TooltipKeys.AD_TARGETING_RADIUS]: {
    title: 'Радиус таргетинга',
    content: 'Радиус вокруг выбранной точки в километрах. Используется для локального бизнеса.',
  },
  [TooltipKeys.AD_AGE_MIN]: {
    title: 'Минимальный возраст',
    content: 'Минимальный возраст аудитории — от 18 лет. Facebook не позволяет таргетировать несовершеннолетних.',
  },
  [TooltipKeys.AD_AGE_MAX]: {
    title: 'Максимальный возраст',
    content: 'Максимальный возраст аудитории — до 65+. Выберите "65+" для показа всем старше 65 лет.',
  },
  [TooltipKeys.AD_GENDER_ALL]: {
    content: 'Реклама будет показываться и мужчинам, и женщинам. Рекомендуется для большинства бизнесов.',
  },
  [TooltipKeys.AD_GENDER_MALE]: {
    content: 'Реклама будет показываться только мужчинам. Используйте для мужских товаров и услуг.',
  },
  [TooltipKeys.AD_GENDER_FEMALE]: {
    content: 'Реклама будет показываться только женщинам. Используйте для женских товаров и услуг.',
  },
  [TooltipKeys.AD_INSTAGRAM_URL_FORMAT]: {
    title: 'Формат ссылки Instagram',
    content: 'Введите ссылку на профиль в формате: https://instagram.com/username или просто @username.',
  },
  [TooltipKeys.AD_SITE_URL_FORMAT]: {
    title: 'Формат ссылки на сайт',
    content: 'Введите полный URL сайта с https://. Например: https://example.com/landing-page.',
  },
  [TooltipKeys.AD_PIXEL_HOW_TO_GET]: {
    title: 'Как получить Pixel ID?',
    content: 'Pixel ID находится в Events Manager → Data Sources → Выберите пиксель → ID отображается под названием.',
    learnMoreLink: '/knowledge-base/ad-launch/create-direction',
  },
  [TooltipKeys.AD_UTM_TAGS]: {
    title: 'UTM-метки',
    content: 'Параметры для отслеживания источника трафика. Формат: ?utm_source=facebook&utm_medium=cpc&utm_campaign=название.',
  },

  // ==========================================
  // Креативы
  // ==========================================
  [TooltipKeys.CREATIVE_STYLE]: {
    title: 'Стиль генерации',
    content: 'Визуальный стиль изображений: современная графика, UGC, визуальный зацеп, минимализм, товарный и др.',
    learnMoreLink: '/knowledge-base/ad-launch/generate-creatives',
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
    learnMoreLink: '/knowledge-base/ad-launch/upload-creatives',
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

  // ==========================================
  // Загрузка и управление креативами
  // ==========================================
  [TooltipKeys.UPLOAD_VIDEO_FORMAT]: {
    content: 'Поддерживаемые форматы: MP4, MOV, WebM. Максимальный размер: 512 МБ.',
  },
  [TooltipKeys.UPLOAD_IMAGE_FORMAT]: {
    content: 'Поддерживаемые форматы: JPG, PNG. Максимальный размер: 10 МБ.',
  },
  [TooltipKeys.UPLOAD_TRANSCRIPTION]: {
    title: 'Автоматическая транскрипция',
    content: 'Система автоматически распознаёт речь в видео и анализирует содержание для оптимизации.',
  },
  [TooltipKeys.UPLOAD_VIDEO_TITLE]: {
    title: 'Название видео',
    content: 'Внутреннее название для идентификации креатива. Не отображается в рекламе.',
  },
  [TooltipKeys.UPLOAD_VIDEO_DESCRIPTION]: {
    title: 'Описание видео',
    content: 'Краткое описание содержания видео. Помогает AI анализировать и оптимизировать креатив.',
  },
  [TooltipKeys.UPLOAD_SELECT_DIRECTION]: {
    title: 'Выбор направления',
    content: 'Выберите направление, к которому будет привязан креатив. Определяет цель и настройки рекламы.',
  },
  [TooltipKeys.UPLOAD_SELECT_OBJECTIVE]: {
    title: 'Цель кампании',
    content: 'WhatsApp — сообщения в мессенджер. Instagram Traffic — переходы на профиль. Site Leads — заявки на сайте.',
  },
  [TooltipKeys.UPLOAD_DAILY_BUDGET]: {
    title: 'Дневной бюджет',
    content: 'Сумма, которую система потратит за день. Рекомендуем от $10 для тестирования, от $30 для масштабирования.',
  },
  [TooltipKeys.UPLOAD_CREATE_CAMPAIGN]: {
    title: 'Запуск кампании',
    content: 'Создаёт рекламную кампанию в Facebook Ads с выбранными настройками и креативом.',
  },
  [TooltipKeys.TEST_CAMPAIGN_WHAT]: {
    title: 'Что такое быстрый тест?',
    content: 'Автоматическое тестирование креатива с фиксированными параметрами для быстрой оценки эффективности.',
    learnMoreLink: '/knowledge-base/ad-launch/upload-creatives',
  },
  [TooltipKeys.TEST_CAMPAIGN_BUDGET]: {
    title: 'Бюджет теста',
    content: 'Стандартный бюджет $20/день. Достаточно для получения статистически значимых результатов.',
  },
  [TooltipKeys.TEST_CAMPAIGN_DURATION]: {
    title: 'Длительность теста',
    content: 'Тест автоматически останавливается после 1000 показов или 3 дней работы.',
  },
  [TooltipKeys.TEST_STATUS_PENDING]: {
    title: 'Ожидание запуска',
    content: 'Тест в очереди на запуск. Обычно начинается в течение нескольких минут.',
  },
  [TooltipKeys.TEST_STATUS_RUNNING]: {
    title: 'Тест в процессе',
    content: 'Реклама показывается, собираются данные. Результаты обновляются каждый час.',
  },
  [TooltipKeys.TEST_STATUS_COMPLETED]: {
    title: 'Тест завершён',
    content: 'Тестирование успешно завершено. Посмотрите результаты и примите решение о масштабировании.',
  },
  [TooltipKeys.TEST_STATUS_FAILED]: {
    title: 'Ошибка теста',
    content: 'Тестирование не удалось завершить. Проверьте креатив и настройки рекламного аккаунта.',
  },
  [TooltipKeys.CREATIVE_LLM_SCORE]: {
    title: 'AI-оценка креатива',
    content: 'Оценка от 0 до 100 на основе анализа структуры, текста, визуала и соответствия лучшим практикам.',
  },
  [TooltipKeys.CREATIVE_LLM_VERDICT]: {
    title: 'AI-вердикт',
    content: 'Отлично (80+) — готов к масштабированию. Хорошо (60-79) — работает. Средне (40-59) — требует улучшений. Слабо (<40) — переделать.',
  },

  // ==========================================
  // Генерация креативов
  // ==========================================
  [TooltipKeys.GEN_STYLE_MODERN]: {
    title: 'Modern Performance',
    content: 'Современная графика с градиентами, геометрическими формами и динамичными элементами. Подходит для tech и digital.',
  },
  [TooltipKeys.GEN_STYLE_UGC]: {
    title: 'Live UGC',
    content: 'Стиль пользовательского контента — живые фото, натуральные цвета, минимум обработки. Высокое доверие аудитории.',
  },
  [TooltipKeys.GEN_STYLE_HOOK]: {
    title: 'Visual Hook',
    content: 'Яркий визуальный зацеп — контрастные цвета, крупный текст, эмоции. Для привлечения внимания в ленте.',
  },
  [TooltipKeys.GEN_STYLE_MINIMAL]: {
    title: 'Минимализм',
    content: 'Чистый дизайн с большим количеством воздуха, минимум элементов. Премиальное восприятие.',
  },
  [TooltipKeys.GEN_STYLE_PRODUCT]: {
    title: 'Товарный',
    content: 'Фокус на продукте — качественное фото товара, цена, характеристики. Для e-commerce.',
  },
  [TooltipKeys.GEN_STYLE_FREESTYLE]: {
    title: 'Свободный стиль',
    content: 'Опишите желаемый стиль своими словами. AI постарается воспроизвести вашу идею.',
  },
  [TooltipKeys.GEN_REFERENCE_LIMIT]: {
    title: 'Лимит референсов',
    content: 'Можно загрузить до 2 референсных изображений. AI проанализирует стиль и создаст похожий креатив.',
  },
  [TooltipKeys.GEN_COMPETITOR_REFERENCE]: {
    title: 'Референс конкурента',
    content: 'Используйте креатив конкурента как основу для генерации. Сохраняет идею, меняет визуал.',
    learnMoreLink: '/knowledge-base/competitors/use-as-reference',
  },
  [TooltipKeys.GEN_CHARACTER_LIMIT]: {
    title: 'Лимит символов',
    content: 'Оффер — до 60 символов. Буллеты — до 120 символов (по 40 на пункт). Выгода — до 50 символов.',
  },
  [TooltipKeys.GEN_4K_UPSCALE]: {
    title: 'Увеличение до 4K',
    content: 'AI увеличивает разрешение изображения до 4K без потери качества. Рекомендуется для Stories и Reels.',
  },
  [TooltipKeys.GEN_SELECT_DIRECTION]: {
    title: 'Выбор направления',
    content: 'Выберите направление для привязки сгенерированного креатива. Влияет на текст и стиль генерации.',
  },
  [TooltipKeys.GEN_CREATE_IN_FACEBOOK]: {
    title: 'Создать в Facebook',
    content: 'Автоматически создаёт объявление в Facebook Ads с этим креативом и настройками направления.',
  },

  // ==========================================
  // ROI
  // ==========================================
  [TooltipKeys.ROI_OVERVIEW]: {
    title: 'ROI Аналитика',
    content: 'Трёхслойная система анализа: креативы → лиды → продажи. Показывает реальную окупаемость рекламы.',
    learnMoreLink: '/knowledge-base/roi-analytics/roi-overview',
  },
  [TooltipKeys.ROI_ROAS]: {
    title: 'ROAS (Return on Ad Spend)',
    content: 'Возврат на рекламные расходы. Формула: выручка ÷ расход на рекламу. ROAS 3 = 300% возврата.',
  },
  [TooltipKeys.ROI_QUALITY_LEADS]: {
    title: 'Качественные лиды',
    content: 'Лиды с 3+ сообщениями в WhatsApp или с заполненными квалификационными полями в CRM.',
    learnMoreLink: '/knowledge-base/roi-analytics/roi-overview',
  },
  [TooltipKeys.ROI_REVENUE]: {
    content: 'Выручка от продаж, привязанных к рекламным лидам. Синхронизируется из AmoCRM.',
  },
  [TooltipKeys.ROI_TOTAL_REVENUE]: {
    title: 'Общая выручка',
    content: 'Сумма всех продаж за выбранный период, привязанных к рекламным лидам.',
  },
  [TooltipKeys.ROI_TOTAL_SPEND]: {
    title: 'Общие расходы',
    content: 'Сумма всех расходов на рекламу за выбранный период по всем направлениям.',
  },
  [TooltipKeys.ROI_TOTAL_PERCENT]: {
    title: 'ROI в процентах',
    content: 'Формула: (Выручка - Расход) ÷ Расход × 100%. ROI 200% означает, что каждый вложенный доллар принёс 2 доллара прибыли.',
  },
  [TooltipKeys.ROI_CPL]: {
    title: 'CPL в ROI',
    content: 'Стоимость лида с учётом качества. Показывает реальную цену привлечения потенциального клиента.',
  },
  [TooltipKeys.ROI_QUALIFICATION_RATE]: {
    title: 'Процент квалификации',
    content: 'Доля качественных лидов от общего числа. Формула: качественные лиды ÷ все лиды × 100%.',
  },
  [TooltipKeys.ROI_CONVERSION_RATE]: {
    title: 'Конверсия в продажу',
    content: 'Процент лидов, которые совершили покупку. Формула: продажи ÷ лиды × 100%.',
  },
  [TooltipKeys.ROI_KEY_STAGES]: {
    title: 'Ключевые этапы (КЭ)',
    content: 'Этапы воронки продаж, которые вы отметили как ключевые в настройках AmoCRM. Например: "Встреча назначена".',
    learnMoreLink: '/knowledge-base/roi-analytics/creatives-tab',
  },
  [TooltipKeys.ROI_FUNNEL_FILTER]: {
    title: 'Фильтр по воронке',
    content: 'Выберите воронку AmoCRM для просмотра статистики только по выбранным сделкам.',
  },
  [TooltipKeys.ROI_MEDIA_TYPE_FILTER]: {
    title: 'Тип медиа',
    content: 'Фильтруйте статистику по типу креативов: видео, изображения или карусели.',
  },
  [TooltipKeys.ROI_VIDEO_WATCH_25]: {
    title: 'Досмотр 25%',
    content: 'Процент людей, которые посмотрели минимум 25% видео. Показывает начальный интерес.',
  },
  [TooltipKeys.ROI_VIDEO_WATCH_50]: {
    title: 'Досмотр 50%',
    content: 'Процент людей, которые посмотрели минимум 50% видео. Показывает устойчивый интерес.',
  },
  [TooltipKeys.ROI_VIDEO_WATCH_95]: {
    title: 'Досмотр 95%',
    content: 'Процент людей, которые досмотрели видео почти до конца. Показывает высокую вовлечённость.',
  },

  // ==========================================
  // Конкуренты
  // ==========================================
  [TooltipKeys.COMPETITORS_SCORE]: {
    title: 'Score креатива',
    content: 'Оценка эффективности креатива от 0 до 100 на основе анализа структуры, текста и визуала.',
    learnMoreLink: '/knowledge-base/competitors/competitor-scoring',
  },
  [TooltipKeys.COMPETITORS_REFERENCE]: {
    content: 'Используйте креатив конкурента как референс для генерации своего объявления.',
    learnMoreLink: '/knowledge-base/competitors/use-as-reference',
  },
  [TooltipKeys.COMPETITOR_ADD_HOW]: {
    title: 'Как добавить конкурента',
    content: 'Введите URL страницы Instagram или Facebook конкурента. Система загрузит все его активные креативы.',
    learnMoreLink: '/knowledge-base/competitors/add-competitor',
  },
  [TooltipKeys.COMPETITOR_URL_FORMAT]: {
    title: 'Формат URL',
    content: 'Введите полную ссылку: https://instagram.com/competitor или https://facebook.com/competitor.page',
  },
  [TooltipKeys.COMPETITOR_COUNTRY]: {
    title: 'Страна конкурента',
    content: 'Выберите страну, где конкурент показывает рекламу. Влияет на результаты поиска креативов.',
  },
  [TooltipKeys.COMPETITOR_REFRESH]: {
    title: 'Обновить данные',
    content: 'Загрузить новые креативы конкурента из Facebook Ad Library. Обновляется автоматически раз в неделю.',
  },
  [TooltipKeys.COMPETITOR_DELETE]: {
    title: 'Удалить конкурента',
    content: 'Удаляет конкурента и все его креативы из мониторинга. Действие необратимо.',
  },
  [TooltipKeys.COMPETITOR_EXTRACT_TEXT]: {
    title: 'Извлечь текст',
    content: 'AI распознаёт текст на изображениях и видео креатива. Используйте для анализа копирайтинга.',
    learnMoreLink: '/knowledge-base/competitors/extract-text',
  },
  [TooltipKeys.COMPETITOR_MEDIA_FILTER]: {
    title: 'Фильтр по типу',
    content: 'Показать только видео, только изображения или все типы креативов.',
  },
  [TooltipKeys.COMPETITOR_SORT]: {
    title: 'Сортировка',
    content: 'Сортируйте по Score (эффективность), дате добавления или количеству дней показа.',
  },
  [TooltipKeys.COMPETITOR_USE_REFERENCE]: {
    title: 'Использовать как референс',
    content: 'Отметьте креатив для использования при генерации. Появится в списке референсов.',
    learnMoreLink: '/knowledge-base/competitors/use-as-reference',
  },
  [TooltipKeys.COMPETITOR_TOP_10]: {
    title: 'Топ-10 креативов',
    content: 'Лучшие креативы конкурента по Score. Рекомендуется начать анализ с них.',
  },

  // ==========================================
  // WhatsApp Аналитика
  // ==========================================
  [TooltipKeys.WA_FUNNEL_HOT]: {
    title: 'Горячий лид',
    content: 'Лид готов к покупке — задаёт конкретные вопросы, интересуется ценой и условиями.',
  },
  [TooltipKeys.WA_FUNNEL_WARM]: {
    title: 'Тёплый лид',
    content: 'Лид заинтересован, но пока не готов купить. Требует дополнительной работы.',
  },
  [TooltipKeys.WA_FUNNEL_COLD]: {
    title: 'Холодный лид',
    content: 'Лид не проявляет активного интереса. Возможно, ошибочный клик или изменение намерений.',
  },
  [TooltipKeys.WA_QUALITY_LEAD]: {
    title: 'Качественный лид',
    content: 'Лид отправил 3+ сообщений в WhatsApp, что указывает на реальный интерес к продукту.',
    learnMoreLink: '/knowledge-base/ad-management/dashboard-metrics',
  },
  [TooltipKeys.WA_ADD_LEAD]: {
    title: 'Добавить лида',
    content: 'Ручное добавление лида в систему. Укажите телефон и источник для правильной атрибуции.',
  },
  [TooltipKeys.WA_VIEW_KANBAN]: {
    title: 'Kanban-доска',
    content: 'Визуальное представление лидов по этапам воронки. Перетаскивайте карточки между колонками.',
  },
  [TooltipKeys.WA_VIEW_LIST]: {
    title: 'Режим списка',
    content: 'Компактный список всех лидов с основной информацией. Удобен для быстрого обзора.',
  },
  [TooltipKeys.WA_VIEW_TABLE]: {
    title: 'Табличный режим',
    content: 'Полная таблица со всеми данными о лидах. Поддерживает сортировку и фильтрацию.',
  },
  [TooltipKeys.WA_LEAD_CARD]: {
    title: 'Карточка лида',
    content: 'Полная информация о лиде: контакты, источник, история сообщений, статус в воронке.',
  },
  [TooltipKeys.WA_UPDATE_STAGE]: {
    title: 'Изменить этап',
    content: 'Переместите лида на другой этап воронки. Изменения синхронизируются с AmoCRM.',
  },

  // ==========================================
  // Профиль / Подключения
  // ==========================================
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
  [TooltipKeys.PROFILE_TARIFF]: {
    title: 'Ваш тариф',
    content: 'Информация о текущем тарифе, дате окончания и доступных функциях.',
  },
  [TooltipKeys.PROFILE_PASSWORD]: {
    title: 'Смена пароля',
    content: 'Минимум 8 символов, рекомендуется использовать буквы, цифры и специальные символы.',
  },
  [TooltipKeys.PROFILE_USERNAME]: {
    title: 'Имя пользователя',
    content: 'Отображается в интерфейсе и отчётах. Можно изменить в любое время.',
  },
  [TooltipKeys.PROFILE_TELEGRAM_IDS]: {
    title: 'Telegram ID',
    content: 'Можно указать до 4 Telegram ID для получения отчётов. Каждый ID с новой строки.',
  },
  [TooltipKeys.PROFILE_MAX_BUDGET]: {
    title: 'Максимальный бюджет',
    content: 'Лимит расхода за день по всем направлениям. Autopilot не превысит этот лимит.',
  },
  [TooltipKeys.PROFILE_PLANNED_CPL]: {
    title: 'Планируемый CPL',
    content: 'Желаемая стоимость лида. Autopilot будет оптимизировать кампании к этому показателю.',
  },
  [TooltipKeys.PROFILE_OPENAI_KEY]: {
    title: 'OpenAI API ключ',
    content: 'Для генерации текстов и анализа креативов. Получите на platform.openai.com.',
  },
  [TooltipKeys.PROFILE_AUDIENCE_ID]: {
    title: 'Instagram Seed Audience',
    content: 'ID аудитории для lookalike таргетинга. Найдите в Meta Business Suite → Audiences.',
  },
  [TooltipKeys.PROFILE_AD_ACCOUNTS]: {
    title: 'Рекламные аккаунты',
    content: 'Выберите рекламный аккаунт для работы. Можно переключаться между несколькими аккаунтами.',
  },
  [TooltipKeys.PROFILE_BUSINESS_PORTFOLIO]: {
    title: 'Business Portfolio',
    content: 'Для подключения выдайте партнёрский доступ к вашему Business Portfolio в Meta Business Suite.',
    learnMoreLink: '/knowledge-base/getting-started/facebook-connection',
  },

  // ==========================================
  // Autopilot
  // ==========================================
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
  [TooltipKeys.AUTOPILOT_TOGGLE]: {
    title: 'Включить/выключить',
    content: 'Включите для автоматического управления рекламой. Выключите для ручного контроля.',
    learnMoreLink: '/knowledge-base/ad-management/autopilot-toggle',
  },
  [TooltipKeys.AUTOPILOT_LAST_RUN]: {
    title: 'Последний запуск',
    content: 'Когда Autopilot последний раз анализировал и оптимизировал ваши кампании.',
  },
  [TooltipKeys.AUTOPILOT_NEXT_RUN]: {
    title: 'Следующий запуск',
    content: 'Autopilot запускается ежедневно в 8:00 утра по вашему часовому поясу.',
  },
  [TooltipKeys.AUTOPILOT_ACTIONS]: {
    title: 'Выполненные действия',
    content: 'История всех действий Autopilot: изменения бюджетов, включение/выключение Ad Set\'ов.',
    learnMoreLink: '/knowledge-base/ad-management/autopilot-reports',
  },
  [TooltipKeys.AUTOPILOT_BUDGET_CHANGE]: {
    title: 'Изменение бюджета',
    content: 'Autopilot увеличивает бюджет успешных Ad Set\'ов и уменьшает у неэффективных.',
  },
  [TooltipKeys.AUTOPILOT_ADSET_CREATED]: {
    title: 'Созданные Ad Set\'ы',
    content: 'Autopilot автоматически создаёт новые Ad Set\'ы на основе лучших креативов.',
  },
  [TooltipKeys.AUTOPILOT_ADSET_PAUSED]: {
    title: 'Приостановленные Ad Set\'ы',
    content: 'Ad Set\'ы с низким Health Score автоматически ставятся на паузу для экономии бюджета.',
  },
  [TooltipKeys.AUTOPILOT_REPORT]: {
    title: 'Ежедневный отчёт',
    content: 'Каждое утро Autopilot отправляет отчёт в Telegram с результатами и выполненными действиями.',
    learnMoreLink: '/knowledge-base/ad-management/autopilot-reports',
  },

  // ==========================================
  // Консультации
  // ==========================================
  [TooltipKeys.CONSULT_ADD]: {
    title: 'Новая консультация',
    content: 'Создайте запись о консультации с клиентом. Укажите время, услугу и контактные данные.',
  },
  [TooltipKeys.CONSULT_TIME_SLOT]: {
    title: 'Выбор времени',
    content: 'Выберите доступный временной слот для консультации. Занятые слоты отмечены серым.',
  },
  [TooltipKeys.CONSULT_BLOCKED_SLOT]: {
    title: 'Заблокированное время',
    content: 'Этот временной слот недоступен — обед, перерыв или уже занят другой консультацией.',
  },
  [TooltipKeys.CONSULT_CLIENT_PHONE]: {
    title: 'Телефон клиента',
    content: 'Введите номер в международном формате: +7XXXXXXXXXX или +998XXXXXXXXX.',
  },
  [TooltipKeys.CONSULT_SERVICE]: {
    title: 'Услуга',
    content: 'Выберите услугу из списка или создайте новую в разделе управления услугами.',
  },
  [TooltipKeys.CONSULT_CREATE_SALE]: {
    title: 'Создать продажу',
    content: 'После успешной консультации создайте продажу для учёта в ROI аналитике.',
  },

  // ==========================================
  // Карусели
  // ==========================================
  [TooltipKeys.CAROUSEL_IDEA]: {
    title: 'Идея карусели',
    content: 'Карусель — это серия связанных карточек с единой историей. AI создаёт storytelling из нескольких слайдов.',
    learnMoreLink: '/knowledge-base/ad-launch/generate-creatives',
  },
  [TooltipKeys.CAROUSEL_IDEA_INPUT]: {
    content: 'Опишите общую идею карусели. Можно оставить пустым — AI придумает сам на основе вашего бизнеса.',
  },
  [TooltipKeys.CAROUSEL_CARDS_COUNT]: {
    title: 'Количество карточек',
    content: 'Оптимально 3-5 карточек. Первая — хук, последняя — призыв к действию. Instagram показывает до 10.',
  },
  [TooltipKeys.CAROUSEL_GENERATE_TEXTS]: {
    content: 'AI создаст связанные тексты для каждой карточки. Потом можно отредактировать вручную.',
  },
  [TooltipKeys.CAROUSEL_VISUAL_STYLE]: {
    title: 'Визуальный стиль',
    content: 'Единый стиль для всех карточек карусели. Создаёт целостное визуальное впечатление.',
  },
  [TooltipKeys.CAROUSEL_STYLE_MINIMAL]: {
    title: 'Чистый минимализм',
    content: 'Универсальный стиль с акцентом на тексте и современным фоном. Подходит для большинства ниш.',
  },
  [TooltipKeys.CAROUSEL_STYLE_STORY]: {
    title: 'Визуальный сторителлинг',
    content: 'Иллюстративный стиль для визуального рассказа истории. Каждая карточка — часть повествования.',
  },
  [TooltipKeys.CAROUSEL_STYLE_UGC]: {
    title: 'Живые фото (UGC)',
    content: 'Реалистичные фото людей и сцен из жизни. Высокое доверие аудитории.',
  },
  [TooltipKeys.CAROUSEL_STYLE_ASSET]: {
    title: 'Фокус на товаре',
    content: 'Стиль для e-commerce: качественные фото товара, цены, характеристики.',
  },
  [TooltipKeys.CAROUSEL_STYLE_FREESTYLE]: {
    title: 'Свободный стиль',
    content: 'Опишите желаемый стиль своими словами. AI постарается воспроизвести вашу идею.',
  },
  [TooltipKeys.CAROUSEL_CUSTOM_PROMPTS]: {
    title: 'Промпты для карточек',
    content: 'Добавьте дополнительные инструкции для конкретных карточек. Например: "добавь человека" или "используй синие тона".',
  },
  [TooltipKeys.CAROUSEL_REFERENCES]: {
    title: 'Референсные изображения',
    content: 'Загрузите изображения как референсы для стиля. Можно применить к одной или нескольким карточкам.',
  },
  [TooltipKeys.CAROUSEL_REGENERATE_CARD]: {
    content: 'Перегенерировать только эту карточку с новым промптом или референсом, сохраняя остальные.',
  },
  [TooltipKeys.CAROUSEL_DOWNLOAD]: {
    title: 'Скачать карусель',
    content: 'Скачайте выбранные или все карточки как ZIP-архив с PNG-файлами в формате 1:1.',
  },
  [TooltipKeys.CAROUSEL_CREATE_FB]: {
    title: 'Создать в Facebook',
    content: 'Автоматически загружает карусель в Facebook Ads и создаёт объявление с настройками направления.',
  },
  [TooltipKeys.CAROUSEL_HOOK_BADGE]: {
    title: 'Хук',
    content: 'Первая карточка — самая важная. Должна зацепить внимание и заставить листать дальше.',
  },
  [TooltipKeys.CAROUSEL_CTA_BADGE]: {
    title: 'CTA',
    content: 'Последняя карточка — призыв к действию. Чёткая инструкция: "Напишите в WhatsApp", "Переходите по ссылке".',
  },

  // ==========================================
  // Генерация текста
  // ==========================================
  [TooltipKeys.TEXT_GENERATION_OVERVIEW]: {
    title: 'Генерация текста',
    content: 'AI создаёт тексты для видео, постов и рекламы на основе контекста вашего бизнеса и лучших практик.',
    learnMoreLink: '/knowledge-base/ad-launch/generate-creatives',
  },
  [TooltipKeys.TEXT_TYPE_SELECT]: {
    title: 'Тип текста',
    content: 'Выберите формат контента. Каждый тип имеет свою структуру и стиль подачи.',
  },
  [TooltipKeys.TEXT_TYPE_STORYTELLING]: {
    title: 'Storytelling',
    content: 'Эмоциональная история с личным опытом. Хук → развитие → кульминация → призыв. Для видео Reels/Stories.',
  },
  [TooltipKeys.TEXT_TYPE_DIRECT_OFFER]: {
    title: 'Прямой оффер',
    content: 'Короткое продающее сообщение: результат + время + безопасность + CTA. Для акций и ограниченных предложений.',
  },
  [TooltipKeys.TEXT_TYPE_EXPERT_VIDEO]: {
    title: 'Экспертное видео',
    content: 'Вирусный хук с экспертным раскрытием темы. Формат "Почему X происходит?" с решением.',
  },
  [TooltipKeys.TEXT_TYPE_TELEGRAM]: {
    title: 'Пост в Telegram',
    content: 'Информационно-познавательный контент без явной рекламы. Для экспертного канала.',
  },
  [TooltipKeys.TEXT_TYPE_THREADS]: {
    title: 'Пост в Threads',
    content: 'Короткий провокационный пост для вовлечения в дискуссию. До 500 символов.',
  },
  [TooltipKeys.TEXT_TYPE_REFERENCE]: {
    title: 'Референс',
    content: 'Адаптация текста креатива (своего или конкурента). Сохраняет структуру и крючки, заменяет детали на ваши.',
  },
  [TooltipKeys.TEXT_USER_PROMPT]: {
    title: 'Ваша задача',
    content: 'Опишите тему, акцент, ключевые моменты. AI использует контекст вашего бизнеса автоматически.',
  },
  [TooltipKeys.TEXT_EDIT_WITH_AI]: {
    title: 'Редактирование с AI',
    content: 'Опишите что изменить: "сделай короче", "добавь эмоций", "измени CTA". AI сохранит структуру.',
  },

  // ==========================================
  // Дополнительные для генерации картинок
  // ==========================================
  [TooltipKeys.GEN_TEXT_AI_BUTTON]: {
    content: 'Сгенерировать текст с помощью AI на основе контекста вашего бизнеса. Учитывает уже заполненные поля.',
  },
  [TooltipKeys.GEN_FREESTYLE_PROMPT]: {
    title: 'Промпт стиля',
    content: 'Опишите желаемый визуальный стиль: цветовую палитру, атмосферу, тип изображения, композицию.',
  },
  [TooltipKeys.GEN_EDIT_MODE]: {
    title: 'Редактирование креатива',
    content: 'Опишите что изменить в сгенерированном изображении. Текущее изображение используется как референс.',
  },

  // ==========================================
  // Загрузка креативов (дополнительные)
  // ==========================================
  [TooltipKeys.CREATIVES_PAGE_OVERVIEW]: {
    title: 'Управление креативами',
    content: 'Здесь хранятся все ваши креативы: загруженные видео, сгенерированные картинки и карусели.',
    learnMoreLink: '/knowledge-base/ad-launch/upload-creatives',
  },
  [TooltipKeys.UPLOAD_DROPZONE]: {
    title: 'Загрузка файлов',
    content: 'Перетащите файлы или нажмите для выбора. Видео: MP4, MOV до 512 МБ. Изображения: JPG, PNG до 10 МБ.',
  },
  [TooltipKeys.CREATIVE_ANALYTICS]: {
    title: 'Аналитика креатива',
    content: 'Статистика из Facebook Ads: показы, клики, лиды, расход. Обновляется каждый час.',
  },
  [TooltipKeys.CREATIVE_LAUNCH_AD]: {
    title: 'Запустить рекламу',
    content: 'Создаёт рекламную кампанию в Facebook с выбранным креативом и настройками направления.',
  },
};

export function getTooltip(key: TooltipKey): TooltipData | undefined {
  return tooltips[key];
}
