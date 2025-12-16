/**
 * CRMAgent Tool Definitions
 * Zod schemas as single source of truth for validation
 * 5 tools: 4 READ + 1 WRITE
 */

import { z } from 'zod';

// Common schemas
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);
const periodSchema = z.enum(['today', 'yesterday', 'last_7d', 'last_30d']);
const extendedPeriodSchema = z.enum(['last_3d', 'last_7d', 'last_14d', 'last_30d']);
const uuidSchema = z.string().uuid('Invalid UUID format');

export const CrmToolDefs = {
  // ============================================================
  // READ TOOLS
  // ============================================================

  getLeads: {
    description: 'Получить список лидов с фильтрами по температуре, этапу воронки, score',
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
    description: 'Получить полную информацию о лиде: контакты, история, анализ диалога',
    schema: z.object({
      lead_id: nonEmptyString('lead_id')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  getFunnelStats: {
    description: 'Получить статистику по воронке продаж: количество лидов на каждом этапе, конверсии',
    schema: z.object({
      period: periodSchema
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getSalesQuality: {
    description: 'Получить показатели качества продаж: количество продаж, сумма, квалифицированные лиды, конверсия. KPI ladder для анализа CPL.',
    schema: z.object({
      direction_id: uuidSchema.optional().describe('UUID направления для фильтрации'),
      period: extendedPeriodSchema.default('last_7d').describe('Период для анализа')
    }),
    meta: { timeout: 25000, retryable: true }
  },

  // ============================================================
  // WRITE TOOLS
  // ============================================================

  updateLeadStage: {
    description: 'Изменить этап воронки для лида',
    schema: z.object({
      lead_id: nonEmptyString('lead_id'),
      new_stage: nonEmptyString('new_stage'),
      reason: z.string().optional()
    }),
    meta: { timeout: 15000, retryable: false, dangerous: false }
  }
};

// List of write tools for mode checks
export const CRM_WRITE_TOOLS = ['updateLeadStage'];

export default CrmToolDefs;
