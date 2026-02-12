import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { resolveFacebookError } from '../lib/facebookErrors.js';
import { resolveTikTokError } from '../lib/tiktokErrors.js';
import { onDirectionCreated } from '../lib/onboardingHelper.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';
import { getPageAccessToken, subscribePageToLeadgen } from '../lib/facebookHelpers.js';
import { getTikTokCredentials, getTikTokObjectiveConfig } from '../lib/tiktokSettings.js';
import { getAppInstallsConfig, getAppInstallsConfigEnvHints } from '../lib/appInstallsConfig.js';
import { tt } from '../adapters/tiktok.js';

const log = createLogger({ module: 'directionsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

// CAPI field config schema
const CapiFieldConfigSchema = z.object({
  field_id: z.union([z.string(), z.number()]),
  field_name: z.string(),
  field_type: z.string(),
  enum_id: z.union([z.string(), z.number(), z.null()]).optional(),
  enum_value: z.string().nullable().optional(),
  entity_type: z.string().optional(), // for Bitrix24
  pipeline_id: z.union([z.string(), z.number(), z.null()]).optional(),
  status_id: z.union([z.string(), z.number(), z.null()]).optional(),
});

const DirectionPlatformSchema = z.enum(['facebook', 'tiktok', 'both']);
const TikTokObjectiveSchema = z.enum(['traffic', 'conversions', 'lead_generation']);
const TikTokAdGroupModeSchema = z.enum(['use_existing', 'create_new']);
const DefaultSettingsSchema = z.object({
  cities: z.array(z.string()).optional(),
  age_min: z.number().int().min(18).max(65).optional(),
  age_max: z.number().int().min(18).max(65).optional(),
  gender: z.enum(['all', 'male', 'female']).optional(),
  description: z.string().optional(),
  // WhatsApp specific
  client_question: z.string().optional(),
  // Instagram specific
  instagram_url: z.string().url().optional(),
  // Site Leads specific
  site_url: z.string().url().optional(),
  pixel_id: z.string().nullable().optional(),
  utm_tag: z.string().optional(),
  // Lead Forms specific
  lead_form_id: z.string().optional(),
  // App Installs specific
  app_id: z.string().optional(),
  app_store_url: z.string().url().optional(),
  is_skadnetwork_attribution: z.boolean().optional(),
});

type DirectionPlatform = z.infer<typeof DirectionPlatformSchema>;
type TikTokObjectiveInput = z.infer<typeof TikTokObjectiveSchema>;
type DirectionObjective = 'whatsapp' | 'conversions' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | 'app_installs';

const TIKTOK_MIN_DAILY_BUDGET = 2500;
const DEFAULT_FB_DAILY_BUDGET_CENTS = 500;
const DEFAULT_FB_TARGET_CPL_CENTS = 50;

const TIKTOK_OBJECTIVE_TO_DIRECTION_OBJECTIVE: Record<
  TikTokObjectiveInput,
  DirectionObjective
> = {
  traffic: 'instagram_traffic',
  conversions: 'site_leads',
  lead_generation: 'lead_forms',
};

function mapTikTokObjectiveToDirectionObjective(objective: TikTokObjectiveInput): DirectionObjective {
  return TIKTOK_OBJECTIVE_TO_DIRECTION_OBJECTIVE[objective] || 'instagram_traffic';
}

function getTikTokObjectiveLabel(objective: TikTokObjectiveInput) {
  switch (objective) {
    case 'traffic':
      return 'Traffic';
    case 'conversions':
      return 'Conversions';
    case 'lead_generation':
      return 'Lead Gen';
    default:
      return 'Traffic';
  }
}

function normalizeDirectionPlatform(platform?: string | null): 'facebook' | 'tiktok' {
  return platform === 'tiktok' ? 'tiktok' : 'facebook';
}

function normalizeCustomAudiences(raw: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any) => ({
      id: String(item?.id || '').trim(),
      name: String(item?.name || item?.id || '').trim(),
    }))
    .filter((item) => item.id.length > 0);
}

const CreateDirectionSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional().nullable(), // UUID из ad_accounts.id для мультиаккаунтности
  platform: DirectionPlatformSchema.optional(),
  name: z.string().min(2).max(100),
  objective: z.enum(['whatsapp', 'conversions', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs']).optional(),
  conversion_channel: z.enum(['whatsapp', 'lead_form', 'site']).optional(),
  optimization_level: z.enum(['level_1', 'level_2', 'level_3']).optional(),
  use_instagram: z.boolean().optional(),
  advantage_audience_enabled: z.boolean().optional(),
  custom_audience_id: z.string().nullable().optional(),
  daily_budget_cents: z.number().int().min(500).optional(), // минимум $5
  target_cpl_cents: z.number().int().min(10).optional(), // минимум $0.10 для instagram_traffic, проверяется в refine
  whatsapp_phone_number: z.string().optional(), // Номер передается напрямую, не ID
  whatsapp_connection_type: z.enum(['evolution', 'waba']).optional(),
  whatsapp_waba_phone_id: z.string().optional(),
  tiktok_objective: TikTokObjectiveSchema.optional(),
  tiktok_daily_budget: z.number().min(TIKTOK_MIN_DAILY_BUDGET).optional(),
  tiktok_target_cpl_kzt: z.number().min(0).optional(),
  tiktok_target_cpl: z.number().min(0).optional(),
  tiktok_adgroup_mode: TikTokAdGroupModeSchema.optional(),
  tiktok_instant_page_id: z.string().optional(),
  // Опциональные дефолтные настройки рекламы
  default_settings: DefaultSettingsSchema.optional(),
  facebook_default_settings: DefaultSettingsSchema.optional(),
  tiktok_default_settings: DefaultSettingsSchema.optional(),
  // CAPI settings (direction-level)
  capi_enabled: z.boolean().optional(),
  capi_source: z.enum(['whatsapp', 'crm']).nullable().optional(),
  capi_crm_type: z.enum(['amocrm', 'bitrix24']).nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_access_token: z.string().nullable().optional(),
  capi_event_level: z.number().int().min(1).max(3).nullable().optional(),
}).superRefine((data, ctx) => {
  const platform = data.platform || 'facebook';
  const needsFacebook = platform === 'facebook' || platform === 'both';
  const needsTikTok = platform === 'tiktok' || platform === 'both';

  if (needsFacebook) {
    if (!data.objective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'objective is required for Facebook',
        path: ['objective'],
      });
    }
    if (data.daily_budget_cents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'daily_budget_cents is required for Facebook',
        path: ['daily_budget_cents'],
      });
    }
    if (data.target_cpl_cents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_cpl_cents is required for Facebook',
        path: ['target_cpl_cents'],
      });
    }
  }

  if (needsTikTok) {
    if (!data.tiktok_objective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tiktok_objective is required for TikTok',
        path: ['tiktok_objective'],
      });
    }
    if (data.tiktok_daily_budget === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tiktok_daily_budget is required and must be >= ${TIKTOK_MIN_DAILY_BUDGET}`,
        path: ['tiktok_daily_budget'],
      });
    }
  }

  if (data.objective && data.target_cpl_cents !== undefined) {
    // Для instagram_traffic минимум 10 центов ($0.10), для остальных 50 центов ($0.50)
    const minCents = data.objective === 'instagram_traffic' ? 10 : 50;
    if (data.target_cpl_cents < minCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_cpl_cents is below minimum for this objective',
        path: ['target_cpl_cents'],
      });
    }
  }

  // conversion_channel обязателен для objective=conversions
  if (data.objective === 'conversions' && !data.conversion_channel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'conversion_channel is required when objective is conversions',
      path: ['conversion_channel'],
    });
  }
});

const UpdateDirectionSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  daily_budget_cents: z.number().int().min(500).optional(),
  target_cpl_cents: z.number().int().min(10).optional(), // минимум проверяется в handler по objective
  is_active: z.boolean().optional(),
  advantage_audience_enabled: z.boolean().optional(),
  custom_audience_id: z.string().nullable().optional(),
  whatsapp_phone_number: z.string().nullable().optional(), // Номер передается напрямую
  whatsapp_connection_type: z.enum(['evolution', 'waba']).optional(),
  whatsapp_waba_phone_id: z.string().nullable().optional(),
  tiktok_objective: TikTokObjectiveSchema.optional(),
  tiktok_daily_budget: z.number().min(TIKTOK_MIN_DAILY_BUDGET).optional(),
  tiktok_target_cpl_kzt: z.number().min(0).optional(),
  tiktok_target_cpl: z.number().min(0).optional(),
  tiktok_adgroup_mode: TikTokAdGroupModeSchema.optional(),
  tiktok_instant_page_id: z.string().nullable().optional(),
  // CAPI settings (direction-level)
  capi_enabled: z.boolean().optional(),
  capi_source: z.enum(['whatsapp', 'crm']).nullable().optional(),
  capi_crm_type: z.enum(['amocrm', 'bitrix24']).nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_access_token: z.string().nullable().optional(),
  capi_event_level: z.number().int().min(1).max(3).nullable().optional(),
  // Conversions optimization level
  optimization_level: z.enum(['level_1', 'level_2', 'level_3']).optional(),
});

type CreateDirectionInput = z.infer<typeof CreateDirectionSchema>;
type UpdateDirectionInput = z.infer<typeof UpdateDirectionSchema>;

// ========================================
// FACEBOOK API HELPERS
// ========================================

/**
 * Создать Facebook Campaign для направления
 */
async function createFacebookCampaign(
  adAccountId: string,
  accessToken: string,
  directionName: string,
  objective: DirectionObjective
): Promise<{ campaign_id: string; status: string }> {
  const normalizedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Определяем Facebook objective и читаемое название
  let fbObjective: string;
  let objectiveReadable: string;

  switch (objective) {
    case 'whatsapp':
      fbObjective = 'OUTCOME_ENGAGEMENT';
      objectiveReadable = 'WhatsApp';
      break;
    case 'conversions':
      fbObjective = 'OUTCOME_SALES';
      objectiveReadable = 'Conversions';
      break;
    case 'instagram_traffic':
      fbObjective = 'OUTCOME_TRAFFIC';
      objectiveReadable = 'Instagram Traffic';
      break;
    case 'site_leads':
      fbObjective = 'OUTCOME_LEADS';
      objectiveReadable = 'Site Leads';
      break;
    case 'lead_forms':
      fbObjective = 'OUTCOME_LEADS';
      objectiveReadable = 'Lead Forms';
      break;
    case 'app_installs':
      fbObjective = 'OUTCOME_APP_PROMOTION';
      objectiveReadable = 'App Installs';
      break;
    default:
      throw new Error(`Unknown objective: ${objective}`);
  }

  const campaignName = `[${directionName}] ${objectiveReadable}`;

  log.info({
    adAccount: normalizedAdAccountId,
    campaignName,
    fbObjective,
  }, 'Creating Facebook campaign');

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${normalizedAdAccountId}/campaigns`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: campaignName,
          objective: fbObjective,
          status: 'ACTIVE', // создаем в активном состоянии сразу
          special_ad_categories: [],
          is_adset_budget_sharing_enabled: false,
          access_token: accessToken,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      const fbMeta = {
        status: response.status,
        method: 'POST',
        path: `${normalizedAdAccountId}/campaigns`,
        code: errorData?.error?.code,
        error_subcode: errorData?.error?.error_subcode,
        fbtrace_id: errorData?.error?.fbtrace_id,
      };
      log.error({ err: errorData, meta: fbMeta, resolution: resolveFacebookError(fbMeta), adAccount: normalizedAdAccountId }, 'Facebook API error while creating campaign');
      throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();

    log.info({ campaignId: data.id, campaignName }, 'Facebook campaign created');

    return {
      campaign_id: data.id,
      status: 'ACTIVE',
    };
  } catch (error: any) {
    log.error({ err: error, adAccount: normalizedAdAccountId }, 'Failed to create Facebook campaign');
    throw new Error(`Failed to create Facebook campaign: ${error.message}`);
  }
}

/**
 * Создать TikTok Campaign для направления
 */
async function createTikTokCampaign(
  advertiserId: string,
  accessToken: string,
  directionName: string,
  objective: TikTokObjectiveInput,
  dailyBudget: number,
  isActive: boolean
): Promise<{ campaign_id: string; status: 'ACTIVE' | 'PAUSED' }> {
  const objectiveConfig = getTikTokObjectiveConfig(objective);
  const objectiveLabel = getTikTokObjectiveLabel(objective);
  const campaignName = `[${directionName}] ${objectiveLabel}`;
  const operationStatus = isActive ? 'ENABLE' : 'DISABLE';

  log.info({
    advertiserId,
    campaignName,
    objective: objectiveConfig.objective_type,
    dailyBudget,
    operationStatus
  }, 'Creating TikTok campaign');

  try {
    const result = await tt.createCampaign(advertiserId, accessToken, {
      campaign_name: campaignName,
      objective_type: objectiveConfig.objective_type,
      budget: dailyBudget,
      budget_mode: 'BUDGET_MODE_DAY',
      operation_status: operationStatus
    });

    log.info({ campaignId: result.campaign_id, campaignName }, 'TikTok campaign created');

    return {
      campaign_id: result.campaign_id,
      status: isActive ? 'ACTIVE' : 'PAUSED'
    };
  } catch (error: any) {
    const resolution = error?.tiktok ? resolveTikTokError(error.tiktok) : undefined;
    log.error({
      err: error,
      resolution,
      advertiserId,
      campaignName
    }, 'Failed to create TikTok campaign');
    throw new Error(`Failed to create TikTok campaign: ${error.message}`);
  }
}

/**
 * Обновить статус кампании в Facebook
 */
async function updateFacebookCampaignStatus(
  campaignId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<void> {
  log.info({ campaignId, status }, 'Updating Facebook campaign status');

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${campaignId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: status,
          access_token: accessToken,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      const fbMeta = {
        status: response.status,
        method: 'POST',
        path: campaignId,
        code: errorData?.error?.code,
        error_subcode: errorData?.error?.error_subcode,
        fbtrace_id: errorData?.error?.fbtrace_id,
      };
      log.error({ err: errorData, meta: fbMeta, resolution: resolveFacebookError(fbMeta), campaignId }, 'Facebook API error while updating campaign status');
      throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
    }

    log.info({ campaignId, status }, 'Facebook campaign status updated');
  } catch (error: any) {
    log.error({ err: error, campaignId }, 'Failed to update Facebook campaign status');
    throw new Error(`Failed to update Facebook campaign status: ${error.message}`);
  }
}

/**
 * Архивировать кампанию в Facebook
 */
async function archiveFacebookCampaign(
  campaignId: string,
  accessToken: string
): Promise<void> {
  log.info({ campaignId }, 'Archiving Facebook campaign');

  try {
    const response = await fetch(
      `https://graph.facebook.com/v20.0/${campaignId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'ARCHIVED',
          access_token: accessToken,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      const fbMeta = {
        status: response.status,
        method: 'POST',
        path: campaignId,
        code: errorData?.error?.code,
        error_subcode: errorData?.error?.error_subcode,
        fbtrace_id: errorData?.error?.fbtrace_id,
      };
      log.error({ err: errorData, meta: fbMeta, resolution: resolveFacebookError(fbMeta), campaignId }, 'Facebook API error while archiving campaign');
      log.warn({ campaignId }, 'Failed to archive campaign, continuing');
    } else {
      log.info({ campaignId }, 'Facebook campaign archived');
    }
  } catch (error: any) {
    log.error({ err: error, campaignId }, 'Failed to archive Facebook campaign');
  }
}

// ========================================
// API ROUTES
// ========================================

export async function directionsRoutes(app: FastifyInstance) {
  /**
   * GET /api/directions
   * Получить все направления пользователя
   * @query userAccountId - ID пользователя из user_accounts (обязательный)
   * @query accountId - UUID из ad_accounts.id для фильтрации по рекламному аккаунту (опционально)
   */
  app.get('/directions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userAccountId = (request.query as any).userAccountId;
      const accountId = (request.query as any).accountId; // UUID из ad_accounts.id (опционально)
      const platform = (request.query as any).platform; // 'facebook' | 'tiktok' (опционально)

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      log.info({ userAccountId, accountId }, 'Fetching directions for user');

      let query = supabase
        .from('account_directions')
        .select(`
          *,
          whatsapp_phone_number:whatsapp_phone_numbers!whatsapp_phone_number_id(phone_number)
        `)
        .eq('user_account_id', userAccountId);

      // Фильтр по account_id ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
      if (await shouldFilterByAccountId(supabase, userAccountId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      if (platform) {
        if (!['facebook', 'tiktok'].includes(platform)) {
          return reply.code(400).send({
            success: false,
            error: 'platform must be facebook or tiktok',
          });
        }
        if (platform === 'facebook') {
          query = query.or('platform.eq.facebook,platform.is.null');
        } else {
          query = query.eq('platform', platform);
        }
      }

      const { data: directions, error } = await query.order('created_at', { ascending: false });

      if (error) {
        log.error({ err: error, userAccountId }, 'Error fetching directions');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }

      // Преобразуем вложенный объект в простое поле + маппинг обратной совместимости
      const directionsWithNumber = (directions || []).map(dir => {
        // Обратная совместимость: whatsapp_conversions -> conversions + conversion_channel: 'whatsapp'
        let objective = dir.objective;
        let conversion_channel = dir.conversion_channel || null;
        if (objective === 'whatsapp_conversions') {
          objective = 'conversions';
          conversion_channel = conversion_channel || 'whatsapp';
        }

        return {
          ...dir,
          objective,
          conversion_channel,
          whatsapp_phone_number: dir.whatsapp_phone_number?.phone_number || null,
        };
      });

      return reply.send({
        success: true,
        directions: directionsWithNumber,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching directions list');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/directions/custom-audiences
   * Подтягивает Custom Audiences из Meta Ads Manager для текущего аккаунта
   * @query userAccountId - ID пользователя (обязательный)
   * @query accountId - UUID ad_accounts.id (обязательный в multi-account режиме)
   */
  app.get('/directions/custom-audiences', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userAccountId = (request.query as any).userAccountId;
      const accountId = (request.query as any).accountId;

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      log.info({
        userAccountId,
        accountId: accountId || null,
      }, 'Fetching custom audiences for direction form');

      const { data: userAccount, error: userError } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled, access_token, ad_account_id')
        .eq('id', userAccountId)
        .single();

      if (userError || !userAccount) {
        return reply.code(404).send({
          success: false,
          error: 'User account not found',
        });
      }

      log.info({
        userAccountId,
        accountId: accountId || null,
        multiAccountEnabled: userAccount.multi_account_enabled,
      }, 'Resolved user account for custom audiences request');

      let graphAdAccountId: string | null = null;
      let graphAccessToken: string | null = null;
      let storedAudiences: Array<{ id: string; name: string }> = [];
      let adAccountRowId: string | null = null;

      if (userAccount.multi_account_enabled) {
        if (!accountId) {
          return reply.code(400).send({
            success: false,
            error: 'accountId is required in multi-account mode',
          });
        }

        const { data: adAccount, error: adAccountError } = await supabase
          .from('ad_accounts')
          .select('id, ad_account_id, access_token, custom_audiences')
          .eq('id', accountId)
          .eq('user_account_id', userAccountId)
          .single();

        if (adAccountError || !adAccount) {
          return reply.code(404).send({
            success: false,
            error: 'Ad account not found',
          });
        }

        adAccountRowId = adAccount.id;
        graphAdAccountId = adAccount.ad_account_id;
        graphAccessToken = adAccount.access_token;
        storedAudiences = normalizeCustomAudiences(adAccount.custom_audiences);

        log.info({
          userAccountId,
          accountId,
          adAccountRowId,
          hasAccessToken: Boolean(graphAccessToken),
          storedAudiencesCount: storedAudiences.length,
        }, 'Resolved ad account data for custom audiences request');
      } else {
        graphAdAccountId = userAccount.ad_account_id;
        graphAccessToken = userAccount.access_token;
      }

      // Если нет доступов для Graph API - возвращаем сохранённые аудитории (если есть)
      if (!graphAdAccountId || !graphAccessToken) {
        log.warn({
          userAccountId,
          accountId: accountId || null,
          hasAdAccountId: Boolean(graphAdAccountId),
          hasAccessToken: Boolean(graphAccessToken),
          storedCount: storedAudiences.length,
        }, 'Graph credentials missing, returning stored custom audiences');

        return reply.send({
          success: true,
          audiences: storedAudiences,
          refreshed: false,
          source: 'stored',
        });
      }

      const normalizedAdAccountId = graphAdAccountId.startsWith('act_')
        ? graphAdAccountId
        : `act_${graphAdAccountId}`;

      const audiencesMap = new Map<string, { id: string; name: string }>();
      let pagesFetched = 0;
      let nextUrl = `https://graph.facebook.com/v20.0/${normalizedAdAccountId}/customaudiences?fields=id,name&limit=500&access_token=${encodeURIComponent(graphAccessToken)}`;

      try {
        while (nextUrl) {
          pagesFetched += 1;
          const response = await fetch(nextUrl);
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const fbMeta = {
              status: response.status,
              method: 'GET',
              path: `${normalizedAdAccountId}/customaudiences`,
              code: errorData?.error?.code,
              error_subcode: errorData?.error?.error_subcode,
              fbtrace_id: errorData?.error?.fbtrace_id,
            };
            log.warn({
              userAccountId,
              accountId: accountId || null,
              meta: fbMeta,
              storedCount: storedAudiences.length,
              pagesFetched,
            }, 'Failed to refresh custom audiences from Facebook, using stored value');

            return reply.send({
              success: true,
              audiences: storedAudiences,
              refreshed: false,
              source: 'stored',
            });
          }

          const data = await response.json();
          const pageItems = Array.isArray(data?.data) ? data.data : [];

          for (const item of pageItems) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            audiencesMap.set(id, {
              id,
              name: String(item?.name || id),
            });
          }

          nextUrl = data?.paging?.next || '';

          // Safety guard to avoid huge loops
          if (audiencesMap.size >= 2000) {
            log.warn({
              userAccountId,
              accountId: accountId || null,
              audiencesCount: audiencesMap.size,
              pagesFetched,
            }, 'Custom audiences pagination stopped by safety guard');
            nextUrl = '';
          }
        }
      } catch (fbError: any) {
        log.warn({
          err: fbError,
          userAccountId,
          accountId: accountId || null,
          storedCount: storedAudiences.length,
          pagesFetched,
        }, 'Error refreshing custom audiences from Facebook, using stored value');

        return reply.send({
          success: true,
          audiences: storedAudiences,
          refreshed: false,
          source: 'stored',
        });
      }

      const refreshedAudiences = Array.from(audiencesMap.values());

      log.info({
        userAccountId,
        accountId: accountId || null,
        refreshedCount: refreshedAudiences.length,
        storedCount: storedAudiences.length,
        pagesFetched,
      }, 'Custom audiences refreshed from Facebook');

      // Для multi-account режима кешируем список в ad_accounts
      if (adAccountRowId) {
        const { error: cacheError } = await supabase
          .from('ad_accounts')
          .update({
            custom_audiences: refreshedAudiences,
            updated_at: new Date().toISOString(),
          })
          .eq('id', adAccountRowId);

        if (cacheError) {
          log.warn({
            err: cacheError,
            adAccountRowId,
            audiencesCount: refreshedAudiences.length,
          }, 'Failed to cache refreshed custom audiences');
        }
      }

      log.info({
        userAccountId,
        accountId: accountId || null,
        refreshedCount: refreshedAudiences.length,
        source: 'facebook',
      }, 'Returning custom audiences response');

      return reply.send({
        success: true,
        audiences: refreshedAudiences,
        refreshed: true,
        source: 'facebook',
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching custom audiences');
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to fetch custom audiences',
      });
    }
  });

  /**
   * POST /api/directions
   * Создать новое направление + Facebook/TikTok Campaign
   */
  app.post('/directions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const userAccountId = body.userAccountId;

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      // Валидация входных данных
      const validationResult = CreateDirectionSchema.safeParse(body);
      if (!validationResult.success) {
        app.log.warn({ zodErrors: validationResult.error.errors, bodyKeys: Object.keys(body) }, 'Direction creation validation failed');
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: validationResult.error.errors,
        });
      }

      const input: CreateDirectionInput = validationResult.data;
      const normalizedCustomAudienceId = input.custom_audience_id?.trim() || null;
      const requestedPlatform = input.platform || 'facebook';
      const platformsToCreate: Array<Exclude<DirectionPlatform, 'both'>> =
        requestedPlatform === 'both' ? ['facebook', 'tiktok'] : [requestedPlatform];
      const needsFacebook = platformsToCreate.includes('facebook');
      const needsTikTok = platformsToCreate.includes('tiktok');

      log.info({
        userAccountId: input.userAccountId,
        accountId: input.accountId || null,
        requestedPlatform,
        needsFacebook,
        needsTikTok,
        advantageAudienceEnabled: input.advantage_audience_enabled !== false,
        hasCustomAudience: Boolean(normalizedCustomAudienceId),
      }, 'Creating direction with audience controls');

      // Проверяем флаг multi_account_enabled у пользователя
      const { data: userAccountCheck, error: userCheckError } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled, ad_account_id, access_token, username, page_id, fb_page_access_token, instagram_id')
        .eq('id', userAccountId)
        .single();

      if (userCheckError || !userAccountCheck) {
        log.error({ userAccountId, error: userCheckError }, 'User account not found');
        return reply.code(404).send({
          success: false,
          error: 'User account not found',
        });
      }

      if (userAccountCheck.multi_account_enabled && !input.accountId) {
        return reply.code(400).send({
          success: false,
          error: 'accountId is required for multi-account mode',
        });
      }

      const directionsNeeded = platformsToCreate.length;

      // Для мультиаккаунта лимит считается по ad_account, для обычного - по user_account
      let activeCountQuery = supabase
        .from('account_directions')
        .select('id', { count: 'exact', head: true })
        .eq('user_account_id', userAccountId)
        .eq('is_active', true);

      if (userAccountCheck.multi_account_enabled && input.accountId) {
        activeCountQuery = activeCountQuery.eq('account_id', input.accountId);
      }

      const { count: activeCount, error: activeCountError } = await activeCountQuery;

      if (activeCountError) {
        log.error({ err: activeCountError, userAccountId }, 'Failed to count active directions');
        return reply.code(500).send({
          success: false,
          error: 'Failed to validate directions limit',
        });
      }

      const maxDirections = userAccountCheck.multi_account_enabled ? 10 : 10;
      if ((activeCount || 0) + directionsNeeded > maxDirections) {
        return reply.code(400).send({
          success: false,
          error: `Maximum ${maxDirections} active directions per ${userAccountCheck.multi_account_enabled ? 'ad account' : 'user'}`,
        });
      }

      // Получаем данные для Facebook API в зависимости от режима (если нужно)
      let fbAdAccountId: string | null = null;
      let fbAccessToken: string | null = null;
      let userAccountName: string | undefined;
      let pageId: string | null = null;
      let pageAccessToken: string | null = null;
      let accountRecordId: string | null = null;
      let instagramId: string | null = null;

      if (needsFacebook) {
        if (userAccountCheck.multi_account_enabled) {
          // Мультиаккаунтный режим: данные в ad_accounts
          const accountIdToUse = input.accountId as string;

          const { data: adAccount, error: adAccountError } = await supabase
            .from('ad_accounts')
            .select('ad_account_id, access_token, name, page_id, fb_page_access_token, instagram_id')
            .eq('id', accountIdToUse)
            .eq('user_account_id', userAccountId)
            .single();

          if (adAccountError || !adAccount) {
            log.error({
              userAccountId,
              accountId: accountIdToUse,
              error: adAccountError
            }, 'Ad account not found');
            return reply.code(404).send({
              success: false,
              error: 'Ad account not found',
            });
          }

          fbAdAccountId = adAccount.ad_account_id;
          fbAccessToken = adAccount.access_token;
          userAccountName = adAccount.name || undefined;
          pageId = adAccount.page_id || null;
          pageAccessToken = adAccount.fb_page_access_token || null;
          accountRecordId = accountIdToUse;
          instagramId = adAccount.instagram_id || null;
        } else {
          // Legacy режим: данные в user_accounts
          fbAdAccountId = userAccountCheck.ad_account_id;
          fbAccessToken = userAccountCheck.access_token;
          userAccountName = userAccountCheck.username || undefined;
          pageId = userAccountCheck.page_id || null;
          pageAccessToken = userAccountCheck.fb_page_access_token || null;
          instagramId = userAccountCheck.instagram_id || null;
        }
      } else if (userAccountCheck.multi_account_enabled) {
        accountRecordId = input.accountId || null;
      }

      let tiktokCreds: { accessToken: string; advertiserId: string; identityId?: string } | null = null;
      if (needsTikTok) {
        tiktokCreds = await getTikTokCredentials(userAccountId, input.accountId || undefined);
        if (!tiktokCreds) {
          return reply.code(400).send({
            success: false,
            error: 'TikTok не подключен. Заполните данные рекламного кабинета.',
          });
        }
      }

      log.info({
        user_account_id: userAccountId,
        name: input.name,
        platform: requestedPlatform,
        facebook_objective: input.objective || null,
        tiktok_objective: input.tiktok_objective || null,
        daily_budget_cents: input.daily_budget_cents || null,
        tiktok_daily_budget: input.tiktok_daily_budget || null,
        userAccountName
      }, 'Creating direction');

      if (needsFacebook && input.objective === 'app_installs') {
        const appConfig = getAppInstallsConfig();
        const appSettings = input.facebook_default_settings || input.default_settings;
        if (!appConfig) {
          const envHints = getAppInstallsConfigEnvHints();
          return reply.code(400).send({
            success: false,
            error: 'app_installs objective requires global app_id env config (META_APP_INSTALLS_APP_ID or META_APP_ID/FB_APP_ID).',
            details: {
              appIdEnvKeys: envHints.appIdEnvKeys,
            }
          });
        }

        if (!appSettings?.app_store_url) {
          return reply.code(400).send({
            success: false,
            error: 'app_installs objective requires app_store_url in direction settings',
          });
        }
      }

      // Если указан WhatsApp номер, создаем или находим запись в whatsapp_phone_numbers
      let whatsapp_phone_number_id: string | null = null;

      if (needsFacebook && input.whatsapp_phone_number && input.whatsapp_phone_number.trim()) {
        const phoneNumber = input.whatsapp_phone_number.trim();

        // Проверяем, существует ли уже такой номер
        const { data: existingNumber, error: checkError } = await supabase
          .from('whatsapp_phone_numbers')
          .select('id')
          .eq('user_account_id', userAccountId)
          .eq('phone_number', phoneNumber)
          .maybeSingle();

        if (checkError) {
          log.error({ err: checkError }, 'Error checking existing WhatsApp number');
          return reply.code(500).send({
            success: false,
            error: 'Database error while checking WhatsApp number',
          });
        }

        if (existingNumber) {
          // Номер уже существует — обновляем connection_type и waba_phone_id если указаны
          whatsapp_phone_number_id = existingNumber.id;

          const connectionType = input.whatsapp_connection_type || 'evolution';
          const wabaPhoneId = connectionType === 'waba' ? input.whatsapp_waba_phone_id : null;

          // Обновляем тип подключения существующего номера
          const { error: updateNumberError } = await supabase
            .from('whatsapp_phone_numbers')
            .update({
              connection_type: connectionType,
              waba_phone_id: wabaPhoneId,
            })
            .eq('id', existingNumber.id);

          if (updateNumberError) {
            log.error({ err: updateNumberError }, 'Error updating WhatsApp number connection type');
          } else {
            log.info({ phoneNumber, connectionType, wabaPhoneId, id: whatsapp_phone_number_id }, 'Updated existing WhatsApp number');
          }
        } else {
          // Создаем новый номер с типом подключения
          const connectionType = input.whatsapp_connection_type || 'evolution';
          const wabaPhoneId = connectionType === 'waba' ? input.whatsapp_waba_phone_id : null;

          const { data: newNumber, error: insertNumberError } = await supabase
            .from('whatsapp_phone_numbers')
            .insert([
              {
                user_account_id: userAccountId,
                account_id: userAccountCheck.multi_account_enabled ? (input.accountId || null) : null, // UUID для мультиаккаунтности
                phone_number: phoneNumber,
                is_active: true,
                is_default: false,
                connection_type: connectionType,
                waba_phone_id: wabaPhoneId,
              },
            ])
            .select('id')
            .single();

          if (insertNumberError) {
            log.error({ err: insertNumberError }, 'Error creating WhatsApp number');
            return reply.code(500).send({
              success: false,
              error: 'Failed to save WhatsApp number',
            });
          }

          whatsapp_phone_number_id = newNumber.id;
          log.info({ phoneNumber, connectionType, wabaPhoneId, id: whatsapp_phone_number_id }, 'Created new WhatsApp number');
        }
      }

      // Проверяем что есть данные для Facebook API
      if (needsFacebook && (!fbAdAccountId || !fbAccessToken)) {
        return reply.code(400).send({
          success: false,
          error: 'Facebook не подключен. Заполните данные рекламного кабинета.',
        });
      }

      // Instagram Traffic требует instagram_id
      if (needsFacebook && input.objective === 'instagram_traffic' && !instagramId) {
        return reply.code(400).send({
          success: false,
          error: 'Instagram Traffic требует подключённый Instagram аккаунт. Добавьте Instagram Account ID в настройках.',
        });
      }

      if (needsFacebook && input.objective === 'lead_forms') {
        if (!pageId) {
          return reply.code(400).send({
            success: false,
            error: 'page_id is required for lead_forms objective',
          });
        }

        log.info({
          userAccountId,
          accountId: input.accountId || null,
          pageId,
          hasPageAccessToken: !!pageAccessToken,
          multiAccount: userAccountCheck.multi_account_enabled
        }, 'Lead forms objective: ensuring page token and leadgen subscription');

        let effectivePageAccessToken = pageAccessToken;
        let fetchedPageAccessToken = false;

        if (!effectivePageAccessToken) {
          log.info({ pageId, userAccountId }, 'Fetching Page Access Token for lead_forms');
          effectivePageAccessToken = await getPageAccessToken(pageId, fbAccessToken as string);
          fetchedPageAccessToken = true;
          if (effectivePageAccessToken) {
            const updateTarget = userAccountCheck.multi_account_enabled ? 'ad_accounts' : 'user_accounts';
            const updateId = userAccountCheck.multi_account_enabled ? accountRecordId : userAccountId;

            if (updateTarget && updateId) {
              const { error: updateError } = await supabase
                .from(updateTarget)
                .update({ fb_page_access_token: effectivePageAccessToken, updated_at: new Date().toISOString() })
                .eq('id', updateId);

              if (updateError) {
                log.warn({ err: updateError, updateTarget, updateId }, 'Failed to store fb_page_access_token');
              } else {
                log.info({ updateTarget, updateId, pageId }, 'Stored fb_page_access_token for lead_forms');
              }
            }
          } else {
            log.warn({ pageId, userAccountId }, 'Failed to obtain Page Access Token for lead_forms');
          }
        }

        if (effectivePageAccessToken) {
          log.info({ pageId, userAccountId }, 'Subscribing page to leadgen');
          let subscribed = await subscribePageToLeadgen(pageId, effectivePageAccessToken);

          if (!subscribed && !fetchedPageAccessToken) {
            log.warn({ pageId, userAccountId }, 'Leadgen subscription failed, retrying with fresh Page Access Token');
            const refreshedToken = await getPageAccessToken(pageId, fbAccessToken as string);

            if (refreshedToken && refreshedToken !== effectivePageAccessToken) {
              const updateTarget = userAccountCheck.multi_account_enabled ? 'ad_accounts' : 'user_accounts';
              const updateId = userAccountCheck.multi_account_enabled ? accountRecordId : userAccountId;

              if (updateTarget && updateId) {
                const { error: updateError } = await supabase
                  .from(updateTarget)
                  .update({ fb_page_access_token: refreshedToken, updated_at: new Date().toISOString() })
                  .eq('id', updateId);

                if (updateError) {
                  log.warn({ err: updateError, updateTarget, updateId }, 'Failed to refresh fb_page_access_token');
                } else {
                  log.info({ updateTarget, updateId, pageId }, 'Refreshed fb_page_access_token for lead_forms');
                }
              }

              subscribed = await subscribePageToLeadgen(pageId, refreshedToken);
            } else if (!refreshedToken) {
              log.warn({ pageId, userAccountId }, 'Failed to refresh Page Access Token after subscription failure');
            } else {
              log.warn({ pageId, userAccountId }, 'Refreshed Page Access Token matches existing token, skipping retry');
            }
          }

          if (!subscribed) {
            log.warn({ pageId, userAccountId }, 'Failed to subscribe page to leadgen');
          } else {
            log.info({ pageId, userAccountId }, 'Page subscribed to leadgen successfully');
          }
        } else {
          log.warn({ pageId, userAccountId }, 'Skipping leadgen subscription: no Page Access Token');
        }
      }

      const createdDirections: any[] = [];
      const createdDefaultSettings: any[] = [];
      const createdCampaigns: Array<{ platform: 'facebook' | 'tiktok'; campaignId: string }> = [];
      const createdDirectionIds: string[] = [];

      const createDefaultSettings = async (
        directionId: string,
        campaignGoal: DirectionObjective,
        settingsOverride?: CreateDirectionInput['default_settings']
      ) => {
        const settingsInput = settingsOverride ?? input.default_settings;

        log.info({
          directionId,
          hasSettingsOverride: !!settingsOverride,
          hasInputDefaultSettings: !!input.default_settings,
          hasFacebookDefaultSettings: !!input.facebook_default_settings,
          settingsInput: settingsInput ? { cities: settingsInput.cities, age_min: settingsInput.age_min } : null,
        }, 'createDefaultSettings called');

        if (!settingsInput) {
          log.warn({ directionId }, 'No settings input provided, skipping default_ad_settings creation');
          return null;
        }

        log.info({ directionId }, 'Creating default settings for direction');

        const { data: settings, error: settingsError } = await supabase
          .from('default_ad_settings')
          .insert({
            direction_id: directionId,
            campaign_goal: campaignGoal,
            cities: settingsInput.cities,
            age_min: settingsInput.age_min,
            age_max: settingsInput.age_max,
            gender: settingsInput.gender || 'all',
            description: settingsInput.description,
            client_question: settingsInput.client_question,
            instagram_url: settingsInput.instagram_url,
            site_url: settingsInput.site_url,
            pixel_id: settingsInput.pixel_id,
            utm_tag: settingsInput.utm_tag,
            lead_form_id: settingsInput.lead_form_id,
            app_id: settingsInput.app_id,
            app_store_url: settingsInput.app_store_url,
            is_skadnetwork_attribution: settingsInput.is_skadnetwork_attribution,
          })
          .select()
          .single();

        if (settingsError) {
          log.error({ err: settingsError }, 'Error creating default settings');
          return null;
        }

        log.info({ directionId }, 'Default settings created successfully');
        return settings;
      };

      const rollbackDirections = async () => {
        if (createdDirectionIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('account_directions')
            .delete()
            .in('id', createdDirectionIds);
          if (deleteError) {
            log.warn({ err: deleteError, directionIds: createdDirectionIds }, 'Failed to roll back directions');
          }
        }

        for (const campaign of createdCampaigns) {
          try {
            if (campaign.platform === 'facebook' && fbAccessToken) {
              await archiveFacebookCampaign(campaign.campaignId, fbAccessToken);
            }
            if (campaign.platform === 'tiktok' && tiktokCreds) {
              await tt.pauseCampaign(tiktokCreds.advertiserId, tiktokCreds.accessToken, campaign.campaignId);
            }
          } catch (rollbackError: any) {
            log.warn({ err: rollbackError, campaignId: campaign.campaignId }, 'Failed to roll back campaign');
          }
        }
      };

      try {
        if (needsFacebook) {
          const fbCampaign = await createFacebookCampaign(
            fbAdAccountId as string,
            fbAccessToken as string,
            input.name,
            input.objective as DirectionObjective
          );

          createdCampaigns.push({ platform: 'facebook', campaignId: fbCampaign.campaign_id });

          // Логируем создание направления конверсии с деталями CAPI
          if (input.objective === 'conversions') {
            log.info({
              userAccountId,
              directionName: input.name,
              objective: input.objective,
              conversion_channel: input.conversion_channel,
              optimization_level: input.optimization_level || 'level_1',
              fb_campaign_id: fbCampaign.campaign_id,
              has_capi_enabled: input.capi_enabled,
              capi_source: input.capi_source,
            }, 'Создаём направление конверсии с CAPI оптимизацией');
          }

          const insertResult = await supabase
            .from('account_directions')
            .insert({
              user_account_id: userAccountId,
              account_id: userAccountCheck.multi_account_enabled ? (input.accountId || null) : null, // UUID из ad_accounts.id для мультиаккаунтности
              name: input.name,
              platform: 'facebook',
              objective: input.objective,
              conversion_channel: input.conversion_channel || null,
              daily_budget_cents: input.daily_budget_cents,
              target_cpl_cents: input.target_cpl_cents,
              advantage_audience_enabled: input.advantage_audience_enabled !== false,
              custom_audience_id: normalizedCustomAudienceId,
              whatsapp_phone_number_id: whatsapp_phone_number_id,
              fb_campaign_id: fbCampaign.campaign_id,
              campaign_status: fbCampaign.status,
              is_active: true,
              // CAPI settings (direction-level)
              capi_enabled: input.capi_enabled || false,
              capi_source: input.capi_source || null,
              capi_crm_type: input.capi_crm_type || null,
              capi_interest_fields: input.capi_interest_fields || [],
              capi_qualified_fields: input.capi_qualified_fields || [],
              capi_scheduled_fields: input.capi_scheduled_fields || [],
              capi_access_token: input.capi_access_token || null,
              capi_event_level: input.capi_event_level ?? null,
              // Conversions optimization level
              optimization_level: input.optimization_level || 'level_1',
              // Instagram account usage
              use_instagram: input.use_instagram !== undefined ? input.use_instagram : true,
            })
            .select()
            .single();

          const direction = insertResult.data;
          if (insertResult.error || !direction) {
            throw insertResult.error || new Error('Direction insert failed');
          }

          createdDirections.push(direction);
          createdDirectionIds.push(direction.id);

          const defaultSettings = await createDefaultSettings(
            direction.id,
            input.objective as DirectionObjective,
            input.facebook_default_settings
          );
          if (defaultSettings) {
            createdDefaultSettings.push(defaultSettings);
          }
        }

        if (needsTikTok) {
          const tiktokObjective = (input.tiktok_objective || 'traffic') as TikTokObjectiveInput;
          const tiktokDailyBudget = input.tiktok_daily_budget ?? TIKTOK_MIN_DAILY_BUDGET;
          const tiktokCampaign = await createTikTokCampaign(
            tiktokCreds!.advertiserId,
            tiktokCreds!.accessToken,
            input.name,
            tiktokObjective,
            tiktokDailyBudget,
            true
          );

          createdCampaigns.push({ platform: 'tiktok', campaignId: tiktokCampaign.campaign_id });

          const mappedObjective = mapTikTokObjectiveToDirectionObjective(tiktokObjective);
          const insertResult = await supabase
            .from('account_directions')
            .insert({
              user_account_id: userAccountId,
              account_id: userAccountCheck.multi_account_enabled ? (input.accountId || null) : null, // UUID из ad_accounts.id для мультиаккаунтности
              name: input.name,
              platform: 'tiktok',
              objective: mappedObjective,
              conversion_channel: null,
              daily_budget_cents: DEFAULT_FB_DAILY_BUDGET_CENTS,
              target_cpl_cents: DEFAULT_FB_TARGET_CPL_CENTS,
              advantage_audience_enabled: true,
              custom_audience_id: null,
              whatsapp_phone_number_id: null,
              tiktok_campaign_id: tiktokCampaign.campaign_id,
              tiktok_objective: tiktokObjective,
              tiktok_daily_budget: tiktokDailyBudget,
              tiktok_target_cpl_kzt: input.tiktok_target_cpl_kzt ?? null,
              tiktok_target_cpl: input.tiktok_target_cpl ?? null,
              tiktok_adgroup_mode: input.tiktok_adgroup_mode ?? null,
              tiktok_identity_id: tiktokCreds?.identityId || null,
              tiktok_instant_page_id: input.tiktok_instant_page_id ?? null,
              campaign_status: tiktokCampaign.status,
              is_active: true,
              // CAPI settings are Facebook-only for now
              capi_enabled: false,
              capi_source: null,
              capi_crm_type: null,
              capi_interest_fields: [],
              capi_qualified_fields: [],
              capi_scheduled_fields: [],
              capi_access_token: null,
              capi_event_level: null,
              optimization_level: 'level_1',
            })
            .select()
            .single();

          const direction = insertResult.data;
          if (insertResult.error || !direction) {
            throw insertResult.error || new Error('Direction insert failed');
          }

          createdDirections.push(direction);
          createdDirectionIds.push(direction.id);

          const defaultSettings = await createDefaultSettings(
            direction.id,
            mappedObjective,
            input.tiktok_default_settings
          );
          if (defaultSettings) {
            createdDefaultSettings.push(defaultSettings);
          }
        }
      } catch (directionError: any) {
        log.error({ err: directionError }, 'Error creating direction');
        await rollbackDirections();
        return reply.code(500).send({
          success: false,
          error: directionError?.message || 'Failed to create direction',
        });
      }

      // Обновляем этап онбординга
      onDirectionCreated(input.userAccountId).catch(err => {
        log.warn({ err, userId: input.userAccountId }, 'Failed to update onboarding stage');
      });

      const primaryDirection = createdDirections[0] || null;
      const defaultSettingsPayload = createdDefaultSettings.length === 0
        ? null
        : (createdDefaultSettings.length === 1 ? createdDefaultSettings[0] : createdDefaultSettings);

      return reply.code(201).send({
        success: true,
        direction: primaryDirection,
        directions: createdDirections,
        default_settings: defaultSettingsPayload,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error creating direction');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * PATCH /api/directions/:id
   * Обновить направление
   */
  app.patch('/directions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      // Валидация входных данных
      const validationResult = UpdateDirectionSchema.safeParse(body);
      if (!validationResult.success) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: validationResult.error.errors,
        });
      }

      const input: UpdateDirectionInput = validationResult.data;

      log.info({ id, updates: input }, 'Updating direction');

      // Получаем текущее направление
      const { data: existingDirection, error: fetchError } = await supabase
        .from('account_directions')
        .select('*, user_accounts!inner(access_token, multi_account_enabled)')
        .eq('id', id)
        .single();

      if (fetchError || !existingDirection) {
        return reply.code(404).send({
          success: false,
          error: 'Direction not found',
        });
      }

      const directionPlatform = normalizeDirectionPlatform(existingDirection.platform);
      const isTikTokDirection = directionPlatform === 'tiktok';

      // Проверка минимума target_cpl_cents в зависимости от objective
      if (input.target_cpl_cents !== undefined) {
        const minCents = existingDirection.objective === 'instagram_traffic' ? 10 : 50;
        if (input.target_cpl_cents < minCents) {
          return reply.code(400).send({
            success: false,
            error: `target_cpl_cents minimum is ${minCents} cents for ${existingDirection.objective}`,
          });
        }
      }

      // Подробное логирование данных направления для диагностики
      const userAccountsData = existingDirection.user_accounts as any;
      log.info({
        directionId: id,
        platform: directionPlatform,
        user_account_id: existingDirection.user_account_id,
        account_id: existingDirection.account_id,
        fb_campaign_id: existingDirection.fb_campaign_id,
        user_accounts_data: {
          has_access_token: !!userAccountsData?.access_token,
          access_token_preview: userAccountsData?.access_token
            ? `${userAccountsData.access_token.slice(0, 10)}...${userAccountsData.access_token.slice(-5)}`
            : null,
          multi_account_enabled: userAccountsData?.multi_account_enabled,
        }
      }, 'Direction data for token determination');

      // Получаем access_token в зависимости от режима
      let accessToken: string | null = null;
      if (!isTikTokDirection) {
        const isMultiAccount = (existingDirection.user_accounts as any).multi_account_enabled;
        const hasAccountId = !!existingDirection.account_id;

        log.info({
          directionId: id,
          isMultiAccount,
          hasAccountId,
          accountId: existingDirection.account_id,
        }, 'Determining access token source');

        if (isMultiAccount && hasAccountId) {
          // Мультиаккаунтный режим: токен в ad_accounts
          const { data: adAccount, error: adAccountError } = await supabase
            .from('ad_accounts')
            .select('access_token')
            .eq('id', existingDirection.account_id)
            .single();

          if (adAccountError) {
            log.error({ err: adAccountError, accountId: existingDirection.account_id }, 'Failed to fetch ad_account for token');
          }

          accessToken = adAccount?.access_token || null;
          log.info({
            directionId: id,
            tokenSource: 'ad_accounts',
            hasToken: !!accessToken,
            tokenPreview: accessToken ? `${accessToken.slice(0, 10)}...${accessToken.slice(-5)}` : null,
          }, 'Using multi-account token');
        } else {
          // Legacy режим: токен в user_accounts
          accessToken = (existingDirection.user_accounts as any).access_token;
          log.info({
            directionId: id,
            tokenSource: 'user_accounts',
            hasToken: !!accessToken,
            tokenPreview: accessToken ? `${accessToken.slice(0, 10)}...${accessToken.slice(-5)}` : null,
          }, 'Using legacy token');
        }
      }

      // Обрабатываем WhatsApp номер если он передан
      let updateData: any = { ...input };
      delete updateData.whatsapp_phone_number; // Удаляем из объекта обновления, т.к. это не колонка БД
      delete updateData.whatsapp_connection_type; // Это поле для whatsapp_phone_numbers, не для directions
      delete updateData.whatsapp_waba_phone_id; // Это поле для whatsapp_phone_numbers, не для directions

      if (typeof updateData.custom_audience_id === 'string') {
        updateData.custom_audience_id = updateData.custom_audience_id.trim() || null;
      }

      if (
        Object.prototype.hasOwnProperty.call(updateData, 'advantage_audience_enabled') ||
        Object.prototype.hasOwnProperty.call(updateData, 'custom_audience_id')
      ) {
        log.info({
          directionId: id,
          advantageAudienceEnabled: updateData.advantage_audience_enabled,
          hasCustomAudience: Boolean(updateData.custom_audience_id),
          customAudienceId: updateData.custom_audience_id || null,
        }, 'Updating direction audience controls');
      }
      
      if (input.whatsapp_phone_number !== undefined) {
        if (input.whatsapp_phone_number === null || input.whatsapp_phone_number === '') {
          // Удаляем привязку к номеру
          updateData.whatsapp_phone_number_id = null;
          log.info({ directionId: id }, 'Removing WhatsApp number from direction');
        } else {
          // Создаем или находим номер
          const phoneNumber = input.whatsapp_phone_number.trim();
          const userAccountId = existingDirection.user_account_id;
          
          const { data: existingNumber } = await supabase
            .from('whatsapp_phone_numbers')
            .select('id')
            .eq('user_account_id', userAccountId)
            .eq('phone_number', phoneNumber)
            .maybeSingle();

          if (existingNumber) {
            updateData.whatsapp_phone_number_id = existingNumber.id;

            // Обновляем connection_type и waba_phone_id если указаны
            const connectionType = input.whatsapp_connection_type || 'evolution';
            const wabaPhoneId = connectionType === 'waba' ? input.whatsapp_waba_phone_id : null;

            const { error: updateNumberError } = await supabase
              .from('whatsapp_phone_numbers')
              .update({
                connection_type: connectionType,
                waba_phone_id: wabaPhoneId,
              })
              .eq('id', existingNumber.id);

            if (updateNumberError) {
              log.error({ err: updateNumberError }, 'Error updating WhatsApp number connection type');
            } else {
              log.info({ phoneNumber, connectionType, wabaPhoneId, id: existingNumber.id }, 'Updated existing WhatsApp number for direction');
            }
          } else {
            // Создаем новый номер с типом подключения
            const connectionType = input.whatsapp_connection_type || 'evolution';
            const wabaPhoneId = connectionType === 'waba' ? input.whatsapp_waba_phone_id : null;

            const { data: newNumber, error: insertNumberError } = await supabase
              .from('whatsapp_phone_numbers')
              .insert([
                {
                  user_account_id: userAccountId,
                  account_id: existingDirection.account_id || null, // UUID для мультиаккаунтности
                  phone_number: phoneNumber,
                  is_active: true,
                  is_default: false,
                  connection_type: connectionType,
                  waba_phone_id: wabaPhoneId,
                },
              ])
              .select('id')
              .single();

            if (insertNumberError) {
              log.error({ err: insertNumberError }, 'Error creating WhatsApp number');
              return reply.code(500).send({
                success: false,
                error: 'Failed to save WhatsApp number',
              });
            }

            updateData.whatsapp_phone_number_id = newNumber.id;
            log.info({ phoneNumber, connectionType, wabaPhoneId, id: newNumber.id }, 'Created new WhatsApp number for direction');
          }
        }
      }

      let tiktokCreds: { accessToken: string; advertiserId: string } | null = null;
      const ensureTikTokCreds = async () => {
        if (tiktokCreds) {
          return tiktokCreds;
        }
        tiktokCreds = await getTikTokCredentials(
          existingDirection.user_account_id,
          existingDirection.account_id || undefined
        );
        if (!tiktokCreds) {
          throw new Error('TikTok credentials not found');
        }
        return tiktokCreds;
      };

      // Если изменился статус is_active, обновляем кампанию в нужной платформе
      if (input.is_active !== undefined && existingDirection.is_active !== input.is_active) {
        const newCampaignStatus = input.is_active ? 'ACTIVE' : 'PAUSED';

        if (isTikTokDirection) {
          if (!existingDirection.tiktok_campaign_id) {
            return reply.code(400).send({
              success: false,
              error: 'TikTok campaign_id is missing for this direction',
            });
          }

          try {
            const creds = await ensureTikTokCreds();
            log.info({
              directionId: id,
              campaignId: existingDirection.tiktok_campaign_id,
              oldStatus: existingDirection.is_active ? 'ACTIVE' : 'PAUSED',
              newStatus: newCampaignStatus,
            }, 'About to update TikTok campaign status');

            if (input.is_active) {
              await tt.resumeCampaign(creds.advertiserId, creds.accessToken, existingDirection.tiktok_campaign_id);
            } else {
              await tt.pauseCampaign(creds.advertiserId, creds.accessToken, existingDirection.tiktok_campaign_id);
            }

            updateData.campaign_status = newCampaignStatus;
            log.info({ directionId: id, newCampaignStatus }, 'TikTok campaign status updated successfully');
          } catch (ttError: any) {
            log.error({
              err: ttError,
              directionId: id,
              campaignId: existingDirection.tiktok_campaign_id
            }, 'Failed to update TikTok campaign status');

            return reply.code(500).send({
              success: false,
              error: 'Не удалось обновить статус кампании в TikTok',
              details: ttError.message,
            });
          }
        } else if (existingDirection.fb_campaign_id) {
          try {
            log.info({
              directionId: id,
              campaignId: existingDirection.fb_campaign_id,
              oldStatus: existingDirection.is_active ? 'ACTIVE' : 'PAUSED',
              newStatus: newCampaignStatus,
              tokenPreview: accessToken ? `${accessToken.slice(0, 10)}...${accessToken.slice(-5)}` : null,
            }, 'About to update Facebook campaign status');

            if (!accessToken) {
              throw new Error('Access token not found');
            }
            await updateFacebookCampaignStatus(
              existingDirection.fb_campaign_id,
              accessToken,
              newCampaignStatus as 'ACTIVE' | 'PAUSED'
            );

            // Обновляем campaign_status в базе данных
            updateData.campaign_status = newCampaignStatus;

            log.info({ directionId: id, newCampaignStatus }, 'Facebook campaign status updated successfully');
          } catch (fbError: any) {
            log.error({
              err: fbError,
              directionId: id,
              campaignId: existingDirection.fb_campaign_id
            }, 'Failed to update Facebook campaign status');

            // Возвращаем ошибку, не обновляем направление
            return reply.code(500).send({
              success: false,
              error: 'Не удалось обновить статус кампании в Facebook',
              details: fbError.message,
            });
          }
        }
      }

      if (isTikTokDirection && input.tiktok_daily_budget !== undefined && existingDirection.tiktok_campaign_id) {
        try {
          const creds = await ensureTikTokCreds();
          await tt.updateCampaignBudget(
            creds.advertiserId,
            creds.accessToken,
            existingDirection.tiktok_campaign_id,
            input.tiktok_daily_budget
          );
          log.info({
            directionId: id,
            campaignId: existingDirection.tiktok_campaign_id,
            newBudget: input.tiktok_daily_budget
          }, 'TikTok campaign budget updated successfully');
        } catch (ttError: any) {
          log.error({
            err: ttError,
            directionId: id,
            campaignId: existingDirection.tiktok_campaign_id
          }, 'Failed to update TikTok campaign budget');
          return reply.code(500).send({
            success: false,
            error: 'Не удалось обновить бюджет кампании в TikTok',
            details: ttError.message,
          });
        }
      }

      // Обновляем направление в базе
      const { data: updatedDirection, error: updateError } = await supabase
        .from('account_directions')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          whatsapp_phone_number:whatsapp_phone_numbers!whatsapp_phone_number_id(phone_number)
        `)
        .single();

      if (updateError) {
        log.error({ err: updateError, directionId: id }, 'Error updating direction');
        return reply.code(500).send({
          success: false,
          error: updateError.message,
        });
      }

      // Преобразуем вложенный объект в простое поле
      const directionWithNumber = {
        ...updatedDirection,
        whatsapp_phone_number: updatedDirection.whatsapp_phone_number?.phone_number || null,
      };

      log.info({ directionId: id }, 'Direction updated successfully');

      return reply.send({
        success: true,
        direction: directionWithNumber,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error updating direction');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * DELETE /api/directions/:id
   * Удалить направление (архивирует/останавливает кампанию)
   */
  app.delete('/directions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      log.info({ id }, 'Deleting direction');

      // Получаем направление с access_token
      const { data: direction, error: fetchError } = await supabase
        .from('account_directions')
        .select('*, user_accounts!inner(access_token, multi_account_enabled)')
        .eq('id', id)
        .single();

      if (fetchError || !direction) {
        return reply.code(404).send({
          success: false,
          error: 'Direction not found',
        });
      }

      const directionPlatform = normalizeDirectionPlatform(direction.platform);

      if (directionPlatform === 'tiktok') {
        if (direction.tiktok_campaign_id) {
          const tiktokCreds = await getTikTokCredentials(
            direction.user_account_id,
            direction.account_id || undefined
          );
          if (!tiktokCreds) {
            log.warn({ directionId: id }, 'TikTok credentials not found while deleting direction');
          } else {
            try {
              await tt.pauseCampaign(
                tiktokCreds.advertiserId,
                tiktokCreds.accessToken,
                direction.tiktok_campaign_id
              );
            } catch (ttError: any) {
              log.error({ err: ttError, campaignId: direction.tiktok_campaign_id }, 'Failed to pause TikTok campaign');
              // Продолжаем удаление даже если не удалось остановить
            }
          }
        }
      } else {
        // Получаем access_token в зависимости от режима
        let accessToken: string | null = null;
        if ((direction.user_accounts as any).multi_account_enabled && direction.account_id) {
          // Мультиаккаунтный режим: токен в ad_accounts
          const { data: adAccount } = await supabase
            .from('ad_accounts')
            .select('access_token')
            .eq('id', direction.account_id)
            .single();
          accessToken = adAccount?.access_token || null;
        } else {
          // Legacy режим: токен в user_accounts
          accessToken = (direction.user_accounts as any).access_token;
        }

        // Архивируем кампанию в Facebook
        if (direction.fb_campaign_id && accessToken) {
          try {
            await archiveFacebookCampaign(
              direction.fb_campaign_id,
              accessToken
            );
          } catch (fbError) {
            log.error({ err: fbError, campaignId: direction.fb_campaign_id }, 'Failed to archive Facebook campaign');
            // Продолжаем удаление даже если не удалось заархивировать
          }
        }
      }

      // Удаляем направление из базы
      const { error: deleteError } = await supabase
        .from('account_directions')
        .delete()
        .eq('id', id);

      if (deleteError) {
        log.error({ err: deleteError, directionId: id }, 'Error deleting direction');
        return reply.code(500).send({
          success: false,
          error: deleteError.message,
        });
      }

      log.info({ directionId: id }, 'Direction deleted successfully');

      return reply.send({
        success: true,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Error deleting direction');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}
