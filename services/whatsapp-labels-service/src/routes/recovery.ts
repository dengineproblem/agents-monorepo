import { FastifyInstance } from 'fastify';
import { runMissedMessagesRecovery, recoverSingleAccount } from '../lib/missedMessages.js';

export function registerRecoveryRoutes(app: FastifyInstance): void {
  /**
   * Trigger missed messages recovery for all accounts.
   * POST /recovery
   */
  app.post('/recovery', async () => {
    // Run async — don't block the request
    runMissedMessagesRecovery().catch(() => {});
    return { status: 'started' };
  });

  /**
   * Trigger missed messages recovery for a single account.
   * POST /recovery/:userAccountId
   */
  app.post<{ Params: { userAccountId: string } }>('/recovery/:userAccountId', async (request, reply) => {
    const { userAccountId } = request.params;

    try {
      const result = await recoverSingleAccount(userAccountId);
      return result;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
