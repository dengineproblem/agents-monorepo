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
  // Launch tools — proxy через agent-service
  aiLaunch: 180_000,
  createAdSet: 90_000,
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
          type: 'string',
          enum: ['ACTIVE', 'PAUSED', 'all'],
          description: 'Фильтр по статусу кампаний',
        },
        campaign_type: {
          type: 'string',
          enum: ['internal', 'external', 'all'],
          description: 'internal = привязаны к directions, external = без directions, all = все',
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
        campaign_id: { type: 'string', description: 'ID Facebook кампании' },
        period: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getCampaignDetails',
    description: 'Детали конкретной кампании',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'ID кампании в Facebook' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'campaign_id'],
    },
  },
  {
    name: 'getAds',
    description: 'Получить статистику на уровне объявлений (ads level) с метриками',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'ID кампании (опционально)' },
        period: { type: 'string' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getSpendReport',
    description: 'Отчёт по расходам с детализацией. ВАЖНО: всегда передавай date_from/date_to или period.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)',
        },
        date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD (приоритет над period)' },
        date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
        group_by: {
          type: 'string',
          enum: ['campaign', 'day', 'total'],
          description: 'Группировка данных',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'getDirectionMetrics',
    description: 'Метрики конкретного направления. Сначала вызови getDirections для получения direction_id.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        period: { type: 'string' },
      },
      required: ['userAccountId', 'direction_id'],
    },
  },
  {
    name: 'getROIReport',
    description: 'ROI отчёт по креативам с РАЗДЕЛЕНИЕМ по платформам. Facebook spend в USD, TikTok в KZT. Результат содержит platforms.facebook и platforms.tiktok с отдельными campaigns[], totalSpend, avgCPL. ВСЕГДА показывай платформы отдельными секциями с указанием валюты.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)',
        },
        date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD (приоритет над period)' },
        date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
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
        adset_id: { type: 'string', description: 'ID адсета Facebook' },
      },
      required: ['userAccountId', 'adset_id'],
    },
  },
  {
    name: 'resumeAdSet',
    description: 'Возобновить адсет',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adset_id: { type: 'string', description: 'ID адсета Facebook' },
      },
      required: ['userAccountId', 'adset_id'],
    },
  },
  {
    name: 'updateBudget',
    description: 'Изменить бюджет адсета',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adset_id: { type: 'string', description: 'ID адсета Facebook' },
        new_budget_cents: { type: 'number', description: 'Новый суточный бюджет в центах (минимум 300, т.е. $3). Пример: $10 = 1000' },
      },
      required: ['userAccountId', 'adset_id', 'new_budget_cents'],
    },
  },
  {
    name: 'updateDirectionBudget',
    description: 'Изменить суточный бюджет направления. ОБЯЗАТЕЛЬНО сначала вызови getDirections для получения реального direction_id!',
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
    name: 'pauseAd',
    description: 'Поставить объявление на паузу',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        ad_id: { type: 'string', description: 'ID объявления Facebook' },
        reason: { type: 'string', description: 'Причина паузы' },
      },
      required: ['userAccountId', 'ad_id'],
    },
  },
  {
    name: 'resumeAd',
    description: 'Возобновить объявление',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        ad_id: { type: 'string', description: 'ID объявления Facebook' },
      },
      required: ['userAccountId', 'ad_id'],
    },
  },
  {
    name: 'updateDirectionTargetCPL',
    description: 'Изменить целевой CPL направления. ОБЯЗАТЕЛЬНО сначала вызови getDirections для получения реального direction_id!',
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
    description: 'Поставить направление на паузу (и FB кампанию). ОБЯЗАТЕЛЬНО сначала вызови getDirections для получения реального direction_id!',
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
    description: 'Возобновить направление (и FB кампанию в Ads Manager). ОБЯЗАТЕЛЬНО сначала вызови getDirections для получения реального direction_id!',
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
    name: 'pauseCampaign',
    description: 'Поставить FB кампанию на паузу НАПРЯМУЮ через FB API. Работает с ЛЮБОЙ кампанией, не требует direction. Сначала вызови getCampaigns для campaign_id.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'Facebook Campaign ID (числовой)' },
        reason: { type: 'string', description: 'Причина паузы' },
      },
      required: ['userAccountId', 'campaign_id'],
    },
  },
  {
    name: 'resumeCampaign',
    description: 'Включить FB кампанию НАПРЯМУЮ через FB API. Работает с ЛЮБОЙ кампанией, не требует direction. Сначала вызови getCampaigns для campaign_id.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'Facebook Campaign ID (числовой)' },
      },
      required: ['userAccountId', 'campaign_id'],
    },
  },
  {
    name: 'getDirectionCreatives',
    description: 'Получить список креативов направления с их статусами и метриками. Сначала вызови getDirections для direction_id.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления из таблицы directions' },
      },
      required: ['userAccountId', 'direction_id'],
    },
  },
  {
    name: 'getDirectionInsights',
    description: 'Метрики направления с сравнением vs предыдущий период. Включает CPL, CTR, CPM, CPC и delta. Сначала вызови getDirections для direction_id.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)',
        },
        date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD (приоритет над period)' },
        date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
        compare: {
          type: 'string',
          enum: ['previous_same', 'previous_7d'],
          description: 'Сравнить с предыдущим периодом',
        },
      },
      required: ['userAccountId', 'direction_id'],
    },
  },
  {
    name: 'getExternalCampaignMetrics',
    description: 'Метрики ВНЕШНИХ кампаний (созданных не через приложение) с CPL, health score и сравнением с target. Target CPL из маппинга (saveCampaignMapping) или fallback аккаунта.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'ID конкретной кампании (опционально). Если не указан — все external кампании' },
        period: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)',
        },
        date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD (приоритет над period)' },
        date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'saveCampaignMapping',
    description: 'Сохранить маппинг внешней кампании → направление + целевой CPL. Используй когда пользователь указал какое направление рекламирует кампания.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'Facebook Campaign ID' },
        campaign_name: { type: 'string', description: 'Название кампании (для читаемости)' },
        direction_name: { type: 'string', description: 'Название направления/услуги (Имплантация, Ремонт квартир и т.д.)' },
        goal: {
          type: 'string',
          enum: ['whatsapp', 'site', 'lead_form', 'other'],
          description: 'Цель кампании',
        },
        target_cpl_cents: { type: 'number', description: 'Целевой CPL в центах (10-100000)' },
      },
      required: ['userAccountId', 'campaign_id', 'direction_name', 'target_cpl_cents'],
    },
  },
  {
    name: 'aiLaunch',
    description: 'Запуск с AI — GPT-4o выбирает лучшие креативы по risk score/CPL/CTR, паузит старые адсеты и создаёт новые для ВСЕХ активных направлений. Это основной способ запуска рекламы. Полный production workflow с правильным таргетингом и маппингом.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        start_mode: {
          type: 'string',
          enum: ['now', 'midnight_almaty'],
          description: 'Время запуска: сейчас или с полуночи по Алмате (UTC+5). По умолчанию now',
        },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'createAdSet',
    description: 'Ручной запуск: создать адсет с конкретными креативами в направлении. Полный production workflow с таргетингом из БД и маппингом. Сначала вызови getDirections для direction_id и getDirectionCreatives для creative_ids.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        direction_id: { type: 'string', description: 'UUID направления' },
        creative_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Массив ID креативов для запуска',
        },
        daily_budget_cents: { type: 'number', description: 'Суточный бюджет в центах (опционально, берётся из direction)' },
        start_mode: {
          type: 'string',
          enum: ['now', 'midnight_almaty'],
          description: 'Время запуска: сейчас или с полуночи по Алмате (UTC+5). По умолчанию now',
        },
        dry_run: { type: 'boolean', description: 'Preview режим без выполнения' },
      },
      required: ['userAccountId', 'direction_id', 'creative_ids'],
    },
  },
  // ============================================================
  // INSIGHTS BREAKDOWN
  // ============================================================
  {
    name: 'getInsightsBreakdown',
    description: 'Метрики с разбивкой по возрасту, полу, устройству, площадке, стране. Используй для: "статистика по возрасту", "CTR по площадкам", "разбивка по странам".',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        breakdown: {
          type: 'string',
          enum: ['age', 'gender', 'age,gender', 'country', 'region', 'device_platform', 'publisher_platform', 'platform_position'],
          description: 'Тип разбивки',
        },
        entity_type: {
          type: 'string',
          enum: ['account', 'campaign', 'adset'],
          description: 'Уровень (по умолчанию account)',
        },
        entity_id: { type: 'string', description: 'ID кампании или адсета (для account не нужен)' },
        period: { type: 'string', description: 'Период: today, yesterday, last_7d, last_14d, last_30d' },
        date_from: { type: 'string', description: 'Начало YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Конец YYYY-MM-DD' },
      },
      required: ['userAccountId', 'breakdown'],
    },
  },
  // ============================================================
  // DIRECT FB ENTITY MODIFICATIONS
  // ============================================================
  {
    name: 'updateTargeting',
    description: 'Изменить таргетинг адсета: возраст, пол, страны, города. Для интересов и аудиторий используй customFbQuery.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        age_min: { type: 'number', description: 'Мин. возраст (13-65)' },
        age_max: { type: 'number', description: 'Макс. возраст (13-65)' },
        genders: { type: 'array', items: { type: 'number' }, description: '0=все, 1=мужчины, 2=женщины' },
        countries: { type: 'array', items: { type: 'string' }, description: 'Коды стран (KZ, RU, US)' },
        cities: { type: 'array', items: { type: 'object' }, description: 'Города [{key, radius, distance_unit}]' },
        dry_run: { type: 'boolean', description: 'Preview без применения' },
      },
      required: ['userAccountId', 'adset_id'],
    },
  },
  {
    name: 'updateSchedule',
    description: 'Изменить расписание адсета: время начала и/или окончания.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        start_time: { type: 'string', description: 'Время начала ISO 8601 (2024-01-15T00:00:00+0500)' },
        end_time: { type: 'string', description: 'Время окончания ISO 8601' },
        dry_run: { type: 'boolean', description: 'Preview без применения' },
      },
      required: ['userAccountId', 'adset_id'],
    },
  },
  {
    name: 'updateBidStrategy',
    description: 'Изменить стратегию ставок адсета: bid_strategy и bid_amount.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        adset_id: { type: 'string', description: 'Facebook AdSet ID' },
        bid_strategy: {
          type: 'string',
          enum: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'],
          description: 'Стратегия ставок',
        },
        bid_amount: { type: 'number', description: 'Ставка в центах (для BID_CAP и COST_CAP)' },
        dry_run: { type: 'boolean', description: 'Preview без применения' },
      },
      required: ['userAccountId', 'adset_id'],
    },
  },
  {
    name: 'renameEntity',
    description: 'Переименовать кампанию, адсет или объявление в Facebook.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        entity_id: { type: 'string', description: 'Facebook ID (campaign, adset или ad)' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Тип сущности' },
        new_name: { type: 'string', description: 'Новое название' },
      },
      required: ['userAccountId', 'entity_id', 'entity_type', 'new_name'],
    },
  },
  {
    name: 'updateCampaignBudget',
    description: 'Изменить бюджет кампании (для CBO кампаний). Для бюджета адсетов используй updateBudget.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        campaign_id: { type: 'string', description: 'Facebook Campaign ID' },
        daily_budget: { type: 'number', description: 'Суточный бюджет в центах ($1 = 100)' },
        lifetime_budget: { type: 'number', description: 'Бюджет за всё время в центах' },
        dry_run: { type: 'boolean', description: 'Preview без применения' },
      },
      required: ['userAccountId', 'campaign_id'],
    },
  },
  // ============================================================
  // CUSTOM FB API QUERY (direct executor)
  // ============================================================
  {
    name: 'customFbQuery',
    description: 'Выполнить произвольный запрос к Facebook Graph API. Передай готовые endpoint, fields и params — handler выполнит напрямую. Для account-level используй "account/insights" — "account" заменится на act_xxx. Для редких запросов используй web search чтобы найти правильные FB API endpoints и fields.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        endpoint: { type: 'string', description: 'FB API endpoint (account/insights, {campaign_id}/adsets)' },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP метод (по умолчанию GET)' },
        fields: { type: 'string', description: 'Поля через запятую (spend,impressions,clicks,ctr)' },
        params: { type: 'object', description: 'Доп. параметры (breakdowns, time_range, filtering)' },
      },
      required: ['userAccountId', 'endpoint'],
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
    description: 'Лучшие креативы по метрикам. ВАЖНО: передавай date_from/date_to или period для нужного периода.',
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
        period: {
          type: 'string',
          enum: ['last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all'],
          description: 'Preset период (игнорируется если указаны date_from/date_to)',
        },
        date_from: { type: 'string', description: 'Начало периода YYYY-MM-DD (приоритет над period)' },
        date_to: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
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
    description: 'Сгенерировать заголовок/оффер для креатива (ШАГ 1). Бэкенд сам берёт описание бизнеса из БД — НЕ передавай prompt.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        existing_bullets: { type: 'string', description: 'Уже сгенерированные буллеты (если есть)' },
        existing_profits: { type: 'string', description: 'Уже сгенерированные выгоды (если есть)' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'generateBullets',
    description: 'Сгенерировать буллеты/преимущества (ШАГ 2). Бэкенд сам берёт описание бизнеса из БД — НЕ передавай prompt.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        existing_offer: { type: 'string', description: 'Оффер из шага 1' },
        existing_profits: { type: 'string', description: 'Уже сгенерированные выгоды (если есть)' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'generateProfits',
    description: 'Сгенерировать выгоды для клиента (ШАГ 3). Бэкенд сам берёт описание бизнеса из БД — НЕ передавай prompt.',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        existing_offer: { type: 'string', description: 'Оффер из шага 1' },
        existing_bullets: { type: 'string', description: 'Буллеты из шага 2' },
      },
      required: ['userAccountId'],
    },
  },
  {
    name: 'generateCreatives',
    description: 'Сгенерировать изображение креатива 1080x1920px с готовыми текстами',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        offer: { type: 'string', description: 'Заголовок (6-12 слов)' },
        bullets: { type: 'string', description: '3 буллета с маркером •' },
        profits: { type: 'string', description: 'ОДНА строка выгоды/бонуса (например "Первый месяц бесплатно")' },
        cta: { type: 'string', description: 'Призыв к действию (2-5 слов)' },
        direction_id: { type: 'string' },
        style_prompt: { type: 'string', description: 'Описание визуала от пользователя (стиль, цвета, элементы)' },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL референс-изображений от пользователя (одно или несколько)',
        },
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
        style_prompt: { type: 'string', description: 'Описание визуала от пользователя' },
        direction_id: { type: 'string' },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL референс-изображений от пользователя',
        },
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
        contact_phone: { type: 'string', description: 'Номер телефона контакта (например: 79001234567)' },
      },
      required: ['userAccountId', 'contact_phone'],
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
  {
    name: 'getKnowledgeBase',
    description: 'Получить информацию из базы знаний платформы Performante.ai. Без параметров — список глав. С chapter_id — оглавление. С chapter_id + section_id — содержимое. Используй когда пользователь спрашивает "как подключить", "как создать", "инструкция", "помощь".',
    input_schema: {
      type: 'object',
      properties: {
        userAccountId: { type: 'string' },
        chapter_id: { type: 'string', description: 'ID главы (getting-started, ad-launch, ad-management, roi-analytics, competitors, profile-settings)' },
        section_id: { type: 'string', description: 'ID раздела внутри главы' },
      },
      required: ['userAccountId'],
    },
  },
];

// Tools that require detailed logging (launch/write operations)
const DETAILED_LOG_TOOLS = new Set([
  'aiLaunch', 'createAdSet', 'launchCreative',
  'pauseDirection', 'resumeDirection', 'updateDirectionBudget',
  'pauseCampaign', 'resumeCampaign',
  'pauseAdSet', 'resumeAdSet', 'updateBudget',
  'approveBrainActions',
]);

/**
 * Выполнить tool через HTTP запрос к agent-brain
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>
): Promise<any> {
  const startTime = Date.now();
  try {
    // Подробный лог для launch/write tools, краткий для read tools
    if (DETAILED_LOG_TOOLS.has(toolName)) {
      // Не логируем userAccountId/accountId — они всегда есть
      const { userAccountId, accountId, ...relevantArgs } = toolInput;
      logger.info({ toolName, args: relevantArgs }, 'Executing dangerous tool');
    } else {
      logger.info({ toolName }, 'Executing tool');
    }

    const url = `${BRAIN_SERVICE_URL}/brain/tools/${toolName}`;
    const timeout = getToolTimeout(toolName);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (BRAIN_SERVICE_SECRET) {
      headers['X-Service-Auth'] = BRAIN_SERVICE_SECRET;
    }

    const response = await axios.post(url, toolInput, { headers, timeout });

    const duration = Date.now() - startTime;
    const resultSuccess = response.data?.success;
    logger.info({ toolName, success: resultSuccess ?? true, duration_ms: duration }, 'Tool executed');
    return response.data;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const status = error.response?.status;
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');

    logger.error({
      toolName,
      status,
      duration_ms: duration,
      isTimeout,
      error: error.response?.data?.error || error.message,
    }, 'Tool execution failed');

    // Не раскрывать internal details в ответах Claude
    const safeError = isTimeout
      ? `Операция ${toolName} превысила таймаут (${Math.round(getToolTimeout(toolName) / 1000)}с). Попробуйте позже.`
      : (error.response?.data?.error || 'Ошибка выполнения операции');
    return {
      success: false,
      error: safeError,
    };
  }
}
