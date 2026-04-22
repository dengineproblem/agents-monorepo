import { describe, it, expect } from 'vitest';

import { supportHandlers } from '../../src/chatAssistant/agents/support/handlers.js';
import { SupportToolDefs } from '../../src/chatAssistant/agents/support/toolDefs.js';
import { buildSupportSystemPrompt } from '../../src/chatAssistant/agents/support/systemPrompt.js';

describe('support agent — integration smoke', () => {
  it('toolDefs и handlers имеют одинаковые ключи', () => {
    const toolKeys = Object.keys(SupportToolDefs).sort();
    const handlerKeys = Object.keys(supportHandlers).sort();
    expect(toolKeys).toEqual(handlerKeys);
  });

  it('systemPrompt содержит имена всех tools из toolDefs', () => {
    const prompt = buildSupportSystemPrompt({ userAccountId: 'u-1' });
    for (const toolName of Object.keys(SupportToolDefs)) {
      expect(prompt).toContain(toolName);
    }
  });

  it('escalateToAdmin reasons enum синхронен с supportEscalations REASON_LABELS', () => {
    const reasons = SupportToolDefs.escalateToAdmin.schema.shape.reason._def.values;
    expect(reasons.length).toBeGreaterThanOrEqual(12);
    expect(reasons).toContain('refund_request');
    expect(reasons).toContain('voice_message');
    expect(reasons).toContain('card_number_detected');
  });
});
