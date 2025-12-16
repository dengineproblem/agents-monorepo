/**
 * AdsAgent Tool Definitions
 *
 * Single source of truth for:
 * - Zod schemas (runtime validation)
 * - Tool descriptions
 * - Metadata (timeout, retryable, dangerous)
 *
 * 15 tools: 7 READ + 8 WRITE
 */

import { z } from 'zod';

// Common schemas
// Period can be preset (today, yesterday, etc.) or specific date (30 ноября, 2024-11-30, 30.11.2024)
const periodSchema = z.string().describe('Период: today, yesterday, last_7d, last_30d или конкретная дата (30 ноября, 2024-11-30)');
const campaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'all']);
const directionStatusSchema = z.enum(['active', 'paused', 'all']);
const directionPeriodSchema = z.enum(['7d', '14d', '30d']);
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
      period: periodSchema.describe('Период для метрик'),
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
      period: periodSchema.optional().describe('Период для метрик')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getSpendReport: {
    description: 'Получить отчёт по расходам за период с разбивкой по кампаниям или дням',
    schema: z.object({
      period: periodSchema.describe('Период отчёта'),
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
      period: periodSchema.optional().describe('Период для метрик')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDirectionDetails: {
    description: 'Получить детальную информацию о направлении включая привязанные адсеты и креативы',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления из таблицы directions')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDirectionMetrics: {
    description: 'Получить метрики направления с разбивкой по дням за период',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      period: directionPeriodSchema.optional().describe('Период для метрик')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS - Campaigns & AdSets
  // ============================================================

  pauseCampaign: {
    description: 'Поставить кампанию на паузу. Используй dry_run: true для preview.',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании для паузы'),
      reason: z.string().optional().describe('Причина паузы (для логирования)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeCampaign: {
    description: 'Возобновить приостановленную кампанию',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

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
  // WRITE TOOLS - Directions
  // ============================================================

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

  pauseDirection: {
    description: 'Поставить направление на паузу. Используй dry_run: true для preview. Все связанные адсеты будут приостановлены.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      reason: z.string().optional().describe('Причина паузы (для логирования)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  // ============================================================
  // READ TOOLS - ROI Reports
  // ============================================================

  getROIReport: {
    description: 'Получить отчёт по ROI креативов: расходы, выручка, ROI%, лиды, конверсии. Включает топ/худших и рекомендации.',
    schema: z.object({
      period: z.enum(['last_7d', 'last_30d', 'last_90d', 'all']).default('last_7d').describe('Период для расчёта ROI'),
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      media_type: z.enum(['video', 'image']).optional().describe('Фильтр по типу медиа')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  getROIComparison: {
    description: 'Сравнить ROI между креативами или направлениями. Возвращает топ N по ROI.',
    schema: z.object({
      period: z.enum(['last_7d', 'last_30d', 'last_90d', 'all']).default('all').describe('Период для сравнения'),
      compare_by: z.enum(['creative', 'direction']).default('creative').describe('По чему сравнивать'),
      top_n: z.number().min(1).max(20).default(5).describe('Количество топ элементов для вывода')
    }),
    meta: { timeout: 30000, retryable: true }
  }
};

export default AdsToolDefs;
