import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'capiSettingsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CapiFieldConfigSchema = z.object({
  field_id: z.union([z.string(), z.number()]),
  field_name: z.string(),
  field_type: z.string(),
  enum_id: z.union([z.string(), z.number(), z.null()]).optional(),
  enum_value: z.string().nullable().optional(),
  entity_type: z.string().optional(),
  pipeline_id: z.union([z.string(), z.number(), z.null()]).optional(),
  status_id: z.union([z.string(), z.number(), z.null()]).optional(),
});

const CapiChannelSchema = z.enum(['whatsapp', 'lead_forms', 'site']);
const CapiSourceSchema = z.enum(['whatsapp', 'crm']);
const CrmTypeSchema = z.enum(['amocrm', 'bitrix24']);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateCapiSettingsSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional().nullable(),
  channel: CapiChannelSchema,
  pixel_id: z.string().min(1),
  capi_access_token: z.string().nullable().optional(),
  capi_source: CapiSourceSchema,
  capi_crm_type: CrmTypeSchema.nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional().default([]),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional().default([]),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional().default([]),
  ai_l2_description: z.string().nullable().optional(),
  ai_l3_description: z.string().nullable().optional(),
  ai_generated_prompt: z.string().nullable().optional(),
});

const UpdateCapiSettingsSchema = z.object({
  pixel_id: z.string().min(1).optional(),
  capi_access_token: z.string().nullable().optional(),
  capi_source: CapiSourceSchema.optional(),
  capi_crm_type: CrmTypeSchema.nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional(),
  ai_l2_description: z.string().nullable().optional(),
  ai_l3_description: z.string().nullable().optional(),
  ai_generated_prompt: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

// ========================================
// ROUTES
// ========================================

export async function capiSettingsRoutes(app: FastifyInstance) {

  // GET /capi-settings — список настроек CAPI для аккаунта
  app.get('/capi-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAccountId, accountId } = request.query as {
      userAccountId?: string;
      accountId?: string;
    };

    if (!userAccountId) {
      return reply.status(400).send({ error: 'userAccountId is required' });
    }

    log.info({ userAccountId, accountId }, 'Fetching CAPI settings');

    let query = supabase
      .from('capi_settings')
      .select('*')
      .eq('user_account_id', userAccountId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    // Для multi-account: фильтруем по конкретному accountId
    // Для legacy (без accountId): возвращаем ВСЕ настройки пользователя
    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;

    if (error) {
      log.error({ error: error.message, userAccountId, accountId }, 'Failed to fetch CAPI settings');
      return reply.status(500).send({ error: 'Failed to fetch CAPI settings' });
    }

    log.info({
      userAccountId,
      accountId,
      count: (data || []).length,
      channels: (data || []).map((s: any) => s.channel),
    }, 'CAPI settings fetched');
    return reply.send({ data: data || [] });
  });

  // GET /capi-settings/:id — получить одну настройку
  app.get('/capi-settings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: 'Invalid id format (UUID expected)' });
    }

    const { data, error } = await supabase
      .from('capi_settings')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: 'CAPI settings not found' });
    }

    return reply.send({ data });
  });

  // POST /capi-settings — создать настройку CAPI для канала
  app.post('/capi-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateCapiSettingsSchema.safeParse(request.body);
    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.flatten() }, 'Invalid CAPI settings payload');
      return reply.status(400).send({
        error: 'Invalid payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    log.info({
      userAccountId: input.userAccountId,
      accountId: input.accountId,
      channel: input.channel,
      source: input.capi_source,
      pixelId: input.pixel_id,
    }, 'Creating CAPI settings');

    // Проверяем уникальность: один channel на аккаунт
    let existingQuery = supabase
      .from('capi_settings')
      .select('id')
      .eq('user_account_id', input.userAccountId)
      .eq('channel', input.channel)
      .eq('is_active', true);

    if (input.accountId) {
      existingQuery = existingQuery.eq('account_id', input.accountId);
    } else {
      existingQuery = existingQuery.is('account_id', null);
    }

    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      log.warn({ channel: input.channel, existingId: existing.id }, 'CAPI settings already exist for channel');
      return reply.status(409).send({
        error: `CAPI settings for channel '${input.channel}' already exist. Use PATCH to update.`,
        existingId: existing.id,
      });
    }

    const { data, error } = await supabase
      .from('capi_settings')
      .insert({
        user_account_id: input.userAccountId,
        account_id: input.accountId || null,
        channel: input.channel,
        pixel_id: input.pixel_id,
        capi_access_token: input.capi_access_token || null,
        capi_source: input.capi_source,
        capi_crm_type: input.capi_source === 'crm' ? (input.capi_crm_type || null) : null,
        capi_interest_fields: input.capi_source === 'crm' ? input.capi_interest_fields : [],
        capi_qualified_fields: input.capi_source === 'crm' ? input.capi_qualified_fields : [],
        capi_scheduled_fields: input.capi_source === 'crm' ? input.capi_scheduled_fields : [],
        ai_l2_description: input.capi_source === 'whatsapp' ? (input.ai_l2_description || null) : null,
        ai_l3_description: input.capi_source === 'whatsapp' ? (input.ai_l3_description || null) : null,
        ai_generated_prompt: input.capi_source === 'whatsapp' ? (input.ai_generated_prompt || null) : null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      log.error({ error: error.message, channel: input.channel }, 'Failed to create CAPI settings');
      return reply.status(500).send({ error: 'Failed to create CAPI settings', details: error.message });
    }

    log.info({
      id: data.id,
      channel: input.channel,
      source: input.capi_source,
      pixelId: input.pixel_id,
      crmType: input.capi_crm_type || null,
      userAccountId: input.userAccountId,
      accountId: input.accountId || null,
    }, 'CAPI settings created');
    return reply.status(201).send({ data });
  });

  // PATCH /capi-settings/:id — обновить настройку
  app.patch('/capi-settings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: 'Invalid id format (UUID expected)' });
    }

    const parseResult = UpdateCapiSettingsSchema.safeParse(request.body);
    if (!parseResult.success) {
      log.warn({ id, errors: parseResult.error.flatten() }, 'Invalid CAPI settings update payload');
      return reply.status(400).send({
        error: 'Invalid payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    log.info({ id, fields: Object.keys(input) }, 'Updating CAPI settings');

    // Строим объект обновления, включая только переданные поля
    const updateData: Record<string, unknown> = {};
    if (input.pixel_id !== undefined) updateData.pixel_id = input.pixel_id;
    if (input.capi_access_token !== undefined) updateData.capi_access_token = input.capi_access_token;
    if (input.capi_source !== undefined) updateData.capi_source = input.capi_source;
    if (input.capi_crm_type !== undefined) updateData.capi_crm_type = input.capi_crm_type;
    if (input.capi_interest_fields !== undefined) updateData.capi_interest_fields = input.capi_interest_fields;
    if (input.capi_qualified_fields !== undefined) updateData.capi_qualified_fields = input.capi_qualified_fields;
    if (input.capi_scheduled_fields !== undefined) updateData.capi_scheduled_fields = input.capi_scheduled_fields;
    if (input.ai_l2_description !== undefined) updateData.ai_l2_description = input.ai_l2_description;
    if (input.ai_l3_description !== undefined) updateData.ai_l3_description = input.ai_l3_description;
    if (input.ai_generated_prompt !== undefined) updateData.ai_generated_prompt = input.ai_generated_prompt;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('capi_settings')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      log.error({ id, error: error.message }, 'Failed to update CAPI settings');
      return reply.status(500).send({ error: 'Failed to update CAPI settings', details: error.message });
    }

    if (!data) {
      return reply.status(404).send({ error: 'CAPI settings not found' });
    }

    log.info({
      id,
      channel: data.channel,
      updatedFields: Object.keys(updateData).filter(k => k !== 'updated_at'),
    }, 'CAPI settings updated');
    return reply.send({ data });
  });

  // DELETE /capi-settings/:id — удалить настройку (soft delete)
  app.delete('/capi-settings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: 'Invalid id format (UUID expected)' });
    }

    log.info({ id }, 'Deleting CAPI settings (soft)');

    const { data, error } = await supabase
      .from('capi_settings')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, channel')
      .single();

    if (error || !data) {
      log.error({ id, error: error?.message }, 'Failed to delete CAPI settings');
      return reply.status(404).send({ error: 'CAPI settings not found' });
    }

    log.info({ id, channel: data.channel }, 'CAPI settings deleted (soft)');
    return reply.send({ success: true, id: data.id });
  });

  // POST /capi-settings/generate-prompt — сгенерировать AI prompt из описаний L2/L3
  app.post('/capi-settings/generate-prompt', async (request: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({
      ai_l2_description: z.string().min(1, 'L2 description is required'),
      ai_l3_description: z.string().min(1, 'L3 description is required'),
    });

    const parseResult = schema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid payload',
        details: parseResult.error.flatten(),
      });
    }

    const { ai_l2_description, ai_l3_description } = parseResult.data;

    log.info({
      l2Length: ai_l2_description.length,
      l3Length: ai_l3_description.length,
    }, 'Generating CAPI qualification prompt');

    const prompt = generateQualificationPrompt(ai_l2_description, ai_l3_description);

    return reply.send({ data: { prompt } });
  });
}

// ========================================
// PROMPT GENERATION
// ========================================

function generateQualificationPrompt(l2Description: string, l3Description: string): string {
  return `Ты — AI-аналитик квалификации лидов. Анализируй диалог между ботом и клиентом в WhatsApp.

Определи два уровня квалификации:

## Level 2 — Квалифицирован (is_qualified)
Критерии от бизнеса:
${l2Description}

Отвечай is_qualified: true если клиент соответствует описанным критериям.

## Level 3 — Записался/Оплатил (is_scheduled)
Критерии от бизнеса:
${l3Description}

Отвечай is_scheduled: true если клиент соответствует описанным критериям.

Ответь СТРОГО в формате JSON:
{
  "is_qualified": true/false,
  "is_scheduled": true/false,
  "reasoning": "краткое объяснение на 1-2 предложения"
}`;
}
