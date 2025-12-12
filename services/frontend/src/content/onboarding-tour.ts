// Контент для онбординг-тура (экскурсия)
// Показывается ТОЛЬКО после одобрения Facebook подключения тех.специалистом
// Логика: показываем кнопку в сайдбаре → переходим → показываем контент раздела

export interface TourStep {
  id: string;
  type: 'modal' | 'tooltip';
  selector?: string; // CSS селектор для tooltip
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  navigateTo?: string; // Навигация ПОСЛЕ показа этого шага (при нажатии "Далее")
  delay?: number; // Задержка перед показом (мс)
  scrollToElement?: boolean; // Автоскролл к элементу
}

export const tourSteps: TourStep[] = [
  // === НАЧАЛО ===
  {
    id: 'welcome',
    type: 'modal',
    title: 'Добро пожаловать в Performante.ai!',
    content: 'Facebook подключён! Сейчас мы проведём вас по платформе и покажем, как запустить первую рекламу. Это займёт около минуты.',
  },

  // === ПРОФИЛЬ: кнопка в сайдбаре ===
  {
    id: 'sidebar-profile',
    type: 'tooltip',
    selector: '[data-tour="sidebar-profile"]',
    title: 'Раздел «Профиль»',
    content: 'Начнём отсюда. Нажмите на эту кнопку, чтобы перейти в центр управления вашим бизнесом.',
    position: 'right',
    navigateTo: '/profile',
    delay: 200,
    scrollToElement: true,
  },

  // === ПРОФИЛЬ: контент страницы ===
  {
    id: 'profile-content',
    type: 'tooltip',
    selector: '[data-tour="directions-block"]',
    title: 'Направления рекламы',
    content: 'Здесь вы создаёте направления — контейнеры для рекламы. Одно направление = один продукт или услуга. Для каждого настраивается своя аудитория и бюджет.',
    position: 'bottom',
    delay: 400,
    scrollToElement: true,
  },

  // === ЗАГРУЗКА ВИДЕО: кнопка в сайдбаре ===
  {
    id: 'sidebar-videos',
    type: 'tooltip',
    selector: '[data-tour="sidebar-videos"]',
    title: 'Раздел «Загрузка креативов»',
    content: 'Теперь перейдём к загрузке материалов для рекламы.',
    position: 'right',
    navigateTo: '/videos',
    delay: 200,
    scrollToElement: true,
  },

  // === ЗАГРУЗКА ВИДЕО: контент страницы ===
  {
    id: 'videos-content',
    type: 'tooltip',
    selector: '[data-tour="videos-content"]',
    title: 'Загрузка креативов',
    content: 'Сюда загружайте видео и картинки для рекламы. Система автоматически создаст из них объявления и запустит в работу.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === ГЕНЕРАЦИЯ: кнопка в сайдбаре ===
  {
    id: 'sidebar-creatives',
    type: 'tooltip',
    selector: '[data-tour="sidebar-creatives"]',
    title: 'Раздел «AI-генерация»',
    content: 'А здесь можно создавать креативы с помощью искусственного интеллекта.',
    position: 'right',
    navigateTo: '/creatives',
    delay: 200,
    scrollToElement: true,
  },

  // === ГЕНЕРАЦИЯ: контент страницы ===
  {
    id: 'creatives-content',
    type: 'tooltip',
    selector: '[data-tour="creatives-content"]',
    title: 'AI-генерация креативов',
    content: 'Здесь AI создаёт картинки, карусели и тексты на основе данных о вашем бизнесе. Не нужно нанимать дизайнера — система сделает всё сама.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === DASHBOARD: кнопка в сайдбаре ===
  {
    id: 'sidebar-dashboard',
    type: 'tooltip',
    selector: '[data-tour="sidebar-dashboard"]',
    title: 'Раздел «Dashboard»',
    content: 'Перейдём к статистике рекламных кампаний.',
    position: 'right',
    navigateTo: '/',
    delay: 200,
    scrollToElement: true,
  },

  // === DASHBOARD: контент страницы ===
  {
    id: 'dashboard-content',
    type: 'tooltip',
    selector: '[data-tour="dashboard-content"]',
    title: 'Dashboard — Статистика',
    content: 'Dashboard показывает все метрики: показы, клики, лиды, расходы. Данные обновляются автоматически из Facebook.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === ROI: кнопка в сайдбаре ===
  {
    id: 'sidebar-roi',
    type: 'tooltip',
    selector: '[data-tour="sidebar-roi"]',
    title: 'Раздел «ROI Аналитика»',
    content: 'Здесь можно отслеживать эффективность рекламы.',
    position: 'right',
    navigateTo: '/roi',
    delay: 200,
    scrollToElement: true,
  },

  // === ROI: контент страницы ===
  {
    id: 'roi-content',
    type: 'tooltip',
    selector: '[data-tour="roi-content"]',
    title: 'ROI Аналитика',
    content: 'Подключите WhatsApp — и увидите, какая реклама приносит реальные заявки. Считайте ROI каждого объявления.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === КОНКУРЕНТЫ: кнопка в сайдбаре ===
  {
    id: 'sidebar-competitors',
    type: 'tooltip',
    selector: '[data-tour="sidebar-competitors"]',
    title: 'Раздел «Конкуренты»',
    content: 'А тут можно подсмотреть, что делают конкуренты.',
    position: 'right',
    navigateTo: '/competitors',
    delay: 200,
    scrollToElement: true,
  },

  // === КОНКУРЕНТЫ: контент страницы ===
  {
    id: 'competitors-content',
    type: 'tooltip',
    selector: '[data-tour="competitors-content"]',
    title: 'Анализ конкурентов',
    content: 'Анализируйте рекламу конкурентов и используйте лучшие идеи как референсы для генерации своих креативов.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === БАЗА ЗНАНИЙ: кнопка в сайдбаре ===
  {
    id: 'sidebar-knowledge',
    type: 'tooltip',
    selector: '[data-tour="sidebar-knowledge"]',
    title: 'Раздел «База знаний»',
    content: 'И наконец, если возникнут вопросы — заходите сюда.',
    position: 'right',
    navigateTo: '/knowledge-base',
    delay: 200,
    scrollToElement: true,
  },

  // === БАЗА ЗНАНИЙ: контент страницы ===
  {
    id: 'knowledge-content',
    type: 'tooltip',
    selector: '[data-tour="knowledge-content"]',
    title: 'База знаний',
    content: 'Здесь подробные инструкции по всем функциям платформы. Если что-то непонятно — ответ найдётся тут.',
    position: 'top',
    delay: 400,
    scrollToElement: true,
  },

  // === ЗАВЕРШЕНИЕ ===
  {
    id: 'completion',
    type: 'modal',
    title: 'Экскурсия завершена!',
    content: 'Теперь вы знаете, где что находится. Рекомендуем начать с создания направления в Профиле — это первый шаг к запуску рекламы. Удачных продаж!',
  },
];

export const TOUR_STORAGE_KEY = 'onboardingTourCompleted';
