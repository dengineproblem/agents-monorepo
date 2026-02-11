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
import { startCapiAnalysisCron, triggerCapiAnalysisCron } from './cron/capiAnalysisCron.js';
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
    // CAPI Level 2-3 анализ через cron (capiAnalysisCron.ts), импорт не нужен здесь

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

      // CAPI Level 2-3 анализ теперь через cron (capiAnalysisCron.ts)
      // Реактивный вызов убран для экономии токенов

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

    // CAPI Level 2-3 анализ теперь через cron (capiAnalysisCron.ts)
    // Реактивный вызов убран для экономии токенов

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
      const { pixelId, accessToken, pageId } = await getDirectionPixelInfo(dialog.direction_id!);

      if (!pixelId || !accessToken) {
        results.push({ dialogId: dialog.id, level: 0, success: false, error: 'No pixel or token' });
        continue;
      }

      // Send events for requested levels (resend = admin override, no capiEventLevel filter)
      for (const level of levels) {
        const eventName = CAPI_EVENTS.LEAD;

        const { data: leadRecord } = await supabase
          .from('leads')
          .select('id')
          .eq('chat_id', dialog.contact_phone)
          .eq('user_account_id', dialog.user_account_id)
          .maybeSingle();

        const response = await sendCapiEvent({
          pixelId,
          accessToken,
          eventName,
          eventLevel: level as 1 | 2 | 3,
          phone: dialog.contact_phone,
          ctwaClid: dialog.ctwa_clid,
          pageId: pageId || undefined,
          dialogAnalysisId: dialog.id,
          leadId: leadRecord?.id,
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

function buildPhoneCandidates(rawPhone: string): string[] {
  const normalized = rawPhone.trim();
  const withoutSuffix = normalized
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '');
  const digits = withoutSuffix.replace(/\D/g, '');

  const candidates = new Set<string>();
  if (normalized) candidates.add(normalized);
  if (withoutSuffix) candidates.add(withoutSuffix);

  if (digits) {
    candidates.add(digits);
    candidates.add(`+${digits}`);
    candidates.add(`${digits}@s.whatsapp.net`);
    candidates.add(`${digits}@c.us`);
  }

  if (digits.length === 11 && digits.startsWith('8')) {
    const alt = `7${digits.slice(1)}`;
    candidates.add(alt);
    candidates.add(`+${alt}`);
    candidates.add(`${alt}@s.whatsapp.net`);
    candidates.add(`${alt}@c.us`);
  }

  if (digits.length === 11 && digits.startsWith('7')) {
    const alt = `8${digits.slice(1)}`;
    candidates.add(alt);
    candidates.add(`+${alt}`);
  }

  return [...candidates];
}

// CRM-triggered CAPI events (near-real-time from Amo/Bitrix webhooks)
app.post('/capi/crm-event', async (request, reply) => {
  const correlationId = (request.headers['x-correlation-id'] as string) || randomUUID();
  const startTime = Date.now();

  try {
    const { userAccountId, directionId, contactPhone, crmType, levels } = request.body as {
      userAccountId: string;
      directionId: string;
      contactPhone: string;
      crmType: 'amocrm' | 'bitrix24';
      levels: {
        interest?: boolean;
        qualified?: boolean;
        scheduled?: boolean;
      };
    };

    if (!userAccountId || !directionId || !contactPhone || !crmType || !levels) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required fields: userAccountId, directionId, contactPhone, crmType, levels',
        correlationId
      });
    }

    const requestedLevels: Array<{ level: 1 | 2 | 3; key: 'interest' | 'qualified' | 'scheduled' }> = [];
    if (levels.scheduled) requestedLevels.push({ level: 3, key: 'scheduled' });
    if (levels.qualified) requestedLevels.push({ level: 2, key: 'qualified' });
    if (levels.interest) requestedLevels.push({ level: 1, key: 'interest' });

    if (requestedLevels.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'At least one level must be true',
        correlationId
      });
    }

    const { getDirectionPixelInfo, sendCapiEventAtomic, CAPI_EVENTS } = await import('./lib/metaCapiClient.js');
    const { supabase } = await import('./lib/supabase.js');

    const { data: directionSettings, error: directionError } = await supabase
      .from('account_directions')
      .select('id, capi_enabled, capi_source, capi_crm_type')
      .eq('id', directionId)
      .eq('user_account_id', userAccountId)
      .maybeSingle();

    if (directionError || !directionSettings) {
      return reply.status(404).send({
        success: false,
        error: 'Direction not found for user account',
        correlationId
      });
    }

    if (!directionSettings.capi_enabled) {
      return reply.status(409).send({
        success: false,
        error: 'CAPI is disabled for direction',
        correlationId
      });
    }

    if (directionSettings.capi_source !== 'crm') {
      return reply.status(409).send({
        success: false,
        error: 'Direction capi_source is not crm',
        correlationId
      });
    }

    if (directionSettings.capi_crm_type && directionSettings.capi_crm_type !== crmType) {
      return reply.status(409).send({
        success: false,
        error: `Direction CRM type mismatch: expected ${directionSettings.capi_crm_type}`,
        correlationId
      });
    }

    const pixelInfo = await getDirectionPixelInfo(directionId);
    if (!pixelInfo.pixelId || !pixelInfo.accessToken) {
      return reply.status(400).send({
        success: false,
        error: 'No pixel or access_token configured for direction',
        correlationId
      });
    }

    const { pageId: directionPageId, capiEventLevel } = pixelInfo;

    const phoneCandidates = buildPhoneCandidates(contactPhone);
    const digitsCandidate = phoneCandidates.find((value) => /^\d+$/.test(value)) || contactPhone.replace(/\D/g, '');

    let leadRecord: { id: string | number; chat_id?: string | null; phone?: string | null; ctwa_clid?: string | null } | null = null;
    const { data: leadByChat } = await supabase
      .from('leads')
      .select('id, chat_id, phone, ctwa_clid')
      .eq('user_account_id', userAccountId)
      .eq('direction_id', directionId)
      .in('chat_id', phoneCandidates)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    leadRecord = leadByChat || null;

    if (!leadRecord) {
      const { data: leadByPhone } = await supabase
        .from('leads')
        .select('id, chat_id, phone, ctwa_clid')
        .eq('user_account_id', userAccountId)
        .eq('direction_id', directionId)
        .in('phone', phoneCandidates)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      leadRecord = leadByPhone || null;
    }

    if (!leadRecord && digitsCandidate) {
      const { data: leadByLike } = await supabase
        .from('leads')
        .select('id, chat_id, phone, ctwa_clid')
        .eq('user_account_id', userAccountId)
        .eq('direction_id', directionId)
        .ilike('chat_id', `%${digitsCandidate}%`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      leadRecord = leadByLike || null;
    }

    let dialogRecord: { id: string; contact_phone?: string | null; ctwa_clid?: string | null } | null = null;
    const { data: dialogByDirection } = await supabase
      .from('dialog_analysis')
      .select('id, contact_phone, ctwa_clid')
      .eq('user_account_id', userAccountId)
      .eq('direction_id', directionId)
      .in('contact_phone', phoneCandidates)
      .order('last_message', { ascending: false })
      .limit(1)
      .maybeSingle();

    dialogRecord = dialogByDirection || null;

    if (!dialogRecord && digitsCandidate) {
      const { data: dialogByLike } = await supabase
        .from('dialog_analysis')
        .select('id, contact_phone, ctwa_clid')
        .eq('user_account_id', userAccountId)
        .eq('direction_id', directionId)
        .ilike('contact_phone', `%${digitsCandidate}%`)
        .order('last_message', { ascending: false })
        .limit(1)
        .maybeSingle();
      dialogRecord = dialogByLike || null;
    }

    const resolvedPhone = dialogRecord?.contact_phone
      || (digitsCandidate || contactPhone);

    const ctwaClid = dialogRecord?.ctwa_clid || leadRecord?.ctwa_clid || undefined;
    const leadId = leadRecord?.id ? String(leadRecord.id) : undefined;
    const dialogAnalysisId = dialogRecord?.id;

    const results: Array<{
      level: 1 | 2 | 3;
      eventName: string;
      success: boolean;
      alreadySent: boolean;
      eventId?: string;
      error?: string;
    }> = [];

    for (const requestedLevel of requestedLevels) {
      // Filter by capiEventLevel: if set, only send for that specific level
      if (capiEventLevel !== null && capiEventLevel !== requestedLevel.level) {
        results.push({
          level: requestedLevel.level,
          eventName: CAPI_EVENTS.LEAD,
          success: false,
          alreadySent: false,
          error: `Level ${requestedLevel.level} filtered by capi_event_level=${capiEventLevel}`
        });
        continue;
      }

      const eventName = CAPI_EVENTS.LEAD;

      const response = await sendCapiEventAtomic({
        pixelId: pixelInfo.pixelId,
        accessToken: pixelInfo.accessToken,
        eventName,
        eventLevel: requestedLevel.level,
        phone: resolvedPhone,
        ctwaClid,
        pageId: directionPageId || undefined,
        dialogAnalysisId,
        leadId,
        userAccountId,
        directionId,
        customData: {
          channel: 'crm',
          crm_source: crmType,
          level: requestedLevel.key
        },
        correlationId
      });

      const alreadySent = !response.success && (response.error || '').toLowerCase().includes('already sent');
      results.push({
        level: requestedLevel.level,
        eventName,
        success: response.success,
        alreadySent,
        eventId: response.eventId,
        error: response.error
      });

      if (response.success && dialogAnalysisId) {
        const sourceUpdates: Record<string, string> = {};
        if (requestedLevel.level === 2) sourceUpdates.capi_qualified_source = crmType;
        if (requestedLevel.level === 3) sourceUpdates.capi_scheduled_source = crmType;

        if (Object.keys(sourceUpdates).length > 0) {
          await supabase
            .from('dialog_analysis')
            .update(sourceUpdates)
            .eq('id', dialogAnalysisId);
        }
      }
    }

    const successCount = results.filter((result) => result.success).length;
    const alreadySentCount = results.filter((result) => result.alreadySent).length;
    const hardFailureCount = results.filter((result) => !result.success && !result.alreadySent).length;
    const durationMs = Date.now() - startTime;

    const responsePayload = {
      success: hardFailureCount === 0,
      correlationId,
      resolvedPhone,
      directionId,
      crmType,
      dialogFound: !!dialogRecord,
      leadFound: !!leadRecord,
      successCount,
      alreadySentCount,
      hardFailureCount,
      durationMs,
      results,
    };

    if (hardFailureCount > 0 && successCount === 0 && alreadySentCount === 0) {
      app.log.warn({
        correlationId,
        directionId,
        crmType,
        resolvedPhone,
        results,
        durationMs
      }, 'CRM CAPI event failed');
      return reply.status(502).send(responsePayload);
    }

    app.log.info({
      correlationId,
      directionId,
      crmType,
      resolvedPhone,
      successCount,
      alreadySentCount,
      hardFailureCount,
      durationMs
    }, 'CRM CAPI event processed');

    return reply.send(responsePayload);
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    app.log.error({
      correlationId,
      error: error.message,
      stack: error.stack,
      durationMs
    }, 'Error processing CRM CAPI event');
    return reply.status(500).send({ success: false, error: error.message, correlationId });
  }
});

// Interest (Level 1) событие по счётчику сообщений
// Вызывается из agent-service когда лид достиг порога capi_msg_count
// Qualified и Scheduled отправляются через AI анализ в processDialogForCapi
app.post('/capi/interest-event', async (request, reply) => {
  // Получаем correlationId из header или генерируем новый
  const correlationId = (request.headers['x-correlation-id'] as string) || randomUUID();
  const startTime = Date.now();

  try {
    const { instanceName, contactPhone } = request.body as {
      instanceName: string;
      contactPhone: string;
    };

    if (!instanceName || !contactPhone) {
      return reply.status(400).send({ error: 'Missing required fields: instanceName, contactPhone' });
    }

    app.log.info({
      correlationId,
      instanceName,
      contactPhone,
      action: 'capi_interest_received'
    }, 'Interest CAPI event request received');

    const { getDialogForCapi } = await import('./lib/qualificationAgent.js');
    const { getDirectionPixelInfo, sendCapiEventAtomic, CAPI_EVENTS } = await import('./lib/metaCapiClient.js');
    const { supabase } = await import('./lib/supabase.js');

    const dialog = await getDialogForCapi(instanceName, contactPhone);

    if (!dialog) {
      const durationMs = Date.now() - startTime;
      app.log.warn({ correlationId, instanceName, contactPhone, durationMs, action: 'capi_interest_not_found' }, 'Dialog not found');
      return reply.status(404).send({ error: 'Dialog not found', correlationId });
    }

    if (!dialog.direction_id) {
      const durationMs = Date.now() - startTime;
      app.log.warn({ correlationId, instanceName, contactPhone, durationMs, action: 'capi_interest_no_direction' }, 'No direction_id');
      return reply.status(400).send({ error: 'No direction_id - cannot send CAPI', correlationId });
    }

    // Получить pixel и access_token
    const pixelInfo = await getDirectionPixelInfo(dialog.direction_id);

    if (!pixelInfo.pixelId || !pixelInfo.accessToken) {
      const durationMs = Date.now() - startTime;
      app.log.warn({ correlationId, directionId: dialog.direction_id, durationMs, action: 'capi_interest_no_pixel' }, 'No pixel or access_token');
      return reply.status(400).send({ error: 'No pixel or access_token configured for direction', correlationId });
    }

    // Filter by capiEventLevel: if set and not level 1, skip
    if (pixelInfo.capiEventLevel !== null && pixelInfo.capiEventLevel !== 1) {
      const durationMs = Date.now() - startTime;
      app.log.info({ correlationId, directionId: dialog.direction_id, capiEventLevel: pixelInfo.capiEventLevel, durationMs, action: 'capi_interest_level_filtered' }, 'Interest level filtered by capi_event_level');
      return reply.send({ success: false, error: `Level 1 filtered by capi_event_level=${pixelInfo.capiEventLevel}`, correlationId });
    }

    // Получить lead_id для логов
    const { data: leadRecord } = await supabase
      .from('leads')
      .select('id')
      .eq('chat_id', contactPhone)
      .eq('user_account_id', dialog.user_account_id)
      .maybeSingle();

    // Отправить Level 1 событие (Lead)
    const response = await sendCapiEventAtomic({
      pixelId: pixelInfo.pixelId,
      accessToken: pixelInfo.accessToken,
      eventName: CAPI_EVENTS.LEAD,
      eventLevel: 1,
      phone: contactPhone,
      ctwaClid: dialog.ctwa_clid || undefined,
      pageId: pixelInfo.pageId || undefined,
      dialogAnalysisId: dialog.id,
      leadId: leadRecord?.id,
      userAccountId: dialog.user_account_id,
      directionId: dialog.direction_id,
      correlationId,
    });

    const durationMs = Date.now() - startTime;

    if (response.success) {
      app.log.info({
        correlationId,
        contactPhone,
        dialogId: dialog.id,
        directionId: dialog.direction_id,
        eventName: CAPI_EVENTS.LEAD,
        eventId: response.eventId,
        durationMs,
        action: 'capi_interest_success'
      }, 'Interest CAPI event sent successfully');

      return reply.send({ success: true, event: CAPI_EVENTS.LEAD, eventId: response.eventId, correlationId });
    } else {
      const normalizedError = (response.error || '').toLowerCase();
      const statusCode = normalizedError.includes('already sent') ? 409 : 502;

      app.log.warn({
        correlationId,
        contactPhone,
        dialogId: dialog.id,
        error: response.error,
        statusCode,
        durationMs,
        action: 'capi_interest_skipped'
      }, 'Interest CAPI event failed or already sent');

      return reply.status(statusCode).send({ success: false, error: response.error, correlationId });
    }

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    app.log.error({
      correlationId,
      error: error.message,
      stack: error.stack,
      durationMs,
      action: 'capi_interest_error'
    }, 'Error sending Interest CAPI event');
    return reply.status(500).send({ error: error.message, correlationId });
  }
});

// Manual trigger for CAPI analysis cron (for testing/debugging)
app.post('/capi/trigger-analysis', async (request, reply) => {
  try {
    app.log.info('Manual trigger of CAPI analysis cron');

    const result = await triggerCapiAnalysisCron();

    app.log.info({
      found: result.found,
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
      durationMs: result.durationMs,
    }, 'CAPI analysis cron triggered manually');

    return reply.send({
      success: true,
      dialogs_found: result.found,
      dialogs_processed: result.processed,
      dialogs_skipped: result.skipped,
      errors: result.errors,
      duration_ms: result.durationMs,
    });
  } catch (error: any) {
    app.log.error({ error: error.message }, 'Error triggering CAPI analysis');
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

// Запускаем cron для CAPI Level 2-3 анализа (ежечасно)
// @ts-ignore
startCapiAnalysisCron();

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
