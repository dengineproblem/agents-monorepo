/**
 * CreativeAgent Tool Definitions
 * Zod schemas as single source of truth for validation
 * 16 tools: 10 READ + 6 WRITE
 */

import { z } from 'zod';

// Common schemas
const uuidSchema = z.string().uuid('Invalid UUID format');
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);
const extendedPeriodEnum = z.enum(['last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all', '7d', '14d', '30d']);

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
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
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
      limit: z.number().min(1).max(20).optional(),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getWorstCreatives: {
    description: 'Получить креативы с худшими показателями (высоким CPL или низким score)',
    schema: z.object({
      threshold_cpl: z.number().min(0).optional(),
      direction_id: uuidSchema.optional(),
      limit: z.number().min(1).max(20).optional(),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  compareCreatives: {
    description: 'Сравнить метрики двух или более креативов за выбранный период',
    schema: z.object({
      creative_ids: z.array(uuidSchema).min(2, 'Need at least 2 creatives to compare').max(5, 'Maximum 5 creatives'),
      period: extendedPeriodEnum.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
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
    description: 'Сгенерировать картинку-креатив с текстом (offer, bullets, profits). Для картинок 1080x1920.',
    schema: z.object({
      offer: z.string().optional().describe('Главный оффер/заголовок'),
      bullets: z.string().optional().describe('Буллеты/преимущества'),
      profits: z.string().optional().describe('Выгоды для клиента'),
      cta: z.string().optional().describe('Call to action'),
      direction_id: uuidSchema.optional().describe('UUID направления (опционально)'),
      style_id: z.string().optional().describe('ID стиля: modern_performance, clean_minimal, bold_dark, etc.'),
      style_prompt: z.string().optional().describe('Кастомный промпт для freestyle стиля'),
      reference_image: z.string().optional().describe('Base64 референсного изображения')
    }),
    meta: { timeout: 120000, retryable: false, dangerous: true }
  },

  generateCarousel: {
    description: 'Сгенерировать карусель из 2-10 карточек с изображениями.',
    schema: z.object({
      carousel_texts: z.array(z.string()).min(2).max(10).describe('Массив текстов для каждой карточки (2-10 штук)'),
      visual_style: z.string().optional().describe('Визуальный стиль: clean_minimal, modern_performance, bold_dark'),
      style_prompt: z.string().optional().describe('Кастомный промпт для freestyle стиля'),
      direction_id: uuidSchema.optional().describe('UUID направления')
    }),
    meta: { timeout: 300000, retryable: false, dangerous: true }
  },

  generateTextCreative: {
    description: 'Сгенерировать текстовый креатив: сценарий для Reels, пост Telegram, оффер и т.д.',
    schema: z.object({
      text_type: z.enum(['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'])
        .describe('Тип текста: storytelling (сторителлинг), direct_offer (прямой оффер), expert_video (экспертное видео), telegram_post, threads_post, reference'),
      user_prompt: z.string().optional().describe('Дополнительные инструкции для генерации')
    }),
    meta: { timeout: 60000, retryable: false, dangerous: true }
  },

  generateCarouselTexts: {
    description: 'Сгенерировать тексты для карусели перед генерацией изображений.',
    schema: z.object({
      carousel_idea: z.string().optional().describe('Идея/тема карусели'),
      cards_count: z.number().min(2).max(10).describe('Количество карточек (2-10)')
    }),
    meta: { timeout: 60000, retryable: false, dangerous: false }
  }
};

// List of write tools for mode checks
export const CREATIVE_WRITE_TOOLS = [
  'triggerCreativeAnalysis',
  'launchCreative',
  'pauseCreative',
  'startCreativeTest',
  'stopCreativeTest',
  'generateCreatives',
  'generateCarousel',
  'generateTextCreative',
  'generateCarouselTexts'
];

// Dangerous tools that ALWAYS require confirmation
export const CREATIVE_DANGEROUS_TOOLS = ['launchCreative', 'startCreativeTest', 'pauseCreative', 'generateCreatives', 'generateCarousel', 'generateTextCreative'];

export default CreativeToolDefs;
