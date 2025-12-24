import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import {
  generateCorrelationId,
  shortCorrelationId,
  maskUuid,
  maskApiKey,
  classifyError,
  createErrorLog,
  getElapsedMs,
  LogTag
} from '../lib/logUtils.js';

// Validation schemas
const DelayedMessageSchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
  prompt: z.string(),
  repeatCount: z.number().int().min(1).max(10).default(1),
  offHoursBehavior: z.enum(['send_immediately', 'next_day_at_time', 'skip']).default('next_day_at_time'),
  offHoursTime: z.string().optional(), // HH:MM format
});

const CreateBotSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(1).max(100).default('Мой бот'),
  systemPrompt: z.string().default(''),
  temperature: z.number().min(0).max(1).default(0.24),
  model: z.enum([
    'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini', 'gpt-o3'
  ]).default('gpt-4o'),
});

const UpdateBotSchema = z.object({
  // Основные настройки
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.enum([
    'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini', 'gpt-o3'
  ]).optional(),

  // Оптимизация истории диалога
  historyTokenLimit: z.number().int().min(0).max(128000).optional(),
  historyMessageLimit: z.number().int().min(1).max(100).nullable().optional(),
  historyTimeLimitHours: z.number().int().min(1).max(168).nullable().optional(),

  // Контроль вмешательства оператора
  operatorPauseEnabled: z.boolean().optional(),
  operatorPauseIgnoreFirstMessage: z.boolean().optional(),
  operatorAutoResumeHours: z.number().int().min(0).max(72).optional(),
  operatorAutoResumeMinutes: z.number().int().min(0).max(59).optional(),
  operatorPauseExceptions: z.array(z.string()).optional(),

  // Управление диалогом по ключевым фразам
  stopPhrases: z.array(z.string()).optional(),
  resumePhrases: z.array(z.string()).optional(),

  // Буфер сообщений
  messageBufferSeconds: z.number().int().min(1).max(60).optional(),

  // Деление сообщений
  splitMessages: z.boolean().optional(),
  splitMaxLength: z.number().int().min(100).max(2000).optional(),

  // Лимиты расходов
  dailyCostLimitCents: z.number().int().min(0).nullable().optional(),
  userCostLimitCents: z.number().int().min(0).nullable().optional(),

  // Форматирование текста
  adaptiveFormatting: z.boolean().optional(),
  cleanMarkdown: z.boolean().optional(),

  // Дата и время
  passCurrentDatetime: z.boolean().optional(),
  timezone: z.string().optional(),

  // Расписание работы агента
  scheduleEnabled: z.boolean().optional(),
  scheduleHoursStart: z.number().int().min(0).max(23).optional(),
  scheduleHoursEnd: z.number().int().min(0).max(23).optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).optional(),

  // Голосовые сообщения
  voiceRecognitionEnabled: z.boolean().optional(),
  voiceRecognitionModel: z.string().optional(),
  voiceResponseMode: z.enum(['never', 'on_voice', 'always']).optional(),
  voiceDefaultResponse: z.string().optional(),

  // Изображения
  imageRecognitionEnabled: z.boolean().optional(),
  imageDefaultResponse: z.string().optional(),
  imageSendFromLinks: z.boolean().optional(),

  // Документы
  documentRecognitionEnabled: z.boolean().optional(),
  documentDefaultResponse: z.string().optional(),
  documentSendFromLinks: z.boolean().optional(),

  // Файлы
  fileHandlingMode: z.enum(['ignore', 'respond']).optional(),
  fileDefaultResponse: z.string().optional(),

  // Отложенная отправка
  delayedMessages: z.array(DelayedMessageSchema).optional(),
  delayedScheduleEnabled: z.boolean().optional(),
  delayedScheduleHoursStart: z.number().int().min(0).max(23).optional(),
  delayedScheduleHoursEnd: z.number().int().min(0).max(23).optional(),

  // Сообщения
  startMessage: z.string().optional(),
  errorMessage: z.string().optional(),

  // Свой API ключ
  customOpenaiApiKey: z.string().nullable().optional(),
});

// Helper to convert camelCase to snake_case
function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}

// Helper to convert snake_case to camelCase
function toCamelCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export async function aiBotConfigurationsRoutes(app: FastifyInstance) {

  /**
   * GET /ai-bots
   * Get all bots for a user
   */
  app.get('/ai-bots', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { userId } = request.query as { userId: string };
    const tags: LogTag[] = ['api', 'bot', 'db'];

    app.log.info({
      cid: shortCorrelationId(cid),
      userId: maskUuid(userId),
      tags
    }, '[GET /ai-bots] Request received');

    try {
      if (!userId) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error'
        }, '[GET /ai-bots] Missing userId parameter');
        return reply.status(400).send({ error: 'userId is required' });
      }

      app.log.debug({
        cid: shortCorrelationId(cid),
        userId: maskUuid(userId),
        tags: ['db']
      }, '[GET /ai-bots] Querying database for user bots');

      const { data: bots, error } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('user_account_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        const errorLog = createErrorLog(error, { correlationId: cid, method: 'GET', path: '/ai-bots', userId });
        app.log.error({
          ...errorLog,
          elapsedMs: getElapsedMs(startTime)
        }, '[GET /ai-bots] Database error');
        throw error;
      }

      const botsCount = bots?.length || 0;
      app.log.info({
        cid: shortCorrelationId(cid),
        userId: maskUuid(userId),
        botsCount,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[GET /ai-bots] Successfully fetched bots');

      return reply.send({
        success: true,
        bots: (bots || []).map(toCamelCase),
      });
    } catch (error: any) {
      const errorLog = createErrorLog(error, { correlationId: cid, method: 'GET', path: '/ai-bots', userId });
      app.log.error({
        ...errorLog,
        elapsedMs: getElapsedMs(startTime)
      }, '[GET /ai-bots] Failed to fetch AI bots');
      return reply.status(500).send({
        error: 'Failed to fetch bots',
        message: error.message
      });
    }
  });

  /**
   * GET /ai-bots/:botId
   * Get a specific bot by ID
   */
  app.get('/ai-bots/:botId', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { botId } = request.params as { botId: string };
    const tags: LogTag[] = ['api', 'bot', 'db'];

    app.log.info({
      cid: shortCorrelationId(cid),
      botId: maskUuid(botId),
      tags
    }, '[GET /ai-bots/:botId] Request received');

    try {
      app.log.debug({
        cid: shortCorrelationId(cid),
        botId: maskUuid(botId),
        tags: ['db']
      }, '[GET /ai-bots/:botId] Fetching bot from database');

      const { data: bot, error } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', botId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          app.log.warn({
            cid: shortCorrelationId(cid),
            botId: maskUuid(botId),
            errorType: 'not_found_error',
            elapsedMs: getElapsedMs(startTime)
          }, '[GET /ai-bots/:botId] Bot not found');
          return reply.status(404).send({ error: 'Bot not found' });
        }
        const errorLog = createErrorLog(error, { correlationId: cid, method: 'GET', path: '/ai-bots/:botId', botId });
        app.log.error({
          ...errorLog,
          elapsedMs: getElapsedMs(startTime)
        }, '[GET /ai-bots/:botId] Database error');
        throw error;
      }

      app.log.debug({
        cid: shortCorrelationId(cid),
        botId: maskUuid(botId),
        botName: bot.name,
        isActive: bot.is_active,
        model: bot.model,
        tags: ['db', 'function']
      }, '[GET /ai-bots/:botId] Bot found, fetching functions');

      // Also fetch functions for this bot
      const { data: functions, error: funcError } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId)
        .eq('is_active', true);

      if (funcError) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          botId: maskUuid(botId),
          errorType: 'db_error'
        }, '[GET /ai-bots/:botId] Error fetching functions (non-fatal)');
      }

      const functionsCount = functions?.length || 0;
      app.log.info({
        cid: shortCorrelationId(cid),
        botId: maskUuid(botId),
        botName: bot.name,
        functionsCount,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[GET /ai-bots/:botId] Successfully fetched bot with functions');

      return reply.send({
        success: true,
        bot: toCamelCase(bot),
        functions: (functions || []).map(toCamelCase),
      });
    } catch (error: any) {
      const errorLog = createErrorLog(error, { correlationId: cid, method: 'GET', path: '/ai-bots/:botId', botId });
      app.log.error({
        ...errorLog,
        elapsedMs: getElapsedMs(startTime)
      }, '[GET /ai-bots/:botId] Failed to fetch AI bot');
      return reply.status(500).send({
        error: 'Failed to fetch bot',
        message: error.message
      });
    }
  });

  /**
   * POST /ai-bots
   * Create a new bot
   */
  app.post('/ai-bots', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const tags: LogTag[] = ['api', 'bot', 'db'];

    app.log.info({
      cid: shortCorrelationId(cid),
      bodySize: JSON.stringify(request.body).length,
      tags
    }, '[POST /ai-bots] Request received');

    try {
      const body = CreateBotSchema.parse(request.body);

      app.log.debug({
        cid: shortCorrelationId(cid),
        userId: maskUuid(body.userAccountId),
        name: body.name,
        model: body.model,
        temp: body.temperature,
        tags: ['db']
      }, '[POST /ai-bots] Creating new bot');

      const insertData = {
        user_account_id: body.userAccountId,
        name: body.name,
        system_prompt: body.systemPrompt,
        temperature: body.temperature,
        model: body.model,
      };

      const { data: bot, error } = await supabase
        .from('ai_bot_configurations')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        const errorLog = createErrorLog(error, { correlationId: cid, method: 'POST', path: '/ai-bots', userId: body.userAccountId });
        app.log.error({
          ...errorLog,
          elapsedMs: getElapsedMs(startTime)
        }, '[POST /ai-bots] Database insert error');
        throw error;
      }

      app.log.info({
        cid: shortCorrelationId(cid),
        botId: maskUuid(bot.id),
        botName: bot.name,
        userId: maskUuid(body.userAccountId),
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[POST /ai-bots] Bot created successfully');

      return reply.status(201).send({
        success: true,
        bot: toCamelCase(bot),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          errorType: 'validation_error',
          validationErrors: error.errors.map(e => ({ path: e.path, msg: e.message })),
          elapsedMs: getElapsedMs(startTime)
        }, '[POST /ai-bots] Validation error');
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      const errorLog = createErrorLog(error, { correlationId: cid, method: 'POST', path: '/ai-bots' });
      app.log.error({
        ...errorLog,
        elapsedMs: getElapsedMs(startTime)
      }, '[POST /ai-bots] Failed to create AI bot');
      return reply.status(500).send({
        error: 'Failed to create bot',
        message: error.message
      });
    }
  });

  /**
   * PUT /ai-bots/:botId
   * Update a bot
   */
  app.put('/ai-bots/:botId', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { botId } = request.params as { botId: string };
    const tags: LogTag[] = ['api', 'bot', 'db'];

    app.log.info({
      cid: shortCorrelationId(cid),
      botId: maskUuid(botId),
      bodySize: JSON.stringify(request.body).length,
      tags
    }, '[PUT /ai-bots/:botId] Request received');

    try {
      const body = UpdateBotSchema.parse(request.body);
      const updateKeys = Object.keys(body);

      app.log.debug({
        cid: shortCorrelationId(cid),
        botId: maskUuid(botId),
        updateFields: updateKeys,
        fieldCount: updateKeys.length,
        hasApiKey: body.customOpenaiApiKey !== undefined,
        apiKeyMasked: maskApiKey(body.customOpenaiApiKey),
        tags: ['db']
      }, '[PUT /ai-bots/:botId] Updating bot configuration');

      // Build update object
      const updateData = toSnakeCase(body);
      updateData.updated_at = new Date().toISOString();

      const { data: bot, error } = await supabase
        .from('ai_bot_configurations')
        .update(updateData)
        .eq('id', botId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          app.log.warn({
            cid: shortCorrelationId(cid),
            botId: maskUuid(botId),
            errorType: 'not_found_error',
            elapsedMs: getElapsedMs(startTime)
          }, '[PUT /ai-bots/:botId] Bot not found');
          return reply.status(404).send({ error: 'Bot not found' });
        }
        const errorLog = createErrorLog(error, { correlationId: cid, method: 'PUT', path: '/ai-bots/:botId', botId });
        app.log.error({
          ...errorLog,
          elapsedMs: getElapsedMs(startTime)
        }, '[PUT /ai-bots/:botId] Database update error');
        throw error;
      }

      app.log.info({
        cid: shortCorrelationId(cid),
        botId: maskUuid(botId),
        botName: bot.name,
        updatedFields: updateKeys,
        isActive: bot.is_active,
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[PUT /ai-bots/:botId] Bot updated successfully');

      return reply.send({
        success: true,
        bot: toCamelCase(bot),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        app.log.warn({
          cid: shortCorrelationId(cid),
          botId: maskUuid(botId),
          errorType: 'validation_error',
          validationErrors: error.errors.map(e => ({ path: e.path, msg: e.message })),
          elapsedMs: getElapsedMs(startTime)
        }, '[PUT /ai-bots/:botId] Validation error');
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      const errorLog = createErrorLog(error, { correlationId: cid, method: 'PUT', path: '/ai-bots/:botId', botId });
      app.log.error({
        ...errorLog,
        elapsedMs: getElapsedMs(startTime)
      }, '[PUT /ai-bots/:botId] Failed to update AI bot');
      return reply.status(500).send({
        error: 'Failed to update bot',
        message: error.message
      });
    }
  });

  /**
   * DELETE /ai-bots/:botId
   * Delete a bot
   */
  app.delete('/ai-bots/:botId', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };

    app.log.info({ botId }, '[DELETE /ai-bots/:botId] Request received');

    try {
      app.log.debug({ botId }, '[DELETE /ai-bots/:botId] Deleting bot from database');

      const { error } = await supabase
        .from('ai_bot_configurations')
        .delete()
        .eq('id', botId);

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          botId,
          elapsed: Date.now() - startTime
        }, '[DELETE /ai-bots/:botId] Database delete error');
        throw error;
      }

      app.log.info({
        botId,
        elapsed: Date.now() - startTime
      }, '[DELETE /ai-bots/:botId] Bot deleted successfully');

      return reply.send({
        success: true,
        message: 'Bot deleted successfully'
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[DELETE /ai-bots/:botId] Failed to delete AI bot');
      return reply.status(500).send({
        error: 'Failed to delete bot',
        message: error.message
      });
    }
  });

  /**
   * POST /ai-bots/:botId/duplicate
   * Duplicate a bot
   */
  app.post('/ai-bots/:botId/duplicate', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };

    app.log.info({ botId }, '[POST /ai-bots/:botId/duplicate] Request received');

    try {
      // Get original bot
      app.log.debug({ botId }, '[POST /ai-bots/:botId/duplicate] Fetching original bot');

      const { data: originalBot, error: fetchError } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', botId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          app.log.warn({ botId, elapsed: Date.now() - startTime }, '[POST /ai-bots/:botId/duplicate] Original bot not found');
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw fetchError;
      }

      app.log.debug({
        originalId: botId,
        originalName: originalBot.name
      }, '[POST /ai-bots/:botId/duplicate] Creating copy');

      // Create copy
      const { id, created_at, updated_at, ...botData } = originalBot;
      botData.name = `${botData.name} (копия)`;
      botData.is_active = false;

      const { data: newBot, error: insertError } = await supabase
        .from('ai_bot_configurations')
        .insert(botData)
        .select()
        .single();

      if (insertError) {
        app.log.error({
          error: insertError.message,
          code: insertError.code,
          elapsed: Date.now() - startTime
        }, '[POST /ai-bots/:botId/duplicate] Failed to insert copy');
        throw insertError;
      }

      // Also duplicate functions
      app.log.debug({ originalId: botId }, '[POST /ai-bots/:botId/duplicate] Fetching functions to duplicate');

      const { data: functions } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId);

      const functionsCount = functions?.length || 0;

      if (functions && functions.length > 0) {
        const newFunctions = functions.map(({ id, bot_id, created_at, updated_at, ...funcData }) => ({
          ...funcData,
          bot_id: newBot.id,
        }));

        const { error: funcInsertError } = await supabase
          .from('ai_bot_functions')
          .insert(newFunctions);

        if (funcInsertError) {
          app.log.warn({
            error: funcInsertError.message,
            newBotId: newBot.id
          }, '[POST /ai-bots/:botId/duplicate] Failed to duplicate functions (non-fatal)');
        }
      }

      app.log.info({
        originalId: botId,
        newId: newBot.id,
        newName: newBot.name,
        functionsDuplicated: functionsCount,
        elapsed: Date.now() - startTime
      }, '[POST /ai-bots/:botId/duplicate] Bot duplicated successfully');

      return reply.status(201).send({
        success: true,
        bot: toCamelCase(newBot),
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[POST /ai-bots/:botId/duplicate] Failed to duplicate AI bot');
      return reply.status(500).send({
        error: 'Failed to duplicate bot',
        message: error.message
      });
    }
  });

  /**
   * PATCH /ai-bots/:botId/toggle
   * Toggle bot active status
   */
  app.patch('/ai-bots/:botId/toggle', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };

    app.log.info({ botId }, '[PATCH /ai-bots/:botId/toggle] Request received');

    try {
      // Get current status
      app.log.debug({ botId }, '[PATCH /ai-bots/:botId/toggle] Fetching current status');

      const { data: bot, error: fetchError } = await supabase
        .from('ai_bot_configurations')
        .select('is_active, name')
        .eq('id', botId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          app.log.warn({ botId, elapsed: Date.now() - startTime }, '[PATCH /ai-bots/:botId/toggle] Bot not found');
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw fetchError;
      }

      const previousStatus = bot.is_active;
      const newStatus = !previousStatus;

      app.log.debug({
        botId,
        botName: bot.name,
        previousStatus,
        newStatus
      }, '[PATCH /ai-bots/:botId/toggle] Toggling status');

      // Toggle status
      const { data: updatedBot, error: updateError } = await supabase
        .from('ai_bot_configurations')
        .update({
          is_active: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', botId)
        .select()
        .single();

      if (updateError) {
        app.log.error({
          error: updateError.message,
          code: updateError.code,
          botId,
          elapsed: Date.now() - startTime
        }, '[PATCH /ai-bots/:botId/toggle] Failed to update status');
        throw updateError;
      }

      app.log.info({
        botId,
        botName: updatedBot.name,
        previousStatus,
        newStatus: updatedBot.is_active,
        elapsed: Date.now() - startTime
      }, '[PATCH /ai-bots/:botId/toggle] Bot status toggled successfully');

      return reply.send({
        success: true,
        bot: toCamelCase(updatedBot),
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[PATCH /ai-bots/:botId/toggle] Failed to toggle AI bot status');
      return reply.status(500).send({
        error: 'Failed to toggle bot status',
        message: error.message
      });
    }
  });

  // ===== Bot Functions CRUD =====

  /**
   * GET /ai-bots/:botId/functions
   * Get all functions for a bot
   */
  app.get('/ai-bots/:botId/functions', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };

    app.log.info({ botId }, '[GET /ai-bots/:botId/functions] Request received');

    try {
      const { data: functions, error } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId)
        .order('created_at', { ascending: true });

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          botId,
          elapsed: Date.now() - startTime
        }, '[GET /ai-bots/:botId/functions] Database error');
        throw error;
      }

      const functionsCount = functions?.length || 0;
      app.log.info({
        botId,
        functionsCount,
        elapsed: Date.now() - startTime
      }, '[GET /ai-bots/:botId/functions] Successfully fetched functions');

      return reply.send({
        success: true,
        functions: (functions || []).map(toCamelCase),
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[GET /ai-bots/:botId/functions] Failed to fetch bot functions');
      return reply.status(500).send({
        error: 'Failed to fetch functions',
        message: error.message
      });
    }
  });

  /**
   * POST /ai-bots/:botId/functions
   * Create a new function for a bot
   */
  app.post('/ai-bots/:botId/functions', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };
    const body = request.body as any;

    app.log.info({
      botId,
      functionName: body.name,
      handlerType: body.handlerType
    }, '[POST /ai-bots/:botId/functions] Request received');

    try {
      const insertData = {
        bot_id: botId,
        name: body.name,
        description: body.description,
        parameters: body.parameters || {},
        handler_type: body.handlerType,
        handler_config: body.handlerConfig || {},
        is_active: body.isActive ?? true,
      };

      app.log.debug({
        botId,
        functionName: body.name,
        handlerType: body.handlerType,
        hasParameters: Object.keys(body.parameters || {}).length > 0
      }, '[POST /ai-bots/:botId/functions] Creating function');

      const { data: func, error } = await supabase
        .from('ai_bot_functions')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          botId,
          elapsed: Date.now() - startTime
        }, '[POST /ai-bots/:botId/functions] Database insert error');
        throw error;
      }

      app.log.info({
        botId,
        functionId: func.id,
        functionName: func.name,
        elapsed: Date.now() - startTime
      }, '[POST /ai-bots/:botId/functions] Function created successfully');

      return reply.status(201).send({
        success: true,
        function: toCamelCase(func),
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[POST /ai-bots/:botId/functions] Failed to create bot function');
      return reply.status(500).send({
        error: 'Failed to create function',
        message: error.message
      });
    }
  });

  /**
   * PUT /ai-bots/:botId/functions/:functionId
   * Update a function
   */
  app.put('/ai-bots/:botId/functions/:functionId', async (request, reply) => {
    const startTime = Date.now();
    const { botId, functionId } = request.params as { botId: string; functionId: string };
    const body = request.body as any;

    app.log.info({ botId, functionId }, '[PUT /ai-bots/:botId/functions/:functionId] Request received');

    try {
      const updateData: any = { updated_at: new Date().toISOString() };
      const updateFields: string[] = [];

      if (body.name !== undefined) { updateData.name = body.name; updateFields.push('name'); }
      if (body.description !== undefined) { updateData.description = body.description; updateFields.push('description'); }
      if (body.parameters !== undefined) { updateData.parameters = body.parameters; updateFields.push('parameters'); }
      if (body.handlerType !== undefined) { updateData.handler_type = body.handlerType; updateFields.push('handlerType'); }
      if (body.handlerConfig !== undefined) { updateData.handler_config = body.handlerConfig; updateFields.push('handlerConfig'); }
      if (body.isActive !== undefined) { updateData.is_active = body.isActive; updateFields.push('isActive'); }

      app.log.debug({
        functionId,
        updateFields,
        fieldCount: updateFields.length
      }, '[PUT /ai-bots/:botId/functions/:functionId] Updating function');

      const { data: func, error } = await supabase
        .from('ai_bot_functions')
        .update(updateData)
        .eq('id', functionId)
        .select()
        .single();

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          functionId,
          elapsed: Date.now() - startTime
        }, '[PUT /ai-bots/:botId/functions/:functionId] Database update error');
        throw error;
      }

      app.log.info({
        botId,
        functionId,
        functionName: func.name,
        updatedFields: updateFields,
        elapsed: Date.now() - startTime
      }, '[PUT /ai-bots/:botId/functions/:functionId] Function updated successfully');

      return reply.send({
        success: true,
        function: toCamelCase(func),
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        functionId,
        elapsed: Date.now() - startTime
      }, '[PUT /ai-bots/:botId/functions/:functionId] Failed to update bot function');
      return reply.status(500).send({
        error: 'Failed to update function',
        message: error.message
      });
    }
  });

  /**
   * DELETE /ai-bots/:botId/functions/:functionId
   * Delete a function
   */
  app.delete('/ai-bots/:botId/functions/:functionId', async (request, reply) => {
    const startTime = Date.now();
    const { botId, functionId } = request.params as { botId: string; functionId: string };

    app.log.info({ botId, functionId }, '[DELETE /ai-bots/:botId/functions/:functionId] Request received');

    try {
      const { error } = await supabase
        .from('ai_bot_functions')
        .delete()
        .eq('id', functionId);

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          functionId,
          elapsed: Date.now() - startTime
        }, '[DELETE /ai-bots/:botId/functions/:functionId] Database delete error');
        throw error;
      }

      app.log.info({
        botId,
        functionId,
        elapsed: Date.now() - startTime
      }, '[DELETE /ai-bots/:botId/functions/:functionId] Function deleted successfully');

      return reply.send({
        success: true,
        message: 'Function deleted successfully'
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        functionId,
        elapsed: Date.now() - startTime
      }, '[DELETE /ai-bots/:botId/functions/:functionId] Failed to delete bot function');
      return reply.status(500).send({
        error: 'Failed to delete function',
        message: error.message
      });
    }
  });

  // ===== WhatsApp Instance - Bot Linking =====

  /**
   * GET /whatsapp-instances
   * Get all WhatsApp instances for a user (with linked bot info)
   */
  app.get('/whatsapp-instances', async (request, reply) => {
    const startTime = Date.now();
    const { userId } = request.query as { userId: string };

    app.log.info({ userId }, '[GET /whatsapp-instances] Request received');

    try {
      if (!userId) {
        app.log.warn({}, '[GET /whatsapp-instances] Missing userId parameter');
        return reply.status(400).send({ error: 'userId is required' });
      }

      app.log.debug({ userId }, '[GET /whatsapp-instances] Querying instances with bot info');

      const { data: instances, error } = await supabase
        .from('whatsapp_instances')
        .select(`
          id,
          instance_name,
          phone_number,
          status,
          ai_bot_id,
          created_at,
          ai_bot_configurations (
            id,
            name,
            is_active
          )
        `)
        .eq('user_account_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          userId,
          elapsed: Date.now() - startTime
        }, '[GET /whatsapp-instances] Database error');
        throw error;
      }

      const instancesCount = instances?.length || 0;
      const linkedCount = instances?.filter((i: any) => i.ai_bot_id).length || 0;

      // Transform response
      const result = (instances || []).map((inst: any) => ({
        id: inst.id,
        instanceName: inst.instance_name,
        phoneNumber: inst.phone_number,
        status: inst.status,
        aiBotId: inst.ai_bot_id,
        createdAt: inst.created_at,
        linkedBot: inst.ai_bot_configurations ? {
          id: inst.ai_bot_configurations.id,
          name: inst.ai_bot_configurations.name,
          isActive: inst.ai_bot_configurations.is_active
        } : null
      }));

      app.log.info({
        userId,
        instancesCount,
        linkedCount,
        elapsed: Date.now() - startTime
      }, '[GET /whatsapp-instances] Successfully fetched instances');

      return reply.send({
        success: true,
        instances: result
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        userId,
        elapsed: Date.now() - startTime
      }, '[GET /whatsapp-instances] Failed to fetch WhatsApp instances');
      return reply.status(500).send({
        error: 'Failed to fetch instances',
        message: error.message
      });
    }
  });

  /**
   * PATCH /whatsapp-instances/:instanceId/link-bot
   * Link a bot to a WhatsApp instance
   */
  app.patch('/whatsapp-instances/:instanceId/link-bot', async (request, reply) => {
    const startTime = Date.now();
    const cid = generateCorrelationId();
    const { instanceId } = request.params as { instanceId: string };
    const { botId } = request.body as { botId: string | null };
    const tags: LogTag[] = ['api', 'instance', 'bot', 'db'];
    const action = botId ? 'link' : 'unlink';

    app.log.info({
      cid: shortCorrelationId(cid),
      instanceId: maskUuid(instanceId),
      botId: botId ? maskUuid(botId) : null,
      action,
      tags
    }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Request received');

    try {
      app.log.debug({
        cid: shortCorrelationId(cid),
        instanceId: maskUuid(instanceId),
        newBotId: botId ? maskUuid(botId) : null,
        tags: ['db']
      }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Updating instance bot link');

      const { data: instance, error } = await supabase
        .from('whatsapp_instances')
        .update({
          ai_bot_id: botId,
          updated_at: new Date().toISOString()
        })
        .eq('id', instanceId)
        .select(`
          id,
          instance_name,
          ai_bot_id,
          ai_bot_configurations (
            id,
            name,
            is_active
          )
        `)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          app.log.warn({
            cid: shortCorrelationId(cid),
            instanceId: maskUuid(instanceId),
            errorType: 'not_found_error',
            elapsedMs: getElapsedMs(startTime)
          }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Instance not found');
          return reply.status(404).send({ error: 'Instance not found' });
        }
        const errorLog = createErrorLog(error, { correlationId: cid, method: 'PATCH', path: '/whatsapp-instances/:instanceId/link-bot', instanceId });
        app.log.error({
          ...errorLog,
          elapsedMs: getElapsedMs(startTime)
        }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Database update error');
        throw error;
      }

      const linkedBot = instance.ai_bot_configurations as any;
      app.log.info({
        cid: shortCorrelationId(cid),
        instanceId: maskUuid(instanceId),
        instanceName: instance.instance_name,
        newBotId: instance.ai_bot_id ? maskUuid(instance.ai_bot_id) : null,
        linkedBotName: linkedBot?.name || null,
        action: instance.ai_bot_id ? 'linked' : 'unlinked',
        elapsedMs: getElapsedMs(startTime),
        tags
      }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Bot link updated successfully');

      return reply.send({
        success: true,
        instance: {
          id: instance.id,
          instanceName: instance.instance_name,
          aiBotId: instance.ai_bot_id,
          linkedBot: linkedBot ? {
            id: linkedBot.id,
            name: linkedBot.name,
            isActive: linkedBot.is_active
          } : null
        }
      });
    } catch (error: any) {
      const errorLog = createErrorLog(error, { correlationId: cid, method: 'PATCH', path: '/whatsapp-instances/:instanceId/link-bot', instanceId });
      app.log.error({
        ...errorLog,
        elapsedMs: getElapsedMs(startTime)
      }, '[PATCH /whatsapp-instances/:instanceId/link-bot] Failed to link bot to instance');
      return reply.status(500).send({
        error: 'Failed to link bot',
        message: error.message
      });
    }
  });

  /**
   * GET /ai-bots/:botId/linked-instances
   * Get all WhatsApp instances linked to a specific bot
   */
  app.get('/ai-bots/:botId/linked-instances', async (request, reply) => {
    const startTime = Date.now();
    const { botId } = request.params as { botId: string };

    app.log.info({ botId }, '[GET /ai-bots/:botId/linked-instances] Request received');

    try {
      app.log.debug({ botId }, '[GET /ai-bots/:botId/linked-instances] Querying linked instances');

      const { data: instances, error } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, phone_number, status')
        .eq('ai_bot_id', botId);

      if (error) {
        app.log.error({
          error: error.message,
          code: error.code,
          botId,
          elapsed: Date.now() - startTime
        }, '[GET /ai-bots/:botId/linked-instances] Database error');
        throw error;
      }

      const instancesCount = instances?.length || 0;
      app.log.info({
        botId,
        linkedInstancesCount: instancesCount,
        instances: instances?.map((i: any) => i.instance_name) || [],
        elapsed: Date.now() - startTime
      }, '[GET /ai-bots/:botId/linked-instances] Successfully fetched linked instances');

      return reply.send({
        success: true,
        instances: (instances || []).map((inst: any) => ({
          id: inst.id,
          instanceName: inst.instance_name,
          phoneNumber: inst.phone_number,
          status: inst.status
        }))
      });
    } catch (error: any) {
      app.log.error({
        error: error.message,
        stack: error.stack,
        botId,
        elapsed: Date.now() - startTime
      }, '[GET /ai-bots/:botId/linked-instances] Failed to fetch linked instances');
      return reply.status(500).send({
        error: 'Failed to fetch linked instances',
        message: error.message
      });
    }
  });
}
