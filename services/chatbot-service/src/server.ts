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
import { startKeyStageTransitionCron } from './cron/keyStageTransitionCron.js';
import { startLeadSnapshotCron } from './cron/leadSnapshotCron.js';
import { startReactivationWorker } from './workers/reactivationWorker.js';
import { startCampaignWorker } from './workers/campaignWorker.js';
import { startDelayedFollowUpWorker } from './workers/delayedFollowUpWorker.js';
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

// Test bot endpoint - для тестирования бота без WhatsApp
app.post('/test-message', async (request, reply) => {
  try {
    const { botId, messageText, conversationHistory = [] } = request.body as {
      botId: string;
      messageText: string;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!botId || !messageText) {
      return reply.status(400).send({ error: 'Missing required fields: botId, messageText' });
    }

    const { testBotResponse } = await import('./lib/aiBotEngine.js');

    const result = await testBotResponse(botId, messageText, conversationHistory);

    return reply.send(result);
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error in test message');
    return reply.status(500).send({ error: error.message });
  }
});

// Internal API endpoint for processing messages from agent-service
app.post('/process-message', async (request, reply) => {
  try {
    const { contactPhone, instanceName, messageText, messageType = 'text' } = request.body as {
      contactPhone: string;
      instanceName: string;
      messageText: string;
      messageType?: 'text' | 'image' | 'audio' | 'document' | 'file';
    };

    // Для аудио сообщений messageText может быть пустым (если транскрипция не удалась)
    if (!contactPhone || !instanceName) {
      return reply.status(400).send({ error: 'Missing required fields: contactPhone, instanceName' });
    }
    if (!messageText && messageType !== 'audio') {
      return reply.status(400).send({ error: 'Missing messageText for non-audio message' });
    }

    // Импорт движков
    const { collectMessages, shouldBotRespond } = await import('./lib/chatbotEngine.js');
    const { processIncomingMessage, getBotConfigForInstance } = await import('./lib/aiBotEngine.js');
    const { supabase } = await import('./lib/supabase.js');
    const { markCampaignReply } = await import('./lib/campaignAnalytics.js');
    const { getDialogForCapi, processDialogForCapi } = await import('./lib/qualificationAgent.js');

    // Проверить, есть ли бот из конструктора для этого инстанса
    const botConfig = await getBotConfigForInstance(instanceName);

    if (botConfig) {
      // Использовать новый движок AI-ботов из конструктора
      app.log.info({ instanceName, botId: botConfig.id, botName: botConfig.name }, 'Using AI bot from constructor');

      const result = await processIncomingMessage(
        contactPhone,
        instanceName,
        messageText,
        messageType,
        app
      );

      // Mark reply on campaign message if applicable
      const { data: lead } = await supabase
        .from('dialog_analysis')
        .select('id')
        .eq('contact_phone', contactPhone)
        .eq('instance_name', instanceName)
        .maybeSingle();

      if (lead) {
        await markCampaignReply(lead.id);
      }

      // Запустить CAPI анализ в фоне (не блокирует ответ)
      // Using Promise.resolve().then() for proper error handling
      Promise.resolve().then(async () => {
        const dialogData = await getDialogForCapi(instanceName, contactPhone);
        if (dialogData) {
          await processDialogForCapi(dialogData);
        }
      }).catch((capiError: Error) => {
        app.log.error({
          error: capiError.message,
          stack: capiError.stack,
          contactPhone,
          instanceName
        }, 'Error in CAPI qualification processing (AI bot)');
      });

      return reply.send({ success: result.processed, reason: result.reason });
    }

    // Fallback на старый движок chatbotEngine
    app.log.debug({ instanceName }, 'No AI bot config, using legacy engine');

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

    // Mark reply on campaign message if applicable
    await markCampaignReply(lead.id);

    // Проверить, должен ли бот ответить
    if (!shouldBotRespond(lead)) {
      app.log.debug({ contactPhone, leadId: lead.id }, 'Bot should not respond');
      return reply.send({ success: false, reason: 'bot_disabled' });
    }

    // Склеить сообщения (задержка 5 сек)
    // @ts-ignore
    await collectMessages(contactPhone, instanceName, messageText, app);

    // Запустить LLM-агент квалификации в фоне (не блокирует ответ бота)
    // Анализирует диалог и отправляет CAPI события если нужно
    // Using Promise.resolve().then() for proper error handling
    Promise.resolve().then(async () => {
      const dialogData = await getDialogForCapi(instanceName, contactPhone);
      if (dialogData) {
        await processDialogForCapi(dialogData);
      }
    }).catch((capiError: Error) => {
      app.log.error({
        error: capiError.message,
        stack: capiError.stack,
        contactPhone,
        instanceName
      }, 'Error in CAPI qualification processing (legacy)');
    });

    return reply.send({ success: true });
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error processing message');
    return reply.status(500).send({ error: error.message });
  }
});

// Force resend CAPI events (for debugging/recovery)
app.post('/capi/resend', async (request, reply) => {
  try {
    const { direction_id, dialog_ids, event_levels } = request.body as {
      direction_id?: string;
      dialog_ids?: string[];
      event_levels?: number[]; // 1, 2, 3
    };

    if (!direction_id && !dialog_ids?.length) {
      return reply.status(400).send({ error: 'Either direction_id or dialog_ids required' });
    }

    const levels = event_levels || [1, 2, 3];
    const { sendCapiEvent, getDirectionPixelInfo, CAPI_EVENTS } = await import('./lib/metaCapiClient.js');
    const { supabase } = await import('./lib/supabase.js');

    // Get dialogs to resend
    let query = supabase
      .from('dialog_analysis')
      .select('id, user_account_id, contact_phone, ctwa_clid, direction_id, capi_interest_sent, capi_qualified_sent, capi_scheduled_sent')
      .not('direction_id', 'is', null);

    if (dialog_ids?.length) {
      query = query.in('id', dialog_ids);
    } else if (direction_id) {
      query = query.eq('direction_id', direction_id);
    }

    const { data: dialogs, error } = await query;

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    if (!dialogs?.length) {
      return reply.send({ success: true, message: 'No dialogs found', sent: 0 });
    }

    app.log.info({ count: dialogs.length, levels }, 'Force resending CAPI events');

    const results: Array<{ dialogId: string; level: number; success: boolean; error?: string }> = [];

    for (const dialog of dialogs) {
      // Get pixel info for this direction
      const { pixelId, accessToken } = await getDirectionPixelInfo(dialog.direction_id!);

      if (!pixelId || !accessToken) {
        results.push({ dialogId: dialog.id, level: 0, success: false, error: 'No pixel or token' });
        continue;
      }

      // Send events for requested levels
      for (const level of levels) {
        const eventName = level === 1 ? CAPI_EVENTS.INTEREST
          : level === 2 ? CAPI_EVENTS.QUALIFIED
          : CAPI_EVENTS.SCHEDULED;

        const response = await sendCapiEvent({
          pixelId,
          accessToken,
          eventName,
          eventLevel: level as 1 | 2 | 3,
          phone: dialog.contact_phone,
          ctwaClid: dialog.ctwa_clid,
          dialogAnalysisId: dialog.id,
          userAccountId: dialog.user_account_id,
          directionId: dialog.direction_id,
        });

        results.push({
          dialogId: dialog.id,
          level,
          success: response.success,
          error: response.error,
        });

        app.log.info({
          dialogId: dialog.id,
          level,
          eventName,
          success: response.success,
          error: response.error,
        }, 'Force resent CAPI event');
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return reply.send({
      success: true,
      total: results.length,
      successCount,
      failCount,
      results,
    });
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error force resending CAPI');
    return reply.status(500).send({ error: error.message });
  }
});

// Запускаем cron для реанимационных рассылок (ежедневно в 00:00)
// @ts-ignore
startReactivationCron();

// Запускаем cron для campaign queue (ежедневно в 9:00)
// @ts-ignore
startCampaignCron();

// Запускаем cron для автоматического перехода с ключевых этапов (ежедневно в 3:00)
// @ts-ignore
startKeyStageTransitionCron();

// Запускаем cron для ежедневных снимков лидов (ежедневно в 23:55)
// @ts-ignore
startLeadSnapshotCron();

// Запускаем worker для отправки реанимационных сообщений (каждую минуту)
// @ts-ignore - Type mismatch between fastify and pino logger
startReactivationWorker(app);

// Запускаем worker для автоматической отправки campaign сообщений (каждые 5 минут)
// @ts-ignore
startCampaignWorker();

// Запускаем worker для отложенных follow-up сообщений (каждую минуту)
// @ts-ignore
startDelayedFollowUpWorker();

app.listen({ host: '0.0.0.0', port: PORT }).then(() => {
  console.log(`🤖 Chatbot Service listening on http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
}).catch((e) => {
  app.log.error(e);
  process.exit(1);
});

