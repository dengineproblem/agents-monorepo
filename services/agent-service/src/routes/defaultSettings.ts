import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

// ========================================
// VALIDATION SCHEMAS
// ========================================

const CreateDefaultSettingsSchema = z.object({
  direction_id: z.string().uuid(),
  campaign_goal: z.enum(['whatsapp', 'conversions', 'instagram_traffic', 'site_leads', 'lead_forms', 'app_installs']),
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
  // Lead Forms specific
  lead_form_id: z.string().optional(),
  // App Installs specific
  app_id: z.string().optional(),
  app_store_url: z.string().url().optional(),
  is_skadnetwork_attribution: z.boolean().optional(),
});

const UpdateDefaultSettingsSchema = z.object({
  cities: z.array(z.string()).optional(),
  age_min: z.number().int().min(18).max(65).optional(),
  age_max: z.number().int().min(18).max(65).optional(),
  gender: z.enum(['all', 'male', 'female']).optional(),
  description: z.string().optional(),
  client_question: z.string().optional(),
  instagram_url: z.string().url().optional(),
  site_url: z.string().url().optional(),
  pixel_id: z.string().optional(),
  utm_tag: z.string().optional(),
  lead_form_id: z.string().optional(),
  // App Installs specific
  app_id: z.string().optional(),
  app_store_url: z.string().url().optional(),
  is_skadnetwork_attribution: z.boolean().optional(),
});

type CreateDefaultSettingsInput = z.infer<typeof CreateDefaultSettingsSchema>;
type UpdateDefaultSettingsInput = z.infer<typeof UpdateDefaultSettingsSchema>;

// ========================================
// ROUTES
// ========================================

export async function defaultSettingsRoutes(app: FastifyInstance) {
  
  // ========================================
  // GET /default-settings?directionId=uuid
  // Получить настройки для направления
  // ========================================
  app.get('/default-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directionId } = request.query as { directionId?: string };

      if (!directionId) {
        return reply.code(400).send({
          success: false,
          error: 'directionId is required',
        });
      }

      // Проверяем что directionId валидный UUID
      if (!z.string().uuid().safeParse(directionId).success) {
        return reply.code(400).send({
          success: false,
          error: 'directionId must be a valid UUID',
        });
      }

      // Получаем настройки из Supabase
      const { data, error } = await supabase
        .from('default_ad_settings')
        .select('*')
        .eq('direction_id', directionId)
        .maybeSingle();

      if (error) {
        app.log.error({ msg: 'Failed to fetch default settings', error, directionId });
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch default settings',
        });
      }

      // Если настроек нет - вернём null
      return reply.send({
        success: true,
        settings: data || null,
      });
    } catch (err: any) {
      app.log.error({ msg: 'Unexpected error in GET /api/default-settings', err });

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'get_default_settings',
        endpoint: '/default-settings',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  });

  // ========================================
  // POST /default-settings
  // Создать или обновить настройки для направления
  // ========================================
  app.post('/default-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Валидация входных данных
      const parseResult = CreateDefaultSettingsSchema.safeParse(request.body);
      
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: parseResult.error.errors,
        });
      }

      const input = parseResult.data;

      // Проверяем что направление существует
      const { data: direction, error: directionError } = await supabase
        .from('account_directions')
        .select('id, objective, user_account_id')
        .eq('id', input.direction_id)
        .single();

      if (directionError || !direction) {
        return reply.code(404).send({
          success: false,
          error: 'Direction not found',
        });
      }

      // Проверяем что campaign_goal совпадает с direction.objective
      if (input.campaign_goal !== direction.objective) {
        return reply.code(400).send({
          success: false,
          error: `campaign_goal (${input.campaign_goal}) must match direction.objective (${direction.objective})`,
        });
      }

      // Проверяем есть ли уже настройки для этого направления
      const { data: existing } = await supabase
        .from('default_ad_settings')
        .select('id')
        .eq('direction_id', input.direction_id)
        .maybeSingle();

      let result;

      if (existing) {
        // Обновляем существующие настройки
        const { data, error } = await supabase
          .from('default_ad_settings')
          .update({
            campaign_goal: input.campaign_goal,
            cities: input.cities,
            age_min: input.age_min,
            age_max: input.age_max,
            gender: input.gender,
            description: input.description,
            client_question: input.client_question,
            instagram_url: input.instagram_url,
            site_url: input.site_url,
            pixel_id: input.pixel_id,
            utm_tag: input.utm_tag,
            lead_form_id: input.lead_form_id,
            app_id: input.app_id,
            app_store_url: input.app_store_url,
            is_skadnetwork_attribution: input.is_skadnetwork_attribution,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) {
          app.log.error({ msg: 'Failed to update default settings', error });
          return reply.code(500).send({
            success: false,
            error: 'Failed to update default settings',
          });
        }

        result = data;
      } else {
        // Создаём новые настройки
        const { data, error } = await supabase
          .from('default_ad_settings')
          .insert({
            direction_id: input.direction_id,
            user_id: null, // направления не используют user_id
            campaign_goal: input.campaign_goal,
            cities: input.cities,
            age_min: input.age_min ?? 18,
            age_max: input.age_max ?? 65,
            gender: input.gender ?? 'all',
            description: input.description ?? 'Напишите нам, чтобы узнать подробности',
            client_question: input.client_question,
            instagram_url: input.instagram_url,
            site_url: input.site_url,
            pixel_id: input.pixel_id,
            utm_tag: input.utm_tag ?? 'utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{ad.id}}',
            lead_form_id: input.lead_form_id,
            app_id: input.app_id,
            app_store_url: input.app_store_url,
            is_skadnetwork_attribution: input.is_skadnetwork_attribution,
          })
          .select()
          .single();

        if (error) {
          app.log.error({ msg: 'Failed to create default settings', error });
          return reply.code(500).send({
            success: false,
            error: 'Failed to create default settings',
          });
        }

        result = data;
      }

      return reply.code(existing ? 200 : 201).send({
        success: true,
        settings: result,
      });
    } catch (err: any) {
      app.log.error({ msg: 'Unexpected error in POST /api/default-settings', err });

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'create_default_settings',
        endpoint: '/default-settings',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  });

  // ========================================
  // PATCH /default-settings/:id
  // Частичное обновление настроек
  // ========================================
  app.patch('/default-settings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      // Валидация UUID
      if (!z.string().uuid().safeParse(id).success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid settings ID',
        });
      }

      // Валидация входных данных
      const parseResult = UpdateDefaultSettingsSchema.safeParse(request.body);
      
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: parseResult.error.errors,
        });
      }

      const input = parseResult.data;

      // Обновляем настройки
      const { data, error } = await supabase
        .from('default_ad_settings')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.code(404).send({
            success: false,
            error: 'Settings not found',
          });
        }
        
        app.log.error({ msg: 'Failed to update settings', error });
        return reply.code(500).send({
          success: false,
          error: 'Failed to update settings',
        });
      }

      return reply.send({
        success: true,
        settings: data,
      });
    } catch (err: any) {
      app.log.error({ msg: 'Unexpected error in PATCH /api/default-settings/:id', err });

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'update_default_settings',
        endpoint: '/default-settings/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  });

  // ========================================
  // DELETE /default-settings/:id
  // Удалить настройки
  // ========================================
  app.delete('/default-settings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      // Валидация UUID
      if (!z.string().uuid().safeParse(id).success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid settings ID',
        });
      }

      const { error } = await supabase
        .from('default_ad_settings')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ msg: 'Failed to delete settings', error });
        return reply.code(500).send({
          success: false,
          error: 'Failed to delete settings',
        });
      }

      return reply.send({
        success: true,
        message: 'Settings deleted successfully',
      });
    } catch (err: any) {
      app.log.error({ msg: 'Unexpected error in DELETE /api/default-settings/:id', err });

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'delete_default_settings',
        endpoint: '/default-settings/:id',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  });
}
