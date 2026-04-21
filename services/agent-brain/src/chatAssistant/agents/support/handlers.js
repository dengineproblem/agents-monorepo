// services/agent-brain/src/chatAssistant/agents/support/handlers.js
/**
 * Handlers for Support domain tools.
 * Sig: async (params, context) => ({ success, data/error })
 */
import { escalateToAdminHttp } from './escalation.js';
import { ESCALATION_REASONS_LIST } from './toolDefs.js';
import { supabase } from '../../../lib/supabaseClient.js';

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
  async getDirectionsAndCreatives(_params, context) {
    const directions = Array.isArray(context.directions) ? context.directions : [];
    if (directions.length === 0) {
      return { success: true, data: { directions: [] } };
    }

    const directionIds = directions.map(d => d.id);
    const { data: creatives, error } = await supabase
      .from('user_creatives')
      .select('id, direction_id, is_active, media_type, created_at')
      .in('direction_id', directionIds);

    if (error) {
      return { success: false, error: `db_error: ${error.message}` };
    }

    const byDir = new Map();
    for (const c of (creatives || [])) {
      if (!byDir.has(c.direction_id)) byDir.set(c.direction_id, []);
      byDir.get(c.direction_id).push({
        id: c.id,
        is_active: !!c.is_active,
        media_type: c.media_type,
        created_at: c.created_at,
      });
    }

    return {
      success: true,
      data: {
        directions: directions.map(d => ({
          id: d.id,
          name: d.name,
          is_active: !!d.is_active,
          daily_budget_cents: d.daily_budget_cents ?? null,
          target_cpl_cents: d.target_cpl_cents ?? null,
          whatsapp_number: d.whatsapp_number || null,
          creatives: byDir.get(d.id) || [],
        })),
      },
    };
  },
  async getSubscriptionStatus(_params, context) {
    const { userAccountId } = context;

    const { data: acc, error: accErr } = await supabase
      .from('user_accounts')
      .select('tarif, tarif_expires')
      .eq('id', userAccountId)
      .single();

    if (accErr) {
      return { success: false, error: `db_error_user_accounts: ${accErr.message}` };
    }

    const endsAt = acc?.tarif_expires || null;
    const daysLeft = endsAt
      ? Math.floor((new Date(endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    let status = 'unknown';
    if (daysLeft !== null) {
      if (daysLeft < 0) status = 'expired';
      else if (daysLeft <= 7) status = 'expiring_soon';
      else status = 'active';
    }

    return {
      success: true,
      data: {
        tarif: acc?.tarif || null,
        ends_at: endsAt,
        days_left: daysLeft,
        status,
        kaspi_link: process.env.KASPI_PAY_LINK || 'https://pay.kaspi.kz/pay/performante',
        robokassa_link: process.env.ROBOKASSA_LINK || null,
        prices: {
          '1m': '49 000 тг',
          '3m': '99 000 тг',
        },
      },
    };
  },
};

export default supportHandlers;
