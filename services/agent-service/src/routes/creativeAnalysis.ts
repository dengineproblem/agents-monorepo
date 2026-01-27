import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { processVideoTranscription, extractVideoThumbnail } from '../lib/transcription.js';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import path from 'path';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const MIN_LEADS = 5;
const TOP_CREATIVES_LIMIT = 5;
const DATE_PRESET = 'last_90d';

interface AdInsight {
  ad_id: string;
  ad_name: string;
  creative_id: string;
  video_id: string | null;
  thumbnail_url: string | null;
  spend: number;
  leads: number;
  cpl: number;
}

interface FBAction {
  action_type: string;
  value: string;
}

interface FBInsightsData {
  spend: string;
  actions?: FBAction[];
}

const AnalyzeSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(), // UUID для мультиаккаунтности
  force: z.boolean().default(false), // Принудительно перезапустить даже если уже есть импортированные
});

/**
 * Получает топ креативы по CPL из Facebook Ads
 */
async function fetchTopCreatives(
  accessToken: string,
  adAccountId: string,
  log: any
): Promise<AdInsight[]> {
  const normalizedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Шаг 1: Получить все ads за период с creative info
  log.info({ adAccountId: normalizedAccountId }, 'Fetching ads with creatives...');

  const adsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAccountId}/ads?` +
    `fields=id,name,creative{id,video_id,thumbnail_url}` +
    `&date_preset=${DATE_PRESET}` +
    `&limit=500` +
    `&access_token=${accessToken}`;

  const adsResponse = await fetch(adsUrl);
  const adsData = await adsResponse.json() as { data?: any[]; error?: any };

  if (!adsResponse.ok || adsData.error) {
    log.error({ error: adsData.error }, 'Failed to fetch ads');
    throw new Error(`Facebook API error: ${adsData.error?.message || 'Unknown error'}`);
  }

  const ads = adsData.data || [];
  log.info({ count: ads.length }, 'Fetched ads');

  if (ads.length === 0) {
    return [];
  }

  // Шаг 2: Batch запрос для insights каждого ad
  const adIds = ads.map((ad: any) => ad.id);
  const insights: Map<string, FBInsightsData> = new Map();

  // Разбиваем на batch по 50 (лимит FB)
  const BATCH_SIZE = 50;
  for (let i = 0; i < adIds.length; i += BATCH_SIZE) {
    const batch = adIds.slice(i, i + BATCH_SIZE);
    const batchRequests = batch.map((adId: string) => ({
      method: 'GET',
      relative_url: `${adId}/insights?fields=spend,actions&date_preset=${DATE_PRESET}&action_breakdowns=action_type`
    }));

    const batchUrl = `https://graph.facebook.com/${FB_API_VERSION}/?` +
      `batch=${encodeURIComponent(JSON.stringify(batchRequests))}` +
      `&access_token=${accessToken}`;

    const batchResponse = await fetch(batchUrl, { method: 'POST' });
    const batchData = await batchResponse.json() as any[];

    if (!batchResponse.ok) {
      log.error({ status: batchResponse.status }, 'Batch request failed');
      continue;
    }

    batchData.forEach((result: any, idx: number) => {
      if (result.code === 200) {
        try {
          const body = JSON.parse(result.body);
          const insightData = body.data?.[0];
          if (insightData) {
            insights.set(batch[idx], insightData);
          }
        } catch (e) {
          log.warn({ adId: batch[idx], error: e }, 'Failed to parse insight');
        }
      }
    });
  }

  log.info({ insightsCount: insights.size }, 'Fetched insights');

  // Шаг 3: Рассчитываем CPL и фильтруем
  const results: AdInsight[] = [];

  for (const ad of ads) {
    const insight = insights.get(ad.id);
    if (!insight) continue;

    const spend = parseFloat(insight.spend || '0');
    const actions = insight.actions || [];
    const leadAction = actions.find((a: FBAction) =>
      a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
    );
    const leads = leadAction ? parseInt(leadAction.value, 10) : 0;

    if (leads < MIN_LEADS) continue;

    const cpl = leads > 0 ? spend / leads : Infinity;

    results.push({
      ad_id: ad.id,
      ad_name: ad.name,
      creative_id: ad.creative?.id || '',
      video_id: ad.creative?.video_id || null,
      thumbnail_url: ad.creative?.thumbnail_url || null,
      spend,
      leads,
      cpl,
    });
  }

  // Сортируем по CPL и берём топ
  results.sort((a, b) => a.cpl - b.cpl);
  const topCreatives = results.slice(0, TOP_CREATIVES_LIMIT);

  log.info({
    totalWithLeads: results.length,
    selected: topCreatives.length,
    bestCpl: topCreatives[0]?.cpl,
  }, 'Top creatives selected');

  return topCreatives;
}

/**
 * Скачивает видео и транскрибирует его
 */
async function downloadAndTranscribe(
  videoId: string,
  accessToken: string,
  log: any
): Promise<{ text: string; duration?: number; videoPath: string } | null> {
  // Получаем URL видео
  const videoInfoUrl = `https://graph.facebook.com/${FB_API_VERSION}/${videoId}?fields=source&access_token=${accessToken}`;
  const videoInfoResponse = await fetch(videoInfoUrl);
  const videoInfo = await videoInfoResponse.json() as { source?: string; error?: any };

  if (!videoInfoResponse.ok || !videoInfo.source) {
    log.warn({ videoId, error: videoInfo.error }, 'Failed to get video URL');
    return null;
  }

  const videoUrl = videoInfo.source;
  const videoPath = path.join('/var/tmp', `import_${randomUUID()}.mp4`);

  log.info({ videoId, videoPath }, 'Downloading video...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

    const response = await fetch(videoUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VideoDownloader/1.0)'
      }
    });

    clearTimeout(timeout);

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download video: HTTP ${response.status}`);
    }

    const nodeStream = Readable.fromWeb(response.body as any);
    await pipeline(nodeStream, createWriteStream(videoPath));

    const stats = await fs.stat(videoPath);
    if (stats.size === 0) {
      throw new Error('Downloaded empty video file');
    }

    log.info({ videoPath, fileSize: stats.size }, 'Video downloaded, transcribing...');

    // Транскрибируем
    const transcription = await processVideoTranscription(videoPath, 'ru');

    log.info({ textLength: transcription.text.length }, 'Transcription completed');

    return {
      text: transcription.text,
      duration: transcription.duration,
      videoPath,
    };
  } catch (error: any) {
    log.error({ videoId, error: error.message }, 'Download/transcribe failed');

    // Очищаем файл при ошибке
    try {
      await fs.unlink(videoPath);
    } catch {}

    return null;
  }
}

/**
 * Экспортируемая функция для вызова из других мест (approve-fb)
 */
export async function analyzeTopCreatives(
  userId: string,
  accountId?: string,
  force: boolean = false
): Promise<{ success: boolean; imported: number; error?: string }> {
  const log = console; // В реальном использовании будет logger из fastify

  try {
    // Получаем credentials
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, access_token, ad_account_id, multi_account_enabled')
      .eq('id', userId)
      .single();

    if (userError || !userAccount) {
      return { success: false, imported: 0, error: 'User not found' };
    }

    let accessToken: string;
    let adAccountId: string;
    let targetAccountId: string | null = null;

    if (userAccount.multi_account_enabled && accountId) {
      // Multi-account режим
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('id, access_token, ad_account_id')
        .eq('id', accountId)
        .eq('user_account_id', userId)
        .single();

      if (!adAccount?.access_token || !adAccount?.ad_account_id) {
        return { success: false, imported: 0, error: 'Ad account not found or incomplete' };
      }

      accessToken = adAccount.access_token;
      adAccountId = adAccount.ad_account_id;
      targetAccountId = adAccount.id;
    } else {
      // Legacy режим
      if (!userAccount.access_token || !userAccount.ad_account_id) {
        return { success: false, imported: 0, error: 'User has no FB credentials' };
      }

      accessToken = userAccount.access_token;
      adAccountId = userAccount.ad_account_id;
    }

    // Проверяем, есть ли уже импортированные креативы (если не force)
    if (!force) {
      const { data: existing } = await supabase
        .from('user_creatives')
        .select('id')
        .eq('user_id', userId)
        .eq('source', 'imported_analysis')
        .limit(1);

      if (existing && existing.length > 0) {
        log.info({ userId }, 'Already has imported creatives, skipping');
        return { success: true, imported: 0 };
      }
    }

    // Получаем топ креативы из FB
    const topCreatives = await fetchTopCreatives(accessToken, adAccountId, log);

    if (topCreatives.length === 0) {
      log.info({ userId }, 'No qualifying creatives found');
      return { success: true, imported: 0 };
    }

    let importedCount = 0;

    // Импортируем каждый креатив
    for (const creative of topCreatives) {
      try {
        // Пропускаем не-видео креативы
        if (!creative.video_id) {
          log.info({ adId: creative.ad_id }, 'Skipping non-video creative');
          continue;
        }

        // Проверяем, не импортировали ли уже этот ad
        const { data: existingAd } = await supabase
          .from('user_creatives')
          .select('id')
          .eq('user_id', userId)
          .eq('fb_ad_id', creative.ad_id)
          .maybeSingle();

        if (existingAd) {
          log.info({ adId: creative.ad_id }, 'Ad already imported, skipping');
          continue;
        }

        // Скачиваем и транскрибируем
        const transcription = await downloadAndTranscribe(creative.video_id, accessToken, log);

        if (!transcription) {
          log.warn({ videoId: creative.video_id }, 'Failed to transcribe, skipping');
          continue;
        }

        // Извлекаем thumbnail
        let thumbnailUrl: string | null = creative.thumbnail_url;
        let thumbnailBuffer: Buffer | null = null;

        try {
          thumbnailBuffer = await extractVideoThumbnail(transcription.videoPath);
        } catch (e) {
          log.warn({ error: e }, 'Failed to extract thumbnail');
        }

        // Удаляем временный видео файл
        try {
          await fs.unlink(transcription.videoPath);
        } catch {}

        // Сохраняем thumbnail в Supabase Storage если получилось извлечь
        if (thumbnailBuffer) {
          try {
            const thumbnailFileName = `video-thumbnails/${userId}/imported_${creative.ad_id}_${Date.now()}.jpg`;

            const { error: uploadError } = await supabase.storage
              .from('creo')
              .upload(thumbnailFileName, thumbnailBuffer, {
                contentType: 'image/jpeg',
                upsert: false,
                cacheControl: '3600'
              });

            if (!uploadError) {
              const { data: publicUrlData } = supabase.storage
                .from('creo')
                .getPublicUrl(thumbnailFileName);

              if (publicUrlData?.publicUrl) {
                thumbnailUrl = publicUrlData.publicUrl;
              }
            }
          } catch (e) {
            log.warn({ error: e }, 'Failed to upload thumbnail');
          }
        }

        // Создаём запись в user_creatives
        const cplCents = Math.round(creative.cpl * 100);

        const { data: newCreative, error: insertError } = await supabase
          .from('user_creatives')
          .insert({
            user_id: userId,
            account_id: targetAccountId,
            title: `Топ креатив: ${creative.ad_name.substring(0, 50)}`,
            status: 'ready',
            source: 'imported_analysis',
            fb_ad_id: creative.ad_id,
            fb_video_id: creative.video_id,
            imported_cpl_cents: cplCents,
            imported_leads: creative.leads,
            thumbnail_url: thumbnailUrl,
            media_type: 'video',
          })
          .select()
          .single();

        if (insertError || !newCreative) {
          log.error({ error: insertError }, 'Failed to create creative record');
          continue;
        }

        // Сохраняем транскрипцию
        await supabase
          .from('creative_transcripts')
          .insert({
            creative_id: newCreative.id,
            lang: 'ru',
            source: 'whisper',
            text: transcription.text,
            duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
            status: 'ready'
          });

        importedCount++;
        log.info({
          adId: creative.ad_id,
          creativeId: newCreative.id,
          cpl: creative.cpl,
          leads: creative.leads
        }, 'Creative imported successfully');

      } catch (creativeError: any) {
        log.error({ adId: creative.ad_id, error: creativeError.message }, 'Failed to import creative');
      }
    }

    log.info({ userId, imported: importedCount }, 'Top creatives analysis completed');
    return { success: true, imported: importedCount };

  } catch (error: any) {
    log.error({ userId, error: error.message }, 'analyzeTopCreatives failed');
    return { success: false, imported: 0, error: error.message };
  }
}

/**
 * Fastify plugin с routes
 */
export const creativeAnalysisRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /analyze-top-creatives
   *
   * Анализирует рекламный кабинет и импортирует топ-5 креативов по CPL
   */
  app.post('/analyze-top-creatives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = AnalyzeSchema.parse(request.body);

      app.log.info({
        userId: body.user_id,
        accountId: body.account_id,
        force: body.force
      }, 'Starting top creatives analysis');

      const result = await analyzeTopCreatives(body.user_id, body.account_id, body.force);

      if (!result.success) {
        return reply.code(400).send({
          success: false,
          error: result.error
        });
      }

      return reply.send({
        success: true,
        imported: result.imported,
        message: result.imported > 0
          ? `Импортировано ${result.imported} креативов`
          : 'Нет подходящих креативов для импорта'
      });

    } catch (error: any) {
      app.log.error({ error: error.message, stack: error.stack }, 'analyze-top-creatives error');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'analyze_top_creatives',
        endpoint: '/analyze-top-creatives',
        severity: 'warning'
      }).catch(() => {});

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors
        });
      }

      return reply.code(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  /**
   * GET /analyze-top-creatives/status
   *
   * Проверяет, есть ли уже импортированные креативы
   */
  app.get('/analyze-top-creatives/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { user_id, account_id } = request.query as { user_id?: string; account_id?: string };

    if (!user_id) {
      return reply.code(400).send({ success: false, error: 'user_id is required' });
    }

    let query = supabase
      .from('user_creatives')
      .select('id, title, imported_cpl_cents, imported_leads, created_at')
      .eq('user_id', user_id)
      .eq('source', 'imported_analysis');

    if (account_id) {
      query = query.eq('account_id', account_id);
    }

    const { data, error } = await query.order('imported_cpl_cents', { ascending: true });

    if (error) {
      return reply.code(500).send({ success: false, error: error.message });
    }

    return reply.send({
      success: true,
      hasImported: data && data.length > 0,
      count: data?.length || 0,
      creatives: data || []
    });
  });
};

export default creativeAnalysisRoutes;
