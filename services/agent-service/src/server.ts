import fastify from 'fastify';
import cors from "@fastify/cors";
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { actionsRoutes } from './routes/actions.js';
import { videoRoutes } from './routes/video.js';
import { imageRoutes } from './routes/image.js';
import { creativeTestRoutes } from './routes/creativeTest.js';
import { campaignBuilderRoutes } from './routes/campaignBuilder.js';
import { directionsRoutes } from './routes/directions.js';
import { defaultSettingsRoutes } from './routes/defaultSettings.js';
import facebookWebhooks from './routes/facebookWebhooks.js';
import { startCreativeTestCron } from './cron/creativeTestChecker.js';
import { logger as baseLogger } from './lib/logger.js';

// Load env from Docker path or local path
dotenv.config({ path: '/root/.env.agent' });
dotenv.config({ path: '../../.env.agent' });

const environment = process.env.NODE_ENV || 'development';

const app = fastify({
  logger: baseLogger.child({ environment, service: 'agent-service' }),
  genReqId: () => randomUUID()
});

app.addHook('onRequest', (request, _reply, done) => {
  request.log = baseLogger.child({ requestId: request.id });
  done();
});

const PORT = Number(process.env.PORT || 8082);

app.get('/health', async () => ({ ok: true }));
app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});
app.register(actionsRoutes);
app.register(videoRoutes);
app.register(imageRoutes);
app.register(creativeTestRoutes);
app.register(campaignBuilderRoutes, { prefix: '/api/campaign-builder' });
app.register(directionsRoutes);
app.register(defaultSettingsRoutes);
app.register(facebookWebhooks); // Без префикса - nginx уже убирает /api

// Запускаем cron для проверки тестов креативов (каждые 5 минут)
startCreativeTestCron(app as any);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
