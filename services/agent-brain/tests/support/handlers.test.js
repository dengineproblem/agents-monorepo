import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/chatAssistant/agents/support/escalation.js', () => ({
  escalateToAdminHttp: vi.fn(),
}));

import { supportHandlers } from '../../src/chatAssistant/agents/support/handlers.js';
import { escalateToAdminHttp } from '../../src/chatAssistant/agents/support/escalation.js';

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
