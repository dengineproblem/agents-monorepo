import { describe, it, expect, vi, afterEach } from 'vitest';
import { escalateToAdminHttp } from '../../src/chatAssistant/agents/support/escalation.js';

describe('escalateToAdminHttp', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('возвращает success=true и escalation_id при 200-ответе', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, escalation_id: 'abc-123', notified: true }),
    });

    const result = await escalateToAdminHttp({
      userAccountId: 'u-1',
      reason: 'refund_request',
      summary: 'Юзер хочет возврат',
    });

    expect(result.success).toBe(true);
    expect(result.escalation_id).toBe('abc-123');
    expect(result.notified).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/internal/support-escalations'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('возвращает success=false при HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    });

    const result = await escalateToAdminHttp({
      userAccountId: 'u-1',
      reason: 'other',
      summary: 'fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('http_500');
  });

  it('возвращает success=false при network exception', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await escalateToAdminHttp({
      userAccountId: 'u-1',
      reason: 'other',
      summary: 'fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
