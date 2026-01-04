import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { resolveFacebookError } from '../lib/facebookErrors.js';
import { onDirectionCreated } from '../lib/onboardingHelper.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';

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
});

const CreateDirectionSchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional().nullable(), // UUID из ad_accounts.id для мультиаккаунтности
  name: z.string().min(2).max(100),
  objective: z.enum(['whatsapp', 'instagram_traffic', 'site_leads', 'lead_forms']),
  daily_budget_cents: z.number().int().min(500), // минимум $5
  target_cpl_cents: z.number().int().min(10), // минимум $0.10 для instagram_traffic, проверяется в refine
  whatsapp_phone_number: z.string().optional(), // Номер передается напрямую, не ID
  // Опциональные дефолтные настройки рекламы
  default_settings: z.object({
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
  }).optional(),
  // CAPI settings (direction-level)
  capi_enabled: z.boolean().optional(),
  capi_source: z.enum(['whatsapp', 'crm']).nullable().optional(),
  capi_crm_type: z.enum(['amocrm', 'bitrix24']).nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional(),
}).refine((data) => {
  // Для instagram_traffic минимум 10 центов ($0.10), для остальных 50 центов ($0.50)
  const minCents = data.objective === 'instagram_traffic' ? 10 : 50;
  return data.target_cpl_cents >= minCents;
}, {
  message: 'target_cpl_cents is below minimum for this objective',
  path: ['target_cpl_cents'],
});

const UpdateDirectionSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  daily_budget_cents: z.number().int().min(500).optional(),
  target_cpl_cents: z.number().int().min(10).optional(), // минимум проверяется в handler по objective
  is_active: z.boolean().optional(),
  whatsapp_phone_number: z.string().nullable().optional(), // Номер передается напрямую
  // CAPI settings (direction-level)
  capi_enabled: z.boolean().optional(),
  capi_source: z.enum(['whatsapp', 'crm']).nullable().optional(),
  capi_crm_type: z.enum(['amocrm', 'bitrix24']).nullable().optional(),
  capi_interest_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_qualified_fields: z.array(CapiFieldConfigSchema).optional(),
  capi_scheduled_fields: z.array(CapiFieldConfigSchema).optional(),
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
  objective: 'whatsapp' | 'instagram_traffic' | 'site_leads' | 'lead_forms'
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

      const { data: directions, error } = await query.order('created_at', { ascending: false });

      if (error) {
        log.error({ err: error, userAccountId }, 'Error fetching directions');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }

      // Преобразуем вложенный объект в простое поле
      const directionsWithNumber = (directions || []).map(dir => ({
        ...dir,
        whatsapp_phone_number: dir.whatsapp_phone_number?.phone_number || null,
      }));

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
   * POST /api/directions
   * Создать новое направление + Facebook Campaign
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
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: validationResult.error.errors,
        });
      }

      const input: CreateDirectionInput = validationResult.data;

      // Проверяем флаг multi_account_enabled у пользователя
      const { data: userAccountCheck, error: userCheckError } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled, ad_account_id, access_token, username')
        .eq('id', userAccountId)
        .single();

      if (userCheckError || !userAccountCheck) {
        log.error({ userAccountId, error: userCheckError }, 'User account not found');
        return reply.code(404).send({
          success: false,
          error: 'User account not found',
        });
      }

      // Получаем данные для Facebook API в зависимости от режима
      let fbAdAccountId: string | null = null;
      let fbAccessToken: string | null = null;
      let userAccountName: string | undefined;

      if (userAccountCheck.multi_account_enabled) {
        // Мультиаккаунтный режим: данные в ad_accounts
        const accountIdToUse = input.accountId;

        if (!accountIdToUse) {
          return reply.code(400).send({
            success: false,
            error: 'accountId is required for multi-account mode',
          });
        }

        const { data: adAccount, error: adAccountError } = await supabase
          .from('ad_accounts')
          .select('ad_account_id, access_token, name')
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
      } else {
        // Legacy режим: данные в user_accounts
        fbAdAccountId = userAccountCheck.ad_account_id;
        fbAccessToken = userAccountCheck.access_token;
        userAccountName = userAccountCheck.username || undefined;
      }

      log.info({
        user_account_id: userAccountId,
        name: input.name,
        objective: input.objective,
        daily_budget: `$${input.daily_budget_cents / 100}`,
        target_cpl: `$${input.target_cpl_cents / 100}`,
        userAccountName
      }, 'Creating direction');

      // Если указан WhatsApp номер, создаем или находим запись в whatsapp_phone_numbers
      let whatsapp_phone_number_id: string | null = null;
      
      if (input.whatsapp_phone_number && input.whatsapp_phone_number.trim()) {
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
          // Номер уже существует, используем его
          whatsapp_phone_number_id = existingNumber.id;
          log.info({ phoneNumber, id: whatsapp_phone_number_id }, 'Using existing WhatsApp number');
        } else {
          // Создаем новый номер
          const { data: newNumber, error: insertNumberError } = await supabase
            .from('whatsapp_phone_numbers')
            .insert([
              {
                user_account_id: userAccountId,
                account_id: input.accountId || null, // UUID для мультиаккаунтности
                phone_number: phoneNumber,
                is_active: true,
                is_default: false,
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
          log.info({ phoneNumber, id: whatsapp_phone_number_id }, 'Created new WhatsApp number');
        }
      }

      // Проверяем что есть данные для Facebook API
      if (!fbAdAccountId || !fbAccessToken) {
        return reply.code(400).send({
          success: false,
          error: 'Facebook не подключен. Заполните данные рекламного кабинета.',
        });
      }

      // Создаём Facebook Campaign
      let fbCampaign;
      try {
        fbCampaign = await createFacebookCampaign(
          fbAdAccountId,
          fbAccessToken,
          input.name,
          input.objective
        );
      } catch (fbError: any) {
        log.error({ err: fbError, userAccountId }, 'Failed to create Facebook campaign during direction creation');
        return reply.code(500).send({
          success: false,
          error: 'Failed to create Facebook campaign',
          details: fbError.message,
        });
      }

      let direction;
      try {
        const insertResult = await supabase
          .from('account_directions')
          .insert({
            user_account_id: userAccountId,
            account_id: input.accountId || null, // UUID из ad_accounts.id для мультиаккаунтности
            name: input.name,
            objective: input.objective,
            daily_budget_cents: input.daily_budget_cents,
            target_cpl_cents: input.target_cpl_cents,
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
          })
          .select()
          .single();

        direction = insertResult.data;
        if (insertResult.error || !direction) {
          throw insertResult.error || new Error('Direction insert failed');
        }
      } catch (directionError: any) {
        log.error({ err: directionError }, 'Error creating direction');

        try {
          await archiveFacebookCampaign(fbCampaign.campaign_id, fbAccessToken);
        } catch (rollbackError: any) {
          log.error({ err: rollbackError, fbCampaignId: fbCampaign.campaign_id }, 'Failed to roll back direction after FB error');
        }

        return reply.code(500).send({
          success: false,
          error: directionError?.message || 'Failed to create direction',
        });
      }

      log.info({
        direction_id: direction.id,
        fb_campaign_id: fbCampaign.campaign_id,
      }, 'Direction created successfully');

      // Создаём дефолтные настройки, если они переданы
      let defaultSettings = null;
      if (input.default_settings) {
        log.info({ directionId: direction.id }, 'Creating default settings for direction');
        
        const { data: settings, error: settingsError } = await supabase
          .from('default_ad_settings')
          .insert({
            direction_id: direction.id,
            campaign_goal: input.objective, // используем objective направления
            cities: input.default_settings.cities,
            age_min: input.default_settings.age_min,
            age_max: input.default_settings.age_max,
            gender: input.default_settings.gender || 'all',
            description: input.default_settings.description,
            client_question: input.default_settings.client_question,
            instagram_url: input.default_settings.instagram_url,
            site_url: input.default_settings.site_url,
            pixel_id: input.default_settings.pixel_id,
            utm_tag: input.default_settings.utm_tag,
            lead_form_id: input.default_settings.lead_form_id,
          })
          .select()
          .single();

        if (settingsError) {
          log.error({ err: settingsError }, 'Error creating default settings');
          // Не падаем, просто логируем — направление уже создано
        } else {
          defaultSettings = settings;
          log.info('Default settings created successfully');
        }
      }

      // Обновляем этап онбординга
      onDirectionCreated(input.userAccountId).catch(err => {
        log.warn({ err, userId: input.userAccountId }, 'Failed to update onboarding stage');
      });

      return reply.code(201).send({
        success: true,
        direction: direction,
        default_settings: defaultSettings, // возвращаем созданные настройки (или null)
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

      // Обрабатываем WhatsApp номер если он передан
      let updateData: any = { ...input };
      delete updateData.whatsapp_phone_number; // Удаляем из объекта обновления, т.к. это не колонка БД
      
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
            log.info({ phoneNumber, id: existingNumber.id }, 'Using existing WhatsApp number for direction');
          } else {
            const { data: newNumber, error: insertNumberError } = await supabase
              .from('whatsapp_phone_numbers')
              .insert([
                {
                  user_account_id: userAccountId,
                  account_id: existingDirection.account_id || null, // UUID для мультиаккаунтности
                  phone_number: phoneNumber,
                  is_active: true,
                  is_default: false,
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
            log.info({ phoneNumber, id: newNumber.id }, 'Created new WhatsApp number for direction');
          }
        }
      }

      // Если изменился статус is_active, обновляем Facebook кампанию
      if (input.is_active !== undefined && existingDirection.is_active !== input.is_active && existingDirection.fb_campaign_id) {
        const newCampaignStatus = input.is_active ? 'ACTIVE' : 'PAUSED';

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
   * Удалить направление (архивирует кампанию в Facebook)
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

