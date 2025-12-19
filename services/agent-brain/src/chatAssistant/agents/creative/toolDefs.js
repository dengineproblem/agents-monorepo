/**
 * CreativeAgent Tool Definitions
 * Zod schemas as single source of truth for validation
 * 16 tools: 10 READ + 6 WRITE
 */

import { z } from 'zod';

// Common schemas
const uuidSchema = z.string().uuid('Invalid UUID format');
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);
const periodSchema = z.enum(['7d', '14d', '30d', 'all']);

// Common WRITE tool options
const dryRunOption = z.boolean().optional().describe('Preview mode — show what will change without executing');
const operationIdOption = z.string().optional().describe('Idempotency key — prevents duplicate execution on retry');

export const CreativeToolDefs = {
  // ============================================================
  // READ TOOLS
  // ============================================================

  getCreatives: {
    description: 'Получить список креативов пользователя с метриками и скорами',
    schema: z.object({
      direction_id: uuidSchema.optional(),
      status: z.enum(['active', 'all']).optional(),
      sort_by: z.enum(['cpl', 'leads', 'spend', 'score', 'created']).optional(),
      limit: z.number().min(1).max(100).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getCreativeDetails: {
    description: 'Получить детальную информацию о креативе включая привязки к ads и directions',
    schema: z.object({
      creative_id: uuidSchema
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getCreativeMetrics: {
    description: 'Получить детальные метрики креатива с разбивкой по дням, включая video retention',
    schema: z.object({
      creative_id: uuidSchema,
      period: periodSchema.optional()
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getCreativeAnalysis: {
    description: 'Получить последний LLM-анализ креатива (score, verdict, recommendations)',
    schema: z.object({
      creative_id: uuidSchema
    }),
    meta: { timeout: 15000, retryable: true }
  },

  getTopCreatives: {
    description: 'Получить топ-N лучших креативов по выбранной метрике',
    schema: z.object({
      metric: z.enum(['cpl', 'leads', 'ctr', 'score']),
      direction_id: uuidSchema.optional(),
      limit: z.number().min(1).max(20).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getWorstCreatives: {
    description: 'Получить креативы с худшими показателями (высоким CPL или низким score)',
    schema: z.object({
      threshold_cpl: z.number().min(0).optional(),
      direction_id: uuidSchema.optional(),
      limit: z.number().min(1).max(20).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  compareCreatives: {
    description: 'Сравнить метрики двух или более креативов за выбранный период',
    schema: z.object({
      creative_ids: z.array(uuidSchema).min(2, 'Need at least 2 creatives to compare').max(5, 'Maximum 5 creatives'),
      period: z.enum(['7d', '14d', '30d']).optional()
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getCreativeScores: {
    description: 'Получить risk scores и predictions от scoring agent',
    schema: z.object({
      level: z.enum(['creative', 'adset']).optional(),
      risk_level: z.enum(['High', 'Medium', 'Low', 'all']).optional(),
      limit: z.number().min(1).max(50).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getCreativeTests: {
    description: 'Получить историю A/B тестов креатива с результатами',
    schema: z.object({
      creative_id: uuidSchema
    }),
    meta: { timeout: 15000, retryable: true }
  },

  getCreativeTranscript: {
    description: 'Получить транскрипцию видео креатива',
    schema: z.object({
      creative_id: uuidSchema
    }),
    meta: { timeout: 15000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================

  triggerCreativeAnalysis: {
    description: 'Запустить LLM-анализ креатива на основе текущих метрик',
    schema: z.object({
      creative_id: uuidSchema,
      operation_id: operationIdOption
    }),
    meta: { timeout: 60000, retryable: false, dangerous: false }
  },

  launchCreative: {
    description: 'Запустить креатив в выбранное направление. Используй dry_run: true для preview. ВНИМАНИЕ: это потратит бюджет.',
    schema: z.object({
      creative_id: uuidSchema,
      direction_id: uuidSchema,
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 30000, retryable: false, dangerous: true }
  },

  pauseCreative: {
    description: 'Поставить все объявления креатива на паузу. Используй dry_run: true для preview.',
    schema: z.object({
      creative_id: uuidSchema,
      reason: z.string().optional(),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: true }
  },

  startCreativeTest: {
    description: 'Запустить A/B тест креатива. Используй dry_run: true для preview. (~$20 бюджет)',
    schema: z.object({
      creative_id: uuidSchema,
      objective: z.enum(['whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms']).optional(),
      dry_run: dryRunOption,
      operation_id: operationIdOption
    }),
    meta: { timeout: 30000, retryable: false, dangerous: true }
  },

  stopCreativeTest: {
    description: 'Остановить текущий A/B тест креатива',
    schema: z.object({
      creative_id: uuidSchema,
      operation_id: operationIdOption
    }),
    meta: { timeout: 20000, retryable: false, dangerous: false }
  },

  generateCreatives: {
    description: 'Запустить генерацию новых креативов для направления. Graceful fallback если сервис не подключен.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления для генерации'),
      offer_hints: z.array(z.string()).optional().describe('Подсказки по офферу'),
      angles: z.array(z.string()).optional().describe('Рекламные углы/подходы'),
      count: z.number().min(1).max(10).default(3).describe('Количество креативов для генерации')
    }),
    meta: { timeout: 30000, retryable: false, dangerous: true }
  }
};

// List of write tools for mode checks
export const CREATIVE_WRITE_TOOLS = [
  'triggerCreativeAnalysis',
  'launchCreative',
  'pauseCreative',
  'startCreativeTest',
  'stopCreativeTest',
  'generateCreatives'
];

// Dangerous tools that ALWAYS require confirmation
export const CREATIVE_DANGEROUS_TOOLS = ['launchCreative', 'startCreativeTest', 'pauseCreative', 'generateCreatives'];

export default CreativeToolDefs;
