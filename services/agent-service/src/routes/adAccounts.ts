import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { getPagePictureUrl } from '../adapters/facebook.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adAccountsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CreateAdAccountSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(1).max(100),
  username: z.string().max(100).optional(),

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
// HELPERS
// ========================================

/**
 * Маппинг данных из БД в формат frontend
 * DB: ad_account_id, page_id, instagram_id, business_id
 * Frontend: fb_ad_account_id, fb_page_id, fb_instagram_id, fb_business_id
 */
function mapDbToFrontend(dbRecord: Record<string, unknown>): Record<string, unknown> {
  return {
    ...dbRecord,
    // Facebook: маппим поля БД -> fb_* формат
    fb_ad_account_id: dbRecord.ad_account_id,
    fb_page_id: dbRecord.page_id,
    fb_instagram_id: dbRecord.instagram_id,
    fb_instagram_username: dbRecord.instagram_username,
    fb_access_token: dbRecord.access_token,
    fb_business_id: dbRecord.business_id,
    // Аватар страницы
    page_picture_url: dbRecord.page_picture_url,
  };
}

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

      log.info({ user, userError }, '[DEBUG] User data from Supabase');

      if (userError || !user) {
        log.error({ userError }, '[DEBUG] User not found or error');
        return reply.status(404).send({ error: 'User not found' });
      }

      log.info({ multi_account_enabled: user.multi_account_enabled, type: typeof user.multi_account_enabled }, '[DEBUG] multi_account_enabled value');

      if (!user.multi_account_enabled) {
        log.info('[DEBUG] Returning multi_account_enabled: false');
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
        ad_accounts: (adAccounts || []).map(mapDbToFrontend),
      });
    } catch (error: any) {
      log.error({ error }, 'Error in ad-accounts route');

      logErrorToAdmin({
        user_account_id: req.params.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'list_ad_accounts',
        endpoint: '/ad-accounts/:userAccountId',
        severity: 'warning'
      }).catch(() => {});

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

      return reply.send(mapDbToFrontend(adAccount));
    } catch (error: any) {
      log.error({ error }, 'Error fetching ad account');

      logErrorToAdmin({
        user_account_id: req.params.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_ad_account',
        endpoint: '/ad-accounts/:userAccountId/:adAccountId',
        severity: 'warning'
      }).catch(() => {});

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

      // Маппинг полей frontend -> DB
      // Frontend использует fb_* префиксы, в БД поля без префикса
      const dbData: Record<string, unknown> = {
        user_account_id: userAccountId,
        name: adAccountData.name,
        username: adAccountData.username,
        // Facebook: маппим fb_* -> поля БД
        ad_account_id: adAccountData.fb_ad_account_id,
        page_id: adAccountData.fb_page_id,
        instagram_id: adAccountData.fb_instagram_id,
        instagram_username: adAccountData.fb_instagram_username,
        business_id: adAccountData.fb_business_id,
        ig_seed_audience_id: adAccountData.ig_seed_audience_id,
        // TikTok (поля совпадают)
        tiktok_account_id: adAccountData.tiktok_account_id,
        tiktok_business_id: adAccountData.tiktok_business_id,
        // Prompts
        prompt1: adAccountData.prompt1,
        prompt2: adAccountData.prompt2,
        prompt3: adAccountData.prompt3,
        prompt4: adAccountData.prompt4,
        // Telegram
        telegram_id: adAccountData.telegram_id,
        telegram_id_2: adAccountData.telegram_id_2,
        telegram_id_3: adAccountData.telegram_id_3,
        telegram_id_4: adAccountData.telegram_id_4,
        // API Keys
        openai_api_key: adAccountData.openai_api_key,
        gemini_api_key: adAccountData.gemini_api_key,
        // Tariff
        tarif: adAccountData.tarif,
        tarif_expires: adAccountData.tarif_expires,
        tarif_renewal_cost: adAccountData.tarif_renewal_cost,
      };

      // Убираем undefined значения
      Object.keys(dbData).forEach(key => {
        if (dbData[key] === undefined) delete dbData[key];
      });

      // Создаём аккаунт (триггер проверит лимит 5 аккаунтов)
      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .insert(dbData)
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
      return reply.status(201).send(mapDbToFrontend(adAccount));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      log.error({ error }, 'Error creating ad account');

      logErrorToAdmin({
        user_account_id: (req.body as any)?.userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'create_ad_account',
        endpoint: '/ad-accounts',
        severity: 'warning'
      }).catch(() => {});

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

      // Маппинг полей frontend -> DB
      const dbData: Record<string, unknown> = {};

      if (validated.name !== undefined) dbData.name = validated.name;
      if (validated.username !== undefined) dbData.username = validated.username;
      if (validated.is_active !== undefined) dbData.is_active = validated.is_active;

      // Facebook: маппим fb_* -> поля БД
      if (validated.fb_ad_account_id !== undefined) dbData.ad_account_id = validated.fb_ad_account_id;
      if (validated.fb_page_id !== undefined) dbData.page_id = validated.fb_page_id;
      if (validated.fb_instagram_id !== undefined) dbData.instagram_id = validated.fb_instagram_id;
      if (validated.fb_instagram_username !== undefined) dbData.instagram_username = validated.fb_instagram_username;
      if (validated.fb_business_id !== undefined) dbData.business_id = validated.fb_business_id;
      if (validated.ig_seed_audience_id !== undefined) dbData.ig_seed_audience_id = validated.ig_seed_audience_id;

      // TikTok
      if (validated.tiktok_account_id !== undefined) dbData.tiktok_account_id = validated.tiktok_account_id;
      if (validated.tiktok_business_id !== undefined) dbData.tiktok_business_id = validated.tiktok_business_id;

      // Prompts
      if (validated.prompt1 !== undefined) dbData.prompt1 = validated.prompt1;
      if (validated.prompt2 !== undefined) dbData.prompt2 = validated.prompt2;
      if (validated.prompt3 !== undefined) dbData.prompt3 = validated.prompt3;
      if (validated.prompt4 !== undefined) dbData.prompt4 = validated.prompt4;

      // Telegram
      if (validated.telegram_id !== undefined) dbData.telegram_id = validated.telegram_id;
      if (validated.telegram_id_2 !== undefined) dbData.telegram_id_2 = validated.telegram_id_2;
      if (validated.telegram_id_3 !== undefined) dbData.telegram_id_3 = validated.telegram_id_3;
      if (validated.telegram_id_4 !== undefined) dbData.telegram_id_4 = validated.telegram_id_4;

      // API Keys
      if (validated.openai_api_key !== undefined) dbData.openai_api_key = validated.openai_api_key;
      if (validated.gemini_api_key !== undefined) dbData.gemini_api_key = validated.gemini_api_key;

      // Custom audiences
      if (validated.custom_audiences !== undefined) dbData.custom_audiences = validated.custom_audiences;

      // Tariff
      if (validated.tarif !== undefined) dbData.tarif = validated.tarif;
      if (validated.tarif_expires !== undefined) dbData.tarif_expires = validated.tarif_expires;
      if (validated.tarif_renewal_cost !== undefined) dbData.tarif_renewal_cost = validated.tarif_renewal_cost;

      // Status
      if (validated.connection_status !== undefined) dbData.connection_status = validated.connection_status;
      if (validated.last_error !== undefined) dbData.last_error = validated.last_error;

      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .update(dbData)
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
      return reply.send(mapDbToFrontend(adAccount));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      log.error({ error }, 'Error updating ad account');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'update_ad_account',
        endpoint: '/ad-accounts/:adAccountId',
        request_data: { adAccountId },
        severity: 'warning'
      }).catch(() => {});

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
    } catch (error: any) {
      log.error({ error }, 'Error deleting ad account');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'delete_ad_account',
        endpoint: '/ad-accounts/:adAccountId',
        request_data: { adAccountId },
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /ad-accounts/:adAccountId/refresh-picture
   * Обновить аватар страницы Facebook
   */
  app.post('/ad-accounts/:adAccountId/refresh-picture', async (
    req: FastifyRequest<{ Params: { adAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { adAccountId } = req.params;

    log.info({ adAccountId }, 'Refreshing page picture');

    try {
      // Получаем аккаунт с токеном и page_id
      const { data: adAccount, error: fetchError } = await supabase
        .from('ad_accounts')
        .select('page_id, access_token')
        .eq('id', adAccountId)
        .single();

      if (fetchError || !adAccount) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      if (!adAccount.page_id || !adAccount.access_token) {
        return reply.status(400).send({ error: 'Page ID or access token not configured' });
      }

      // Получаем URL аватара через Graph API
      const pictureUrl = await getPagePictureUrl(adAccount.page_id, adAccount.access_token);

      if (!pictureUrl) {
        return reply.status(400).send({ error: 'Could not get page picture' });
      }

      // Сохраняем URL в БД
      const { error: updateError } = await supabase
        .from('ad_accounts')
        .update({ page_picture_url: pictureUrl })
        .eq('id', adAccountId);

      if (updateError) {
        log.error({ error: updateError }, 'Error updating page picture');
        return reply.status(500).send({ error: 'Failed to update page picture' });
      }

      log.info({ adAccountId, pictureUrl }, 'Page picture updated');
      return reply.send({ success: true, page_picture_url: pictureUrl });
    } catch (error: any) {
      log.error({ error }, 'Error refreshing page picture');

      logErrorToAdmin({
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'refresh_page_picture',
        endpoint: '/ad-accounts/:adAccountId/refresh-picture',
        request_data: { adAccountId },
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /ad-accounts/refresh-all-pictures
   * Обновить аватары для всех аккаунтов пользователя
   */
  app.post('/ad-accounts/:userAccountId/refresh-all-pictures', async (
    req: FastifyRequest<{ Params: { userAccountId: string } }>,
    reply: FastifyReply
  ) => {
    const { userAccountId } = req.params;

    log.info({ userAccountId }, 'Refreshing all page pictures');

    try {
      // Получаем все аккаунты с токеном и page_id
      const { data: adAccounts, error: fetchError } = await supabase
        .from('ad_accounts')
        .select('id, page_id, access_token')
        .eq('user_account_id', userAccountId)
        .not('page_id', 'is', null)
        .not('access_token', 'is', null);

      if (fetchError) {
        return reply.status(500).send({ error: 'Failed to fetch ad accounts' });
      }

      const results: Array<{ id: string; success: boolean; page_picture_url?: string }> = [];

      for (const account of adAccounts || []) {
        try {
          const pictureUrl = await getPagePictureUrl(account.page_id, account.access_token);

          if (pictureUrl) {
            await supabase
              .from('ad_accounts')
              .update({ page_picture_url: pictureUrl })
              .eq('id', account.id);

            results.push({ id: account.id, success: true, page_picture_url: pictureUrl });
          } else {
            results.push({ id: account.id, success: false });
          }
        } catch (err) {
          results.push({ id: account.id, success: false });
        }
      }

      log.info({ userAccountId, updated: results.filter(r => r.success).length }, 'Page pictures refreshed');
      return reply.send({ success: true, results });
    } catch (error: any) {
      log.error({ error }, 'Error refreshing page pictures');

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'refresh_all_page_pictures',
        endpoint: '/ad-accounts/:userAccountId/refresh-all-pictures',
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

}

export default adAccountsRoutes;
