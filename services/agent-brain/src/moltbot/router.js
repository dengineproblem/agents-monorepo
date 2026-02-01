import { logger } from '../lib/logger.js';

/**
 * Маршрутизация запросов к specialist агентам через Moltbot Gateway API
 */
export async function routeToSpecialist(specialist, message, telegramChatId) {
  const startTime = Date.now();

  logger.info({
    specialist,
    telegramChatId,
    messageLength: message.length
  }, 'Routing to specialist agent');

  // Validate specialist
  const validSpecialists = ['facebook-ads', 'creatives', 'crm', 'tiktok', 'onboarding'];
  if (!validSpecialists.includes(specialist)) {
    logger.error({ specialist, validSpecialists }, 'Invalid specialist name');
    throw new Error(`Invalid specialist: ${specialist}. Must be one of: ${validSpecialists.join(', ')}`);
  }

  // Validate telegramChatId
  if (!telegramChatId || typeof telegramChatId !== 'string') {
    logger.error({ telegramChatId }, 'Invalid telegramChatId');
    throw new Error('telegramChatId is required and must be a string');
  }

  try {
    // Call Moltbot Gateway API (OpenAI-compatible endpoint) для specialist агента
    const response = await fetch('http://moltbot:18789/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOLTBOT_TOKEN || 'moltbot-dev-token-2026'}`,
        'x-moltbot-agent-id': specialist,
        'x-moltbot-session-id': `telegram-${telegramChatId}-${specialist}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-5.2', // Specialist agents используют GPT-5.2
        messages: [
          {
            role: 'user',
            content: `[Telegram Chat ID: ${telegramChatId}]\n\n${message}`
          }
        ],
        stream: false
      }),
      signal: AbortSignal.timeout(120000) // 2 минуты timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({
        specialist,
        status: response.status,
        statusText: response.statusText,
        errorText
      }, 'Moltbot API error');
      throw new Error(`Moltbot API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    // Извлечь ответ из OpenAI-совместимого формата
    const assistantMessage = result.choices?.[0]?.message?.content || '';

    const duration = Date.now() - startTime;
    logger.info({
      specialist,
      telegramChatId,
      routeDuration: duration,
      responseLength: assistantMessage.length,
      totalTokens: result.usage?.total_tokens || 0
    }, 'Specialist routing completed');

    return {
      response: assistantMessage,
      usage: result.usage
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      specialist,
      telegramChatId,
      routeDuration: duration,
      error: error.message,
      stack: error.stack
    }, 'Routing error');
    throw error;
  }
}
