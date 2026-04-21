// services/agent-brain/src/chatAssistant/agents/support/toolDefs.js
/**
 * Tool definitions for Support domain agent.
 * Zod-based schemas, аналогично agents/whatsapp/toolDefs.js
 */
import { z } from 'zod';

const ESCALATION_REASONS = [
  'refund_request',
  'password_reset',
  'fb_account_auth',
  'whatsapp_code',
  'legal_invoice',
  'cabinet_blocked',
  'bitrix_box',
  'voice_message',
  'multiple_retries_failed',
  'card_number_detected',
  'manual_request',
  'other',
];

export const SupportToolDefs = {
  escalateToAdmin: {
    description:
      'Эскалировать запрос живому админу в Telegram-группу техподдержки. ' +
      'Вызывай ТОЛЬКО для ситуаций, где бот сам решить не может: возвраты, ' +
      'коды 2FA, счета на ТОО, блокировки кабинета, голосовые, жалобы, ' +
      'номер карты в сообщении, или юзер явно просит человека. ' +
      'После успешной эскалации ответь юзеру: "Приняли, передаём специалисту, ' +
      'свяжется в ближайшее время."',
    schema: z.object({
      reason: z.enum(ESCALATION_REASONS).describe(
        'Категория причины эскалации (строгий enum)'
      ),
      summary: z.string().min(10).max(500).describe(
        'Краткое описание ситуации для админа: что хочет юзер и что бот уже попробовал. 2–3 предложения.'
      ),
      category: z.string().optional().describe(
        'Номер категории из docs/support-bot-scripts.md (1-16), для статистики'
      ),
    }),
    meta: { timeout: 10000, retryable: false },
  },
  getAdAccountStatus: {
    description:
      'Получить статус рекламного кабинета юзера: подключён ли FB, баланс, задолженность, ' +
      'часовой пояс, активные ограничения (EU privacy и пр.). Используй для вопросов про ' +
      'подключение FB, списания, задолженность, часовой пояс, блокировки.',
    schema: z.object({}).describe('Нет параметров — читает из контекста'),
    meta: { timeout: 5000, retryable: true },
  },
  getIntegrationsStatus: {
    description:
      'Получить статус интеграций юзера: Facebook, WhatsApp, AmoCRM, Bitrix24, ROI. ' +
      'Используй для вопросов «как подключить вацап», «как подключить срм», «куда падают лиды».',
    schema: z.object({}).describe('Нет параметров — читает из контекста'),
    meta: { timeout: 3000, retryable: true },
  },
};

export const ESCALATION_REASONS_LIST = ESCALATION_REASONS;
export default SupportToolDefs;
