import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'userProfileRoutes' });

// ========================================
// SECURITY: Whitelist of columns returned to frontend
// NEVER return: password, access_token, telegram_bot_token,
//   fb_page_access_token, amocrm_*, bitrix24_* tokens
// ========================================

const PROFILE_SELECT_COLUMNS = [
  'id', 'username', 'role', 'is_tech_admin', 'is_active',
  'page_id', 'ad_account_id', 'instagram_id', 'instagram_username', 'business_id',
  'page_picture_url',
  'tarif', 'tarif_expires', 'tarif_renewal_cost',
  'autopilot', 'autopilot_tiktok', 'optimization', 'current_campaign_goal', 'current_campaign_goal_changed_at',
  'tiktok_account_id', 'tiktok_business_id',
  'telegram_id', 'telegram_id_2', 'telegram_id_3', 'telegram_id_4',
  'plan_daily_budget_cents', 'default_cpl_target_cents',
  'max_adset_daily_budget_cents', 'min_adset_daily_budget_cents',
  'openai_api_key', 'gemini_api_key', 'anthropic_api_key',
  'ig_seed_audience_id', 'tilda_utm_field', 'default_adset_mode',
  'creative_generations_available', 'multi_account_enabled',
  'prompt1', 'prompt2', 'prompt3', 'prompt4',
  'skip_whatsapp_number_in_api', 'use_account_timezone', 'preferred_check_hour_local',
  'onboarding_stage', 'onboarding_tags', 'community_channel_invited',
  'fb_connection_status', 'whatsapp_phone_number', 'wwebjs_label_id',
  'created_at', 'updated_at', 'last_session_at',
].join(', ');

// Mask secrets that frontend doesn't need in full
function maskApiKey(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  if (val.length <= 8) return '***';
  return val.substring(0, 8) + '***';
}

function sanitizeProfile(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    openai_api_key: maskApiKey(row.openai_api_key),
    gemini_api_key: maskApiKey(row.gemini_api_key),
    anthropic_api_key: maskApiKey(row.anthropic_api_key),
  };
}

// ========================================
// VALIDATION SCHEMAS
// ========================================

const ALLOWED_UPDATE_FIELDS = [
  'username',
  'telegram_id', 'telegram_id_2', 'telegram_id_3', 'telegram_id_4',
  'plan_daily_budget_cents', 'default_cpl_target_cents',
  'max_adset_daily_budget_cents', 'min_adset_daily_budget_cents',
  'openai_api_key', 'gemini_api_key', 'anthropic_api_key',
  'ig_seed_audience_id', 'tilda_utm_field', 'default_adset_mode',
  'current_campaign_goal', 'current_campaign_goal_changed_at',
  'autopilot', 'autopilot_tiktok', 'optimization',
  'skip_whatsapp_number_in_api', 'use_account_timezone', 'preferred_check_hour_local',
  'prompt1', 'prompt2', 'prompt3', 'prompt4',
  'community_channel_invited', 'whatsapp_phone_number',
] as const;

const UpdateProfileSchema = z.object(
  Object.fromEntries(
    ALLOWED_UPDATE_FIELDS.map(f => [f, z.unknown().optional()])
  )
).strict();

const DefaultSettingsSchema = z.object({
  user_id: z.string().uuid(),
  campaign_goal: z.string(),
}).passthrough();

// ========================================
// ROUTES
// ========================================

export default async function userProfileRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /user/profile
  // ----------------------------------------
  app.get('/user/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { data, error } = await supabase
      .from('user_accounts')
      .select(PROFILE_SELECT_COLUMNS)
      .eq('id', userId)
      .single();

    if (error) {
      log.error({ error, userId }, 'Failed to fetch user profile');
      return reply.status(500).send({ error: 'Failed to fetch profile' });
    }
    if (!data) return reply.status(404).send({ error: 'User not found' });

    return sanitizeProfile(data as unknown as Record<string, unknown>);
  });

  // ----------------------------------------
  // PATCH /user/profile
  // ----------------------------------------
  app.patch('/user/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    let validated: Record<string, unknown>;
    try {
      validated = UpdateProfileSchema.parse(req.body) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: e.errors });
      }
      throw e;
    }

    // Filter out undefined values and masked secrets ('***')
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (value === undefined) continue;
      // Don't overwrite API keys with mask value
      if (typeof value === 'string' && value === '***') continue;
      if (typeof value === 'string' && value.endsWith('***') && value.length < 15) continue;
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('user_accounts')
      .update(updates)
      .eq('id', userId)
      .select(PROFILE_SELECT_COLUMNS)
      .single();

    if (error) {
      log.error({ error, userId, updates: Object.keys(updates) }, 'Failed to update user profile');
      return reply.status(500).send({ error: 'Failed to update profile' });
    }

    return sanitizeProfile(data as unknown as Record<string, unknown>);
  });

  // ----------------------------------------
  // POST /user/change-password
  // ----------------------------------------
  app.post('/user/change-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword?.trim() || !newPassword?.trim()) {
      return reply.status(400).send({ error: 'oldPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' });
    }

    const { data: user, error: fetchError } = await supabase
      .from('user_accounts')
      .select('password')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const isBcrypt = user.password?.startsWith('$2a$') || user.password?.startsWith('$2b$');
    const passwordMatch = isBcrypt
      ? await bcrypt.compare(oldPassword, user.password)
      : oldPassword === user.password;

    if (!passwordMatch) {
      return reply.status(401).send({ error: 'Incorrect current password' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from('user_accounts')
      .update({ password: hashed })
      .eq('id', userId);

    if (updateError) {
      log.error({ error: updateError, userId }, 'Failed to change password');
      return reply.status(500).send({ error: 'Failed to change password' });
    }

    return reply.send({ ok: true });
  });

  // ----------------------------------------
  // DELETE /user/facebook-connection
  // ----------------------------------------
  app.delete('/user/facebook-connection', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { error } = await supabase
      .from('user_accounts')
      .update({
        access_token: '',
        page_id: '',
        ad_account_id: '',
        instagram_id: '',
        fb_page_access_token: null,
        fb_connection_status: null,
      })
      .eq('id', userId);

    if (error) {
      log.error({ error, userId }, 'Failed to disconnect Facebook');
      return reply.status(500).send({ error: 'Failed to disconnect Facebook' });
    }

    return { success: true };
  });

  // ----------------------------------------
  // DELETE /user/tiktok-connection
  // ----------------------------------------
  app.delete('/user/tiktok-connection', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const { error } = await supabase
      .from('user_accounts')
      .update({
        tiktok_access_token: null,
        tiktok_business_id: null,
        tiktok_account_id: null,
      })
      .eq('id', userId);

    if (error) {
      log.error({ error, userId }, 'Failed to disconnect TikTok');
      return reply.status(500).send({ error: 'Failed to disconnect TikTok' });
    }

    return { success: true };
  });

  // ----------------------------------------
  // GET /user/default-settings
  // ----------------------------------------
  app.get('/user/default-settings', async (req: FastifyRequest<{
    Querystring: { userAccountId?: string; campaignGoal?: string; directionId?: string }
  }>, reply: FastifyReply) => {
    const userId = (req.query.userAccountId || req.headers['x-user-id']) as string;
    if (!userId) return reply.status(401).send({ error: 'Missing user identifier' });

    let query = supabase
      .from('default_ad_settings')
      .select('*')
      .eq('user_id', userId);

    if (req.query.campaignGoal) {
      query = query.eq('campaign_goal', req.query.campaignGoal);
    }
    if (req.query.directionId) {
      query = query.eq('direction_id', req.query.directionId);
    }

    const { data, error } = req.query.campaignGoal
      ? await query.maybeSingle()
      : await query;

    if (error) {
      log.error({ error, userId }, 'Failed to fetch default settings');
      return reply.status(500).send({ error: 'Failed to fetch default settings' });
    }

    return data || (req.query.campaignGoal ? null : []);
  });

  // ----------------------------------------
  // PUT /user/default-settings
  // ----------------------------------------
  app.put('/user/default-settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return reply.status(401).send({ error: 'Missing x-user-id header' });

    const body = req.body as Record<string, unknown>;

    // Ensure user_id matches the authenticated user (IDOR protection)
    const dataToSave = { ...body, user_id: userId };

    const { data, error } = await supabase
      .from('default_ad_settings')
      .upsert(dataToSave, { onConflict: 'user_id,campaign_goal' })
      .select();

    if (error) {
      log.error({ error, userId }, 'Failed to save default settings');
      return reply.status(500).send({ error: 'Failed to save default settings' });
    }

    return data;
  });

  // ----------------------------------------
  // PUT /user-accounts/:id/wwebjs-label
  // Save WhatsApp label ID for auto-labeling qualified leads
  // ----------------------------------------
  app.put<{ Params: { id: string } }>('/user-accounts/:id/wwebjs-label', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const { labelId } = req.body as { labelId: string };

    if (!labelId) {
      return reply.status(400).send({ error: 'labelId is required' });
    }

    const { error } = await supabase
      .from('user_accounts')
      .update({ wwebjs_label_id: labelId })
      .eq('id', id);

    if (error) {
      log.error({ error, userId: id }, 'Failed to save wwebjs_label_id');
      return reply.status(500).send({ error: 'Failed to save label config' });
    }

    return { ok: true, labelId };
  });
}
