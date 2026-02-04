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
import { consultationsRoutes } from './routes/consultations.js';
import { consultationNotificationsRoutes } from './routes/consultationNotifications.js';
import { consultationServicesRoutes } from './routes/consultationServices.js';
import { publicBookingRoutes } from './routes/publicBooking.js';
import { aiBotConfigurationsRoutes } from './routes/aiBotConfigurations.js';
import { chatsRoutes } from './routes/chats.js';
import { consultantsManagementRoutes } from './routes/consultantsManagement.js';
import { consultantDashboardRoutes } from './routes/consultantDashboard.js';
import { consultantMessagesRoutes } from './routes/consultantMessages.js';
import { adminConsultantManagementRoutes } from './routes/adminConsultantManagement.js';
import { consultantSalesRoutes } from './routes/consultantSales.js';
import { consultantTasksRoutes } from './routes/consultantTasks.js';
import { subscriptionBillingRoutes } from './routes/subscriptionBilling.js';
import { startNotificationCron } from './cron/notificationCron.js';
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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
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
app.register(consultationsRoutes);
app.register(consultationNotificationsRoutes);
app.register(consultationServicesRoutes);
app.register(publicBookingRoutes);
app.register(aiBotConfigurationsRoutes);
app.register(chatsRoutes);
app.register(consultantsManagementRoutes);
app.register(consultantDashboardRoutes);
app.register(consultantMessagesRoutes);
app.register(adminConsultantManagementRoutes);
app.register(consultantSalesRoutes);
app.register(consultantTasksRoutes);
app.register(subscriptionBillingRoutes);

// Start notification cron job
startNotificationCron();

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
