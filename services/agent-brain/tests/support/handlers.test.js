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

describe('supportHandlers.getSubscriptionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает тариф и дату окончания из user_accounts', async () => {
    const userAccChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { tarif: 'subscription_3m', tarif_expires: '2026-07-01' },
        error: null,
      }),
    };
    supabase.from.mockImplementation((table) => {
      if (table === 'user_accounts') return userAccChain;
      throw new Error(`unexpected table ${table}`);
    });

    vi.setSystemTime(new Date('2026-04-21T00:00:00Z'));

    const result = await supportHandlers.getSubscriptionStatus(
      {},
      { userAccountId: 'u-1' }
    );

    expect(result.success).toBe(true);
    expect(result.data.tarif).toBe('subscription_3m');
    expect(result.data.ends_at).toBe('2026-07-01');
    expect(result.data.days_left).toBeGreaterThan(60);
    expect(result.data.status).toBe('active');
    expect(result.data.kaspi_link).toMatch(/kaspi/i);
  });

  it('возвращает status=expired если дата прошла', async () => {
    const userAccChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { tarif: 'subscription_1m', tarif_expires: '2026-01-01' },
        error: null,
      }),
    };
    supabase.from.mockImplementation((t) =>
      t === 'user_accounts' ? userAccChain : (() => { throw new Error(`unexpected table ${t}`); })()
    );
    vi.setSystemTime(new Date('2026-04-21T00:00:00Z'));

    const result = await supportHandlers.getSubscriptionStatus({}, { userAccountId: 'u-1' });
    expect(result.data.status).toBe('expired');
    expect(result.data.days_left).toBeLessThan(0);
  });
});

describe('supportHandlers.getRecentUserErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает последние ошибки юзера из error_logs', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'e-1',
            error_type: 'api',
            error_code: 'FB_TOKEN_EXPIRED',
            raw_error: 'OAuthException',
            llm_explanation: 'Токен Facebook истёк',
            llm_solution: 'Переподключите кабинет через Профиль',
            action: 'fetch_metrics',
            endpoint: '/graph/v19/act_123',
            severity: 'warning',
            created_at: '2026-04-21T10:00:00Z',
          },
        ],
        error: null,
      }),
    };
    supabase.from.mockReturnValue(chain);

    const result = await supportHandlers.getRecentUserErrors(
      { limit: 5, since_hours: 48 },
      { userAccountId: 'u-1' }
    );

    expect(result.success).toBe(true);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0].llm_explanation).toBe('Токен Facebook истёк');
    expect(result.data.errors[0].llm_solution).toBe('Переподключите кабинет через Профиль');
    expect(chain.eq).toHaveBeenCalledWith('user_account_id', 'u-1');
    expect(chain.gte).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('использует дефолтные limit=5 и since_hours=48', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    supabase.from.mockReturnValue(chain);

    await supportHandlers.getRecentUserErrors({}, { userAccountId: 'u-1' });
    expect(chain.limit).toHaveBeenCalledWith(5);
  });
});

describe('supportHandlers.getTodayReportStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает sent=true если найдено сообщение-отчёт за сегодня', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'm-1',
            message:
              '📊 Отчёт за 20.04.2026\n\nЗатраты: $15.20\nЛидов: 4\nКачественных: 2\nCPL: $3.80\n\nПосле отчёта текст',
            created_at: '2026-04-21T06:00:00Z',
          },
        ],
        error: null,
      }),
    };
    supabase.from.mockReturnValue(chain);

    vi.setSystemTime(new Date('2026-04-21T10:00:00Z'));

    const result = await supportHandlers.getTodayReportStatus(
      {},
      { userAccountId: 'u-1' }
    );

    expect(result.success).toBe(true);
    expect(result.data.sent).toBe(true);
    expect(result.data.sent_at).toBe('2026-04-21T06:00:00Z');
    expect(result.data.excerpt).toMatch(/Затраты/);
  });

  it('возвращает sent=false если отчёта за сегодня нет', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    supabase.from.mockReturnValue(chain);

    const result = await supportHandlers.getTodayReportStatus({}, { userAccountId: 'u-1' });
    expect(result.data.sent).toBe(false);
  });
});
