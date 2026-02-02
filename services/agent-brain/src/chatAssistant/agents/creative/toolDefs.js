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

  // ============================================================
  // IMAGE CREATIVE GENERATION
  // Flow: generateOffer → generateBullets → generateProfits → generateCta → generateCreatives
  // ============================================================

  generateOffer: {
    description: 'ШАГ 1: Сгенерировать заголовок/оффер для креатива. После генерации пользователь может отредактировать или перегенерировать.',
    schema: z.object({
      prompt: z.string().optional().describe('Контекст/пожелания для генерации оффера'),
      existing_bullets: z.string().optional().describe('Уже сгенерированные буллеты (если есть)'),
      existing_profits: z.string().optional().describe('Уже сгенерированные выгоды (если есть)'),
      existing_cta: z.string().optional().describe('Уже сгенерированный CTA (если есть)')
    }),
    meta: { timeout: 30000, retryable: true, dangerous: false }
  },

  generateBullets: {
    description: 'ШАГ 2: Сгенерировать буллеты/преимущества для креатива. Учитывает уже созданный оффер.',
    schema: z.object({
      prompt: z.string().optional().describe('Контекст/пожелания для генерации буллетов'),
      existing_offer: z.string().optional().describe('Уже сгенерированный оффер'),
      existing_profits: z.string().optional().describe('Уже сгенерированные выгоды (если есть)'),
      existing_cta: z.string().optional().describe('Уже сгенерированный CTA (если есть)')
    }),
    meta: { timeout: 30000, retryable: true, dangerous: false }
  },

  generateProfits: {
    description: 'ШАГ 3: Сгенерировать выгоды для клиента. Учитывает оффер и буллеты.',
    schema: z.object({
      prompt: z.string().optional().describe('Контекст/пожелания для генерации выгод'),
      existing_offer: z.string().optional().describe('Уже сгенерированный оффер'),
      existing_bullets: z.string().optional().describe('Уже сгенерированные буллеты'),
      existing_cta: z.string().optional().describe('Уже сгенерированный CTA (если есть)')
    }),
    meta: { timeout: 30000, retryable: true, dangerous: false }
  },

  generateCta: {
    description: 'ШАГ 4: Сгенерировать призыв к действию (CTA). Учитывает оффер, буллеты и выгоды.',
    schema: z.object({
      prompt: z.string().optional().describe('Контекст/пожелания для генерации CTA'),
      existing_offer: z.string().optional().describe('Уже сгенерированный оффер'),
      existing_bullets: z.string().optional().describe('Уже сгенерированные буллеты'),
      existing_profits: z.string().optional().describe('Уже сгенерированные выгоды')
    }),
    meta: { timeout: 30000, retryable: true, dangerous: false }
  },

  generateCreatives: {
    description: 'ШАГ 5 (финал): Сгенерировать картинку-креатив 1080x1920 с готовыми текстами. ВАЖНО: Сначала сгенерируй тексты через generateOffer/Bullets/Profits/Cta, потом вызывай этот инструмент с готовыми текстами.',
    schema: z.object({
      offer: z.string().describe('Готовый оффер/заголовок (из generateOffer)'),
      bullets: z.string().optional().describe('Готовые буллеты (из generateBullets)'),
      profits: z.string().optional().describe('Готовые выгоды (из generateProfits)'),
      cta: z.string().optional().describe('Готовый CTA (из generateCta)'),
      direction_id: uuidSchema.optional().describe('UUID направления'),
      style_id: z.string().optional().describe('Стиль изображения: modern_performance (современный), clean_minimal (минималистичный), bold_dark (тёмный контрастный), neon_glow (неоновый), gradient_soft (мягкий градиент)'),
      style_prompt: z.string().optional().describe('Кастомный промпт для freestyle стиля (если style_id не подходит)'),
      reference_image: z.string().optional().describe('Base64 референсного изображения для копирования стиля')
    }),
    meta: { timeout: 120000, retryable: false, dangerous: true }
  },

  // ============================================================
  // CAROUSEL GENERATION
  // Flow: generateCarouselTexts → (редактирование) → generateCarousel
  // ============================================================

  generateCarouselTexts: {
    description: 'ШАГ 1 для карусели: Сгенерировать тексты для всех карточек. После генерации пользователь может отредактировать тексты.',
    schema: z.object({
      carousel_idea: z.string().optional().describe('Идея/тема карусели (например: "5 причин выбрать нас", "Как увеличить продажи")'),
      cards_count: z.number().min(2).max(10).describe('Количество карточек (2-10)')
    }),
    meta: { timeout: 60000, retryable: true, dangerous: false }
  },

  generateCarousel: {
    description: 'ШАГ 2 для карусели (финал): Сгенерировать изображения для карусели. ВАЖНО: Сначала сгенерируй тексты через generateCarouselTexts, потом вызывай этот инструмент с готовыми текстами.',
    schema: z.object({
      carousel_texts: z.array(z.string()).min(2).max(10).describe('Массив готовых текстов для каждой карточки (2-10 штук)'),
      visual_style: z.string().optional().describe('Стиль: clean_minimal (минималистичный), modern_performance (современный), bold_dark (тёмный), gradient_soft (градиент)'),
      style_prompt: z.string().optional().describe('Кастомный промпт для freestyle стиля'),
      reference_image: z.string().optional().describe('Base64 референсного изображения для копирования стиля карусели'),
      direction_id: uuidSchema.optional().describe('UUID направления')
    }),
    meta: { timeout: 300000, retryable: false, dangerous: true }
  },

  // ============================================================
  // TEXT CREATIVE (сценарии, посты)
  // ============================================================

  generateTextCreative: {
    description: 'Сгенерировать текстовый креатив: сценарий для Reels/видео, пост для соцсетей, оффер.',
    schema: z.object({
      text_type: z.enum(['storytelling', 'direct_offer', 'expert_video', 'telegram_post', 'threads_post', 'reference'])
        .describe('Тип текста: storytelling (сторителлинг для Reels), direct_offer (прямой продающий оффер), expert_video (экспертное видео), telegram_post (пост Telegram), threads_post (пост Threads), reference (референс)'),
      user_prompt: z.string().optional().describe('Дополнительные инструкции: тема, тон, особенности')
    }),
    meta: { timeout: 60000, retryable: true, dangerous: false }
  }
};

// List of write tools for mode checks
export const CREATIVE_WRITE_TOOLS = [
  'triggerCreativeAnalysis',
  'launchCreative',
  'pauseCreative',
  'startCreativeTest',
  'stopCreativeTest',
  // Text generation (не dangerous - можно перегенерировать)
  'generateOffer',
  'generateBullets',
  'generateProfits',
  'generateCta',
  'generateCarouselTexts',
  'generateTextCreative',
  // Image generation (dangerous - тратит ресурсы)
  'generateCreatives',
  'generateCarousel'
];

// Dangerous tools that ALWAYS require confirmation (тратят ресурсы или меняют рекламу)
export const CREATIVE_DANGEROUS_TOOLS = [
  'launchCreative',      // Запускает рекламу
  'startCreativeTest',   // Тратит бюджет на тест
  'pauseCreative',       // Останавливает рекламу
  'generateCreatives',   // Генерирует изображение (дорого)
  'generateCarousel'     // Генерирует карусель (очень дорого)
];

export default CreativeToolDefs;
