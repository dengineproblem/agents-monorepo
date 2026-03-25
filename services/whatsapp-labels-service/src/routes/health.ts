import { FastifyInstance } from 'fastify';
import { getAllSessions, checkSessionAlive } from '../lib/sessionManager.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    const sessions = getAllSessions();
    const sessionDetails = [];

    for (const [id, s] of sessions.entries()) {
      let waState = 'UNKNOWN';
      if (s.ready) {
        const check = await checkSessionAlive(id);
        waState = check.state;
      }
      sessionDetails.push({
        userAccountId: id,
        ready: s.ready,
        waState,
        hasQr: !!s.qrCode,
      });
    }

    return {
      status: 'ok',
      activeSessions: sessions.size,
      sessions: sessionDetails,
    };
  });
}
