/**
 * AdsAgent Tool Definitions
 *
 * Single source of truth for:
 * - Zod schemas (runtime validation)
 * - Tool descriptions
 * - Metadata (timeout, retryable, dangerous)
 *
 * 25 tools: 12 READ + 13 WRITE
 */

import { z } from 'zod';

// Common schemas
// Extended period enum for all tools
const extendedPeriodEnum = z.enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
// Period can be preset (today, yesterday, etc.) or specific date (30 ноября, 2024-11-30, 30.11.2024)
const periodSchema = z.string().describe('Период: today, yesterday, last_7d, last_30d или конкретная дата (30 ноября, 2024-11-30)');
const campaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'all']);
const campaignTypeSchema = z.enum(['internal', 'external', 'all']).describe('internal = привязаны к directions, external = без directions, all = все');
const directionStatusSchema = z.enum(['active', 'paused', 'all']);
const directionPeriodSchema = z.enum(['7d', '14d', '30d', '90d', '6m', '12m']);
const groupBySchema = z.enum(['campaign', 'day', 'total']);

// UUID validation with custom message
const uuidSchema = z.string().uuid('Invalid UUID format');
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);

// Common WRITE tool options (added to all WRITE tools)
const dryRunOption = z.boolean().optional().describe('Preview mode — show what will change without executing');
const operationIdOption = z.string().optional().describe('Idempotency key — prevents duplicate execution on retry');

/**
 * AdsAgent Tool Definitions
 */
export const AdsToolDefs = {
  // ============================================================
  // READ TOOLS - Campaigns & AdSets
  // ============================================================

  getCampaigns: {
    description: 'Получить список кампаний с метриками (расходы, лиды, CPL, CTR) за указанный период. Поддерживает фильтрацию по типу: internal (созданные в приложении) или external (внешние)',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      status: campaignStatusSchema.optional().describe('Фильтр по статусу кампаний'),
      campaign_type: campaignTypeSchema.optional().describe('Фильтр по типу кампании')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getCampaignDetails: {
    description: 'Получить детальную информацию о кампании включая адсеты и объявления',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании в Facebook')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getAdSets: {
    description: 'Получить список адсетов кампании с метриками. Можно фильтровать по campaign_id или campaign_type',
    schema: z.object({
      campaign_id: z.string().optional().describe('ID кампании (опционально, если указан campaign_type)'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      campaign_type: campaignTypeSchema.optional().describe('Фильтр по типу кампании (если не указан campaign_id)')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getAds: {
    description: 'Получить статистику на уровне ОБЪЯВЛЕНИЙ (ads level) с метриками: spend, leads, CPL, impressions, clicks. Используй для анализа эффективности объявлений, группировки по названию, поиска объявлений с плохим CPL.',
    schema: z.object({
      campaign_id: z.string().optional().describe('ID кампании (опционально). Если не указан - все объявления аккаунта'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      campaign_type: campaignTypeSchema.optional().describe('Фильтр по типу кампании')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  getSpendReport: {
    description: 'Получить отчёт по расходам за период с разбивкой по кампаниям или дням',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      group_by: groupBySchema.optional().describe('Группировка данных')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  // ============================================================
  // READ TOOLS - Directions
  // ============================================================

  getDirections: {
    description: 'Получить список направлений (рекламных вертикалей) с метриками за период',
    schema: z.object({
      status: directionStatusSchema.optional().describe('Фильтр по статусу направлений'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDirectionCreatives: {
    description: 'Получить список креативов направления с их статусами и метриками',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления из таблицы directions')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDirectionMetrics: {
    description: 'Получить метрики направления с разбивкой по дням за период',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      period: directionPeriodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  // ============================================================
  // READ TOOLS - Pre-checks & Insights
  // ============================================================

  getAdAccountStatus: {
    description: 'Проверить статус рекламного аккаунта: может ли крутить рекламу, причины блокировки, лимиты расхода. Используй как pre-check перед анализом.',
    schema: z.object({}),
    meta: { timeout: 15000, retryable: true }
  },

  getDirectionInsights: {
    description: 'Получить метрики направления с сравнением vs предыдущий период. Включает CPL, CTR, CPM, CPC и delta.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      compare: z.enum(['previous_same', 'previous_7d']).optional().describe('Сравнить с предыдущим периодом')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getLeadsEngagementRate: {
    description: 'Получить показатель вовлечённости лидов (2+ сообщения). Использует FB метрику onsite_conversion.messaging_user_depth_2_message_send. Высокий engagement = качественные лиды. ИСПОЛЬЗУЙ ДЛЯ ПОДСЧЁТА QCPL (качественных лидов) ПО FACEBOOK.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      period: z.enum(['last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']).optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS - AdSets & Ads
  // ============================================================

  pauseAdSet: {
    description: 'Поставить адсет на паузу. Используй dry_run: true для preview.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета для паузы'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeAdSet: {
    description: 'Возобновить приостановленный адсет',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  pauseAd: {
    description: 'Поставить конкретное объявление на паузу. Используй dry_run: true для preview.',
    schema: z.object({
      ad_id: nonEmptyString('ad_id').describe('ID объявления в Facebook'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeAd: {
    description: 'Возобновить приостановленное объявление',
    schema: z.object({
      ad_id: nonEmptyString('ad_id').describe('ID объявления для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  updateBudget: {
    description: 'Изменить дневной бюджет адсета. Используй dry_run: true для preview изменений.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета'),
      new_budget_cents: z.number()
        .min(300, 'Minimum budget is 300 cents ($3)')
        .describe('Новый дневной бюджет в центах (минимум 300, т.е. $3)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  // ============================================================
  // WRITE TOOLS - Directions (1 направление = 1 кампания)
  // ============================================================

  pauseDirection: {
    description: 'Поставить направление на паузу. Паузит привязанную FB кампанию и все адсеты. Используй dry_run: true для preview.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      reason: z.string().optional().describe('Причина паузы (для логирования)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  resumeDirection: {
    description: 'Возобновить направление. Включает привязанную FB кампанию.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false }
  },

  updateDirectionBudget: {
    description: 'Изменить суточный бюджет направления. Используй dry_run: true для preview.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      new_budget: z.number()
        .positive('Budget must be positive')
        .describe('Новый суточный бюджет в долларах (например: 50)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  updateDirectionTargetCPL: {
    description: 'Изменить целевой CPL направления. Используется для автоматической оптимизации.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      target_cpl: z.number()
        .positive('Target CPL must be positive')
        .describe('Новый целевой CPL в долларах (например: 15.50)'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  // ============================================================
  // READ TOOLS - ROI Reports
  // ============================================================

  getROIReport: {
    description: 'Получить отчёт по ROI креативов: расходы, выручка, ROI%, лиды, конверсии. Включает топ/худших и рекомендации.',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      media_type: z.enum(['video', 'image']).optional().describe('Фильтр по типу медиа')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  getROIComparison: {
    description: 'Сравнить ROI между креативами или направлениями. Возвращает топ N по ROI.',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      compare_by: z.enum(['creative', 'direction']).default('creative').describe('По чему сравнивать'),
      top_n: z.number().min(1).max(20).default(5).describe('Количество топ элементов для вывода')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  // ============================================================
  // EXTERNAL CAMPAIGNS TOOLS
  // ============================================================

  getExternalCampaignMetrics: {
    description: 'Получить метрики ВНЕШНИХ кампаний (созданных не через приложение) с расчётом CPL, health score и сравнением с target. Target CPL берётся из маппинга (saveCampaignMapping) или fallback на default аккаунта.',
    schema: z.object({
      campaign_id: z.string().optional().describe('ID конкретной кампании (опционально). Если не указан - все external кампании'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  // ============================================================
  // BRAIN AGENT TOOLS (Tier-based)
  // ============================================================

  getAgentBrainActions: {
    description: 'Получить историю действий Brain Agent: изменения бюджетов, паузы адсетов, запуски креативов. Используй для анализа автоматической оптимизации.',
    schema: z.object({
      period: z.enum(['last_1d', 'last_3d', 'last_7d']).optional().describe('Предустановленный период (если не указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода в формате YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода в формате YYYY-MM-DD'),
      limit: z.number().min(1).max(50).default(20).describe('Максимум действий для возврата'),
      action_type: z.enum(['all', 'budget_change', 'pause', 'resume', 'launch']).default('all').describe('Фильтр по типу действия')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  triggerBrainOptimizationRun: {
    description: `Запустить AI-оптимизацию рекламы.

⚠️ ОТВЕТ ПОЛЬЗОВАТЕЛЮ: Скопируй ДОСЛОВНО текст из поля formatted.text — это готовый отчёт.
Ничего не добавляй, не анализируй, не комментируй. Просто выведи formatted.text.`,
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для оптимизации (для internal кампаний)'),
      campaign_id: z.string().optional().describe('Facebook Campaign ID для оптимизации (для external кампаний без direction)'),
      dry_run: dryRunOption.describe('Preview mode — показать что будет сделано без выполнения'),
      reason: z.string().optional().describe('Причина запуска (для логирования)')
    }),
    meta: { timeout: 600000, retryable: false, dangerous: true } // 10 минут — LLM может думать 4 мин × 2 retry
  },

  approveBrainActions: {
    description: `Выполнить выбранные шаги Brain оптимизации (из результатов triggerBrainOptimizationRun с dry_run=true).

Используй после того как пользователь посмотрел план оптимизации и подтвердил выполнение конкретных шагов.
Передай индексы шагов (stepIndices) из proposals массива.`,
    schema: z.object({
      stepIndices: z.array(z.number().int().min(0)).min(1).describe('Массив индексов шагов для выполнения (0-based, из proposals массива)'),
      execution_id: z.string().optional().describe('ID выполнения brain optimization (опционально, по умолчанию — последнее)'),
      direction_id: uuidSchema.optional().describe('UUID направления'),
      campaign_id: z.string().optional().describe('Facebook Campaign ID (для external кампаний)'),
    }),
    meta: { timeout: 600000, retryable: false, dangerous: true }
  },

  // ============================================================
  // DIRECT FB CAMPAIGN MANAGEMENT (без привязки к directions)
  // ============================================================

  pauseCampaign: {
    description: 'Поставить FB кампанию на паузу НАПРЯМУЮ через FB Graph API. НЕ требует direction. Работает с любой кампанией.',
    schema: z.object({
      campaign_id: z.string().min(1).describe('Facebook Campaign ID (числовой)'),
      reason: z.string().optional().describe('Причина паузы')
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  resumeCampaign: {
    description: 'Включить FB кампанию НАПРЯМУЮ через FB Graph API. НЕ требует direction. Работает с любой кампанией.',
    schema: z.object({
      campaign_id: z.string().min(1).describe('Facebook Campaign ID (числовой)')
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  // ============================================================
  // INSIGHTS BREAKDOWN (stats with breakdowns)
  // ============================================================

  getInsightsBreakdown: {
    description: 'Получить метрики с разбивкой (breakdown): по возрасту, полу, устройству, площадке, стране. Работает на уровне аккаунта, кампании или адсета.',
    schema: z.object({
      breakdown: z.enum(['age', 'gender', 'age,gender', 'country', 'region', 'device_platform', 'publisher_platform', 'platform_position']).describe('Тип разбивки'),
      entity_type: z.enum(['account', 'campaign', 'adset']).default('account').describe('Уровень: account, campaign или adset'),
      entity_id: z.string().optional().describe('ID кампании или адсета (для account не нужен)'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
    }),
    meta: { timeout: 30000, retryable: true }
  },

  // ============================================================
  // DIRECT FB ENTITY MODIFICATIONS
  // ============================================================

  updateTargeting: {
    description: 'Изменить таргетинг адсета: возраст, пол, страны, города. Для интересов и аудиторий используй customFbQuery.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('Facebook AdSet ID'),
      age_min: z.number().min(13).max(65).optional().describe('Минимальный возраст (13-65)'),
      age_max: z.number().min(13).max(65).optional().describe('Максимальный возраст (13-65)'),
      genders: z.array(z.number().min(0).max(2)).optional().describe('Пол: 0=все, 1=мужчины, 2=женщины'),
      countries: z.array(z.string()).optional().describe('Коды стран (KZ, RU, US...)'),
      cities: z.array(z.object({
        key: z.string().describe('FB city key'),
        radius: z.number().optional().describe('Радиус в км'),
        distance_unit: z.string().optional().describe('Единица: kilometer или mile'),
      })).optional().describe('Города с радиусом'),
      dry_run: dryRunOption,
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  updateSchedule: {
    description: 'Изменить расписание адсета: время начала и/или окончания.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('Facebook AdSet ID'),
      start_time: z.string().optional().describe('Время начала в ISO 8601 (2024-01-15T00:00:00+0500)'),
      end_time: z.string().optional().describe('Время окончания в ISO 8601 (null = без ограничения)'),
      dry_run: dryRunOption,
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  updateBidStrategy: {
    description: 'Изменить стратегию ставок адсета: bid_strategy и bid_amount.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('Facebook AdSet ID'),
      bid_strategy: z.enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP']).optional().describe('Стратегия ставок'),
      bid_amount: z.number().min(1).optional().describe('Сумма ставки в центах (для BID_CAP и COST_CAP)'),
      dry_run: dryRunOption,
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  renameEntity: {
    description: 'Переименовать кампанию, адсет или объявление в Facebook.',
    schema: z.object({
      entity_id: nonEmptyString('entity_id').describe('Facebook ID (campaign_id, adset_id или ad_id)'),
      entity_type: z.enum(['campaign', 'adset', 'ad']).describe('Тип сущности'),
      new_name: z.string().min(1).max(400).describe('Новое название'),
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  updateCampaignBudget: {
    description: 'Изменить бюджет кампании (для CBO кампаний с бюджетом на уровне кампании). Для адсетов используй updateBudget.',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('Facebook Campaign ID'),
      daily_budget: z.number().min(100).optional().describe('Суточный бюджет в центах ($1 = 100)'),
      lifetime_budget: z.number().min(100).optional().describe('Бюджет за всё время в центах'),
      dry_run: dryRunOption,
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  // ============================================================
  // CUSTOM FB API QUERY (direct executor)
  // ============================================================

  customFbQuery: {
    description: `Выполнить произвольный запрос к Facebook Graph API. Передай готовые endpoint, fields и params — handler выполнит запрос напрямую.

Используй когда ни один стандартный tool не подходит. Для account-level запросов используй 'account/insights' — 'account' будет заменён на act_xxx.`,
    schema: z.object({
      endpoint: z.string().describe('FB API endpoint (account/insights, campaign_id/adsets, act_xxx/insights)'),
      method: z.enum(['GET', 'POST']).default('GET').describe('HTTP метод'),
      fields: z.string().optional().describe('Запрашиваемые поля через запятую (spend,impressions,clicks,ctr)'),
      params: z.record(z.any()).optional().describe('Дополнительные параметры (breakdowns, time_range, filtering и т.д.)'),
    }),
    meta: { timeout: 30000, retryable: true }
  },

  // ============================================================
  // AI LAUNCH — proxy to agent-service auto-launch-v2
  // ============================================================

  aiLaunch: {
    description: 'Запуск с AI — GPT-4o выбирает лучшие креативы, паузит старые адсеты и создаёт новые для ВСЕХ активных направлений. Основной способ запуска рекламы.',
    schema: z.object({
      start_mode: z.enum(['now', 'midnight_almaty']).default('now').optional().describe('Время запуска: сейчас или с полуночи по Алмате (UTC+5)')
    }),
    meta: { timeout: 180000, retryable: false, dangerous: true }
  },

  // ============================================================
  // LAUNCH TOOLS (proxy to agent-service)
  // ============================================================

  createAdSet: {
    description: 'Ручной запуск: создать адсет с конкретными креативами в направлении. Полный production workflow: таргетинг из БД, batch API, маппинг direction_adsets.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      creative_ids: z.array(z.string().min(1)).min(1).describe('Массив ID креативов для запуска'),
      daily_budget_cents: z.number().min(300).optional().describe('Суточный бюджет в центах (опционально, берётся из direction)'),
      adset_name: z.string().optional().describe('Название адсета (опционально)'),
      start_mode: z.enum(['now', 'midnight_almaty']).default('now').optional().describe('Время запуска: сейчас или с полуночи по Алмате (UTC+5)'),
      dry_run: dryRunOption
    }),
    meta: { timeout: 90000, retryable: false, dangerous: true }
  },

  createAd: {
    description: 'Добавить одно объявление в существующий адсет.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID существующего адсета Facebook'),
      creative_id: nonEmptyString('creative_id').describe('ID креатива из user_creatives'),
      ad_name: z.string().optional().describe('Название объявления (опционально)'),
      dry_run: dryRunOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  saveCampaignMapping: {
    description: `Сохранить маппинг кампании для ручного режима (пользователи без directions).
Используй когда пользователь указал какое направление (услугу) рекламирует кампания и какой целевой CPL.
Если маппинг для этого campaign_id уже существует — он будет обновлён.`,
    schema: z.object({
      campaign_id: z.string().min(1).describe('Facebook Campaign ID (например: 120212345678901234)'),
      campaign_name: z.string().optional().describe('Название кампании (для читаемости)'),
      direction_name: z.string().min(1).describe('Название направления/услуги (Имплантация, Ремонт квартир и т.д.)'),
      goal: z.enum(['whatsapp', 'site', 'lead_form', 'other']).optional().describe('Цель кампании: whatsapp, site, lead_form, other'),
      target_cpl_cents: z.number().min(10).max(100000).describe('Целевой CPL в центах (10-100000, т.е. $0.10 - $1000)')
    }),
    meta: { timeout: 10000, retryable: false }
  }
};

export default AdsToolDefs;
