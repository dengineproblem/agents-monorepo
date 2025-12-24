import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

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
    try {
      const { userId } = request.query as { userId: string };

      if (!userId) {
        return reply.status(400).send({ error: 'userId is required' });
      }

      app.log.info({ userId }, 'Fetching AI bots');

      const { data: bots, error } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('user_account_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        bots: (bots || []).map(toCamelCase),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch AI bots');
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
    try {
      const { botId } = request.params as { botId: string };

      app.log.info({ botId }, 'Fetching AI bot');

      const { data: bot, error } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', botId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw error;
      }

      // Also fetch functions for this bot
      const { data: functions } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId)
        .eq('is_active', true);

      return reply.send({
        success: true,
        bot: toCamelCase(bot),
        functions: (functions || []).map(toCamelCase),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch AI bot');
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
    try {
      const body = CreateBotSchema.parse(request.body);

      app.log.info({ userId: body.userAccountId }, 'Creating AI bot');

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
        throw error;
      }

      app.log.info({ botId: bot.id }, 'AI bot created');

      return reply.status(201).send({
        success: true,
        bot: toCamelCase(bot),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({ error: error.message }, 'Failed to create AI bot');
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
    try {
      const { botId } = request.params as { botId: string };
      const body = UpdateBotSchema.parse(request.body);

      app.log.info({ botId, updates: Object.keys(body) }, 'Updating AI bot');

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
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw error;
      }

      app.log.info({ botId }, 'AI bot updated');

      return reply.send({
        success: true,
        bot: toCamelCase(bot),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.errors
        });
      }

      app.log.error({ error: error.message }, 'Failed to update AI bot');
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
    try {
      const { botId } = request.params as { botId: string };

      app.log.info({ botId }, 'Deleting AI bot');

      const { error } = await supabase
        .from('ai_bot_configurations')
        .delete()
        .eq('id', botId);

      if (error) {
        throw error;
      }

      app.log.info({ botId }, 'AI bot deleted');

      return reply.send({
        success: true,
        message: 'Bot deleted successfully'
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete AI bot');
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
    try {
      const { botId } = request.params as { botId: string };

      app.log.info({ botId }, 'Duplicating AI bot');

      // Get original bot
      const { data: originalBot, error: fetchError } = await supabase
        .from('ai_bot_configurations')
        .select('*')
        .eq('id', botId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw fetchError;
      }

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
        throw insertError;
      }

      // Also duplicate functions
      const { data: functions } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId);

      if (functions && functions.length > 0) {
        const newFunctions = functions.map(({ id, bot_id, created_at, updated_at, ...funcData }) => ({
          ...funcData,
          bot_id: newBot.id,
        }));

        await supabase
          .from('ai_bot_functions')
          .insert(newFunctions);
      }

      app.log.info({ originalId: botId, newId: newBot.id }, 'AI bot duplicated');

      return reply.status(201).send({
        success: true,
        bot: toCamelCase(newBot),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to duplicate AI bot');
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
    try {
      const { botId } = request.params as { botId: string };

      app.log.info({ botId }, 'Toggling AI bot status');

      // Get current status
      const { data: bot, error: fetchError } = await supabase
        .from('ai_bot_configurations')
        .select('is_active')
        .eq('id', botId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Bot not found' });
        }
        throw fetchError;
      }

      // Toggle status
      const { data: updatedBot, error: updateError } = await supabase
        .from('ai_bot_configurations')
        .update({
          is_active: !bot.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', botId)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      app.log.info({ botId, isActive: updatedBot.is_active }, 'AI bot status toggled');

      return reply.send({
        success: true,
        bot: toCamelCase(updatedBot),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to toggle AI bot status');
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
    try {
      const { botId } = request.params as { botId: string };

      const { data: functions, error } = await supabase
        .from('ai_bot_functions')
        .select('*')
        .eq('bot_id', botId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        functions: (functions || []).map(toCamelCase),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch bot functions');
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
    try {
      const { botId } = request.params as { botId: string };
      const body = request.body as any;

      app.log.info({ botId, functionName: body.name }, 'Creating bot function');

      const insertData = {
        bot_id: botId,
        name: body.name,
        description: body.description,
        parameters: body.parameters || {},
        handler_type: body.handlerType,
        handler_config: body.handlerConfig || {},
        is_active: body.isActive ?? true,
      };

      const { data: func, error } = await supabase
        .from('ai_bot_functions')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return reply.status(201).send({
        success: true,
        function: toCamelCase(func),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to create bot function');
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
    try {
      const { functionId } = request.params as { botId: string; functionId: string };
      const body = request.body as any;

      const updateData: any = { updated_at: new Date().toISOString() };

      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.parameters !== undefined) updateData.parameters = body.parameters;
      if (body.handlerType !== undefined) updateData.handler_type = body.handlerType;
      if (body.handlerConfig !== undefined) updateData.handler_config = body.handlerConfig;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const { data: func, error } = await supabase
        .from('ai_bot_functions')
        .update(updateData)
        .eq('id', functionId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        function: toCamelCase(func),
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to update bot function');
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
    try {
      const { functionId } = request.params as { botId: string; functionId: string };

      const { error } = await supabase
        .from('ai_bot_functions')
        .delete()
        .eq('id', functionId);

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        message: 'Function deleted successfully'
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to delete bot function');
      return reply.status(500).send({
        error: 'Failed to delete function',
        message: error.message
      });
    }
  });
}
