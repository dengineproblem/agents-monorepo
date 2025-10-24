import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { resolveFacebookError } from '../lib/facebookErrors.js';

const log = createLogger({ module: 'directionsRoutes' });

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CreateDirectionSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(2).max(100),
  objective: z.enum(['whatsapp', 'instagram_traffic', 'site_leads']),
  daily_budget_cents: z.number().int().min(1000), // минимум $10
  target_cpl_cents: z.number().int().min(50), // минимум $0.50
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
    pixel_id: z.string().optional(),
    utm_tag: z.string().optional(),
  }).optional(),
});

const UpdateDirectionSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  daily_budget_cents: z.number().int().min(1000).optional(),
  target_cpl_cents: z.number().int().min(50).optional(),
  is_active: z.boolean().optional(),
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
  objective: 'whatsapp' | 'instagram_traffic' | 'site_leads'
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
   */
  app.get('/api/directions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userAccountId = (request.query as any).userAccountId;

      if (!userAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'userAccountId is required',
        });
      }

      log.info({ userAccountId }, 'Fetching directions for user');

      const { data: directions, error } = await supabase
        .from('account_directions')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false });

      if (error) {
        log.error({ err: error, userAccountId }, 'Error fetching directions');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }

      return reply.send({
        success: true,
        directions: directions || [],
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
  app.post('/api/directions', async (request: FastifyRequest, reply: FastifyReply) => {
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

      // Получаем user_account для доступа к Facebook API
      const { data: userAccount, error: userAccountError } = await supabase
        .from('user_accounts')
        .select('ad_account_id, access_token, username, email')
        .eq('id', userAccountId)
        .single();

      if (userAccountError || !userAccount) {
        log.error({ 
          userAccountId, 
          error: userAccountError,
          hasData: !!userAccount,
          errorMessage: userAccountError?.message,
          errorDetails: userAccountError?.details,
          errorHint: userAccountError?.hint,
          errorCode: userAccountError?.code
        }, 'User account not found');
        return reply.code(404).send({
          success: false,
          error: 'User account not found',
          debug: {
            errorMessage: userAccountError?.message,
            errorCode: userAccountError?.code
          }
        });
      }

      const userAccountName = userAccount.username || userAccount.email || undefined;

      log.info({
        user_account_id: userAccountId,
        name: input.name,
        objective: input.objective,
        daily_budget: `$${input.daily_budget_cents / 100}`,
        target_cpl: `$${input.target_cpl_cents / 100}`,
        userAccountName
      }, 'Creating direction');

      // Создаём Facebook Campaign
      let fbCampaign;
      try {
        fbCampaign = await createFacebookCampaign(
          userAccount.ad_account_id,
          userAccount.access_token,
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
            name: input.name,
            objective: input.objective,
            daily_budget_cents: input.daily_budget_cents,
            target_cpl_cents: input.target_cpl_cents,
            fb_campaign_id: fbCampaign.campaign_id,
            campaign_status: fbCampaign.status,
            is_active: true,
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
          await archiveFacebookCampaign(fbCampaign.campaign_id, userAccount.access_token);
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
  app.patch('/api/directions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
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
        .select('*, user_accounts!inner(access_token)')
        .eq('id', id)
        .single();

      if (fetchError || !existingDirection) {
        return reply.code(404).send({
          success: false,
          error: 'Direction not found',
        });
      }

      // Обновляем направление в базе
      const { data: updatedDirection, error: updateError } = await supabase
        .from('account_directions')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        log.error({ err: updateError, directionId: id }, 'Error updating direction');
        return reply.code(500).send({
          success: false,
          error: updateError.message,
        });
      }

      log.info({ directionId: id }, 'Direction updated successfully');

      return reply.send({
        success: true,
        direction: updatedDirection,
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
  app.delete('/api/directions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      log.info({ id }, 'Deleting direction');

      // Получаем направление с access_token
      const { data: direction, error: fetchError } = await supabase
        .from('account_directions')
        .select('*, user_accounts!inner(access_token)')
        .eq('id', id)
        .single();

      if (fetchError || !direction) {
        return reply.code(404).send({
          success: false,
          error: 'Direction not found',
        });
      }

      // Архивируем кампанию в Facebook
      if (direction.fb_campaign_id) {
        try {
          await archiveFacebookCampaign(
            direction.fb_campaign_id,
            (direction.user_accounts as any).access_token
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

