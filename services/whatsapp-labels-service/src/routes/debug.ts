import { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { initSession, destroySession } from '../lib/sessionManager.js';
import { extractAdAttribution } from '../lib/adAttribution.js';

const log = pino({ name: 'debug' });

/**
 * Diagnostic routes — NOT for production traffic, only for manual checks.
 */
export function registerDebugRoutes(app: FastifyInstance): void {
  /**
   * Run extractAdAttribution against the last 10 messages of a specific chat,
   * without pushing anything to the chatbot. Returns the detected pattern plus
   * raw ctwaContext/contextInfo fragments so we can verify whether wwebjs
   * preserves the ad metadata.
   *
   * POST /debug/attribution/:userAccountId
   * body: { "chatId": "5720997138523@lid" }
   */
  app.post<{
    Params: { userAccountId: string };
    Body: { chatId: string; limit?: number };
  }>('/debug/attribution/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;
    const { chatId, limit = 10 } = request.body || ({} as any);

    if (!chatId) {
      return reply.code(400).send({ error: 'chatId required in body' });
    }

    let session;
    try {
      session = await initSession(userAccountId);
    } catch (err: any) {
      return reply.code(500).send({ error: `initSession failed: ${err.message}` });
    }

    if (!session.ready) {
      await destroySession(userAccountId).catch(() => {});
      return reply.code(500).send({ error: 'Session not ready' });
    }

    try {
      const SYNC_DELAY_MS = parseInt(process.env.WWEBJS_SYNC_DELAY_MS || '15000');
      await new Promise(r => setTimeout(r, SYNC_DELAY_MS));

      const chat = await session.client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit });

      const messagesSummary = messages.map((m: any) => {
        const rd = m.rawData || m._data || {};
        return {
          id: m.id?._serialized,
          fromMe: m.fromMe,
          timestamp: m.timestamp,
          date: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : null,
          type: m.type,
          body: (m.body || '').substring(0, 200),
          hasCtwaContext: !!rd.ctwaContext,
          ctwaContext: rd.ctwaContext || null,
          hasExternalAdReply: !!rd?.contextInfo?.externalAdReply,
          externalAdReply: rd?.contextInfo?.externalAdReply || null,
          hasReferral: !!rd?.contextInfo?.referral,
          referral: rd?.contextInfo?.referral || null,
          links: m.links || [],
        };
      });

      const attribution = extractAdAttribution(messages);

      log.info({ userAccountId, chatId, attribution, msgCount: messages.length }, 'Debug attribution run');

      await destroySession(userAccountId).catch(() => {});

      return {
        chatId,
        messageCount: messages.length,
        attribution,
        messages: messagesSummary,
      };
    } catch (err: any) {
      log.error({ userAccountId, chatId, err: err.message }, 'Debug attribution failed');
      await destroySession(userAccountId).catch(() => {});
      return reply.code(500).send({ error: err.message });
    }
  });
}
