import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok', service: 'subscription-bot' };
  });
}
