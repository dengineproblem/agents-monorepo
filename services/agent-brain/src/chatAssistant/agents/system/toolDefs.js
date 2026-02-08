/**
 * System Agent Tool Definitions
 * Системные tools: ошибки, статус и т.д.
 */

import { z } from 'zod';

export const SystemToolDefs = {
  getUserErrors: {
    description: 'Получить ошибки пользователя из системного лога. Возвращает: error_type, severity, raw_error, llm_explanation (объяснение), llm_solution (решение), action, created_at, is_resolved. Используй когда пользователь спрашивает про ошибки или проблемы.',
    schema: z.object({
      severity: z.enum(['critical', 'warning', 'info']).optional().describe('Фильтр по серьезности'),
      error_type: z.string().optional().describe('Фильтр по типу: facebook, creative_generation, api, cron, chatbot_service'),
      resolved: z.boolean().optional().describe('Фильтр: true = решенные, false = нерешенные, пусто = все'),
      limit: z.number().min(1).max(50).optional().describe('Количество записей (по умолчанию 10)')
    }),
    meta: { timeout: 15000, retryable: true }
  },

  getKnowledgeBase: {
    description: 'Получить информацию из базы знаний платформы Performante.ai. Без параметров — список глав. С chapter_id — оглавление главы. С chapter_id + section_id — содержимое раздела. Используй когда пользователь спрашивает "как подключить", "как создать", "инструкция", "помощь".',
    schema: z.object({
      chapter_id: z.string().optional().describe('ID главы (getting-started, ad-launch, ad-management, roi-analytics, competitors, profile-settings)'),
      section_id: z.string().optional().describe('ID раздела внутри главы'),
    }),
    meta: { timeout: 5000, retryable: true }
  },
};

export default SystemToolDefs;
