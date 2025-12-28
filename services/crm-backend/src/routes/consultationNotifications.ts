import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// Schemas
const NotificationSettingsSchema = z.object({
  confirmation_enabled: z.boolean().optional(),
  confirmation_template: z.string().optional(),
  reminder_24h_enabled: z.boolean().optional(),
  reminder_24h_template: z.string().optional(),
  reminder_1h_enabled: z.boolean().optional(),
  reminder_1h_template: z.string().optional()
});

const CustomTemplateSchema = z.object({
  name: z.string().min(1),
  minutes_before: z.number().int().positive(),
  template: z.string().min(1),
  is_enabled: z.boolean().optional().default(true)
});

export async function consultationNotificationsRoutes(app: FastifyInstance) {

  // ==================== NOTIFICATION SETTINGS ====================

  /**
   * GET /consultation-notifications/settings
   * Get notification settings for user account
   */
  app.get('/consultation-notifications/settings', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { data, error } = await supabase
        .from('consultation_notification_settings')
        .select('*')
        .eq('user_account_id', userAccountId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        app.log.error({ error }, 'Failed to fetch notification settings');
        return reply.status(500).send({ error: error.message });
      }

      // Return default settings if not found
      if (!data) {
        return reply.send({
          user_account_id: userAccountId,
          confirmation_enabled: true,
          confirmation_template: 'Здравствуйте{{#client_name}}, {{client_name}}{{/client_name}}! Вы записаны на консультацию {{date}} в {{time}}. До встречи!',
          reminder_24h_enabled: true,
          reminder_24h_template: 'Напоминаем о вашей консультации завтра {{date}} в {{time}}. Ждём вас!',
          reminder_1h_enabled: true,
          reminder_1h_template: 'Через час у вас консультация в {{time}}. До скорой встречи!'
        });
      }

      return reply.send(data);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching notification settings');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultation-notifications/settings
   * Update notification settings for user account
   */
  app.put('/consultation-notifications/settings', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const body = NotificationSettingsSchema.parse(request.body);

      // Upsert settings
      const { data, error } = await supabase
        .from('consultation_notification_settings')
        .upsert({
          user_account_id: userAccountId,
          ...body
        }, {
          onConflict: 'user_account_id'
        })
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update notification settings');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating notification settings');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== CUSTOM TEMPLATES ====================

  /**
   * GET /consultation-notifications/templates
   * Get custom notification templates
   */
  app.get('/consultation-notifications/templates', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const { data, error } = await supabase
        .from('consultation_notification_templates')
        .select('*')
        .eq('user_account_id', userAccountId)
        .order('minutes_before');

      if (error) {
        app.log.error({ error }, 'Failed to fetch notification templates');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching notification templates');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /consultation-notifications/templates
   * Create custom notification template
   */
  app.post('/consultation-notifications/templates', async (request, reply) => {
    try {
      const { userAccountId } = request.query as { userAccountId: string };

      if (!userAccountId) {
        return reply.status(400).send({ error: 'userAccountId is required' });
      }

      const body = CustomTemplateSchema.parse(request.body);

      const { data, error } = await supabase
        .from('consultation_notification_templates')
        .insert({
          user_account_id: userAccountId,
          ...body
        })
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to create notification template');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(201).send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error creating notification template');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * PUT /consultation-notifications/templates/:id
   * Update custom notification template
   */
  app.put('/consultation-notifications/templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = CustomTemplateSchema.partial().parse(request.body);

      const { data, error } = await supabase
        .from('consultation_notification_templates')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        app.log.error({ error }, 'Failed to update notification template');
        return reply.status(500).send({ error: error.message });
      }

      if (!data) {
        return reply.status(404).send({ error: 'Template not found' });
      }

      return reply.send(data);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.errors });
      }
      app.log.error({ error }, 'Error updating notification template');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /consultation-notifications/templates/:id
   * Delete custom notification template
   */
  app.delete('/consultation-notifications/templates/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const { error } = await supabase
        .from('consultation_notification_templates')
        .delete()
        .eq('id', id);

      if (error) {
        app.log.error({ error }, 'Failed to delete notification template');
        return reply.status(500).send({ error: error.message });
      }

      return reply.status(204).send();
    } catch (error: any) {
      app.log.error({ error }, 'Error deleting notification template');
      return reply.status(500).send({ error: error.message });
    }
  });

  // ==================== NOTIFICATION HISTORY ====================

  /**
   * GET /consultation-notifications/history/:consultationId
   * Get notification history for a consultation
   */
  app.get('/consultation-notifications/history/:consultationId', async (request, reply) => {
    try {
      const { consultationId } = request.params as { consultationId: string };

      const { data, error } = await supabase
        .from('consultation_notifications')
        .select('*')
        .eq('consultation_id', consultationId)
        .order('created_at', { ascending: false });

      if (error) {
        app.log.error({ error }, 'Failed to fetch notification history');
        return reply.status(500).send({ error: error.message });
      }

      return reply.send(data || []);
    } catch (error: any) {
      app.log.error({ error }, 'Error fetching notification history');
      return reply.status(500).send({ error: error.message });
    }
  });
}
