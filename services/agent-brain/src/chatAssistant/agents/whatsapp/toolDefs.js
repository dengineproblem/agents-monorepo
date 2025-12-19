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
    description: 'Получить список WhatsApp диалогов с лидами. Возвращает: имя лида, телефон, уровень интереса (hot/warm/cold), score (0-100), этап воронки, количество сообщений, дату последнего сообщения и краткое резюме диалога. Используй для: "покажи диалоги", "какие есть лиды в WhatsApp", "активные переписки"',
    schema: z.object({
      status: z.enum(['active', 'inactive', 'all']).optional().describe('active = сообщения за последние 24ч, inactive = старше 24ч, all = все'),
      limit: z.number().min(1).max(100).optional().describe('Максимальное количество диалогов (по умолчанию 20)')
    }),
    meta: { timeout: 20000, retryable: true }
  },

  getDialogMessages: {
    description: 'Получить историю сообщений конкретного WhatsApp диалога. Возвращает: текст сообщения, кто отправил (клиент/бот), тип (text/image/audio), время. Используй для: "покажи переписку с +7...", "что писал клиент", "история диалога"',
    schema: z.object({
      contact_phone: phoneSchema.describe('Номер телефона контакта (например: 79001234567)'),
      limit: z.number().min(1).max(200).optional().describe('Количество последних сообщений (по умолчанию 50)')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  analyzeDialog: {
    description: 'Получить AI-анализ диалога с клиентом. Возвращает: уровень интереса, score, этап воронки, ключевые интересы клиента, выявленные возражения, сигналы готовности к покупке, рекомендуемое следующее действие. Используй для: "проанализируй диалог", "что хочет клиент", "какие возражения у лида"',
    schema: z.object({
      contact_phone: phoneSchema.describe('Номер телефона контакта (например: 79001234567)')
    }),
    meta: { timeout: 45000, retryable: true }  // Longer timeout for AI analysis
  },

  searchDialogSummaries: {
    description: 'Полнотекстовый поиск по резюме всех диалогов. Поддерживает русский язык и фильтрацию по тегам. Возвращает: телефон, имя, резюме диалога, теги, score, этап воронки. Используй для: "найди кто жаловался на цену", "клиенты интересовавшиеся имплантацией", "диалоги с возражениями", "кто спрашивал про рассрочку"',
    schema: z.object({
      query: z.string().optional().describe('Поисковый запрос на русском (ищет по резюме диалогов)'),
      tags: z.array(z.string()).optional().describe('Фильтр по тегам (например: ["имплантация", "возражение:цена", "hot"])'),
      limit: z.number().min(1).max(50).optional().describe('Максимальное количество результатов (по умолчанию 10)')
    }),
    meta: { timeout: 20000, retryable: true }
  }
};

// WhatsApp agent has no write tools
export const WHATSAPP_WRITE_TOOLS = [];

export default WhatsappToolDefs;
