/**
 * TikTokAdsAgent Tool Definitions
 *
 * Single source of truth for:
 * - Zod schemas (runtime validation)
 * - Tool descriptions
 * - Metadata (timeout, retryable, dangerous)
 *
 * Аналог AdsToolDefs для Facebook
 */

import { z } from 'zod';

// Common schemas
const extendedPeriodEnum = z.enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
const periodSchema = z.string().describe('Период: today, yesterday, last_7d, last_30d или конкретная дата');
const campaignStatusSchema = z.enum(['ENABLE', 'DISABLE', 'all']);
const objectiveSchema = z.enum(['traffic', 'conversions', 'lead_generation']);
const groupBySchema = z.enum(['campaign', 'adgroup', 'ad', 'day', 'total']);
const TIKTOK_MIN_DAILY_BUDGET_KZT = 2500;

// UUID validation with custom message
const uuidSchema = z.string().uuid('Invalid UUID format');
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);

// Common WRITE tool options
const dryRunOption = z.boolean().optional().describe('Preview mode — show what will change without executing');
const operationIdOption = z.string().optional().describe('Idempotency key — prevents duplicate execution on retry');

/**
 * TikTokAdsAgent Tool Definitions
 */
export const TikTokToolDefs = {
  // ============================================================
  // READ TOOLS - Campaigns & AdGroups
  // ============================================================

  getTikTokCampaigns: {
    description: 'Получить список TikTok кампаний с метриками (расходы, показы, клики, конверсии) за указанный период',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      status: campaignStatusSchema.optional().describe('Фильтр по статусу кампаний (ENABLE/DISABLE)')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getTikTokCampaignDetails: {
    description: 'Получить детальную информацию о TikTok кампании включая адгруппы и объявления',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании в TikTok')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getTikTokAdGroups: {
    description: 'Получить список TikTok адгрупп (AdGroups) кампании с метриками',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании'),
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getTikTokAds: {
    description: 'Получить статистику на уровне ОБЪЯВЛЕНИЙ TikTok с метриками: spend, impressions, clicks, conversions, CTR, CPM',
    schema: z.object({
      campaign_id: z.string().optional().describe('ID кампании (опционально)'),
      adgroup_id: z.string().optional().describe('ID адгруппы (опционально)'),
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  getTikTokSpendReport: {
    description: 'Получить отчёт по расходам TikTok за период с разбивкой по кампаниям или дням',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      group_by: groupBySchema.optional().describe('Группировка данных')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  // ============================================================
  // READ TOOLS - Account & Insights
  // ============================================================

  getTikTokAccountStatus: {
    description: 'Проверить статус TikTok рекламного аккаунта: баланс, статус, лимиты. Используй как pre-check перед анализом.',
    schema: z.object({}),
    meta: { timeout: 15000, retryable: true }
  },

  getTikTokAdvertiserInfo: {
    description: 'Получить информацию о рекламодателе TikTok: имя, статус, timezone, валюта',
    schema: z.object({}),
    meta: { timeout: 15000, retryable: true }
  },

  getTikTokDirections: {
    description: 'Получить список TikTok направлений (рекламных вертикалей) с метриками',
    schema: z.object({
      status: z.enum(['active', 'paused', 'all']).optional().describe('Фильтр по статусу направлений'),
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getTikTokDirectionCreatives: {
    description: 'Получить список TikTok креативов направления с их статусами и метриками',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getTikTokDirectionInsights: {
    description: 'Получить метрики TikTok направления с сравнением vs предыдущий период',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      compare: z.enum(['previous_same', 'previous_7d']).optional().describe('Сравнить с предыдущим периодом')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS - Campaigns
  // ============================================================

  pauseTikTokCampaign: {
    description: 'Поставить TikTok кампанию на паузу (ENABLE -> DISABLE)',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании TikTok'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeTikTokCampaign: {
    description: 'Возобновить TikTok кампанию (DISABLE -> ENABLE)',
    schema: z.object({
      campaign_id: nonEmptyString('campaign_id').describe('ID кампании для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  // ============================================================
  // WRITE TOOLS - AdGroups
  // ============================================================

  pauseTikTokAdGroup: {
    description: 'Поставить TikTok адгруппу на паузу. Используй dry_run: true для preview.',
    schema: z.object({
      adgroup_id: nonEmptyString('adgroup_id').describe('ID адгруппы для паузы'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeTikTokAdGroup: {
    description: 'Возобновить приостановленную TikTok адгруппу',
    schema: z.object({
      adgroup_id: nonEmptyString('adgroup_id').describe('ID адгруппы для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  updateTikTokAdGroupBudget: {
    description: 'Изменить дневной бюджет TikTok адгруппы. Минимум 2500 ₸/день.',
    schema: z.object({
      adgroup_id: nonEmptyString('adgroup_id').describe('ID адгруппы'),
      new_budget: z.number()
        .min(TIKTOK_MIN_DAILY_BUDGET_KZT, `Minimum TikTok budget is ${TIKTOK_MIN_DAILY_BUDGET_KZT} ₸/day`)
        .describe('Новый дневной бюджет в тенге (минимум 2500 ₸)'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  // ============================================================
  // WRITE TOOLS - Ads
  // ============================================================

  pauseTikTokAd: {
    description: 'Поставить TikTok объявление на паузу.',
    schema: z.object({
      ad_id: nonEmptyString('ad_id').describe('ID объявления TikTok'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  resumeTikTokAd: {
    description: 'Возобновить приостановленное TikTok объявление',
    schema: z.object({
      ad_id: nonEmptyString('ad_id').describe('ID объявления для возобновления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false }
  },

  // ============================================================
  // WRITE TOOLS - Create Campaign/AdGroup/Ad
  // ============================================================

  createTikTokCampaign: {
    description: 'Создать новую TikTok рекламную кампанию с креативами. Полный workflow: Campaign -> AdGroup -> Ad.',
    schema: z.object({
      campaign_name: nonEmptyString('campaign_name').describe('Название кампании'),
      objective: objectiveSchema.describe('Цель кампании: traffic (Traffic Clicky), conversions (Website Conversions), lead_generation (Leadform)'),
      creative_ids: z.array(uuidSchema).min(1).describe('UUID креативов из user_creatives'),
      daily_budget: z.number().min(TIKTOK_MIN_DAILY_BUDGET_KZT).describe('Дневной бюджет в тенге (минимум 2500 ₸)'),
      auto_activate: z.boolean().optional().describe('Сразу активировать кампанию'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 120000, retryable: false, dangerous: true }
  },

  addTikTokAdsToDirection: {
    description: 'Добавить TikTok объявления в существующую адгруппу направления.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      creative_ids: z.array(uuidSchema).min(1).describe('UUID креативов для добавления'),
      auto_activate: z.boolean().optional().describe('Сразу активировать объявления'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 60000, retryable: false, dangerous: true }
  },

  // ============================================================
  // WRITE TOOLS - Directions
  // ============================================================

  pauseTikTokDirection: {
    description: 'Поставить TikTok направление на паузу. Паузит привязанные кампании и адгруппы.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      reason: z.string().optional().describe('Причина паузы'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  resumeTikTokDirection: {
    description: 'Возобновить TikTok направление.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false }
  },

  updateTikTokDirectionBudget: {
    description: 'Изменить суточный бюджет TikTok направления (KZT).',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      new_budget: z.number()
        .min(TIKTOK_MIN_DAILY_BUDGET_KZT, `TikTok minimum is ${TIKTOK_MIN_DAILY_BUDGET_KZT} ₸/day`)
        .describe('Новый суточный бюджет в тенге'),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 15000, retryable: false, dangerous: true }
  },

  // ============================================================
  // MEDIA TOOLS
  // ============================================================

  uploadTikTokVideo: {
    description: 'Загрузить видео в TikTok для использования в рекламе',
    schema: z.object({
      video_url: z.string().url().describe('URL видео для загрузки'),
      video_name: z.string().optional().describe('Название видео')
    }),
    meta: { timeout: 120000, retryable: true }
  },

  getTikTokVideos: {
    description: 'Получить список загруженных видео в TikTok рекламном аккаунте',
    schema: z.object({
      video_ids: z.array(z.string()).optional().describe('Конкретные ID видео для получения')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  // ============================================================
  // ROI & ANALYTICS
  // ============================================================

  getTikTokROIReport: {
    description: 'Получить отчёт по ROI TikTok креативов: расходы, конверсии, ROAS',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации')
    }),
    meta: { timeout: 30000, retryable: true }
  },

  compareTikTokWithFacebook: {
    description: 'Сравнить метрики TikTok и Facebook рекламы за период: расходы, CPL, CTR, конверсии',
    schema: z.object({
      period: extendedPeriodEnum.optional().describe('Preset период'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      metrics: z.array(z.enum(['spend', 'impressions', 'clicks', 'conversions', 'cpl', 'ctr', 'cpm'])).optional()
        .describe('Метрики для сравнения')
    }),
    meta: { timeout: 45000, retryable: true }
  }
};

export default TikTokToolDefs;
