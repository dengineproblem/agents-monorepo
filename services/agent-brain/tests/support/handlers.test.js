import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/chatAssistant/agents/support/escalation.js', () => ({
  escalateToAdminHttp: vi.fn(),
}));

vi.mock('../../src/lib/supabaseClient.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supportHandlers } from '../../src/chatAssistant/agents/support/handlers.js';
import { escalateToAdminHttp } from '../../src/chatAssistant/agents/support/escalation.js';
import { supabase } from '../../src/lib/supabaseClient.js';

describe('supportHandlers.escalateToAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('вызывает escalateToAdminHttp с нужными полями и возвращает escalated=true', async () => {
    escalateToAdminHttp.mockResolvedValue({
      success: true,
      escalation_id: 'esc-1',
      notified: true,
    });

    const context = {
      userAccountId: 'u-1',
      conversationId: 'c-1',
      businessName: 'Elite Dental',
      recentMessages: [
        { role: 'user', content: 'хочу возврат' },
        { role: 'assistant', content: 'поясните ситуацию' },
        { role: 'user', content: 'верните деньги' },
      ],
    };

    const result = await supportHandlers.escalateToAdmin(
      { reason: 'refund_request', summary: 'Юзер просит возврат', category: '3' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.data.escalated).toBe(true);
    expect(result.data.escalation_id).toBe('esc-1');

    expect(escalateToAdminHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        userAccountId: 'u-1',
        reason: 'refund_request',
        summary: 'Юзер просит возврат',
        category: '3',
        businessName: 'Elite Dental',
        contextMessages: expect.arrayContaining([
          expect.objectContaining({ content: 'верните деньги' }),
        ]),
      })
    );
  });

  it('возвращает success=false при ошибке escalateToAdminHttp', async () => {
    escalateToAdminHttp.mockResolvedValue({ success: false, error: 'http_500' });

    const result = await supportHandlers.escalateToAdmin(
      { reason: 'other', summary: 'x' },
      { userAccountId: 'u-1' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('http_500');
  });

  it('валидирует reason против enum', async () => {
    const result = await supportHandlers.escalateToAdmin(
      { reason: 'random_invalid_reason', summary: 'x' },
      { userAccountId: 'u-1' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid_reason/i);
  });
});

describe('supportHandlers.getAdAccountStatus', () => {
  it('возвращает данные из context.adAccountStatus', async () => {
    const context = {
      userAccountId: 'u-1',
      adAccountStatus: {
        is_connected: true,
        ad_account_id: 'act_123',
        balance_cents: -1500,
        currency: 'USD',
        timezone_name: 'America/Los_Angeles',
        has_debt: true,
        restrictions: ['EU_PRIVACY'],
      },
    };

    const result = await supportHandlers.getAdAccountStatus({}, context);

    expect(result.success).toBe(true);
    expect(result.data.is_connected).toBe(true);
    expect(result.data.has_debt).toBe(true);
    expect(result.data.timezone_name).toBe('America/Los_Angeles');
    expect(result.data.restrictions).toEqual(['EU_PRIVACY']);
  });

  it('возвращает is_connected=false если adAccountStatus пустой', async () => {
    const result = await supportHandlers.getAdAccountStatus(
      {},
      { userAccountId: 'u-1' }
    );
    expect(result.success).toBe(true);
    expect(result.data.is_connected).toBe(false);
  });
});

describe('supportHandlers.getIntegrationsStatus', () => {
  it('возвращает статусы всех интеграций из context', async () => {
    const context = {
      userAccountId: 'u-1',
      integrations: {
        fb: true,
        whatsapp: false,
        amocrm: true,
        bitrix24: false,
        roi: false,
        crm: true,
      },
    };

    const result = await supportHandlers.getIntegrationsStatus({}, context);

    expect(result.success).toBe(true);
    expect(result.data.fb).toBe(true);
    expect(result.data.whatsapp).toBe(false);
    expect(result.data.amocrm).toBe(true);
    expect(result.data.bitrix24).toBe(false);
  });

  it('возвращает all=false если integrations отсутствуют в context', async () => {
    const result = await supportHandlers.getIntegrationsStatus(
      {},
      { userAccountId: 'u-1' }
    );
    expect(result.success).toBe(true);
    expect(result.data.fb).toBe(false);
    expect(result.data.whatsapp).toBe(false);
  });
});

describe('supportHandlers.getDirectionsAndCreatives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает direction + привязанные креативы', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [
          { id: 'cr-1', direction_id: 'd-1', is_active: true, media_type: 'video', created_at: '2026-04-01' },
          { id: 'cr-2', direction_id: 'd-1', is_active: false, media_type: 'image', created_at: '2026-04-02' },
        ],
        error: null,
      }),
    };
    supabase.from.mockReturnValue(chain);

    const context = {
      userAccountId: 'u-1',
      directions: [
        {
          id: 'd-1',
          name: 'Имплантация',
          is_active: true,
          daily_budget_cents: 1500,
          target_cpl_cents: 300,
          whatsapp_number: '+77001234567',
        },
      ],
    };

    const result = await supportHandlers.getDirectionsAndCreatives({}, context);

    expect(result.success).toBe(true);
    expect(result.data.directions).toHaveLength(1);
    expect(result.data.directions[0].name).toBe('Имплантация');
    expect(result.data.directions[0].creatives).toHaveLength(2);
    expect(result.data.directions[0].creatives[0].is_active).toBe(true);
  });

  it('возвращает пустой список если directions нет', async () => {
    const result = await supportHandlers.getDirectionsAndCreatives(
      {},
      { userAccountId: 'u-1', directions: [] }
    );
    expect(result.success).toBe(true);
    expect(result.data.directions).toEqual([]);
  });
});
