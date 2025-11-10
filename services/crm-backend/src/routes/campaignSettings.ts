import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

// Validation schemas
const GetSettingsSchema = z.object({
  userAccountId: z.string().uuid(),
});

const UpdateSettingsSchema = z.object({
  autopilotEnabled: z.boolean().optional(),
  dailyMessageLimit: z.number().int().min(1).max(1000).optional(),
  hotIntervalDays: z.number().int().min(1).max(30).optional(),
  warmIntervalDays: z.number().int().min(1).max(30).optional(),
  coldIntervalDays: z.number().int().min(1).max(90).optional(),
  workHoursStart: z.number().int().min(0).max(23).optional(),
  workHoursEnd: z.number().int().min(0).max(23).optional(),
  workDays: z.array(z.number().int().min(1).max(7)).optional(),
});

export async function campaignSettingsRoutes(app: FastifyInstance) {
  
  /**
   * GET /campaign-settings/:userId
   * Get campaign settings for a user (or create default if not exists)
   */
  app.get('/campaign-settings/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      // Validate UUID
      GetSettingsSchema.parse({ userAccountId: userId });

      app.log.info({ userId }, 'Fetching campaign settings');

      // Try to get existing settings
      let { data: settings, error } = await supabase
        .from('campaign_settings')
        .select('*')
        .eq('user_account_id', userId)
        .maybeSingle();

      // If not found, create default settings
      if (!settings) {
        app.log.info({ userId }, 'Creating default campaign settings');
        
        const { data: newSettings, error: insertError } = await supabase
          .from('campaign_settings')
          .insert({
            user_account_id: userId,
            autopilot_enabled: false,
            daily_message_limit: 300,
            hot_interval_days: 2,
            warm_interval_days: 5,
            cold_interval_days: 10,
            work_hours_start: 10,
            work_hours_end: 20,
            work_days: [1, 2, 3, 4, 5], // Monday to Friday
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        settings = newSettings;
      }

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        settings: settings,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to fetch campaign settings');
      return reply.status(500).send({ 
        error: 'Failed to fetch settings', 
        message: error.message 
      });
    }
  });

  /**
   * PUT /campaign-settings/:userId
   * Update campaign settings
   */
  app.put('/campaign-settings/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const body = UpdateSettingsSchema.parse(request.body);

      // Validate UUID
      GetSettingsSchema.parse({ userAccountId: userId });

      app.log.info({ userId, updates: Object.keys(body) }, 'Updating campaign settings');

      // Check if settings exist
      const { data: existingSettings, error: fetchError } = await supabase
        .from('campaign_settings')
        .select('id')
        .eq('user_account_id', userId)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      // Build update object
      const updateObject: any = {
        updated_at: new Date().toISOString(),
      };

      if (body.autopilotEnabled !== undefined) updateObject.autopilot_enabled = body.autopilotEnabled;
      if (body.dailyMessageLimit !== undefined) updateObject.daily_message_limit = body.dailyMessageLimit;
      if (body.hotIntervalDays !== undefined) updateObject.hot_interval_days = body.hotIntervalDays;
      if (body.warmIntervalDays !== undefined) updateObject.warm_interval_days = body.warmIntervalDays;
      if (body.coldIntervalDays !== undefined) updateObject.cold_interval_days = body.coldIntervalDays;
      if (body.workHoursStart !== undefined) updateObject.work_hours_start = body.workHoursStart;
      if (body.workHoursEnd !== undefined) updateObject.work_hours_end = body.workHoursEnd;
      if (body.workDays !== undefined) updateObject.work_days = body.workDays;

      let settings;

      if (!existingSettings) {
        // Create new settings if not exists
        const { data: newSettings, error: insertError } = await supabase
          .from('campaign_settings')
          .insert({
            user_account_id: userId,
            ...updateObject,
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        settings = newSettings;
      } else {
        // Update existing settings
        const { data: updatedSettings, error: updateError } = await supabase
          .from('campaign_settings')
          .update(updateObject)
          .eq('user_account_id', userId)
          .select()
          .single();

        if (updateError) {
          throw updateError;
        }

        settings = updatedSettings;
      }

      app.log.info({ userId }, 'Campaign settings updated');

      return reply.send({
        success: true,
        settings: settings,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation error', 
          details: error.errors 
        });
      }
      
      app.log.error({ error: error.message }, 'Failed to update campaign settings');
      return reply.status(500).send({ 
        error: 'Failed to update settings', 
        message: error.message 
      });
    }
  });

  /**
   * GET /campaign-settings/:userId/autopilot-status
   * Quick endpoint to check if autopilot is enabled
   */
  app.get('/campaign-settings/:userId/autopilot-status', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      const { data: settings, error } = await supabase
        .from('campaign_settings')
        .select('autopilot_enabled')
        .eq('user_account_id', userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        autopilotEnabled: settings?.autopilot_enabled || false,
      });
    } catch (error: any) {
      app.log.error({ error: error.message }, 'Failed to fetch autopilot status');
      return reply.status(500).send({ 
        error: 'Failed to fetch autopilot status', 
        message: error.message 
      });
    }
  });
}

