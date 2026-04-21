// services/agent-brain/src/chatAssistant/agents/support/handlers.js
/**
 * Handlers for Support domain tools.
 * Sig: async (params, context) => ({ success, data/error })
 */
import { escalateToAdminHttp } from './escalation.js';
import { ESCALATION_REASONS_LIST } from './toolDefs.js';

export const supportHandlers = {
  /**
   * @param {{ reason: string, summary: string, category?: string }} params
   * @param {{ userAccountId: string, conversationId?: string,
   *           businessName?: string, recentMessages?: Array }} context
   */
  async escalateToAdmin(params, context) {
    const { reason, summary, category } = params;

    if (!ESCALATION_REASONS_LIST.includes(reason)) {
      return {
        success: false,
        error: `invalid_reason: ${reason}`,
      };
    }

    const contextMessages = (context.recentMessages || [])
      .slice(-5)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));

    const res = await escalateToAdminHttp({
      userAccountId: context.userAccountId,
      conversationId: context.conversationId,
      reason,
      category,
      summary,
      businessName: context.businessName,
      contextMessages,
    });

    if (!res.success) {
      return { success: false, error: res.error || 'escalation_failed' };
    }

    return {
      success: true,
      data: {
        escalated: true,
        escalation_id: res.escalation_id,
        notified: res.notified,
      },
    };
  },
  /**
   * @param {{}} params (empty)
   * @param {{ adAccountStatus?: Object }} context
   */
  async getAdAccountStatus(_params, context) {
    const s = context.adAccountStatus;
    if (!s) {
      return { success: true, data: { is_connected: false } };
    }
    return {
      success: true,
      data: {
        is_connected: !!s.is_connected,
        ad_account_id: s.ad_account_id || null,
        balance_cents: s.balance_cents ?? null,
        currency: s.currency || null,
        timezone_name: s.timezone_name || null,
        has_debt: !!s.has_debt,
        restrictions: Array.isArray(s.restrictions) ? s.restrictions : [],
        last_sync_at: s.last_sync_at || null,
      },
    };
  },
  /**
   * @param {{}} params (empty)
   * @param {{ integrations?: Object }} context
   */
  async getIntegrationsStatus(_params, context) {
    const i = context.integrations || {};
    return {
      success: true,
      data: {
        fb: !!i.fb,
        whatsapp: !!i.whatsapp,
        amocrm: !!i.amocrm,
        bitrix24: !!i.bitrix24,
        roi: !!i.roi,
        crm: !!i.crm,
      },
    };
  },
};

export default supportHandlers;
