/**
 * AdsAgent Tool Definitions
 *
 * Single source of truth for:
 * - Zod schemas (runtime validation)
 * - Tool descriptions
 * - Metadata (timeout, retryable, dangerous)
 *
 * 19 tools: 11 READ + 8 WRITE
 */

import { z } from 'zod';

// Common schemas
// Extended period enum for all tools
const extendedPeriodEnum = z.enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
// Period can be preset (today, yesterday, etc.) or specific date (30 ноября, 2024-11-30, 30.11.2024)
const periodSchema = z.string().describe('Период: today, yesterday, last_7d, last_30d или конкретная дата (30 ноября, 2024-11-30)');
const campaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'all']);
const directionStatusSchema = z.enum(['active', 'paused', 'all']);
const directionPeriodSchema = z.enum(['7d', '14d', '30d', '90d', '6m', '12m']);
const groupBySchema = z.enum(['campaign', 'day']);

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
    description: 'Получить список кампаний с метриками (расходы, лиды, CPL, CTR) за указанный период',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      status: campaignStatusSchema.optional().describe('Фильтр по статусу кампаний')
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
    description: 'Получить список адсетов кампании с метриками',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
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
        .min(500, 'Minimum budget is 500 cents ($5)')
        .describe('Новый дневной бюджет в центах (минимум 500, т.е. $5)'),
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
    description: 'Запустить принудительный цикл Brain Agent оптимизации ПРЯМО СЕЙЧАС. ОПАСНАЯ ОПЕРАЦИЯ — агент может изменить бюджеты, остановить или запустить адсеты.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для оптимизации (опционально — если не указано, оптимизирует весь аккаунт)'),
      dry_run: dryRunOption.describe('Preview mode — показать что будет сделано без выполнения'),
      reason: z.string().optional().describe('Причина запуска (для логирования)')
    }),
    meta: { timeout: 120000, retryable: false, dangerous: true }
  },

  // ============================================================
  // CUSTOM FB API QUERY (LLM-powered)
  // ============================================================

  customFbQuery: {
    description: `Универсальный кастомный запрос к Facebook Marketing API v20.0.

Используй когда:
- Нужны breakdowns (возраст, пол, устройство, платформа, placement)
- Сравнение Facebook vs Instagram
- Детальная статистика по плейсментам (feed, stories, reels)
- Video метрики (досмотры)
- Любые нестандартные комбинации метрик

Улучшенная логика (v2):
1. LLM (gpt-4o) анализирует запрос с полной документацией FB API
2. Pre-валидация запроса ДО отправки к FB
3. Умный retry с контекстом ошибки (до 3 попыток)
4. Логирование успешных запросов для улучшения`,
    schema: z.object({
      user_request: z.string().describe('Описание того, что хочет узнать пользователь (на естественном языке)'),
      entity_type: z.enum(['account', 'campaign', 'adset', 'ad']).default('account').describe('Уровень сущности для запроса'),
      entity_id: z.string().optional().describe('ID сущности (campaign_id, adset_id, ad_id). Если не указан — используется ad_account'),
      period: periodSchema.optional().describe('Период для метрик (если применимо)')
    }),
    meta: { timeout: 60000, retryable: true }
  }
};

export default AdsToolDefs;
