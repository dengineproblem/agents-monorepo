import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { getPageAccessToken } from '../lib/facebookHelpers.js';

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
  anthropic_api_key: z.string().optional(),

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
  fb_access_token: z.string().nullable().optional(),  // User Access Token
  fb_business_id: z.string().nullable().optional(),
  ig_seed_audience_id: z.string().nullable().optional(),

  // TikTok
  tiktok_account_id: z.string().nullable().optional(),
  tiktok_business_id: z.string().nullable().optional(),
  tiktok_access_token: z.string().nullable().optional(),

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
  anthropic_api_key: z.string().nullable().optional(),

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
  connection_status: z.enum(['pending', 'pending_review', 'connected', 'error']).optional(),
  last_error: z.string().nullable().optional(),

  // Autopilot settings
  autopilot: z.boolean().optional(),
  autopilot_tiktok: z.boolean().optional(),
  optimization: z.boolean().optional(),
  plan_daily_budget_cents: z.number().nullable().optional(),
  default_cpl_target_cents: z.number().nullable().optional(),

  // Brain settings
  brain_mode: z.enum(['autopilot', 'report', 'semi_auto']).optional(),
  brain_schedule_hour: z.number().int().min(0).max(23).optional(),
  brain_timezone: z.string().optional(),
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
  // SECURITY: Явный whitelist полей (вместо ...dbRecord spread).
  // FB/TikTok токены возвращаем — фронтенд использует их для прямых Graph API запросов.
  // AI API ключи маскируем — используются только на бэкенде.
  // IDOR-защита гарантирует что пользователь видит только СВОИ аккаунты.
  const maskSecret = (val: unknown): string | null => val ? '***' : null;

  return {
    // Идентификация
    id: dbRecord.id,
    user_account_id: dbRecord.user_account_id,
    name: dbRecord.name,
    username: dbRecord.username,
    is_active: dbRecord.is_active,
    created_at: dbRecord.created_at,
    updated_at: dbRecord.updated_at,

    // Facebook (маппинг DB → fb_* формат) — токен НЕ отдаём, все вызовы через /fb-proxy
    fb_ad_account_id: dbRecord.ad_account_id,
    fb_page_id: dbRecord.page_id,
    fb_instagram_id: dbRecord.instagram_id,
    fb_instagram_username: dbRecord.instagram_username,
    fb_business_id: dbRecord.business_id,
    fb_access_token: maskSecret(dbRecord.access_token),
    ig_seed_audience_id: dbRecord.ig_seed_audience_id,

    // TikTok — токен маскируем, бэкенд использует из БД
    tiktok_account_id: dbRecord.tiktok_account_id,
    tiktok_business_id: dbRecord.tiktok_business_id,
    tiktok_access_token: maskSecret(dbRecord.tiktok_access_token),

    // AI API Keys — маскируем, используются только на бэкенде
    openai_api_key: maskSecret(dbRecord.openai_api_key),
    gemini_api_key: maskSecret(dbRecord.gemini_api_key),
    anthropic_api_key: maskSecret(dbRecord.anthropic_api_key),

    // Аватар страницы
    page_picture_url: dbRecord.page_picture_url,

    // Telegram
    telegram_id: dbRecord.telegram_id,
    telegram_id_2: dbRecord.telegram_id_2,
    telegram_id_3: dbRecord.telegram_id_3,
    telegram_id_4: dbRecord.telegram_id_4,

    // Промпты
    prompt1: dbRecord.prompt1,
    prompt2: dbRecord.prompt2,
    prompt3: dbRecord.prompt3,
    prompt4: dbRecord.prompt4,

    // Статус — вычисляем из данных, а не из БД
    connection_status: (dbRecord.access_token && dbRecord.ad_account_id)
      ? 'connected'
      : (dbRecord.page_id || dbRecord.ad_account_id)
        ? 'pending_review'
        : (dbRecord.connection_status || 'pending'),
    last_error: dbRecord.last_error,

    // Autopilot
    autopilot: dbRecord.autopilot ?? false,
    autopilot_tiktok: dbRecord.autopilot_tiktok ?? false,
    optimization: dbRecord.optimization ?? false,
    plan_daily_budget_cents: dbRecord.plan_daily_budget_cents ?? null,
    default_cpl_target_cents: dbRecord.default_cpl_target_cents ?? null,

    // Brain
    brain_mode: dbRecord.brain_mode || 'report',
    brain_schedule_hour: dbRecord.brain_schedule_hour ?? 8,
    brain_timezone: dbRecord.brain_timezone || 'Asia/Almaty',

    // Тариф
    tarif: dbRecord.tarif,
    tarif_expires: dbRecord.tarif_expires,
    tarif_renewal_cost: dbRecord.tarif_renewal_cost,

    // Custom audiences
    custom_audiences: dbRecord.custom_audiences,
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

      if (userError || !user) {
        log.warn({ userAccountId, userError }, 'User not found');
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
   * GET /ad-accounts/:userAccountId/all-stats
   * Получить статистику для всех рекламных аккаунтов пользователя
   *
   * @param userAccountId - UUID пользователя
   * @query since - Начало периода (YYYY-MM-DD)
   * @query until - Конец периода (YYYY-MM-DD)
   *
   * @returns { accounts: AccountStats[] }
   */
  app.get('/ad-accounts/:userAccountId/all-stats', async (
    req: FastifyRequest<{
      Params: { userAccountId: string };
      Querystring: { since?: string; until?: string };
    }>,
    reply: FastifyReply
  ) => {
    const requestStartTime = Date.now();
    const { userAccountId } = req.params;
    const { since, until } = req.query;

    log.info({
      userAccountId,
      dateRange: { since, until },
      requestId: req.id
    }, '[all-stats] Starting request');

    // Валидация userAccountId как UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userAccountId)) {
      log.warn({ userAccountId }, '[all-stats] Invalid userAccountId format');
      return reply.status(400).send({ error: 'Invalid userAccountId format' });
    }

    // Валидация query параметров
    const queryValidation = AllStatsQuerySchema.safeParse({ since, until });
    if (!queryValidation.success) {
      log.warn({
        userAccountId,
        errors: queryValidation.error.errors
      }, '[all-stats] Invalid query parameters');
      return reply.status(400).send({
        error: 'Invalid date format',
        details: queryValidation.error.errors
      });
    }

    try {
      // Получаем все аккаунты пользователя
      log.debug({ userAccountId }, '[all-stats] Fetching ad accounts from database');

      const { data: adAccounts, error: fetchError } = await supabase
        .from('ad_accounts')
        .select('id, name, page_id, connection_status, is_active, ad_account_id, access_token')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: true });

      if (fetchError) {
        log.error({
          userAccountId,
          error: fetchError.message,
          code: fetchError.code
        }, '[all-stats] Database error fetching ad accounts');
        return reply.status(500).send({ error: 'Failed to fetch ad accounts' });
      }

      const accountCount = adAccounts?.length || 0;
      log.info({
        userAccountId,
        accountCount
      }, '[all-stats] Ad accounts fetched from database');

      if (accountCount === 0) {
        log.debug({ userAccountId }, '[all-stats] No accounts found, returning empty array');
        return reply.send({ accounts: [] });
      }

      // Подготавливаем базовые данные аккаунтов
      const accountsBase = (adAccounts || []).map(account => {
        // Вычисляем статус из данных: есть токен = подключён, есть IDs но нет токена = на проверке
        const computedStatus = (account.access_token && account.ad_account_id)
          ? 'connected'
          : (account.page_id || account.ad_account_id)
            ? 'pending_review'
            : 'pending';
        return {
          id: account.id,
          name: account.name,
          fb_page_id: account.page_id,
          connection_status: computedStatus,
          is_active: account.is_active !== false,
          fb_ad_account_id: account.ad_account_id,
          access_token: account.access_token,
        };
      });

      // Фильтруем аккаунты с credentials
      const accountsWithCredentials = accountsBase.filter(acc => acc.access_token && acc.fb_ad_account_id);

      // Для статистики нужны даты
      const accountsToFetchStats = since && until ? accountsWithCredentials : [];

      log.info({
        userAccountId,
        totalAccounts: accountCount,
        accountsWithCredentials: accountsWithCredentials.length,
        accountsToFetchStats: accountsToFetchStats.length,
        hasDates: !!(since && until)
      }, '[all-stats] Preparing to fetch Facebook data');

      // Запрашиваем статус для ВСЕХ аккаунтов с credentials (независимо от дат)
      const statusPromises = accountsWithCredentials.map(async account => {
        const accountStatus = await fetchFacebookAccountStatus(
          account.fb_ad_account_id!,
          account.access_token!,
          account.id
        );
        return { accountId: account.id, accountStatus };
      });

      // Запрашиваем статистику только если есть даты
      const statsPromises = accountsToFetchStats.map(async account => {
        const stats = await fetchFacebookStatsForAccount(
          account.fb_ad_account_id!,
          account.access_token!,
          since!,
          until!,
          account.id
        );
        return { accountId: account.id, stats };
      });

      // Выполняем все запросы параллельно
      const [statusResults, statsResults] = await Promise.all([
        Promise.all(statusPromises),
        Promise.all(statsPromises),
      ]);

      // Создаём maps для быстрого доступа к статистике и статусу
      const statsMap = new Map<string, FacebookStats | null>();
      const statusMap = new Map<string, FacebookAccountStatus | null>();

      for (const result of statusResults) {
        statusMap.set(result.accountId, result.accountStatus);
      }
      for (const result of statsResults) {
        statsMap.set(result.accountId, result.stats);
      }

      // Собираем финальный результат
      const accountsWithStats = accountsBase.map(account => {
        const status = statusMap.get(account.id);
        return {
          id: account.id,
          name: account.name,
          fb_page_id: account.fb_page_id,
          connection_status: account.connection_status,
          is_active: account.is_active,
          fb_account_status: status?.account_status ?? null,
          fb_disable_reason: status?.disable_reason ?? null,
          stats: statsMap.get(account.id) || null,
        };
      });

      // Считаем статистику для логирования
      const accountsWithStatsCount = accountsWithStats.filter(a => a.stats !== null).length;
      const totalDuration = Date.now() - requestStartTime;

      log.info({
        userAccountId,
        totalAccounts: accountCount,
        accountsWithStats: accountsWithStatsCount,
        durationMs: totalDuration,
        requestId: req.id
      }, '[all-stats] Request completed successfully');

      return reply.send({ accounts: accountsWithStats });
    } catch (error: any) {
      const totalDuration = Date.now() - requestStartTime;

      log.error({
        userAccountId,
        error: error.message,
        stack: error.stack?.slice(0, 500),
        durationMs: totalDuration,
        requestId: req.id
      }, '[all-stats] Unexpected error');

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'get_all_account_stats',
        endpoint: '/ad-accounts/:userAccountId/all-stats',
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
        anthropic_api_key: adAccountData.anthropic_api_key,
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
        if (error.message.includes('Maximum 10')) {
          return reply.status(400).send({ error: 'Maximum 10 advertising accounts allowed' });
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
    const userAccountId = req.headers['x-user-id'] as string;

    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    try {
      const validated = UpdateAdAccountSchema.parse(req.body);

      log.info({ adAccountId, userAccountId, updates: Object.keys(validated) }, 'Updating ad account');

      // Маппинг полей frontend -> DB
      const dbData: Record<string, unknown> = {};

      // SECURITY: Игнорируем маскированные токены — '***' означает "без изменений"
      const isMasked = (val: unknown): boolean => val === '***';

      if (validated.name !== undefined) dbData.name = validated.name;
      if (validated.username !== undefined) dbData.username = validated.username;
      if (validated.is_active !== undefined) dbData.is_active = validated.is_active;

      // Facebook: маппим fb_* -> поля БД
      if (validated.fb_ad_account_id !== undefined) dbData.ad_account_id = validated.fb_ad_account_id;
      if (validated.fb_page_id !== undefined) dbData.page_id = validated.fb_page_id;
      if (validated.fb_instagram_id !== undefined) dbData.instagram_id = validated.fb_instagram_id;
      if (validated.fb_instagram_username !== undefined) dbData.instagram_username = validated.fb_instagram_username;
      if (validated.fb_access_token !== undefined && !isMasked(validated.fb_access_token)) dbData.access_token = validated.fb_access_token;
      if (validated.fb_business_id !== undefined) dbData.business_id = validated.fb_business_id;
      if (validated.ig_seed_audience_id !== undefined) dbData.ig_seed_audience_id = validated.ig_seed_audience_id;

      // If access_token is being updated and we have page_id, try to get Page Access Token
      if (validated.fb_access_token && !isMasked(validated.fb_access_token) && (validated.fb_page_id || dbData.page_id)) {
        const pageId = validated.fb_page_id || dbData.page_id as string;
        try {
          const pageToken = await getPageAccessToken(pageId, validated.fb_access_token);
          if (pageToken) {
            dbData.fb_page_access_token = pageToken;
            log.info({ adAccountId, pageId }, 'Obtained Page Access Token for ad account');
          }
        } catch (err) {
          log.warn({ err, adAccountId }, 'Failed to get Page Access Token');
        }
      }

      // TikTok
      if (validated.tiktok_account_id !== undefined) {
        dbData.tiktok_account_id = validated.tiktok_account_id;
        log.info({
          adAccountId,
          tiktok_account_id: validated.tiktok_account_id ? '***set***' : null,
          action: validated.tiktok_account_id ? 'connect' : 'disconnect'
        }, 'Updating TikTok account ID');
      }
      if (validated.tiktok_business_id !== undefined) {
        dbData.tiktok_business_id = validated.tiktok_business_id;
        log.info({
          adAccountId,
          tiktok_business_id: validated.tiktok_business_id || null,
          action: validated.tiktok_business_id ? 'connect' : 'disconnect'
        }, 'Updating TikTok business ID');
      }
      if (validated.tiktok_access_token !== undefined && !isMasked(validated.tiktok_access_token)) {
        dbData.tiktok_access_token = validated.tiktok_access_token;
        log.info({
          adAccountId,
          tiktok_access_token: validated.tiktok_access_token ? '***set***' : null,
          action: validated.tiktok_access_token ? 'connect' : 'disconnect'
        }, 'Updating TikTok access token');
      }

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

      // API Keys (игнорируем маскированные значения)
      if (validated.openai_api_key !== undefined && !isMasked(validated.openai_api_key)) dbData.openai_api_key = validated.openai_api_key;
      if (validated.gemini_api_key !== undefined && !isMasked(validated.gemini_api_key)) dbData.gemini_api_key = validated.gemini_api_key;
      if (validated.anthropic_api_key !== undefined && !isMasked(validated.anthropic_api_key)) dbData.anthropic_api_key = validated.anthropic_api_key;

      // Custom audiences
      if (validated.custom_audiences !== undefined) dbData.custom_audiences = validated.custom_audiences;

      // Tariff
      if (validated.tarif !== undefined) dbData.tarif = validated.tarif;
      if (validated.tarif_expires !== undefined) dbData.tarif_expires = validated.tarif_expires;
      if (validated.tarif_renewal_cost !== undefined) dbData.tarif_renewal_cost = validated.tarif_renewal_cost;

      // Status
      if (validated.connection_status !== undefined) dbData.connection_status = validated.connection_status;
      if (validated.last_error !== undefined) dbData.last_error = validated.last_error;

      // Autopilot settings
      if (validated.autopilot !== undefined) {
        dbData.autopilot = validated.autopilot;
        log.info({ adAccountId, autopilot: validated.autopilot }, 'Updating Facebook autopilot setting');
      }
      if (validated.autopilot_tiktok !== undefined) {
        dbData.autopilot_tiktok = validated.autopilot_tiktok;
        log.info({ adAccountId, autopilot_tiktok: validated.autopilot_tiktok }, 'Updating TikTok autopilot setting');
      }
      if (validated.optimization !== undefined) dbData.optimization = validated.optimization;
      if (validated.plan_daily_budget_cents !== undefined) dbData.plan_daily_budget_cents = validated.plan_daily_budget_cents;
      if (validated.default_cpl_target_cents !== undefined) dbData.default_cpl_target_cents = validated.default_cpl_target_cents;

      // Brain settings
      if (validated.brain_mode !== undefined) dbData.brain_mode = validated.brain_mode;
      if (validated.brain_schedule_hour !== undefined) dbData.brain_schedule_hour = validated.brain_schedule_hour;
      if (validated.brain_timezone !== undefined) dbData.brain_timezone = validated.brain_timezone;

      const { data: adAccount, error } = await supabase
        .from('ad_accounts')
        .update(dbData)
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId)
        .select()
        .single();

      if (error || !adAccount) {
        log.warn({ adAccountId, userAccountId, error }, 'Ad account not found or access denied');
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      log.info({ adAccountId, userAccountId }, 'Ad account updated successfully');
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
    const userAccountId = req.headers['x-user-id'] as string;

    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    log.info({ adAccountId, userAccountId }, 'Deleting ad account');

    try {
      // Сначала проверяем что аккаунт принадлежит пользователю
      const { data: existing } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId)
        .single();

      if (!existing) {
        log.warn({ adAccountId, userAccountId }, 'Ad account not found or access denied for delete');
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      const { error } = await supabase
        .from('ad_accounts')
        .delete()
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId);

      if (error) {
        log.error({ error }, 'Error deleting ad account');
        return reply.status(500).send({ error: 'Failed to delete ad account' });
      }

      log.info({ adAccountId, userAccountId }, 'Ad account deleted successfully');
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
    const userAccountId = req.headers['x-user-id'] as string;

    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    log.info({ adAccountId, userAccountId }, 'Refreshing page picture');

    try {
      // Получаем аккаунт с токеном и page_id (с проверкой владельца)
      const { data: adAccount, error: fetchError } = await supabase
        .from('ad_accounts')
        .select('page_id, access_token')
        .eq('id', adAccountId)
        .eq('user_account_id', userAccountId)
        .single();

      if (fetchError || !adAccount) {
        return reply.status(404).send({ error: 'Ad account not found' });
      }

      if (!adAccount.page_id || !adAccount.access_token) {
        return reply.status(400).send({ error: 'Page ID or access token not configured' });
      }

      // Возвращаем прямой URL с Facebook Graph API (без кэширования)
      // Клиент использует https://graph.facebook.com/{page_id}/picture?type=large напрямую
      const pictureUrl = `https://graph.facebook.com/${adAccount.page_id}/picture?type=large`;

      log.info({ adAccountId, pictureUrl }, 'Page picture URL generated');
      return reply.send({ success: true, page_picture_url: pictureUrl, fb_page_id: adAccount.page_id });
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

      // Возвращаем прямые URL с Facebook Graph API (без кэширования)
      const results = (adAccounts || []).map(account => ({
        id: account.id,
        success: true,
        page_picture_url: `https://graph.facebook.com/${account.page_id}/picture?type=large`,
        fb_page_id: account.page_id,
      }));

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

  // ========================================
  // VALIDATION SCHEMA FOR ALL-STATS
  // ========================================

  const AllStatsQuerySchema = z.object({
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  });

  // ========================================
  // HELPER: Fetch Facebook account status
  // ========================================

  // Facebook account_status codes:
  // 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED (задолженность)
  // 7 = PENDING_RISK_REVIEW, 8 = PENDING_SETTLEMENT, 9 = IN_GRACE_PERIOD
  // 100 = PENDING_CLOSURE, 101 = CLOSED
  interface FacebookAccountStatus {
    account_status: number;
    disable_reason?: number;
  }

  async function fetchFacebookAccountStatus(
    adAccountId: string,
    accessToken: string,
    accountDbId: string
  ): Promise<FacebookAccountStatus | null> {
    const fbAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    try {
      const url = new URL(`https://graph.facebook.com/v18.0/${fbAccountId}`);
      url.searchParams.set('access_token', accessToken);
      url.searchParams.set('fields', 'account_status,disable_reason');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд

      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        log.warn({ accountDbId, status: response.status, error: errorText.slice(0, 200) }, 'Failed to fetch account status');
        return null;
      }

      const data = await response.json();

      log.info({
        accountDbId,
        fbAccountId: fbAccountId.slice(0, 15) + '...',
        account_status: data.account_status,
        disable_reason: data.disable_reason,
      }, '[fetchFacebookAccountStatus] Got account status from Facebook');

      return {
        account_status: data.account_status ?? 1,
        disable_reason: data.disable_reason,
      };
    } catch (error: any) {
      log.warn({ accountDbId, error: error.message }, 'Error fetching account status');
      return null;
    }
  }

  // ========================================
  // HELPER: Fetch Facebook stats for single account
  // ========================================

  interface FacebookStats {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    cpl: number;
    ctr: number; // Click-through rate (%)
    cpm: number; // Cost per mille (cost per 1000 impressions)
    messagingLeads: number; // total_messaging_connection
    qualityLeads: number; // messaging_user_depth_2_message_send (≥2 messages)
    cpql: number; // Cost per qualified lead
    qualityRate: number; // (qualityLeads / messagingLeads) × 100
  }

  async function fetchFacebookStatsForAccount(
    adAccountId: string,
    accessToken: string,
    since: string,
    until: string,
    accountDbId: string
  ): Promise<FacebookStats | null> {
    const startTime = Date.now();
    const fbAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    log.debug({
      accountDbId,
      fbAccountId: fbAccountId.slice(0, 10) + '...',
      dateRange: { since, until }
    }, 'Fetching Facebook stats for account');

    try {
      const insightsUrl = new URL(`https://graph.facebook.com/v18.0/${fbAccountId}/insights`);
      insightsUrl.searchParams.set('access_token', accessToken);
      insightsUrl.searchParams.set('level', 'account');
      insightsUrl.searchParams.set('fields', 'spend,impressions,clicks,actions');
      insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));

      // Добавляем таймаут для fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 секунд таймаут

      const response = await fetch(insightsUrl.toString(), {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        log.warn({
          accountDbId,
          fbAccountId: fbAccountId.slice(0, 10) + '...',
          status: response.status,
          durationMs: duration,
          error: errorText.slice(0, 200)
        }, 'Facebook API returned error');
        return null;
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        log.debug({
          accountDbId,
          durationMs: duration
        }, 'No insights data returned from Facebook');
        return null;
      }

      const insight = data.data[0];
      const spend = parseFloat(insight.spend || '0');
      const impressions = parseInt(insight.impressions || '0', 10);
      const clicks = parseInt(insight.clicks || '0', 10);

      // Подсчёт лидов из actions с раздельным учётом messaging и quality
      let leads = 0;
      let messagingLeads = 0;
      let qualityLeads = 0;

      if (insight.actions && Array.isArray(insight.actions)) {
        for (const action of insight.actions) {
          // Messaging leads (переписки)
          if (action.action_type === 'onsite_conversion.total_messaging_connection') {
            const value = parseInt(action.value || '0', 10);
            messagingLeads = value;
            leads += value;
          }
          // Quality leads (≥2 сообщения)
          else if (action.action_type === 'onsite_conversion.messaging_user_depth_2_message_send') {
            qualityLeads = parseInt(action.value || '0', 10);
          }
          // Site leads и lead forms
          else if (
            action.action_type === 'offsite_conversion.fb_pixel_lead' ||
            action.action_type === 'onsite_conversion.lead_grouped'
          ) {
            leads += parseInt(action.value || '0', 10);
          }
        }
      }

      // Расчет производных метрик качества
      const cpql = qualityLeads > 0 ? spend / qualityLeads : 0;
      const qualityRate = messagingLeads > 0 ? (qualityLeads / messagingLeads) * 100 : 0;

      const stats: FacebookStats = {
        spend,
        leads,
        impressions,
        clicks,
        cpl: leads > 0 ? spend / leads : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        messagingLeads,
        qualityLeads,
        cpql,
        qualityRate,
      };

      log.debug({
        accountDbId,
        durationMs: duration,
        stats: { spend, leads, impressions }
      }, 'Facebook stats fetched successfully');

      return stats;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.name === 'AbortError') {
        log.warn({
          accountDbId,
          durationMs: duration
        }, 'Facebook API request timed out');
      } else {
        log.warn({
          accountDbId,
          durationMs: duration,
          error: error.message
        }, 'Failed to fetch Facebook stats');
      }

      return null;
    }
  }

}

export default adAccountsRoutes;
