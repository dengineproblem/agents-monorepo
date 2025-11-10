import fastify from 'fastify';
import cors from "@fastify/cors";
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import chatbotRoutes from './routes/chatbot.js';
import documentsRoutes from './routes/documents.js';
import reactivationRoutes from './routes/reactivation.js';
import { campaignRoutes } from './routes/campaign.js';
import { startReactivationCron } from './cron/reactivationCron.js';
import { startCampaignCron } from './cron/campaignCron.js';
import { startReactivationWorker } from './workers/reactivationWorker.js';
import pino from 'pino';

// Load env from Docker path or local path
dotenv.config({ path: '/root/.env.chatbot' });
dotenv.config({ path: '../../.env.chatbot' });
dotenv.config({ path: '.env' });

const environment = process.env.NODE_ENV || 'development';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: environment === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
});

const app = fastify({
  logger: logger.child({ environment, service: 'chatbot-service' }),
  genReqId: () => randomUUID()
});

app.addHook('onRequest', (request, _reply, done) => {
  request.log = logger.child({ requestId: request.id });
  done();
});

const PORT = Number(process.env.PORT || 8083);

// Health check
app.get('/health', async () => ({ 
  ok: true, 
  service: 'chatbot-service',
  timestamp: new Date().toISOString()
}));

// CORS
app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});

// Routes
app.register(chatbotRoutes);
app.register(documentsRoutes);
app.register(reactivationRoutes);
app.register(campaignRoutes);

// Internal API endpoint for processing messages from agent-service
app.post('/process-message', async (request, reply) => {
  try {
    const { contactPhone, instanceName, messageText } = request.body as {
      contactPhone: string;
      instanceName: string;
      messageText: string;
    };

    if (!contactPhone || !instanceName || !messageText) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    // Динамический импорт для избежания циркулярных зависимостей
    const { collectMessages, shouldBotRespond } = await import('./lib/chatbotEngine.js');
    const { supabase } = await import('./lib/supabase.js');

    // Получить информацию о лиде
    const { data: lead } = await supabase
      .from('dialog_analysis')
      .select('*')
      .eq('contact_phone', contactPhone)
      .eq('instance_name', instanceName)
      .maybeSingle();

    if (!lead) {
      app.log.debug({ contactPhone, instanceName }, 'Lead not found for bot response');
      return reply.send({ success: false, reason: 'lead_not_found' });
    }

    // Проверить, должен ли бот ответить
    if (!shouldBotRespond(lead)) {
      app.log.debug({ contactPhone, leadId: lead.id }, 'Bot should not respond');
      return reply.send({ success: false, reason: 'bot_disabled' });
    }

    // Склеить сообщения (задержка 5 сек)
    // @ts-ignore
    await collectMessages(contactPhone, instanceName, messageText, app);

    return reply.send({ success: true });
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error processing message');
    return reply.status(500).send({ error: error.message });
  }
});

// Запускаем cron для реанимационных рассылок (ежедневно в 00:00)
// @ts-ignore
startReactivationCron();

// Запускаем cron для campaign queue (ежедневно в 9:00)
// @ts-ignore
startCampaignCron();

// Запускаем worker для отправки реанимационных сообщений (каждую минуту)
// @ts-ignore - Type mismatch between fastify and pino logger
startReactivationWorker(app);

app.listen({ host: '0.0.0.0', port: PORT }).then(() => {
  console.log(`🤖 Chatbot Service listening on http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
}).catch((e) => {
  app.log.error(e);
  process.exit(1);
});

