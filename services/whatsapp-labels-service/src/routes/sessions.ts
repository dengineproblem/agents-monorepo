import { FastifyInstance } from 'fastify';
import { initSession, destroySession, getSession, getAllSessions } from '../lib/sessionManager.js';

export function registerSessionRoutes(app: FastifyInstance): void {
  /**
   * List all active sessions.
   */
  app.get('/sessions', async () => {
    const sessions = getAllSessions();
    return Array.from(sessions.entries()).map(([id, s]) => ({
      userAccountId: id,
      ready: s.ready,
      hasQr: !!s.qrCode,
    }));
  });

  /**
   * Get labels available in a connected session.
   * GET /sessions/:userAccountId/labels
   */
  app.get<{ Params: { userAccountId: string } }>('/sessions/:userAccountId/labels', async (request, reply) => {
    const { userAccountId } = request.params;

    let session = getSession(userAccountId);
    if (!session?.ready) {
      // Try to init
      try {
        session = await initSession(userAccountId);
      } catch {
        return reply.code(400).send({ error: 'Session not available' });
      }
    }

    if (!session.ready) {
      return reply.code(400).send({ error: 'Session not ready' });
    }

    try {
      const labels = await session.client.getLabels();
      const result = labels.map((l: any) => ({
        id: l.id,
        name: l.name,
        hexColor: l.hexColor,
      }));

      // Destroy after fetching labels
      await destroySession(userAccountId);

      return result;
    } catch (err: any) {
      await destroySession(userAccountId);
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * Disconnect and remove a session.
   * DELETE /sessions/:userAccountId
   */
  app.delete<{ Params: { userAccountId: string } }>('/sessions/:userAccountId', async (request) => {
    const { userAccountId } = request.params;
    await destroySession(userAccountId);
    return { status: 'destroyed' };
  });
}
