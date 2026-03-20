import { FastifyInstance } from 'fastify';
import { runQualificationSync, qualifyAccountDialogs } from '../lib/qualificationSync.js';

export function registerQualificationRoutes(app: FastifyInstance): void {
  /**
   * Trigger qualification sync for all accounts.
   * POST /qualification
   */
  app.post('/qualification', async () => {
    runQualificationSync().catch(() => {});
    return { status: 'started' };
  });

  /**
   * Trigger qualification for a single account.
   * POST /qualification/:userAccountId
   */
  app.post<{ Params: { userAccountId: string } }>('/qualification/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;

    try {
      const result = await qualifyAccountDialogs(userAccountId);
      return result;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
