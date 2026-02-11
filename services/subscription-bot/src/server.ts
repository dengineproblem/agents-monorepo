import fastify from 'fastify';
import { config } from './config.js';
import { createLogger } from './lib/logger.js';
import healthRoutes from './routes/health.js';
import robokassaRoutes from './routes/robokassa.js';

const logger = createLogger({ module: 'server' });

export async function startServer() {
  const app = fastify({
    logger: false,
  });

  await app.register(healthRoutes);
  await app.register(robokassaRoutes);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'Fastify HTTP server started');

  return app;
}
