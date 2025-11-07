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
import directionAdSetsRoutes from './routes/directionAdSets.js';
import { defaultSettingsRoutes } from './routes/defaultSettings.js';
import { dialogsRoutes } from './routes/dialogs.js';
import whatsappNumbersRoutes from './routes/whatsappNumbers.js';
import facebookWebhooks from './routes/facebookWebhooks.js';
import tiktokOAuthRoutes from './routes/tiktokOAuth.js';
import evolutionWebhooks from './routes/evolutionWebhooks.js';
import greenApiWebhooks from './routes/greenApiWebhooks.js';
import bizonWebhooks from './routes/bizonWebhooks.js';
import whatsappInstances from './routes/whatsappInstances.js';
import amocrmOAuthRoutes from './routes/amocrmOAuth.js';
import amocrmWebhooks from './routes/amocrmWebhooks.js';
import amocrmSecretsRoutes from './routes/amocrmSecrets.js';
import amocrmConnectRoutes from './routes/amocrmConnect.js';
import amocrmPipelinesRoutes from './routes/amocrmPipelines.js';
import leadsRoutes from './routes/leads.js';
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
// ВАЖНО: НЕ ДОБАВЛЯЙТЕ prefix: '/api' - nginx убирает /api перед проксированием!
// См. nginx-production.conf: rewrite ^/api/(.*)$ /$1 break;
app.register(actionsRoutes);
app.register(videoRoutes);
app.register(imageRoutes);
app.register(creativeTestRoutes);
app.register(campaignBuilderRoutes, { prefix: '/campaign-builder' });
app.register(directionsRoutes);
app.register(directionAdSetsRoutes);
app.register(defaultSettingsRoutes);
app.register(dialogsRoutes);
app.register(whatsappNumbersRoutes);
app.register(facebookWebhooks);
app.register(tiktokOAuthRoutes);
app.register(evolutionWebhooks);
app.register(greenApiWebhooks);
app.register(bizonWebhooks);
app.register(whatsappInstances);
app.register(amocrmOAuthRoutes);
app.register(amocrmWebhooks);
app.register(amocrmSecretsRoutes);
app.register(amocrmConnectRoutes);
app.register(amocrmPipelinesRoutes);
app.register(leadsRoutes);

// Запускаем cron для проверки тестов креативов (каждые 5 минут)
startCreativeTestCron(app as any);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
