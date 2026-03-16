import { FastifyInstance } from 'fastify';
import { runLabelSync, syncSingleAccount } from '../lib/labelSync.js';

export function registerSyncRoutes(app: FastifyInstance): void {
  /**
   * Manually trigger label sync for all accounts.
   * POST /sync
   */
  app.post('/sync', async () => {
    // Run async — don't block the request
    runLabelSync().catch(() => {});
    return { status: 'started' };
  });

  /**
   * Manually trigger label sync for a single account.
   * POST /sync/:userAccountId
   */
  app.post<{ Params: { userAccountId: string } }>('/sync/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;

    try {
      const result = await syncSingleAccount(userAccountId);
      return result;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
