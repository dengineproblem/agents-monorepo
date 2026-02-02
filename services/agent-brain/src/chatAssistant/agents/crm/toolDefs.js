/**
 * CRMAgent Tool Definitions
 * Zod schemas as single source of truth for validation
 * 13 tools: 11 READ + 2 WRITE
 */

import { z } from 'zod';

// Common schemas
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);
const periodSchema = z.enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
const extendedPeriodSchema = z.enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
const amoPeriodSchema = z.enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_6m', 'last_12m', 'all']);
const uuidSchema = z.string().uuid('Invalid UUID format');

export const CrmToolDefs = {
  // ============================================================
  // READ TOOLS
  // ============================================================

  getLeads: {
    description: 'Получить список лидов с фильтрацией. Возвращает: name, phone, score (0-100), interest_level (hot/warm/cold), funnel_stage, creative_id, direction_id, created_at. Используй для поиска конкретных лидов или анализа базы.',
    schema: z.object({
      interest_level: z.enum(['hot', 'warm', 'cold']).optional(),
      funnel_stage: z.string().optional(),
      min_score: z.number().min(0).max(100).optional(),
      limit: z.number().min(1).max(100).optional(),
      search: z.string().optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getLeadDetails: {
    description: 'Полная карточка лида: контакты (name, phone, email), текущий этап воронки, score, temperature, источник (creative, direction), история WhatsApp диалога, AI-анализ переписки. Используй для глубокого анализа конкретного лида.',
    schema: z.object({
      lead_id: nonEmptyString('lead_id')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  getFunnelStats: {
    description: 'Статистика воронки продаж за период: количество лидов на каждом этапе, конверсии между этапами (%), распределение по температуре. Используй для оценки эффективности воронки.',
    schema: z.object({
      period: periodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getSalesQuality: {
    description: 'KPI ladder для оценки качества лидов: total_leads, qualified_leads, sales_count, revenue, avg_check, qualification_rate, CPL ladder (cost per qualified lead). Ключевой инструмент для анализа ROI рекламы.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      period: extendedPeriodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  getSales: {
    description: 'Получить список продаж с детализацией. Возвращает: client_phone, amount, created_at, lead_source, creative_name, direction_name. Используй для анализа продаж и поиска покупателей.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      period: periodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD'),
      min_amount: z.number().optional().describe('Минимальная сумма покупки'),
      search: z.string().optional().describe('Поиск по номеру телефона (частичное совпадение)'),
      limit: z.number().min(1).max(100).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================

  addSale: {
    description: 'Добавить продажу вручную. ОБЯЗАТЕЛЬНО укажи client_phone и amount. Система автоматически найдет лида по номеру телефона и привяжет продажу. Если лид не найден - вернет ошибку с предложением выбрать креатив.',
    schema: z.object({
      client_phone: nonEmptyString('client_phone').describe('Номер телефона клиента (формат: +77001234567)'),
      amount: z.number().positive('Amount must be positive').describe('Сумма продажи в тенге'),
      direction_id: uuidSchema.optional().describe('UUID направления (опционально)'),
      manual_source_id: z.string().optional().describe('Source ID креатива если лид не найден (для создания нового лида)'),
      manual_creative_url: z.string().optional().describe('URL креатива если лид не найден')
    }),
    meta: { timeout: 20000, retryable: false, dangerous: false }
  },

  updateLeadStage: {
    description: 'Изменить этап воронки для лида. Обновляет funnel_stage в БД, записывает в историю. Опционально указать reason для аудита. НЕ синхронизирует с amoCRM автоматически.',
    schema: z.object({
      lead_id: nonEmptyString('lead_id'),
      new_stage: nonEmptyString('new_stage'),
      reason: z.string().optional()
    }),
    meta: { timeout: 15000, retryable: false, dangerous: false }
  },

  // ============================================================
  // AMOCRM TOOLS
  // ============================================================

  getAmoCRMStatus: {
    description: 'Проверить подключение amoCRM: connected (bool), subdomain, tokenValid (bool), expiresAt. ОБЯЗАТЕЛЬНО вызови перед другими amoCRM tools. Если connected=false — интеграция не настроена.',
    schema: z.object({}),
    meta: { timeout: 10000, retryable: true }
  },

  getAmoCRMPipelines: {
    description: 'Воронки и этапы из amoCRM с маппингом квалификации. Возвращает: pipelines[{id, name, stages[{id, name, sort, is_qualified}]}]. Используй для понимания структуры CRM клиента.',
    schema: z.object({
      include_qualified_only: z.boolean().optional().describe('Показать только квалификационные этапы')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  syncAmoCRMLeads: {
    description: '⚠️ DANGEROUS: Синхронизировать статусы лидов из amoCRM. Обновляет: current_status, is_qualified, reached_key_stage_1/2/3. Может занять 30+ секунд. ВСЕГДА требует подтверждения пользователя. Вернёт: total, updated, errors, summary.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для синхронизации'),
      limit: z.number().min(1).max(500).optional().describe('Максимум лидов (по умолчанию 100)')
    }),
    meta: { timeout: 30000, retryable: false, dangerous: true }
  },

  getAmoCRMKeyStageStats: {
    description: 'Конверсия в ключевые этапы направления: key_stage_1/2/3 с названиями, total_leads, reached_count, conversion_rate (%). Показывает глубину прохождения воронки. Требует direction_id.',
    schema: z.object({
      direction_id: uuidSchema.describe('UUID направления'),
      period: amoPeriodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getAmoCRMQualificationStats: {
    description: 'Статистика квалификации по креативам: creative_id, name, total_leads, qualified_count, qualification_rate (%). Включает recommendations для масштабирования/оптимизации. Ключевой для оценки качества трафика.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления'),
      period: amoPeriodSchema.optional().describe('Preset период (игнорируется если указаны date_from/date_to)'),
      date_from: z.string().optional().describe('Начало периода YYYY-MM-DD (приоритет над period)'),
      date_to: z.string().optional().describe('Конец периода YYYY-MM-DD')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getAmoCRMLeadHistory: {
    description: 'Полная история переходов лида в amoCRM: все смены статусов с датами, от какого этапа к какому перешёл, время на каждом этапе. Используй для анализа пути клиента.',
    schema: z.object({
      lead_id: nonEmptyString('lead_id').describe('ID лида (внутренний UUID)')
    }),
    meta: { timeout: 15000, retryable: true }
  }
};

// List of write tools for mode checks
export const CRM_WRITE_TOOLS = ['addSale', 'updateLeadStage', 'syncAmoCRMLeads'];

// Dangerous tools that ALWAYS require confirmation
export const CRM_DANGEROUS_TOOLS = ['syncAmoCRMLeads'];

// amoCRM tools list for preflight check
export const AMOCRM_TOOLS = [
  'getAmoCRMStatus',
  'getAmoCRMPipelines',
  'syncAmoCRMLeads',
  'getAmoCRMKeyStageStats',
  'getAmoCRMQualificationStats',
  'getAmoCRMLeadHistory'
];

export default CrmToolDefs;
