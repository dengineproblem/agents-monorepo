import { FastifyInstance } from 'fastify';
import { getAllSessions } from '../lib/sessionManager.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    const sessions = getAllSessions();
    return {
      status: 'ok',
      activeSessions: sessions.size,
      sessions: Array.from(sessions.entries()).map(([id, s]) => ({
        userAccountId: id,
        ready: s.ready,
        hasQr: !!s.qrCode,
      })),
    };
  });
}
