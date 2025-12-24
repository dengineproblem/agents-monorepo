import fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { dialogsRoutes } from './routes/dialogs.js';
import { templatesRoutes } from './routes/templates.js';
import { campaignSettingsRoutes } from './routes/campaignSettings.js';
import { businessProfileRoutes } from './routes/businessProfile.js';
import { campaignContextsRoutes } from './routes/campaignContexts.js';
import { conversationReportsRoutes } from './routes/conversationReports.js';
import { aiBotConfigurationsRoutes } from './routes/aiBotConfigurations.js';
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

// Register multipart for file uploads (audio transcription)
app.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB (Whisper API limit)
  }
});

// ВАЖНО: НЕ ДОБАВЛЯЙТЕ prefix: '/api' - nginx убирает /api перед проксированием!
// См. nginx-production.conf: rewrite ^/api/crm/(.*)$ /$1 break;
app.register(dialogsRoutes);
app.register(templatesRoutes);
app.register(campaignSettingsRoutes);
app.register(businessProfileRoutes);
app.register(campaignContextsRoutes);
app.register(conversationReportsRoutes);
app.register(aiBotConfigurationsRoutes);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});


