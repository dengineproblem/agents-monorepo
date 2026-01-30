import log from '../lib/logger.js';

/**
 * Маршрутизация запросов к specialist агентам через Moltbot Gateway API
 */
export async function routeToSpecialist(specialist, message, telegramChatId) {
  const startTime = Date.now();

  log.info({
    specialist,
    telegramChatId,
    messageLength: message.length
  }, 'Routing to specialist agent');

  // Validate specialist
  const validSpecialists = ['facebook-ads', 'creatives', 'crm', 'tiktok', 'onboarding'];
  if (!validSpecialists.includes(specialist)) {
    log.error({ specialist, validSpecialists }, 'Invalid specialist name');
    throw new Error(`Invalid specialist: ${specialist}. Must be one of: ${validSpecialists.join(', ')}`);
  }

  // Validate telegramChatId
  if (!telegramChatId || typeof telegramChatId !== 'string') {
    log.error({ telegramChatId }, 'Invalid telegramChatId');
    throw new Error('telegramChatId is required and must be a string');
  }

  try {
    // Call Moltbot Gateway API для specialist агента
    const response = await fetch('http://moltbot:18789/api/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOLTBOT_TOKEN || 'moltbot-dev-token-2026'}`
      },
      body: JSON.stringify({
        agentId: specialist,
        message: `[Telegram Chat ID: ${telegramChatId}]\n\n${message}`,
        channelId: 'telegram',
        userId: telegramChatId,
        sessionId: `telegram-${telegramChatId}-${specialist}`
      }),
      signal: AbortSignal.timeout(120000) // 2 минуты timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({
        specialist,
        status: response.status,
        statusText: response.statusText,
        errorText
      }, 'Moltbot API error');
      throw new Error(`Moltbot API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    const duration = Date.now() - startTime;
    log.info({
      specialist,
      telegramChatId,
      routeDuration: duration,
      responseLength: result.response?.length || 0
    }, 'Specialist routing completed');

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    log.error({
      specialist,
      telegramChatId,
      routeDuration: duration,
      error: error.message,
      stack: error.stack
    }, 'Routing error');
    throw error;
  }
}
