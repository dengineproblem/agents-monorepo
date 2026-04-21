import { describe, it, expect } from 'vitest';
import { buildSupportSystemPrompt } from '../../src/chatAssistant/agents/support/systemPrompt.js';

describe('buildSupportSystemPrompt', () => {
  it('содержит роль, стиль, контекст юзера и скрипты', () => {
    const prompt = buildSupportSystemPrompt({
      userAccountId: 'u-1',
      businessName: 'Elite Dental',
      integrations: { fb: true, whatsapp: false, amocrm: true, bitrix24: false, roi: false },
      directions: [{ id: 'd-1', name: 'Имплантация', is_active: true }],
    });

    expect(prompt).toMatch(/специалист тех\.поддержки Performante/i);
    expect(prompt).toMatch(/обращение на «Вы»/i);
    expect(prompt).toMatch(/без эмодзи/i);
    expect(prompt).toMatch(/Если что я на связи/i);
    expect(prompt).toContain('Elite Dental');
    expect(prompt).toContain('Имплантация');
    expect(prompt).toMatch(/FB:\s*подключ/i);
    expect(prompt).toMatch(/WhatsApp:\s*НЕ подключ/i);
    expect(prompt).toMatch(/## Тональность и общий стиль/);
    expect(prompt).toMatch(/Шаблон ответа бота/);
    expect(prompt).toMatch(/escalateToAdmin/);
    expect(prompt).toMatch(/возврат/i);
    expect(prompt).toMatch(/на русском языке/i);
  });

  it('работает с пустым контекстом', () => {
    const prompt = buildSupportSystemPrompt({ userAccountId: 'u-1' });
    expect(prompt).toMatch(/специалист тех\.поддержки Performante/i);
    expect(prompt).toMatch(/## Тональность и общий стиль/);
  });
});
