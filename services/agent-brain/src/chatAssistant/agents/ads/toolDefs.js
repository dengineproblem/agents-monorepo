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
const periodSchema = z.enum(['today', 'yesterday', 'last_7d', 'last_30d']);
const campaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'all']);
const directionStatusSchema = z.enum(['active', 'paused', 'all']);
const directionPeriodSchema = z.enum(['7d', '14d', '30d']);
const groupBySchema = z.enum(['campaign', 'day']);

// UUID validation with custom message
const uuidSchema = z.string().uuid('Invalid UUID format');
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);

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
    description: 'Поставить кампанию на паузу',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании для паузы'),
      reason: z.string().optional().describe('Причина паузы (для логирования)')
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeCampaign: {
    description: 'Возобновить приостановленную кампанию',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании для возобновления')
    }),
    meta: { timeout: 15000, retryable: false }
  },

  pauseAdSet: {
    description: 'Поставить адсет на паузу',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета для паузы'),
      reason: z.string().optional().describe('Причина паузы')
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeAdSet: {
    description: 'Возобновить приостановленный адсет',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета для возобновления')
    }),
    meta: { timeout: 15000, retryable: false }
  },

  updateBudget: {
    description: 'Изменить дневной бюджет адсета. ВНИМАНИЕ: изменение бюджета > 50% требует подтверждения.',
    schema: z.object({
      adset_id: nonEmptyString('adset_id').describe('ID адсета'),
      new_budget_cents: z.number()
        .min(500, 'Minimum budget is 500 cents ($5)')
        .describe('Новый дневной бюджет в центах (минимум 500, т.е. $5)')
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  // ============================================================
  // WRITE TOOLS - Directions
  // ============================================================

  updateDirectionBudget: {
    description: 'Изменить суточный бюджет направления. Обновит budget_per_day в настройках направления.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      new_budget: z.number()
        .positive('Budget must be positive')
        .describe('Новый суточный бюджет в долларах (например: 50)')
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  updateDirectionTargetCPL: {
    description: 'Изменить целевой CPL направления. Используется для автоматической оптимизации.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      target_cpl: z.number()
        .positive('Target CPL must be positive')
        .describe('Новый целевой CPL в долларах (например: 15.50)')
    }),
    meta: { timeout: 15000, retryable: false }
  },

  pauseDirection: {
    description: 'Поставить направление на паузу. Все связанные адсеты будут приостановлены.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      reason: z.string().optional().describe('Причина паузы (для логирования)')
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  }
};

export default AdsToolDefs;
