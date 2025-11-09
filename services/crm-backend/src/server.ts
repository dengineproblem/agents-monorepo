import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { dialogsRoutes } from './routes/dialogs.js';
import { logger } from './lib/logger.js';

dotenv.config();

const PORT = Number(process.env.PORT || 8084);

const app = fastify({
  logger: logger.child({ service: 'crm-backend' }),
  genReqId: () => randomUUID()
});

app.get('/health', async () => ({ ok: true, service: 'crm-backend' }));

app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// ВАЖНО: НЕ ДОБАВЛЯЙТЕ prefix: '/api' - nginx убирает /api перед проксированием!
// См. nginx-production.conf: rewrite ^/api/crm/(.*)$ /$1 break;
app.register(dialogsRoutes);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});

