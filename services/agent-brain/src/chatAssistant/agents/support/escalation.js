/**
 * Support escalation helper.
 * Sends HTTP POST to agent-service /internal/support-escalations.
 */
import { logger } from '../../../lib/logger.js';

const AGENT_SERVICE_URL =
  process.env.AGENT_SERVICE_URL || 'http://agent-service:8082';

/**
 * @param {Object} params
 * @param {string} params.userAccountId
 * @param {string} [params.conversationId]
 * @param {string} params.reason
 * @param {string} [params.category]
 * @param {string} params.summary
 * @param {string} [params.businessName]
 * @param {Array<{role:string,content:string}>} [params.contextMessages]
 * @returns {Promise<{ success: boolean, escalation_id?: string, notified?: boolean, error?: string }>}
 */
export async function escalateToAdminHttp(params) {
  try {
    const res = await fetch(`${AGENT_SERVICE_URL}/internal/support-escalations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_account_id: params.userAccountId,
        conversation_id: params.conversationId,
        reason: params.reason,
        category: params.category,
        summary: params.summary,
        business_name: params.businessName,
        context_messages: params.contextMessages,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error({ status: res.status, text }, 'escalateToAdminHttp failed');
      return { success: false, error: `http_${res.status}` };
    }

    return await res.json();
  } catch (err) {
    logger.error({ err: String(err) }, 'escalateToAdminHttp exception');
    return { success: false, error: String(err) };
  }
}
