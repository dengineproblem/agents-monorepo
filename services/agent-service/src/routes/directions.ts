import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CreateDirectionSchema = z.object({
  userAccountId: z.string().uuid(),
  name: z.string().min(2).max(100),
  objective: z.enum(['whatsapp', 'instagram_traffic', 'site_leads']),
  daily_budget_cents: z.number().int().min(1000), // минимум $10
  target_cpl_cents: z.number().int().min(50), // минимум $0.50
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

  console.log('[Directions] Creating Facebook campaign:', {
    ad_account: normalizedAdAccountId,
    name: campaignName,
    objective: fbObjective,
  });

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
          status: 'PAUSED', // создаем в паузе до добавления ad sets
          special_ad_categories: [],
          access_token: accessToken,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Directions] Facebook API error:', errorData);
      throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();

    console.log('[Directions] Facebook campaign created:', {
      campaign_id: data.id,
      name: campaignName,
    });

    return {
      campaign_id: data.id,
      status: 'PAUSED',
    };
  } catch (error: any) {
    console.error('[Directions] Failed to create Facebook campaign:', error);
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
  console.log('[Directions] Updating Facebook campaign status:', { campaign_id: campaignId, status });

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
      console.error('[Directions] Facebook API error:', errorData);
      throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
    }

    console.log('[Directions] Facebook campaign status updated');
  } catch (error: any) {
    console.error('[Directions] Failed to update Facebook campaign status:', error);
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
  console.log('[Directions] Archiving Facebook campaign:', { campaign_id: campaignId });

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
      console.error('[Directions] Facebook API error:', errorData);
      console.warn('[Directions] Failed to archive campaign, continuing...');
    } else {
      console.log('[Directions] Facebook campaign archived');
    }
  } catch (error: any) {
    console.error('[Directions] Failed to archive Facebook campaign:', error);
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

      console.log('[Directions] Fetching directions for user:', userAccountId);

      const { data: directions, error } = await supabase
        .from('account_directions')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Directions] Error fetching directions:', error);
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
      console.error('[Directions] Error:', error);
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

      console.log('[Directions] Creating direction:', {
        user_account_id: userAccountId,
        name: input.name,
        objective: input.objective,
        daily_budget: `$${input.daily_budget_cents / 100}`,
        target_cpl: `$${input.target_cpl_cents / 100}`,
      });

      // Получаем user_account для доступа к Facebook API
      const { data: userAccount, error: userAccountError } = await supabase
        .from('user_accounts')
        .select('ad_account_id, access_token')
        .eq('id', userAccountId)
        .single();

      if (userAccountError || !userAccount) {
        console.error('[Directions] User account not found:', userAccountError);
        return reply.code(404).send({
          success: false,
          error: 'User account not found',
        });
      }

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
        console.error('[Directions] Failed to create Facebook campaign:', fbError);
        return reply.code(500).send({
          success: false,
          error: 'Failed to create Facebook campaign',
          details: fbError.message,
        });
      }

      // Сохраняем направление в базу
      const { data: direction, error: directionError } = await supabase
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

      if (directionError) {
        console.error('[Directions] Error creating direction:', directionError);
        
        // Пытаемся откатить создание кампании в Facebook
        try {
          await archiveFacebookCampaign(fbCampaign.campaign_id, userAccount.access_token);
        } catch (rollbackError) {
          console.error('[Directions] Failed to rollback Facebook campaign:', rollbackError);
        }

        return reply.code(500).send({
          success: false,
          error: directionError.message,
        });
      }

      console.log('[Directions] Direction created successfully:', {
        direction_id: direction.id,
        fb_campaign_id: fbCampaign.campaign_id,
      });

      return reply.code(201).send({
        success: true,
        direction: direction,
      });
    } catch (error: any) {
      console.error('[Directions] Error:', error);
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

      console.log('[Directions] Updating direction:', { id, updates: input });

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
        console.error('[Directions] Error updating direction:', updateError);
        return reply.code(500).send({
          success: false,
          error: updateError.message,
        });
      }

      console.log('[Directions] Direction updated successfully');

      return reply.send({
        success: true,
        direction: updatedDirection,
      });
    } catch (error: any) {
      console.error('[Directions] Error:', error);
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

      console.log('[Directions] Deleting direction:', id);

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
          console.error('[Directions] Failed to archive Facebook campaign:', fbError);
          // Продолжаем удаление даже если не удалось заархивировать
        }
      }

      // Удаляем направление из базы
      const { error: deleteError } = await supabase
        .from('account_directions')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('[Directions] Error deleting direction:', deleteError);
        return reply.code(500).send({
          success: false,
          error: deleteError.message,
        });
      }

      console.log('[Directions] Direction deleted successfully');

      return reply.send({
        success: true,
      });
    } catch (error: any) {
      console.error('[Directions] Error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });
}

