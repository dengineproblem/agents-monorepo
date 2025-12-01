import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'adAccountsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CreateAdAccountSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  username: z.string().max(100).optional(),
  is_default: z.boolean().optional(),

  // Facebook (user fills IDs, admin fills access_token later)
  fb_ad_account_id: z.string().optional(),
  fb_page_id: z.string().optional(),
  fb_instagram_id: z.string().optional(),
  fb_instagram_username: z.string().optional(),
  fb_business_id: z.string().optional(),
  ig_seed_audience_id: z.string().optional(),

  // TikTok (OAuth fills these)
  tiktok_account_id: z.string().optional(),
  tiktok_business_id: z.string().optional(),

  // Prompts
  prompt1: z.string().optional(),
  prompt2: z.string().optional(),
  prompt3: z.string().optional(),
  prompt4: z.string().optional(),

  // Telegram
  telegram_id: z.string().optional(),
  telegram_id_2: z.string().optional(),
  telegram_id_3: z.string().optional(),
  telegram_id_4: z.string().optional(),

  // API Keys
  openai_api_key: z.string().optional(),
  gemini_api_key: z.string().optional(),

  // Tariff
  tarif: z.string().optional(),
  tarif_expires: z.string().optional(),
  tarif_renewal_cost: z.number().optional(),
});

const UpdateAdAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  username: z.string().max(100).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),

  // Facebook
  fb_ad_account_id: z.string().nullable().optional(),
  fb_page_id: z.string().nullable().optional(),
  fb_instagram_id: z.string().nullable().optional(),
  fb_instagram_username: z.string().nullable().optional(),
  fb_business_id: z.string().nullable().optional(),
  ig_seed_audience_id: z.string().nullable().optional(),

  // TikTok
  tiktok_account_id: z.string().nullable().optional(),
  tiktok_business_id: z.string().nullable().optional(),

  // Prompts
  prompt1: z.string().nullable().optional(),
  prompt2: z.string().nullable().optional(),
  prompt3: z.string().nullable().optional(),
  prompt4: z.string().nullable().optional(),

  // Telegram
  telegram_id: z.string().nullable().optional(),
  telegram_id_2: z.string().nullable().optional(),
  telegram_id_3: z.string().nullable().optional(),
  telegram_id_4: z.string().nullable().optional(),

  // API Keys
  openai_api_key: z.string().nullable().optional(),
  gemini_api_key: z.string().nullable().optional(),

  // Custom audiences
  custom_audiences: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).optional(),

  // Tariff
  tarif: z.string().nullable().optional(),
  tarif_expires: z.string().nullable().optional(),
  tarif_renewal_cost: z.number().nullable().optional(),

  // Status
  connection_status: z.enum(['pending', 'connected', 'error']).optional(),
  last_error: z.string().nullable().optional(),
});

type CreateAdAccountInput = z.infer<typeof CreateAdAccountSchema>;
type UpdateAdAccountInput = z.infer<typeof UpdateAdAccountSchema>;

// ========================================
// ROUTES
// ========================================

export async function adAccountsRoutes(app: FastifyInstance) {
  /**
   * GET /ad-accounts/:userAccountId
   * Получить все рекламные аккаунты пользователя
   */
  app.get('/ad-accounts/:userAccountId', async (
    req: FastifyRequest<{ Params: { userAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { userAccountId } = req.params;
    log.info({ userAccountId }, 'Fetching ad accounts');

    try {
      // Проверяем, включена ли мультиаккаунтность
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled')
        .eq('id', userAccountId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!user.multi_account_enabled) {
        return reply.send({
          multi_account_enabled: false,
          ad_accounts: [],
        });
      }

      const { data: adAccounts, error } = await supabase
        .from('ad_accounts')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: true });

      if (error) {
        log.error({ error }, 'Error fetching ad accounts');
        return reply.status(500).send({ error: 'Failed to fetch ad accounts' });
      }

      return reply.send({
        multi_account_enabled: true,
        ad_accounts: adAccounts || [],
      });
    } catch (error) {
      log.error({ error }, 'Error in ad-accounts route');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /ad-accounts/:userAccountId/:adAccountId
   * Получить конкретный рекламный аккаунт
   */
  app.get('/ad-accounts/:userAccountId/:adAccountId', async (
    req: FastifyRequest<{ Params: { userAccountId: string; adAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { userAccountId, adAccountId } = req.params;
    log.info({ userAccountId, adAccountId }, 'Fetching single ad account');

    try {
      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .select('*')
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId)
        .single();

      if (error || !adAccount) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      return reply.send(adAccount);
    } catch (error) {
      log.error({ error }, 'Error fetching ad account');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /ad-accounts
   * Создать новый рекламный аккаунт
   */
  app.post('/ad-accounts', async (
    req: FastifyRequest<{ Body: CreateAdAccountInput }>,
    reply: FastifyReply
  ) => {
    try {
      const validated = CreateAdAccountSchema.parse(req.body);
      const { userAccountId, ...adAccountData } = validated;

      log.info({ userAccountId, name: adAccountData.name }, 'Creating ad account');

      // Проверяем, включена ли мультиаккаунтность
      const { data: user, error: userError } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled')
        .eq('id', userAccountId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!user.multi_account_enabled) {
        return reply.status(400).send({
          error: 'Multi-account mode is not enabled for this user',
        });
      }

      // Создаём аккаунт (триггер проверит лимит 5 аккаунтов)
      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .insert({
          user_account_id: userAccountId,
          ...adAccountData,
        })
        .select()
        .single();

      if (error) {
        log.error({ error }, 'Error creating ad account');
        if (error.message.includes('Maximum 5')) {
          return reply.status(400).send({ error: 'Maximum 5 advertising accounts allowed' });
        }
        return reply.status(500).send({ error: 'Failed to create ad account' });
      }

      log.info({ adAccountId: adAccount.id }, 'Ad account created successfully');
      return reply.status(201).send(adAccount);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      log.error({ error }, 'Error creating ad account');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /ad-accounts/:adAccountId
   * Обновить рекламный аккаунт
   */
  app.patch('/ad-accounts/:adAccountId', async (
    req: FastifyRequest<{ Params: { adAccountId: string }; Body: UpdateAdAccountInput }>,
    reply: FastifyReply
  ) => {
    const { adAccountId } = req.params;

    try {
      const validated = UpdateAdAccountSchema.parse(req.body);

      log.info({ adAccountId, updates: Object.keys(validated) }, 'Updating ad account');

      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .update(validated)
        .eq('id', adAccountId)
        .select()
        .single();

      if (error) {
        log.error({ error }, 'Error updating ad account');
        return reply.status(500).send({ error: 'Failed to update ad account' });
      }

      if (!adAccount) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      log.info({ adAccountId }, 'Ad account updated successfully');
      return reply.send(adAccount);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      log.error({ error }, 'Error updating ad account');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /ad-accounts/:adAccountId
   * Удалить рекламный аккаунт
   */
  app.delete('/ad-accounts/:adAccountId', async (
    req: FastifyRequest<{ Params: { adAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { adAccountId } = req.params;

    log.info({ adAccountId }, 'Deleting ad account');

    try {
      const { error } = await supabase
        .from('ad_accounts')
        .delete()
        .eq('id', adAccountId);

      if (error) {
        log.error({ error }, 'Error deleting ad account');
        return reply.status(500).send({ error: 'Failed to delete ad account' });
      }

      log.info({ adAccountId }, 'Ad account deleted successfully');
      return reply.status(204).send();
    } catch (error) {
      log.error({ error }, 'Error deleting ad account');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /ad-accounts/:adAccountId/set-default
   * Установить аккаунт как дефолтный
   */
  app.post('/ad-accounts/:adAccountId/set-default', async (
    req: FastifyRequest<{ Params: { adAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { adAccountId } = req.params;

    log.info({ adAccountId }, 'Setting ad account as default');

    try {
      // Триггер автоматически сбросит is_default у других аккаунтов
      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .update({ is_default: true })
        .eq('id', adAccountId)
        .select()
        .single();

      if (error) {
        log.error({ error }, 'Error setting default ad account');
        return reply.status(500).send({ error: 'Failed to set default ad account' });
      }

      if (!adAccount) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      log.info({ adAccountId }, 'Ad account set as default');
      return reply.send(adAccount);
    } catch (error) {
      log.error({ error }, 'Error setting default ad account');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

export default adAccountsRoutes;
