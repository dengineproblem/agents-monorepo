import { FastifyInstance } from 'fastify';
import { initSession, destroySession } from '../lib/sessionManager.js';
import { extractAdAttribution } from '../lib/adAttribution.js';
import { updateLeadAttribution } from '../lib/leadAttributionUpdater.js';

export function registerDebugBackfillLeadRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { userAccountId: string; contactPhone: string };
    Querystring: { instanceName?: string };
  }>(
    '/debug/backfill-lead/:userAccountId/:contactPhone',
    async (request, reply) => {
      const { userAccountId, contactPhone } = request.params;
      const instanceName = request.query.instanceName;

      if (!instanceName) {
        return reply.code(400).send({ error: 'instanceName query param required' });
      }

      let session;
      try {
        session = await initSession(userAccountId);
      } catch (err: any) {
        return reply.code(500).send({ error: `initSession: ${err.message}` });
      }

      if (!session.ready) {
        await destroySession(userAccountId);
        return reply.code(400).send({ error: 'Session not ready' });
      }

      try {
        await new Promise(r => setTimeout(r, 5000));

        const candidates = [
          `${contactPhone}@c.us`,
          `${contactPhone}@s.whatsapp.net`,
        ];

        let chat: any = null;
        for (const id of candidates) {
          try {
            chat = await session.client.getChatById(id);
            if (chat) break;
          } catch {
            // try next
          }
        }

        if (!chat) {
          // Fallback: scan all chats and match by resolved phone
          const chats = await session.client.getChats();
          for (const c of chats) {
            if (c.isGroup) continue;
            if (c.id._serialized.includes('@lid')) {
              try {
                const contact = await c.getContact();
                const number = contact?.number || contact?.id?.user;
                if (number === contactPhone) {
                  chat = c;
                  break;
                }
              } catch {}
            }
          }
        }

        if (!chat) {
          await destroySession(userAccountId);
          return reply.code(404).send({ error: 'Chat not found' });
        }

        const messages = await chat.fetchMessages({ limit: 30 });
        const incoming = messages
          .filter((m: any) => !m.fromMe)
          .sort((a: any, b: any) => a.timestamp - b.timestamp);

        const attribution = extractAdAttribution(incoming);

        if (attribution.pattern === 'none') {
          // Для full_miss с рекламы — считаем unattributed чтобы всё равно создать лид
          attribution.pattern = 'unattributed';
        }

        await updateLeadAttribution(contactPhone, userAccountId, instanceName, attribution);

        await destroySession(userAccountId);
        return {
          contactPhone,
          userAccountId,
          instanceName,
          chatId: chat.id._serialized,
          messageCount: incoming.length,
          attribution,
        };
      } catch (err: any) {
        await destroySession(userAccountId);
        return reply.code(500).send({ error: err.message });
      }
    }
  );
}
