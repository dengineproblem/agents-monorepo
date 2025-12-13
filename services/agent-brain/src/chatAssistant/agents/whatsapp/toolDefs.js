/**
 * WhatsAppAgent Tool Definitions
 * Zod schemas as single source of truth for validation
 * 4 tools: all READ
 */

import { z } from 'zod';

// Common schemas
const nonEmptyString = (field) => z.string().min(1, `${field} is required`);
const phoneSchema = z.string().min(10, 'Phone number must be at least 10 characters');

export const WhatsappToolDefs = {
  // ============================================================
  // READ TOOLS (all WhatsApp tools are read-only)
  // ============================================================

  getDialogs: {
    description: 'Получить список WhatsApp диалогов с лидами',
    schema: z.object({
      status: z.enum(['active', 'inactive', 'all']).optional(),
      limit: z.number().min(1).max(100).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDialogMessages: {
    description: 'Получить сообщения конкретного WhatsApp диалога',
    schema: z.object({
      contact_phone: phoneSchema,
      limit: z.number().min(1).max(200).optional()
    }),
    meta: { timeout: 15000, retryable: true }
  },

  analyzeDialog: {
    description: 'Запросить AI-анализ диалога: интересы клиента, возражения, готовность к покупке, рекомендации',
    schema: z.object({
      contact_phone: phoneSchema
    }),
    meta: { timeout: 45000, retryable: true }  // Longer timeout for AI analysis
  },

  searchDialogSummaries: {
    description: 'Поиск по истории диалогов. Используй для вопросов типа "найди где жаловались на цену", "кто интересовался имплантацией", "покажи диалоги с возражениями"',
    schema: z.object({
      query: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().min(1).max(50).optional()
    }),
    meta: { timeout: 20000, retryable: true }
  }
};

// WhatsApp agent has no write tools
export const WHATSAPP_WRITE_TOOLS = [];

export default WhatsappToolDefs;
