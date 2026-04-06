/**
 * User Creatives API Routes
 *
 * CRUD для user_creatives, получение generated_creatives,
 * транскриптов, метрик, тестов и bulk-запросов.
 *
 * @module routes/userCreatives
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { shouldFilterByAccountId } from '../lib/multiAccountHelper.js';
import {
  uploadImage,
  createWhatsAppCreative,
  createInstagramCreative,
  createInstagramDMCreative,
  createWebsiteLeadsCreative,
  createLeadFormVideoCreative,
  createAppInstallsVideoCreative,
} from '../adapters/facebook.js';
import { getAppInstallsConfig } from '../lib/appInstallsConfig.js';

const log = createLogger({ module: 'userCreativesRoutes' });

export default async function userCreativesRoutes(app: FastifyInstance) {

  // ----------------------------------------
  // GET /user-creatives
  // ----------------------------------------
  app.get('/user-creatives', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, accountId, status } = req.query as {
        userId?: string;
        accountId?: string;
        status?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      const statusArray = status
        ? status.split(',').map(s => s.trim()).filter(Boolean)
        : ['ready', 'partial_ready', 'uploaded'];

      let query = supabase
        .from('user_creatives')
        .select('*')
        .eq('user_id', effectiveUserId)
        .in('status', statusArray)
        .order('created_at', { ascending: false });

      if (accountId && await shouldFilterByAccountId(supabase, effectiveUserId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch user creatives');
        return reply.status(500).send({ error: 'Failed to fetch user creatives' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching user creatives');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // POST /user-creatives
  // ----------------------------------------
  app.post('/user-creatives', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const body = req.body as Record<string, unknown>;

      // IDOR protection: force user_id from header
      const data = { ...body, user_id: userId };

      const { data: inserted, error } = await supabase
        .from('user_creatives')
        .insert(data)
        .select('*')
        .single();

      if (error) {
        log.error({ error, userId }, 'Failed to insert user creative');
        return reply.status(500).send({ error: 'Failed to create user creative' });
      }

      return inserted;

    } catch (error: any) {
      log.error({ error }, 'Error creating user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // PATCH /user-creatives/:id
  // ----------------------------------------
  app.patch('/user-creatives/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;

      // IDOR protection: ensure ownership via user_id
      const { data: updated, error } = await supabase
        .from('user_creatives')
        .update(body)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        log.error({ error, userId, id }, 'Failed to update user creative');
        return reply.status(500).send({ error: 'Failed to update user creative' });
      }

      if (!updated) {
        return reply.status(404).send({ error: 'User creative not found or not owned by user' });
      }

      return updated;

    } catch (error: any) {
      log.error({ error }, 'Error updating user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // DELETE /user-creatives/:id
  // ----------------------------------------
  app.delete('/user-creatives/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      // IDOR protection: ensure ownership via user_id
      const { error } = await supabase
        .from('user_creatives')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        log.error({ error, userId, id }, 'Failed to delete user creative');
        return reply.status(500).send({ error: 'Failed to delete user creative' });
      }

      return { success: true };

    } catch (error: any) {
      log.error({ error }, 'Error deleting user creative');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/:id/generated
  // ----------------------------------------
  app.get('/user-creatives/:id/generated', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      // Get user_creative with IDOR protection
      const { data: creative, error: creativeError } = await supabase
        .from('user_creatives')
        .select('generated_creative_id, carousel_data')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (creativeError || !creative) {
        return reply.status(404).send({ error: 'User creative not found or not owned by user' });
      }

      let generated = null;
      if (creative.generated_creative_id) {
        const { data: genData, error: genError } = await supabase
          .from('generated_creatives')
          .select('id, offer, bullets, profits, carousel_data, creative_type')
          .eq('id', creative.generated_creative_id)
          .single();

        if (genError) {
          log.error({ error: genError, generatedCreativeId: creative.generated_creative_id }, 'Failed to fetch generated creative');
        } else {
          generated = genData;
        }
      }

      return { creative, generated };

    } catch (error: any) {
      log.error({ error }, 'Error fetching generated creative data');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/:id/transcript
  // ----------------------------------------
  app.get('/user-creatives/:id/transcript', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) {
        return reply.status(401).send({ error: 'Missing x-user-id header' });
      }

      const { id } = req.params as { id: string };

      const { data, error } = await supabase
        .from('creative_transcripts')
        .select('text, created_at')
        .eq('creative_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        log.error({ error, creativeId: id }, 'Failed to fetch creative transcript');
        return reply.status(500).send({ error: 'Failed to fetch creative transcript' });
      }

      return data || null;

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative transcript');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/metrics
  // ----------------------------------------
  app.get('/user-creatives/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const {
        userId: queryUserId,
        userCreativeIds,
        adIds,
        dateFrom,
        dateTo,
        accountId,
        source,
      } = req.query as {
        userId?: string;
        userCreativeIds?: string;
        adIds?: string;
        dateFrom?: string;
        dateTo?: string;
        accountId?: string;
        source?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      let query = supabase
        .from('creative_metrics_history')
        .select('*')
        .eq('user_account_id', effectiveUserId);

      if (userCreativeIds) {
        const ids = userCreativeIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          query = query.in('user_creative_id', ids);
        }
      }

      if (adIds) {
        const ids = adIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          query = query.in('ad_id', ids);
        }
      }

      if (dateFrom) {
        query = query.gte('date', dateFrom);
      }

      if (dateTo) {
        query = query.lte('date', dateTo);
      }

      if (source) {
        query = query.eq('source', source);
      }

      if (accountId && await shouldFilterByAccountId(supabase, effectiveUserId, accountId)) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch creative metrics');
        return reply.status(500).send({ error: 'Failed to fetch creative metrics' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative metrics');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/tests
  // ----------------------------------------
  app.get('/user-creatives/tests', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, creativeIds } = req.query as {
        userId?: string;
        creativeIds?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      if (!creativeIds) {
        return reply.status(400).send({ error: 'Missing creativeIds parameter' });
      }

      const ids = creativeIds.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('creative_tests')
        .select('user_creative_id, status, started_at, completed_at, impressions, created_at')
        .in('user_creative_id', ids)
        .order('created_at', { ascending: false });

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch creative tests');
        return reply.status(500).send({ error: 'Failed to fetch creative tests' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching creative tests');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/by-ids
  // ----------------------------------------
  app.get('/user-creatives/by-ids', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { userId: queryUserId, ids: idsParam } = req.query as {
        userId?: string;
        ids?: string;
      };

      const effectiveUserId = userId || queryUserId;
      if (!effectiveUserId) {
        return reply.status(400).send({ error: 'Missing userId or x-user-id' });
      }

      if (!idsParam) {
        return reply.status(400).send({ error: 'Missing ids parameter' });
      }

      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('user_creatives')
        .select('id, title, created_at, media_type, image_url, thumbnail_url, carousel_data, generated_creative_id, fb_video_id, direction_id')
        .eq('user_id', effectiveUserId)
        .in('id', ids);

      if (error) {
        log.error({ error, userId: effectiveUserId }, 'Failed to fetch user creatives by ids');
        return reply.status(500).send({ error: 'Failed to fetch user creatives by ids' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching user creatives by ids');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // GET /user-creatives/generated-bulk
  // ----------------------------------------
  app.get('/user-creatives/generated-bulk', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { generatedIds } = req.query as { generatedIds?: string };

      if (!generatedIds) {
        return reply.status(400).send({ error: 'Missing generatedIds parameter' });
      }

      const ids = generatedIds.split(',').map(s => s.trim()).filter(Boolean);

      const { data, error } = await supabase
        .from('generated_creatives')
        .select('id, carousel_data')
        .in('id', ids);

      if (error) {
        log.error({ error }, 'Failed to fetch generated creatives bulk');
        return reply.status(500).send({ error: 'Failed to fetch generated creatives' });
      }

      return data || [];

    } catch (error: any) {
      log.error({ error }, 'Error fetching generated creatives bulk');
      return reply.status(500).send({ error: 'internal_error', message: error.message });
    }
  });

  // ----------------------------------------
  // POST /user-creatives/:id/assign-direction
  // Привязать существующий видео-креатив к другому направлению:
  // переиспользует fb_video_id, создаёт новый fb_creative_id и новую строку
  // ----------------------------------------
  app.post('/user-creatives/:id/assign-direction', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id: sourceCreativeId } = req.params as { id: string };
      const userId = req.headers['x-user-id'] as string;
      const body = req.body as { target_direction_id: string; account_id?: string };

      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
      if (!body?.target_direction_id) return reply.status(400).send({ error: 'target_direction_id is required' });

      // 1. Исходный креатив
      const { data: source, error: sourceError } = await supabase
        .from('user_creatives')
        .select('*')
        .eq('id', sourceCreativeId)
        .eq('user_id', userId)
        .single();

      if (sourceError || !source) return reply.status(404).send({ error: 'Creative not found' });
      if (source.media_type !== 'video') return reply.status(400).send({ error: 'Only video creatives can be assigned to directions' });
      if (!source.fb_video_id) return reply.status(400).send({ error: 'Creative has no uploaded video' });
      if (!source.thumbnail_url) return reply.status(400).send({ error: 'Creative has no thumbnail' });
      if (source.direction_id === body.target_direction_id) {
        return reply.status(400).send({ error: 'Creative is already in this direction' });
      }

      // 2. Credentials аккаунта
      const { data: userAccount } = await supabase
        .from('user_accounts')
        .select('multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
        .eq('id', userId)
        .single();

      if (!userAccount) return reply.status(404).send({ error: 'User account not found' });

      let ACCESS_TOKEN: string;
      let fbAdAccountId: string;
      let pageId: string;
      let instagramId: string | null;
      let instagramUsername: string | null = null;
      let whatsappPhoneNumber: string | null = null;

      const effectiveAccountId = body.account_id || source.account_id;

      if (userAccount.multi_account_enabled && effectiveAccountId) {
        const { data: adAccount } = await supabase
          .from('ad_accounts')
          .select('access_token, ad_account_id, page_id, instagram_id, instagram_username')
          .eq('id', effectiveAccountId)
          .eq('user_account_id', userId)
          .single();

        if (!adAccount?.access_token || !adAccount?.ad_account_id || !adAccount?.page_id) {
          return reply.status(400).send({ error: 'Ad account incomplete or not found' });
        }
        ACCESS_TOKEN = adAccount.access_token;
        fbAdAccountId = adAccount.ad_account_id;
        pageId = adAccount.page_id;
        instagramId = adAccount.instagram_id || null;
        instagramUsername = adAccount.instagram_username || null;
      } else {
        if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id) {
          return reply.status(400).send({ error: 'User account incomplete' });
        }
        ACCESS_TOKEN = userAccount.access_token;
        fbAdAccountId = userAccount.ad_account_id;
        pageId = userAccount.page_id;
        instagramId = userAccount.instagram_id || null;
        instagramUsername = userAccount.instagram_username || null;
        whatsappPhoneNumber = userAccount.whatsapp_phone_number || null;
      }

      const normalizedAccountId = fbAdAccountId.startsWith('act_') ? fbAdAccountId : `act_${fbAdAccountId}`;

      // 3. Целевое направление + настройки
      const { data: direction } = await supabase
        .from('account_directions')
        .select('objective, platform, conversion_channel, cta_type')
        .eq('id', body.target_direction_id)
        .maybeSingle();

      if (!direction) return reply.status(404).send({ error: 'Direction not found' });
      if (direction.platform === 'tiktok') return reply.status(400).send({ error: 'TikTok directions are not supported for Facebook video creatives' });

      const { data: settings } = await supabase
        .from('default_ad_settings')
        .select('description, client_question, client_questions, site_url, utm_tag, lead_form_id, app_store_url')
        .eq('direction_id', body.target_direction_id)
        .maybeSingle();

      const description = settings?.description || 'Напишите нам, чтобы узнать подробности';
      const clientQuestions: string[] = (settings as any)?.client_questions?.length
        ? (settings as any).client_questions
        : [settings?.client_question || 'Здравствуйте! Хочу узнать об этом подробнее.'];
      const siteUrl = settings?.site_url || null;
      const utm = settings?.utm_tag || null;
      const leadFormId = settings?.lead_form_id || null;
      const appStoreUrl = settings?.app_store_url || null;
      const objective = direction.objective || 'whatsapp';

      // 4. Скачиваем thumbnail из Supabase Storage → загружаем в FB
      const thumbResponse = await fetch(source.thumbnail_url);
      if (!thumbResponse.ok) {
        return reply.status(502).send({ error: 'Failed to download thumbnail from storage' });
      }
      const thumbnailBuffer = Buffer.from(await thumbResponse.arrayBuffer());
      const thumbnailResult = await uploadImage(normalizedAccountId, ACCESS_TOKEN, thumbnailBuffer);

      // 5. Создаём FB creative под objective нового направления
      let fbCreativeId = '';

      if (objective === 'whatsapp' || (objective === 'conversions' && direction.conversion_channel === 'whatsapp')) {
        const c = await createWhatsAppCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId,
          instagramId: instagramId || undefined, message: description,
          clientQuestions, whatsappPhoneNumber: whatsappPhoneNumber || undefined,
          thumbnailHash: thumbnailResult.hash,
        });
        fbCreativeId = c.id;
      } else if (objective === 'instagram_traffic') {
        if (!instagramId) return reply.status(400).send({ error: 'Instagram ID required for instagram_traffic' });
        const c = await createInstagramCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId, instagramId,
          instagramUsername: instagramUsername || '', message: description,
          thumbnailHash: thumbnailResult.hash,
        });
        fbCreativeId = c.id;
      } else if (objective === 'instagram_dm') {
        if (!instagramId) return reply.status(400).send({ error: 'Instagram ID required for instagram_dm' });
        const c = await createInstagramDMCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId, instagramId,
          message: description, thumbnailHash: thumbnailResult.hash,
        });
        fbCreativeId = c.id;
      } else if (objective === 'site_leads' || (objective === 'conversions' && direction.conversion_channel === 'site')) {
        if (!siteUrl) return reply.status(400).send({ error: 'site_url is required for site_leads in direction settings' });
        const c = await createWebsiteLeadsCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId, instagramId,
          message: description, siteUrl, utm,
          thumbnailHash: thumbnailResult.hash, ctaType: direction.cta_type || undefined,
        });
        fbCreativeId = c.id;
      } else if (objective === 'lead_forms' || (objective === 'conversions' && direction.conversion_channel === 'lead_form')) {
        if (!leadFormId) return reply.status(400).send({ error: 'lead_form_id is required for lead_forms in direction settings' });
        const c = await createLeadFormVideoCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId, instagramId,
          message: description, leadFormId,
          thumbnailHash: thumbnailResult.hash, ctaType: direction.cta_type || undefined,
        });
        fbCreativeId = c.id;
      } else if (objective === 'app_installs') {
        const appConfig = getAppInstallsConfig();
        if (!appConfig || !appStoreUrl) return reply.status(400).send({ error: 'app_id and app_store_url required for app_installs' });
        const c = await createAppInstallsVideoCreative(normalizedAccountId, ACCESS_TOKEN, {
          videoId: source.fb_video_id, pageId, instagramId,
          message: description, appStoreUrl, thumbnailHash: thumbnailResult.hash,
        });
        fbCreativeId = c.id;
      }

      // 6. Создаём новую запись креатива
      const { data: newCreative, error: insertError } = await supabase
        .from('user_creatives')
        .insert({
          user_id: userId,
          account_id: effectiveAccountId || null,
          title: source.title,
          status: 'ready',
          direction_id: body.target_direction_id,
          media_type: 'video',
          fb_video_id: source.fb_video_id,
          fb_creative_id: fbCreativeId,
          file_hash: source.file_hash || null,
          thumbnail_url: source.thumbnail_url,
          creative_group_id: source.creative_group_id || randomUUID(),
          is_active: true,
          source: source.source || 'uploaded',
        })
        .select('id')
        .single();

      if (insertError || !newCreative) {
        log.error({ insertError }, 'Failed to insert assigned creative');
        return reply.status(500).send({ error: 'Failed to create creative record' });
      }

      log.info({ sourceCreativeId, newCreativeId: newCreative.id, targetDirectionId: body.target_direction_id }, 'Creative assigned to direction');

      return { success: true, creative_id: newCreative.id, fb_creative_id: fbCreativeId };

    } catch (error: any) {
      log.error({ error: error.message }, 'Error assigning creative to direction');
      if (error.fb) {
        return reply.status(500).send({ error: error.message, facebook_error: error.fb });
      }
      return reply.status(500).send({ error: error.message || 'Internal server error' });
    }
  });
}
