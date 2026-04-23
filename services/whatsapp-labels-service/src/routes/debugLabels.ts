import { FastifyInstance } from 'fastify';
import { initSession, destroySession } from '../lib/sessionManager.js';

export function registerDebugLabelsRoutes(app: FastifyInstance): void {
  app.get<{ Params: { userAccountId: string; labelId: string } }>(
    '/debug/labels/:userAccountId/:labelId',
    async (request, reply) => {
      const { userAccountId, labelId } = request.params;

      let session;
      try {
        session = await initSession(userAccountId);
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }

      if (!session.ready) {
        await destroySession(userAccountId);
        return reply.code(400).send({ error: 'Session not ready' });
      }

      try {
        await new Promise(r => setTimeout(r, 3000));
        const chats = await session.client.getChatsByLabelId(labelId);
        const list = chats.map((c: any) => ({
          chatId: c.id._serialized,
          name: c.name,
        }));
        await destroySession(userAccountId);
        return { labelId, count: list.length, chats: list };
      } catch (err: any) {
        await destroySession(userAccountId);
        return reply.code(500).send({ error: err.message });
      }
    }
  );
}
