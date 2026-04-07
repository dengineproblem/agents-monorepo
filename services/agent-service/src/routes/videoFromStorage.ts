import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { processVideoTranscription, extractVideoThumbnail } from '../lib/transcription.js';
import {
  graph,
  uploadVideo,
  uploadImage,
  createWhatsAppCreative,
  createInstagramCreative,
  createInstagramDMCreative,
  createWebsiteLeadsCreative,
  createLeadFormVideoCreative,
  createAppInstallsVideoCreative
} from '../adapters/facebook.js';
import { onCreativeCreated } from '../lib/onboardingHelper.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import { createLogger } from '../lib/logger.js';
import { getAppInstallsConfig } from '../lib/appInstallsConfig.js';

const log = createLogger({ module: 'videoFromStorage' });

const TEMP_DIR = '/var/tmp';

function normalizeAdAccountId(id: string): string {
  const s = String(id).trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

const RequestSchema = z.object({
  user_id: z.string().uuid(),
  storage_path: z.string().min(1), // e.g. "uploads/uuid/123_video.mp4"
  account_id: z.string().uuid().optional(),
  direction_id: z.string().uuid().optional(),
  title: z.string().optional(),
  language: z.string().default('ru'),
});

export const videoFromStorageRoutes: FastifyPluginAsync = async (app) => {

  // POST /create-upload-url — бэкенд создаёт signed URL для прямой загрузки из браузера
  app.post('/create-upload-url', async (request: any, reply) => {
    const { user_id, filename, content_type } = request.body as { user_id?: string; filename?: string; content_type?: string };
    if (!user_id || !filename) {
      return reply.status(400).send({ error: 'user_id and filename required' });
    }
    const ext = filename.split('.').pop() || 'mp4';
    const storagePath = `uploads/${user_id}/${Date.now()}_${filename.replace(/[^\w.-]+/g, '_')}`;
    const { data, error } = await supabase.storage
      .from('videos')
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      log.error({ error }, '[create-upload-url] Failed to create signed URL');
      return reply.status(500).send({ error: 'Failed to create upload URL' });
    }
    return reply.send({ signed_url: data.signedUrl, token: data.token, storage_path: storagePath });
  });

  // POST /process-video-from-storage
  // Accepts storage_path (already uploaded to Supabase Storage), processes in background
  app.post('/process-video-from-storage', async (request, reply) => {
    let body: z.infer<typeof RequestSchema>;
    try {
      body = RequestSchema.parse(request.body);
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: 'Validation error', details: err.errors });
    }

    const { user_id, storage_path, account_id, direction_id, title, language } = body;

    // Security: prevent path traversal
    if (storage_path.includes('..') || storage_path.startsWith('/')) {
      return reply.status(400).send({ success: false, error: 'Invalid storage_path' });
    }

    // Validate direction platform if provided
    if (direction_id) {
      const { data: direction } = await supabase
        .from('account_directions')
        .select('platform')
        .eq('id', direction_id)
        .maybeSingle();
      if (direction?.platform === 'tiktok') {
        return reply.status(400).send({ success: false, error: 'TikTok directions not supported via this endpoint' });
      }
    }

    // Create creative record immediately so frontend can poll
    const { data: creative, error: creativeError } = await supabase
      .from('user_creatives')
      .insert({
        user_id,
        account_id: account_id || null,
        title: title || 'Untitled',
        status: 'processing',
        direction_id: direction_id || null,
        media_type: 'video',
        creative_group_id: randomUUID(),
      })
      .select()
      .single();

    if (creativeError || !creative) {
      return reply.status(500).send({ success: false, error: 'Failed to create creative record' });
    }

    // Return immediately — processing happens in background
    reply.send({ success: true, creative_id: creative.id });

    // Background processing (fire-and-forget)
    processVideoFromStorageBackground({
      userId: user_id,
      accountId: account_id,
      directionId: direction_id,
      storagePath: storage_path,
      creativeId: creative.id,
      title: title || 'Untitled',
      language,
    }).catch(err => {
      log.error({ err, creativeId: creative.id }, '[FromStorage] Background processing failed');
    });
  });

  // GET /creative-status?creative_id=<id>&user_id=<id>
  // Simple polling endpoint for frontend
  app.get('/creative-status', async (request: any, reply) => {
    const { creative_id, user_id } = request.query as { creative_id?: string; user_id?: string };

    if (!creative_id || !user_id) {
      return reply.status(400).send({ error: 'creative_id and user_id are required' });
    }

    const { data: creative, error } = await supabase
      .from('user_creatives')
      .select('id, status, error_text, fb_video_id, thumbnail_url')
      .eq('id', creative_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (error) return reply.status(500).send({ error: 'DB error' });
    if (!creative) return reply.status(404).send({ error: 'Not found' });

    if (creative.status === 'processing') {
      return reply.send({ status: 'processing', creative_id });
    }
    if (creative.status === 'error' || creative.status === 'failed') {
      return reply.send({ status: 'error', creative_id, error: creative.error_text || 'Processing failed' });
    }
    // ready
    return reply.send({ status: 'success', creative_id, fb_video_id: creative.fb_video_id, thumbnail_url: creative.thumbnail_url });
  });
};

async function processVideoFromStorageBackground({
  userId,
  accountId,
  directionId,
  storagePath,
  creativeId,
  title,
  language,
}: {
  userId: string;
  accountId?: string;
  directionId?: string;
  storagePath: string;
  creativeId: string;
  title: string;
  language: string;
}) {
  const tempVideoPath = path.join(TEMP_DIR, `fromstorage_${randomUUID()}.mp4`);
  let backgroundTranscriptionStarted = false;

  try {
    // 1. Download from Supabase Storage
    log.info({ creativeId, storagePath }, '[FromStorage] Downloading video from Supabase Storage');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('videos')
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download from storage: ${downloadError?.message}`);
    }

    // Write to temp file
    const arrayBuffer = await fileData.arrayBuffer();
    await fs.writeFile(tempVideoPath, Buffer.from(arrayBuffer));
    const stats = await fs.stat(tempVideoPath);
    log.info({ creativeId, fileSizeMB: Math.round(stats.size / 1024 / 1024) }, '[FromStorage] Video downloaded to temp');

    // 2. Get credentials
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, multi_account_enabled, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
      .eq('id', userId)
      .single();

    if (userError || !userAccount) throw new Error(`User account not found: ${userError?.message}`);

    let ACCESS_TOKEN: string;
    let fbAdAccountId: string;
    let pageId: string;
    let instagramId: string | null;
    let instagramUsername: string | null = null;
    let whatsappPhoneNumber: string | null = null;

    if (userAccount.multi_account_enabled) {
      if (!accountId) throw new Error('account_id required for multi_account_enabled');
      const { data: adAccount, error: adError } = await supabase
        .from('ad_accounts')
        .select('access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
        .eq('id', accountId)
        .eq('user_account_id', userId)
        .single();
      if (adError || !adAccount) throw new Error(`Ad account not found: ${adError?.message}`);
      ACCESS_TOKEN = adAccount.access_token;
      fbAdAccountId = adAccount.ad_account_id;
      pageId = adAccount.page_id;
      instagramId = adAccount.instagram_id || null;
      instagramUsername = adAccount.instagram_username;
      whatsappPhoneNumber = adAccount.whatsapp_phone_number;
    } else {
      if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id) {
        throw new Error('User account credentials incomplete');
      }
      ACCESS_TOKEN = userAccount.access_token;
      fbAdAccountId = userAccount.ad_account_id;
      pageId = userAccount.page_id;
      instagramId = userAccount.instagram_id || null;
      instagramUsername = userAccount.instagram_username;
      whatsappPhoneNumber = userAccount.whatsapp_phone_number;
    }

    const normalizedAdAccountId = normalizeAdAccountId(fbAdAccountId);

    // 3. Upload video to Facebook
    log.info({ creativeId }, '[FromStorage] Uploading to Facebook');
    const fbVideo = await uploadVideo(normalizedAdAccountId, ACCESS_TOKEN, tempVideoPath);
    log.info({ creativeId, fbVideoId: fbVideo.id }, '[FromStorage] Facebook upload done');

    // 4. Poll Facebook video status (max 60s, 2s interval)
    const pollMaxMs = 60_000;
    const pollIntervalMs = 2_000;
    const pollStart = Date.now();
    while (Date.now() - pollStart < pollMaxMs) {
      try {
        const videoStatus = await graph('GET', fbVideo.id, ACCESS_TOKEN, { fields: 'status' });
        const status = videoStatus?.status?.video_status;
        if (status === 'ready') break;
        if (status === 'error') { log.warn({ creativeId }, '[FromStorage] FB video error, continuing'); break; }
      } catch { break; }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    // 5. Parallel: thumbnail + direction settings
    const [thumbnailBuffer, directionSettings] = await Promise.all([
      extractVideoThumbnail(tempVideoPath),
      loadDirectionSettings(directionId),
    ]);

    const { description, clientQuestions, siteUrl, utm, leadFormId, appStoreUrl, objective, useInstagram, direction } = directionSettings;

    // Resolve instagram based on use_instagram flag
    const effectiveInstagramId = useInstagram ? (instagramId || undefined) : undefined;

    // 6. Upload thumbnail to Facebook
    const thumbnailResult = await uploadImage(normalizedAdAccountId, ACCESS_TOKEN, thumbnailBuffer);

    // 7. Save thumbnail to Supabase Storage (creo bucket)
    let thumbnailUrl: string | null = null;
    try {
      const thumbnailFileName = `video-thumbnails/${userId}/${creativeId}_${Date.now()}.jpg`;
      const { error: storageErr } = await supabase.storage
        .from('creo')
        .upload(thumbnailFileName, thumbnailBuffer, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (!storageErr) {
        const { data: pub } = supabase.storage.from('creo').getPublicUrl(thumbnailFileName);
        thumbnailUrl = pub?.publicUrl || null;
      }
    } catch { /* non-critical */ }

    // 8. Create FB creative
    let fbCreativeId = '';
    if (objective === 'whatsapp' || (objective === 'conversions' && direction?.conversion_channel === 'whatsapp')) {
      const c = await createWhatsAppCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId: effectiveInstagramId, message: description, clientQuestions, whatsappPhoneNumber: whatsappPhoneNumber || undefined, thumbnailHash: thumbnailResult.hash });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_traffic') {
      if (!instagramId) throw new Error('Instagram Traffic requires instagram_id');
      const c = await createInstagramCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId, instagramUsername: instagramUsername || '', message: description, thumbnailHash: thumbnailResult.hash });
      fbCreativeId = c.id;
    } else if (objective === 'instagram_dm') {
      if (!instagramId) throw new Error('Instagram DM requires instagram_id');
      const c = await createInstagramDMCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId, message: description, thumbnailHash: thumbnailResult.hash });
      fbCreativeId = c.id;
    } else if (objective === 'site_leads' || (objective === 'conversions' && direction?.conversion_channel === 'site')) {
      if (!siteUrl) throw new Error('site_url required for site_leads');
      const c = await createWebsiteLeadsCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId: effectiveInstagramId, message: description, siteUrl, utm: utm ?? undefined, thumbnailHash: thumbnailResult.hash, ctaType: direction?.cta_type || undefined });
      fbCreativeId = c.id;
    } else if (objective === 'lead_forms' || (objective === 'conversions' && direction?.conversion_channel === 'lead_form')) {
      if (!leadFormId) throw new Error('lead_form_id required for lead_forms');
      const c = await createLeadFormVideoCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId: effectiveInstagramId, message: description, leadFormId, thumbnailHash: thumbnailResult.hash, ctaType: direction?.cta_type || undefined });
      fbCreativeId = c.id;
    } else if (objective === 'app_installs') {
      const appConfig = getAppInstallsConfig();
      if (!appConfig || !appStoreUrl) throw new Error('app_installs requires app_id and app_store_url');
      const c = await createAppInstallsVideoCreative(normalizedAdAccountId, ACCESS_TOKEN, { videoId: fbVideo.id, pageId, instagramId: effectiveInstagramId, message: description, appStoreUrl, thumbnailHash: thumbnailResult.hash });
      fbCreativeId = c.id;
    }

    // 9. Update creative to 'ready'
    const obj = objective as string;
    const updateData: Record<string, any> = {
      fb_video_id: fbVideo.id,
      status: 'ready',
      fb_creative_id: fbCreativeId,
      ...(thumbnailUrl && { thumbnail_url: thumbnailUrl }),
      ...(obj === 'whatsapp' && { fb_creative_id_whatsapp: fbCreativeId }),
      ...(obj === 'instagram_traffic' && { fb_creative_id_instagram_traffic: fbCreativeId }),
      ...(obj === 'instagram_dm' && { fb_creative_id_whatsapp: fbCreativeId }),
      ...((obj === 'site_leads' || (obj === 'conversions' && direction?.conversion_channel === 'site')) && { fb_creative_id_site_leads: fbCreativeId }),
      ...((obj === 'lead_forms' || (obj === 'conversions' && direction?.conversion_channel === 'lead_form')) && { fb_creative_id_lead_forms: fbCreativeId }),
    };
    await supabase.from('user_creatives').update(updateData).eq('id', creativeId);
    log.info({ creativeId, fbVideoId: fbVideo.id, fbCreativeId }, '[FromStorage] Creative ready');

    // 10. Start background transcription (fire-and-forget)
    backgroundTranscriptionStarted = true;
    const bgPath = tempVideoPath;
    Promise.resolve().then(async () => {
      try {
        const transcript = await processVideoTranscription(bgPath, language);
        await supabase.from('creative_transcripts').insert({
          creative_id: creativeId,
          lang: language,
          source: 'whisper',
          text: transcript.text,
          duration_sec: transcript.duration ? Math.round(transcript.duration) : null,
          status: 'ready',
        });
        log.info({ creativeId }, '[FromStorage] Background transcription saved');
      } catch (err: any) {
        log.warn({ err: err.message, creativeId }, '[FromStorage] Background transcription failed');
      } finally {
        // Delete temp video file
        await fs.unlink(bgPath).catch(() => {});
        // Delete from Supabase Storage
        await supabase.storage.from('videos').remove([storagePath]).catch(() => {});
        log.info({ creativeId, storagePath }, '[FromStorage] Cleanup done');
      }
    }).catch(() => {});

    onCreativeCreated(userId).catch(() => {});

  } catch (error: any) {
    log.error({ err: error, creativeId }, '[FromStorage] Processing failed');
    await supabase.from('user_creatives')
      .update({ status: 'error', error_text: error.message || 'Processing failed' })
      .eq('id', creativeId);

    logErrorToAdmin({
      user_account_id: userId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'process_video_from_storage',
      endpoint: '/process-video-from-storage',
      request_data: { creativeId, storagePath },
      severity: 'warning',
    }).catch(() => {});

  } finally {
    if (!backgroundTranscriptionStarted) {
      // Error before background started — clean up now
      await fs.unlink(tempVideoPath).catch(() => {});
      await supabase.storage.from('videos').remove([storagePath]).catch(() => {});
    }
  }
}

async function loadDirectionSettings(directionId?: string) {
  let description = 'Напишите нам, чтобы узнать подробности';
  let clientQuestions: string[] = ['Здравствуйте! Хочу узнать об этом подробнее.'];
  let siteUrl: string | null = null;
  let utm: string | null = null;
  let leadFormId: string | null = null;
  let appStoreUrl: string | null = null;
  let objective: 'whatsapp' | 'conversions' | 'instagram_traffic' | 'instagram_dm' | 'site_leads' | 'lead_forms' | 'app_installs' = 'whatsapp';
  let useInstagram = true;
  let direction: any = null;

  if (!directionId) return { description, clientQuestions, siteUrl, utm, leadFormId, appStoreUrl, objective, useInstagram, direction };

  const [{ data: dir }, { data: settings }] = await Promise.all([
    supabase.from('account_directions').select('objective, use_instagram, conversion_channel, cta_type').eq('id', directionId).maybeSingle(),
    supabase.from('default_ad_settings').select('*').eq('direction_id', directionId).maybeSingle(),
  ]);

  direction = dir;
  if (dir?.objective) objective = dir.objective as typeof objective;
  if (dir?.use_instagram !== undefined) useInstagram = dir.use_instagram;

  if (settings) {
    description = settings.description || description;
    clientQuestions = settings.client_questions?.length ? settings.client_questions : [settings.client_question || clientQuestions[0]];
    siteUrl = settings.site_url;
    utm = settings.utm_tag;
    leadFormId = settings.lead_form_id;
    appStoreUrl = settings.app_store_url || null;
  }

  return { description, clientQuestions, siteUrl, utm, leadFormId, appStoreUrl, objective, useInstagram, direction };
}
