import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { logger } from './logger.js';
import { BRAIN_SERVICE_URL, BRAIN_SERVICE_SECRET } from './config.js';

/**
 * Таймауты для разных типов tools (в миллисекундах)
 */
const TOOL_TIMEOUTS: Record<string, number> = {
  // Генерация изображений — до 3 минут
  generateCreatives: 180_000,
  createImageCreative: 180_000,
  // Карусель — до 10 минут
  generateCarousel: 600_000,
  // Текстовая генерация — до 3 минут
  generateOffer: 180_000,
  generateBullets: 180_000,
  generateProfits: 180_000,
  generateCta: 180_000,
  generateTextCreative: 180_000,
  generateCarouselTexts: 180_000,
  // AI-анализ — до 2 минут
  triggerCreativeAnalysis: 120_000,
  analyzeDialog: 120_000,
  triggerBrainOptimizationRun: 120_000,
};
const DEFAULT_TIMEOUT = 30_000;

function getToolTimeout(toolName: string): number {
  return TOOL_TIMEOUTS[toolName] || DEFAULT_TIMEOUT;
}

/**
 * Определения всех инструментов для Anthropic Tool Use
 */
export const tools: Anthropic.Tool[] = [
  // ===== FACEBOOK ADS SPECIALIST =====
  {
    name: 'getCampaigns',
    description: 'Получить список Facebook кампаний с метриками',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: {
          type: 'string',
          description: 'UUID пользователя из контекста сессии',
        },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_30d', 'lifetime'],
          description: 'Период для метрик',
        },
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['ACTIVE', 'PAUSED'],
          },
          description: 'Фильтр по статусу кампаний',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getAdSets',
    description: 'Получить адсеты кампании',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaignId: { type: 'string', description: 'ID Facebook кампании' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'campaignId'],
    },
  },
  {
    name: 'getCampaignDetails',
    description: 'Детали конкретной кампании',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaignId: { type: 'string' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'campaignId'],
    },
  },
  {
    name: 'getAds',
    description: 'Получить объявления адсета',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string', description: 'ID адсета Facebook' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'adSetId'],
    },
  },
  {
    name: 'getSpendReport',
    description: 'Отчёт по расходам с детализацией',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
        breakdown: {
          type: 'string',
          enum: ['day', 'week', 'campaign', 'adset'],
          description: 'Тип разбивки отчёта',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getDirectionMetrics',
    description: 'Метрики конкретного направления',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        directionId: { type: 'string', description: 'UUID направления' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'directionId'],
    },
  },
  {
    name: 'getROIReport',
    description: 'ROI отчёт по креативам: расходы, выручка, ROI%',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
        date_from: { type: 'string', description: 'Начало периода (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'Конец периода (YYYY-MM-DD)' },
        direction_id: { type: 'string' },
        media_type: {
          type: 'string',
          enum: ['video', 'image'],
          description: 'Тип медиа креативов',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getROIComparison',
    description: 'Сравнить ROI между креативами или направлениями',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        compare_by: {
          type: 'string',
          enum: ['creative', 'direction'],
          description: 'По чему сравнивать',
        },
        top_n: { type: 'number', description: 'Количество топ записей' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'compare_by'],
    },
  },
  {
    name: 'getAdAccountStatus',
    description: 'Статус рекламного аккаунта',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getLeadsEngagementRate',
    description: 'Качество лидов WhatsApp: % отправивших 2+ сообщения',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string', description: 'Период для анализа' },
        direction_id: { type: 'string' },
      },
      required: ['userAccountId', 'period'],
    },
  },
  {
    name: 'getAgentBrainActions',
    description: 'История действий агента',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        limit: { type: 'number', description: 'Количество записей' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'triggerBrainOptimizationRun',
    description: 'Запустить Brain Mini оптимизацию',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
        reason: { type: 'string', description: 'Причина запуска' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getDirections',
    description: 'Получить направления (группы кампаний)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'pauseAdSet',
    description: 'Поставить адсет на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
      },
      required: ['userAccountId', 'adSetId'],
    },
  },
  {
    name: 'resumeAdSet',
    description: 'Возобновить адсет',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
      },
      required: ['userAccountId', 'adSetId'],
    },
  },
  {
    name: 'updateBudget',
    description: 'Изменить бюджет адсета',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string' },
        dailyBudget: { type: 'number', description: 'Новый суточный бюджет в долларах' },
      },
      required: ['userAccountId', 'adSetId', 'dailyBudget'],
    },
  },
  {
    name: 'updateDirectionBudget',
    description: 'Изменить суточный бюджет направления',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        new_budget: { type: 'number', description: 'Новый суточный бюджет в долларах' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'direction_id', 'new_budget'],
    },
  },
  {
    name: 'scaleBudget',
    description: 'Масштабировать бюджет с процентным изменением',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adSetId: { type: 'string', description: 'ID адсета Facebook' },
        scalePercent: { type: 'number', description: 'Процент изменения (например 20 = +20%)' },
      },
      required: ['userAccountId', 'adSetId', 'scalePercent'],
    },
  },
  {
    name: 'pauseAd',
    description: 'Поставить объявление на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adId: { type: 'string', description: 'ID объявления Facebook' },
        reason: { type: 'string', description: 'Причина паузы' },
      },
      required: ['userAccountId', 'adId'],
    },
  },
  {
    name: 'resumeAd',
    description: 'Возобновить объявление',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adId: { type: 'string', description: 'ID объявления Facebook' },
      },
      required: ['userAccountId', 'adId'],
    },
  },
  {
    name: 'updateDirectionTargetCPL',
    description: 'Изменить целевой CPL направления',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        target_cpl: { type: 'number', description: 'Новый целевой CPL' },
      },
      required: ['userAccountId', 'direction_id', 'target_cpl'],
    },
  },
  {
    name: 'pauseDirection',
    description: 'Поставить направление на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        reason: { type: 'string', description: 'Причина паузы' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'direction_id'],
    },
  },
  {
    name: 'resumeDirection',
    description: 'Возобновить направление',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
      },
      required: ['userAccountId', 'direction_id'],
    },
  },
  {
    name: 'approveBrainActions',
    description: 'Выполнить выбранные действия Brain Mini',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        stepIndices: {
          type: 'array',
          items: { type: 'number' },
          description: 'Индексы шагов для выполнения',
        },
      },
      required: ['userAccountId', 'stepIndices'],
    },
  },
  {
    name: 'createDirection',
    description: 'Создать новое направление',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        name: { type: 'string', description: 'Название направления' },
        platform: { type: 'string', description: 'Рекламная платформа' },
        objective: { type: 'string', description: 'Цель кампании' },
        daily_budget_cents: { type: 'number', description: 'Суточный бюджет в центах' },
        target_cpl_cents: { type: 'number', description: 'Целевой CPL в центах' },
        whatsapp_phone_number: { type: 'string', description: 'Номер WhatsApp' },
      },
      required: ['userAccountId', 'name'],
    },
  },

  // ===== CREATIVES SPECIALIST =====
  {
    name: 'getCreatives',
    description: 'Получить список креативов с метриками за 30 дней',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления для фильтрации' },
        status: { type: 'string', enum: ['active', 'all'] },
        sort_by: { type: 'string', enum: ['cpl', 'leads', 'spend', 'score', 'created'] },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getCreativeDetails',
    description: 'Детальная информация о креативе',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'getCreativeMetrics',
    description: 'Детальные метрики креатива с разбивкой по дням',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
        period: { type: 'string' },
        date_from: { type: 'string', description: 'Начало периода (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'Конец периода (YYYY-MM-DD)' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'getTopCreatives',
    description: 'Лучшие креативы по метрикам',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        metric: {
          type: 'string',
          enum: ['cpl', 'leads', 'ctr', 'score'],
          description: 'Метрика для сортировки',
        },
        direction_id: { type: 'string' },
        period: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getWorstCreatives',
    description: 'Худшие креативы с высоким CPL',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        threshold_cpl: { type: 'number', description: 'Порог CPL для фильтрации' },
        direction_id: { type: 'string' },
        period: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'compareCreatives',
    description: 'Сравнить метрики 2-5 креативов',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Массив ID креативов для сравнения (2-5 шт)',
        },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'creative_ids'],
    },
  },
  {
    name: 'getCreativeAnalysis',
    description: 'Последний AI-анализ креатива',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'getCreativeScores',
    description: 'Risk scores и predictions',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        level: {
          type: 'string',
          enum: ['creative', 'adset'],
          description: 'Уровень скоринга',
        },
        risk_level: {
          type: 'string',
          enum: ['High', 'Medium', 'Low', 'all'],
          description: 'Фильтр по уровню риска',
        },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getCreativeTests',
    description: 'История A/B тестов креатива',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'getCreativeTranscript',
    description: 'Транскрипция видео креатива',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'generateOffer',
    description: 'Сгенерировать заголовок/оффер для креатива (ШАГ 1 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string', description: 'Описание для генерации оффера' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateBullets',
    description: 'Сгенерировать буллеты/преимущества (ШАГ 2 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string', description: 'Оффер из шага 1' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateProfits',
    description: 'Сгенерировать выгоды для клиента (ШАГ 3 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string' },
        existing_bullets: { type: 'string' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateCta',
    description: 'Сгенерировать призыв к действию (ШАГ 4 из 5)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        prompt: { type: 'string' },
        existing_offer: { type: 'string' },
        existing_bullets: { type: 'string' },
        existing_profits: { type: 'string' },
      },
      required: ['userAccountId', 'prompt'],
    },
  },
  {
    name: 'generateCreatives',
    description: 'Сгенерировать изображение креатива 1080x1920px с готовыми текстами (ШАГ 5 ФИНАЛ)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        offer: { type: 'string', description: 'Готовый заголовок' },
        bullets: { type: 'string', description: 'Готовые буллеты' },
        profits: { type: 'string', description: 'Готовые выгоды' },
        cta: { type: 'string', description: 'Готовый CTA' },
        direction_id: { type: 'string' },
        style_id: {
          type: 'string',
          enum: ['modern_performance', 'clean_minimal', 'bold_dark', 'neon_glow', 'gradient_soft'],
        },
        reference_image_url: { type: 'string', description: 'URL референс-изображения от пользователя' },
      },
      required: ['userAccountId', 'offer'],
    },
  },
  {
    name: 'generateCarouselTexts',
    description: 'Тексты для карусели',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        carousel_idea: { type: 'string', description: 'Идея/тема карусели' },
        cards_count: { type: 'number', description: 'Количество карточек' },
      },
      required: ['userAccountId', 'carousel_idea'],
    },
  },
  {
    name: 'generateCarousel',
    description: 'Изображения карусели',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        carousel_texts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Тексты для карточек карусели',
        },
        visual_style: {
          type: 'string',
          enum: ['clean_minimal', 'modern_performance', 'bold_dark', 'gradient_soft'],
          description: 'Визуальный стиль карусели',
        },
        style_prompt: { type: 'string', description: 'Дополнительный промпт для стиля' },
        direction_id: { type: 'string' },
        reference_image_url: { type: 'string', description: 'URL референс-изображения от пользователя' },
      },
      required: ['userAccountId', 'carousel_texts'],
    },
  },
  {
    name: 'generateTextCreative',
    description: 'Текст для видео/постов',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        text_type: {
          type: 'string',
          enum: ['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'],
          description: 'Тип текста',
        },
        user_prompt: { type: 'string', description: 'Пользовательский промпт' },
      },
      required: ['userAccountId', 'text_type'],
    },
  },
  {
    name: 'createImageCreative',
    description: 'Создать Facebook креатив из сгенерированного изображения',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID сгенерированного креатива' },
        direction_id: { type: 'string', description: 'UUID направления' },
      },
      required: ['userAccountId', 'creative_id', 'direction_id'],
    },
  },
  {
    name: 'pauseCreative',
    description: 'Поставить все объявления креатива на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
        reason: { type: 'string', description: 'Причина паузы' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'launchCreative',
    description: 'Запустить креатив в направление',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
        direction_id: { type: 'string', description: 'UUID направления' },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'creative_id', 'direction_id'],
    },
  },
  {
    name: 'startCreativeTest',
    description: 'Запустить A/B тест креатива',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
        objective: {
          type: 'string',
          enum: ['whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms'],
          description: 'Цель теста',
        },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'stopCreativeTest',
    description: 'Остановить A/B тест',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },
  {
    name: 'triggerCreativeAnalysis',
    description: 'Запустить AI-анализ креатива',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        creative_id: { type: 'string', description: 'ID креатива' },
      },
      required: ['userAccountId', 'creative_id'],
    },
  },

  // ===== CRM SPECIALIST =====
  {
    name: 'getLeads',
    description: 'Получить список лидов с фильтрацией',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        status: { type: 'string' },
        period: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getSales',
    description: 'Получить список продаж с детализацией',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
        direction_id: { type: 'string' },
        min_amount: { type: 'number', description: 'Минимальная сумма покупки в тенге' },
        search: { type: 'string', description: 'Поиск по номеру телефона' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getFunnelStats',
    description: 'Статистика по воронке продаж',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getDialogs',
    description: 'WhatsApp диалоги',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        status: { type: 'string', description: 'Статус диалога' },
        limit: { type: 'number' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'analyzeDialog',
    description: 'AI-анализ диалога WhatsApp',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        dialogId: { type: 'string', description: 'ID диалога' },
      },
      required: ['userAccountId', 'dialogId'],
    },
  },
  {
    name: 'getSalesQuality',
    description: 'KPI ladder: лиды → квалифицированные → продажи',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string' },
        period: { type: 'string' },
        date_from: { type: 'string', description: 'Начало периода (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'Конец периода (YYYY-MM-DD)' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'addSale',
    description: 'Добавить продажу вручную',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        client_phone: { type: 'string', description: 'Номер телефона клиента (формат: +77001234567)' },
        amount: { type: 'number', description: 'Сумма продажи в тенге (например: 150000 = 150K ₸)' },
        direction_id: { type: 'string' },
        manual_source_id: { type: 'string', description: 'source ID креатива если лид не найден' },
      },
      required: ['userAccountId', 'client_phone', 'amount'],
    },
  },
  {
    name: 'updateLeadStage',
    description: 'Изменить стадию лида',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        lead_id: { type: 'string', description: 'ID лида' },
        new_stage: { type: 'string', description: 'Новая стадия лида' },
        reason: { type: 'string', description: 'Причина изменения' },
      },
      required: ['userAccountId', 'lead_id', 'new_stage'],
    },
  },

  // ===== TIKTOK SPECIALIST =====
  {
    name: 'getTikTokCampaigns',
    description: 'Список TikTok кампаний',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
        status: { type: 'string', description: 'Фильтр по статусу' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'compareTikTokWithFacebook',
    description: 'Сравнить TikTok и Facebook метрики',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'pauseTikTokCampaign',
    description: 'Поставить TikTok кампанию на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaignId: { type: 'string', description: 'ID TikTok кампании' },
        reason: { type: 'string', description: 'Причина паузы' },
      },
      required: ['userAccountId', 'campaignId'],
    },
  },

  // ===== ONBOARDING =====
  {
    name: 'createUser',
    description: 'Создать пользователя (онбординг)',
    input_schema: {
      type: 'object',
      properties: {
        business_name: { type: 'string', description: 'Название бизнеса' },
        business_niche: { type: 'string', description: 'Ниша бизнеса' },
        username: { type: 'string', description: 'Имя пользователя' },
        password: { type: 'string', description: 'Пароль' },
        instagram_url: { type: 'string', description: 'URL Instagram' },
        website_url: { type: 'string', description: 'URL сайта' },
        target_audience: { type: 'string', description: 'Целевая аудитория' },
        geography: { type: 'string', description: 'География' },
      },
      required: ['business_name', 'business_niche', 'username', 'password'],
    },
  },

  // ===== SYSTEM =====
  {
    name: 'getUserErrors',
    description: 'Получить ошибки пользователя из системного лога с LLM-расшифровкой (объяснение + решение)',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'warning', 'info'], description: 'Фильтр по серьёзности' },
        error_type: { type: 'string', description: 'Фильтр по типу ошибки' },
        resolved: { type: 'boolean', description: 'Фильтр по статусу решения' },
        limit: { type: 'number', description: 'Количество записей (макс 50)' },
      },
      required: ['userAccountId'],
    },
  },
];

/**
 * Выполнить tool через HTTP запрос к agent-brain
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>
): Promise<any> {
  try {
    logger.info({ toolName }, 'Executing tool');

    const url = `${BRAIN_SERVICE_URL}/brain/tools/${toolName}`;
    const timeout = getToolTimeout(toolName);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (BRAIN_SERVICE_SECRET) {
      headers['X-Service-Auth'] = BRAIN_SERVICE_SECRET;
    }

    const response = await axios.post(url, toolInput, { headers, timeout });

    logger.info({ toolName, success: true }, 'Tool executed successfully');
    return response.data;
  } catch (error: any) {
    logger.error({ toolName, status: error.response?.status }, 'Tool execution failed');

    // Не раскрывать internal details в ответах Claude
    const safeError = error.response?.data?.error || 'Ошибка выполнения операции';
    return {
      success: false,
      error: safeError,
    };
  }
}
