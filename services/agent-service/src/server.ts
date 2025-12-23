import fastify from 'fastify';
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
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
import amocrmManagementRoutes from './routes/amocrmManagement.js';
import bitrix24OAuthRoutes from './routes/bitrix24OAuth.js';
import bitrix24PipelinesRoutes from './routes/bitrix24Pipelines.js';
import bitrix24WebhooksRoutes from './routes/bitrix24Webhooks.js';
import leadsRoutes from './routes/leads.js';
import { briefingRoutes } from './routes/briefingRoutes.js';
import { carouselCreativeRoutes } from './routes/carouselCreative.js';
import { autopilotRoutes } from './routes/autopilot.js';
import competitorsRoutes from './routes/competitors.js';
import adAccountsRoutes from './routes/adAccounts.js';
import analyticsRoutes from './routes/analytics.js';
import onboardingRoutes from './routes/onboarding.js';
import notificationsRoutes from './routes/notifications.js';
import impersonationRoutes from './routes/impersonation.js';
import telegramWebhook from './routes/telegramWebhook.js';
import adminChatRoutes from './routes/adminChat.js';
import adminStatsRoutes from './routes/adminStats.js';
import adminUsersRoutes from './routes/adminUsers.js';
import adminAdsRoutes from './routes/adminAds.js';
import adminLeadsRoutes from './routes/adminLeads.js';
import adminErrorsRoutes from './routes/adminErrors.js';
import adminNotificationsRoutes from './routes/adminNotifications.js';
import adminSettingsRoutes from './routes/adminSettings.js';
import adInsightsRoutes from './routes/adInsights.js';
import { requireTechAdmin } from './middleware/adminAuth.js';
import { startCreativeTestCron } from './cron/creativeTestChecker.js';
import { startCompetitorCrawlerCron } from './cron/competitorCrawler.js';
import { startWhatsAppMonitorCron } from './cron/whatsappMonitorCron.js';
import { startUserScoringCron } from './cron/userScoringCron.js';
import { startEngagementNotificationCron } from './cron/engagementNotificationCron.js';
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

// SECURITY: CORS whitelist - разрешаем только известные домены
const ALLOWED_ORIGINS = [
  // Production
  'https://app.performanteaiagency.com',
  'https://performanteaiagency.com',
  'https://www.performanteaiagency.com',
  'https://agents.performanteaiagency.com',
  'https://crm.performanteaiagency.com',
  'https://brain2.performanteaiagency.com',
  // Development
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:7080'
];

app.register(cors, {
  origin: (origin, cb) => {
    // Разрешаем запросы без origin (server-to-server, curl, etc)
    if (!origin) {
      cb(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      app.log.warn({ origin }, 'CORS: blocked request from unknown origin');
      cb(new Error('CORS: origin not allowed'), false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id"]
});
// Поддержка application/x-www-form-urlencoded (для Tilda webhook)
app.register(formbody);
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
app.register(amocrmManagementRoutes);
app.register(bitrix24OAuthRoutes);
app.register(bitrix24PipelinesRoutes);
app.register(bitrix24WebhooksRoutes);
app.register(leadsRoutes);
app.register(briefingRoutes, { prefix: '/briefing' });
app.register(carouselCreativeRoutes);
app.register(autopilotRoutes);
app.register(competitorsRoutes);
app.register(adAccountsRoutes);
app.register(analyticsRoutes);
app.register(onboardingRoutes);
app.register(notificationsRoutes);
app.register(impersonationRoutes);
app.register(telegramWebhook);

// SECURITY: Admin routes с обязательной проверкой is_tech_admin
app.register(async (adminApp) => {
  // Применяем middleware ко всем роутам в этом контексте
  adminApp.addHook('preHandler', requireTechAdmin);

  adminApp.register(adminChatRoutes);
  adminApp.register(adminStatsRoutes);
  adminApp.register(adminUsersRoutes);
  adminApp.register(adminAdsRoutes);
  adminApp.register(adminLeadsRoutes);
  adminApp.register(adminErrorsRoutes);
  adminApp.register(adminNotificationsRoutes);
  adminApp.register(adminSettingsRoutes);
  adminApp.register(adInsightsRoutes);
});

// Запускаем cron для проверки тестов креативов (каждые 5 минут)
startCreativeTestCron(app as any);

// Запускаем cron для мониторинга WhatsApp инстансов (каждые 5 минут)
startWhatsAppMonitorCron(app as any);

// Запускаем cron для сбора креативов конкурентов (раз в неделю)
startCompetitorCrawlerCron(app as any);

// Запускаем cron для ежедневного скоринга пользователей (в 03:00)
startUserScoringCron(app as any);

// Запускаем cron для engagement уведомлений (в 10:00 по Алматы)
startEngagementNotificationCron(app as any);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
