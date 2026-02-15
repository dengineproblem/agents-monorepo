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
import {
  createWhatsAppCreative,
  createInstagramCreative,
  createWebsiteLeadsCreative,
  createLeadFormVideoCreative,
  createAppInstallsVideoCreative
} from '../adapters/facebook.js';
import { getAppInstallsConfig, getAppInstallsConfigEnvHints } from '../lib/appInstallsConfig.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v20.0';
const MIN_LEADS = 5;
const MAX_IMPORT_LIMIT = 500; // Практически без лимита
const LOOKBACK_DAYS = 180;
function getTimeRange(): { since: string; until: string } {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}
const FB_API_TIMEOUT = 60000; // 60 секунд таймаут для FB API
const VIDEO_DOWNLOAD_TIMEOUT = 300000; // 5 минут для скачивания видео
const YTDLP_RETRY_ATTEMPTS = 3; // Количество попыток скачивания через yt-dlp
const YTDLP_RETRY_DELAY = 2000; // Задержка между попытками (мс)
const EXEC_MAX_BUFFER = 10 * 1024 * 1024; // 10MB буфер для exec

// Интерфейс для креатива из Facebook
export interface TopCreativePreview {
  ad_id: string;
  ad_name: string;
  creative_id: string;
  video_id: string | null;
  thumbnail_url: string | null;
  spend: number;
  leads: number;
  cpl: number;
  cpl_cents: number;
  is_video: boolean;
  preview_url: string; // Ссылка на просмотр в Facebook Ads Manager
}

interface FBAction {
  action_type: string;
  value: string;
}

interface FBInsightsData {
  spend: string;
  actions?: FBAction[];
}

interface Logger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  debug?: (obj: object, msg?: string) => void;
  child?: (bindings: object) => Logger;
}

const PreviewSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
});

const DirectionMappingSchema = z.object({
  ad_id: z.string(),
  direction_id: z.string().uuid().nullable(),
});

const ImportSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  ad_ids: z.array(z.string()).min(1).max(MAX_IMPORT_LIMIT), // Выбранные ad_id для импорта (до 50)
  direction_mappings: z.array(DirectionMappingSchema).optional(), // Маппинг ad_id -> direction_id
});

/**
 * Fetch с таймаутом
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Маскирует access_token для логов
 */
function maskToken(token: string): string {
  if (!token || token.length < 10) return '***';
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}

/**
 * Получает credentials для доступа к Facebook API
 */
async function getCredentials(userId: string, accountId: string | undefined, log: Logger): Promise<{
  accessToken: string;
  adAccountId: string;
  targetAccountId: string | null;
} | null> {
  log.info({ userId, accountId: accountId || 'default' }, 'Fetching credentials');

  const { data: userAccount, error: userError } = await supabase
    .from('user_accounts')
    .select('id, access_token, ad_account_id, multi_account_enabled')
    .eq('id', userId)
    .single();

  if (userError) {
    log.error({ userId, error: userError.message, code: userError.code }, 'Failed to fetch user_accounts');
    return null;
  }

  if (!userAccount) {
    log.warn({ userId }, 'User account not found');
    return null;
  }

  if (userAccount.multi_account_enabled && accountId) {
    // Multi-account режим
    log.debug?.({ userId, accountId }, 'Using multi-account mode');

    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('id, access_token, ad_account_id')
      .eq('id', accountId)
      .eq('user_account_id', userId)
      .single();

    if (adError) {
      log.error({ userId, accountId, error: adError.message }, 'Failed to fetch ad_accounts');
      return null;
    }

    if (!adAccount?.access_token || !adAccount?.ad_account_id) {
      log.warn({ userId, accountId, hasToken: !!adAccount?.access_token, hasAdAccount: !!adAccount?.ad_account_id },
        'Ad account missing credentials');
      return null;
    }

    log.info({ userId, accountId, adAccountId: adAccount.ad_account_id, tokenMask: maskToken(adAccount.access_token) },
      'Credentials loaded (multi-account)');

    return {
      accessToken: adAccount.access_token,
      adAccountId: adAccount.ad_account_id,
      targetAccountId: adAccount.id,
    };
  } else {
    // Legacy режим
    if (!userAccount.access_token || !userAccount.ad_account_id) {
      log.warn({ userId, hasToken: !!userAccount.access_token, hasAdAccount: !!userAccount.ad_account_id },
        'User account missing credentials');
      return null;
    }

    log.info({ userId, adAccountId: userAccount.ad_account_id, tokenMask: maskToken(userAccount.access_token) },
      'Credentials loaded (legacy mode)');

    return {
      accessToken: userAccount.access_token,
      adAccountId: userAccount.ad_account_id,
      targetAccountId: null,
    };
  }
}

/**
 * Получает полные credentials включая pageId, instagramId и т.д.
 * Используется для создания Facebook Creatives при импорте
 */
async function getFullCredentials(
  userId: string,
  accountId: string | null,
  log: Logger
): Promise<{
  accessToken: string;
  adAccountId: string;
  pageId: string;
  instagramId: string | null;
  instagramUsername: string | null;
  whatsappPhoneNumber: string | null;
} | null> {
  const { data: userAccount, error: userError } = await supabase
    .from('user_accounts')
    .select('id, access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number, multi_account_enabled')
    .eq('id', userId)
    .single();

  if (userError || !userAccount) {
    log.error({ userId, error: userError?.message }, 'Failed to fetch user account');
    return null;
  }

  // Multi-account режим
  if (userAccount.multi_account_enabled && accountId) {
    const { data: adAccount, error: adError } = await supabase
      .from('ad_accounts')
      .select('access_token, ad_account_id, page_id, instagram_id, instagram_username, whatsapp_phone_number')
      .eq('id', accountId)
      .eq('user_account_id', userId)
      .single();

    if (adError || !adAccount) {
      log.error({ userId, accountId, error: adError?.message }, 'Failed to fetch ad account');
      return null;
    }

    if (!adAccount.access_token || !adAccount.ad_account_id || !adAccount.page_id) {
      log.warn({ userId, accountId }, 'Ad account has incomplete credentials');
      return null;
    }

    return {
      accessToken: adAccount.access_token,
      adAccountId: adAccount.ad_account_id,
      pageId: adAccount.page_id,
      instagramId: adAccount.instagram_id || null,
      instagramUsername: adAccount.instagram_username || null,
      whatsappPhoneNumber: adAccount.whatsapp_phone_number || null
    };
  }

  // Legacy режим (один аккаунт)
  if (!userAccount.access_token || !userAccount.ad_account_id || !userAccount.page_id) {
    log.warn({ userId }, 'User account has incomplete credentials');
    return null;
  }

  return {
    accessToken: userAccount.access_token,
    adAccountId: userAccount.ad_account_id,
    pageId: userAccount.page_id,
    instagramId: userAccount.instagram_id || null,
    instagramUsername: userAccount.instagram_username || null,
    whatsappPhoneNumber: userAccount.whatsapp_phone_number || null
  };
}

/**
 * Получает топ креативы по CPL из Facebook Ads (только данные, без импорта)
 */
async function fetchTopCreatives(
  accessToken: string,
  adAccountId: string,
  log: Logger
): Promise<TopCreativePreview[]> {
  const normalizedAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const startTime = Date.now();

  // Шаг 1: Получить все ads за период с creative info (с пагинацией)
  const timeRange = getTimeRange();
  log.info({ adAccountId: normalizedAccountId, timeRange }, 'Step 1: Fetching ads with creatives');

  const ads: any[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${FB_API_VERSION}/${normalizedAccountId}/ads?` +
    `fields=id,name,creative{id,video_id,thumbnail_url,effective_object_story_id,object_story_id,asset_feed_spec}` +
    `&time_range=${encodeURIComponent(JSON.stringify(timeRange))}` +
    `&limit=200` +
    `&access_token=${accessToken}`;

  while (nextUrl) {
    let adsResponse: Response;
    try {
      adsResponse = await fetchWithTimeout(nextUrl, {}, FB_API_TIMEOUT);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        log.error({ adAccountId: normalizedAccountId, timeout: FB_API_TIMEOUT }, 'FB API timeout on ads fetch');
        throw new Error('Facebook API timeout while fetching ads');
      }
      throw error;
    }

    const adsData = await adsResponse.json() as { data?: any[]; paging?: { next?: string }; error?: any };

    if (!adsResponse.ok || adsData.error) {
      log.error({
        adAccountId: normalizedAccountId,
        status: adsResponse.status,
        errorCode: adsData.error?.code,
        errorType: adsData.error?.type,
        errorMessage: adsData.error?.message
      }, 'Facebook API error on ads fetch');
      throw new Error(`Facebook API error: ${adsData.error?.message || `HTTP ${adsResponse.status}`}`);
    }

    const page = adsData.data || [];
    ads.push(...page);
    nextUrl = adsData.paging?.next || null;
    log.debug?.({ fetched: page.length, total: ads.length, hasNext: !!nextUrl }, 'Ads page fetched');
  }

  log.info({ count: ads.length, durationMs: Date.now() - startTime }, 'Step 1 completed: Ads fetched');

  // Диагностика: показываем структуру первых 5 ads
  if (ads.length > 0) {
    const sampleAds = ads.slice(0, 5).map((ad: any) => ({
      id: ad.id,
      name: ad.name,
      creative_id: ad.creative?.id,
      video_id: ad.creative?.video_id,
      asset_feed_video_id: ad.creative?.asset_feed_spec?.videos?.[0]?.video_id || null,
      has_asset_feed_spec: !!ad.creative?.asset_feed_spec,
      effective_object_story_id: ad.creative?.effective_object_story_id,
      object_story_id: ad.creative?.object_story_id,
      thumbnail_url: ad.creative?.thumbnail_url ? 'exists' : null,
      creative_keys: ad.creative ? Object.keys(ad.creative) : []
    }));
    log.info({ sampleAds }, 'Sample ad structures from Facebook');
  }

  if (ads.length === 0) {
    log.info({ adAccountId: normalizedAccountId }, 'No ads found in the account');
    return [];
  }

  // Шаг 2: Batch запрос для insights каждого ad
  log.info({ adsCount: ads.length }, 'Step 2: Fetching insights via batch API');

  const adIds = ads.map((ad: any) => ad.id);
  const insights: Map<string, FBInsightsData> = new Map();
  let batchErrors = 0;

  // Разбиваем на batch по 50 (лимит FB)
  const BATCH_SIZE = 50;
  for (let i = 0; i < adIds.length; i += BATCH_SIZE) {
    const batch = adIds.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(adIds.length / BATCH_SIZE);

    log.debug?.({ batchIndex, totalBatches, batchSize: batch.length }, 'Processing batch');

    const batchRequests = batch.map((adId: string) => ({
      method: 'GET',
      relative_url: `${adId}/insights?fields=spend,actions&time_range=${encodeURIComponent(JSON.stringify(timeRange))}&action_breakdowns=action_type`
    }));

    const batchUrl = `https://graph.facebook.com/${FB_API_VERSION}/?` +
      `batch=${encodeURIComponent(JSON.stringify(batchRequests))}` +
      `&access_token=${accessToken}`;

    try {
      const batchResponse = await fetchWithTimeout(batchUrl, { method: 'POST' }, FB_API_TIMEOUT);

      if (!batchResponse.ok) {
        log.error({ batchIndex, status: batchResponse.status }, 'Batch request failed');
        batchErrors++;
        continue;
      }

      const batchData = await batchResponse.json() as any[];

      batchData.forEach((result: any, idx: number) => {
        if (result.code === 200) {
          try {
            const body = JSON.parse(result.body);
            const insightData = body.data?.[0];
            if (insightData) {
              insights.set(batch[idx], insightData);
            }
          } catch (e: any) {
            log.warn({ adId: batch[idx], parseError: e.message }, 'Failed to parse insight response');
          }
        } else {
          log.debug?.({ adId: batch[idx], code: result.code }, 'Non-200 response for ad insight');
        }
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        log.error({ batchIndex, timeout: FB_API_TIMEOUT }, 'Batch request timeout');
      } else {
        log.error({ batchIndex, error: error.message }, 'Batch request exception');
      }
      batchErrors++;
    }
  }

  log.info({
    insightsCount: insights.size,
    totalAds: ads.length,
    batchErrors,
    durationMs: Date.now() - startTime
  }, 'Step 2 completed: Insights fetched');

  // Шаг 3: Группируем по video_id (для видео) или creative_id (для изображений)
  // ВАЖНО: Одно видео может использоваться в разных креативах - группируем по video_id
  log.info({ minLeads: MIN_LEADS }, 'Step 3: Grouping by video_id/creative_id and calculating CPL');

  // Группировка данных по video_id (для видео) или creative_id (для изображений)
  interface CreativeGroup {
    group_key: string; // video_id или creative_id
    creative_id: string;
    video_id: string | null;
    thumbnail_url: string | null;
    is_video: boolean;
    ad_ids: string[];
    ad_names: string[];
    total_spend: number;
    total_leads: number;
  }

  const creativeGroups = new Map<string, CreativeGroup>();
  let skippedNoInsights = 0;
  let skippedNoCreative = 0;

  // Диагностика: собираем video_id для анализа
  const videoIdCounts = new Map<string, number>();
  let adsWithVideoId = 0;
  let adsWithoutVideoId = 0;

  for (const ad of ads) {
    const creativeId = ad.creative?.id;
    if (!creativeId) {
      skippedNoCreative++;
      continue;
    }

    const insight = insights.get(ad.id);
    if (!insight) {
      skippedNoInsights++;
      continue;
    }

    const spend = parseFloat(insight.spend || '0');
    const actions = insight.actions || [];

    // Считаем лиды из источников как на dashboard
    // ВАЖНО: messaging_user_depth_2 это подмножество total_messaging_connection, не суммировать!
    let leads = 0;
    for (const action of actions) {
      if (
        action.action_type === 'lead' ||
        action.action_type === 'onsite_conversion.lead_grouped' ||
        action.action_type === 'onsite_conversion.total_messaging_connection'
      ) {
        leads += parseInt(action.value, 10) || 0;
      }
    }

    // Ключ группировки:
    // 1. video_id для видео (дубликаты сохраняют video_id)
    // 2. creative_id для изображений
    // Fallback: для Advantage+ Creative (dynamic creative) video_id может быть в asset_feed_spec.videos
    let videoId = ad.creative?.video_id;
    if (!videoId && ad.creative?.asset_feed_spec?.videos?.length > 0) {
      videoId = ad.creative.asset_feed_spec.videos[0].video_id;
      log.debug?.({ adId: ad.id, videoId, source: 'asset_feed_spec' }, 'Found video_id via asset_feed_spec');
    }

    let groupKey: string;
    if (videoId) {
      groupKey = `video:${videoId}`;
    } else {
      groupKey = `creative:${creativeId}`;
    }

    // Диагностика
    if (videoId) {
      adsWithVideoId++;
      videoIdCounts.set(videoId, (videoIdCounts.get(videoId) || 0) + 1);
    } else {
      adsWithoutVideoId++;
    }

    // Добавляем или обновляем группу
    const existing = creativeGroups.get(groupKey);
    if (existing) {
      existing.ad_ids.push(ad.id);
      existing.ad_names.push(ad.name);
      existing.total_spend += spend;
      existing.total_leads += leads;
      // Обновляем thumbnail если текущий лучше
      if (!existing.thumbnail_url && ad.creative?.thumbnail_url) {
        existing.thumbnail_url = ad.creative.thumbnail_url;
      }
    } else {
      creativeGroups.set(groupKey, {
        group_key: groupKey,
        creative_id: creativeId,
        video_id: videoId || null,
        thumbnail_url: ad.creative?.thumbnail_url || null,
        is_video: !!videoId,
        ad_ids: [ad.id],
        ad_names: [ad.name],
        total_spend: spend,
        total_leads: leads,
      });
    }
  }

  // Детальная диагностика группировки
  const duplicatedVideoIds = Array.from(videoIdCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([videoId, count]) => ({ videoId, count }));

  log.info({
    totalAds: ads.length,
    adsWithVideoId,
    adsWithoutVideoId,
    uniqueVideoIds: videoIdCounts.size,
    duplicatedVideoIds: duplicatedVideoIds.slice(0, 10),
    totalDuplicatedVideos: duplicatedVideoIds.length,
    uniqueCreatives: creativeGroups.size,
    skippedNoInsights,
    skippedNoCreative
  }, 'Grouped by video_id');

  // Фильтруем по MIN_LEADS и формируем результат
  const results: TopCreativePreview[] = [];
  let skippedLowLeads = 0;
  const accountIdNumeric = normalizedAccountId.replace('act_', '');

  for (const group of creativeGroups.values()) {
    if (group.total_leads < MIN_LEADS) {
      skippedLowLeads++;
      continue;
    }

    const cpl = group.total_leads > 0 ? group.total_spend / group.total_leads : Infinity;

    // Ссылка на первый ad для просмотра креатива
    const previewUrl = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountIdNumeric}&selected_ad_ids=${group.ad_ids[0]}`;

    // Название: берём самое короткое из ad_names (обычно оно самое информативное)
    const creativeName = group.ad_names.reduce((shortest, name) =>
      name.length < shortest.length ? name : shortest
    );

    results.push({
      ad_id: group.ad_ids[0], // Основной ad_id для импорта
      ad_name: creativeName + (group.ad_ids.length > 1 ? ` (+${group.ad_ids.length - 1} ads)` : ''),
      creative_id: group.creative_id,
      video_id: group.video_id,
      thumbnail_url: group.thumbnail_url,
      spend: group.total_spend,
      leads: group.total_leads,
      cpl,
      cpl_cents: Math.round(cpl * 100),
      is_video: group.is_video,
      preview_url: previewUrl,
    });
  }

  // Сортируем по CPL (лучшие сверху)
  results.sort((a, b) => a.cpl - b.cpl);

  log.info({
    totalAds: ads.length,
    uniqueCreatives: creativeGroups.size,
    skippedNoInsights,
    skippedNoCreative,
    skippedLowLeads,
    qualifyingCreatives: results.length,
    bestCpl: results[0]?.cpl?.toFixed(2),
    worstCpl: results[results.length - 1]?.cpl?.toFixed(2),
    totalDurationMs: Date.now() - startTime
  }, 'Step 3 completed: All qualifying creatives returned');

  return results;
}

/**
 * Задержка между retry
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Проверяет наличие yt-dlp в системе
 */
async function checkYtDlpAvailable(log: Logger): Promise<boolean> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync('which yt-dlp', { timeout: 5000 });
    const ytdlpPath = stdout.trim();
    if (ytdlpPath) {
      log.info({ ytdlpPath }, 'yt-dlp found');
      return true;
    }
    return false;
  } catch (error: any) {
    log.warn({ error: error.message }, 'yt-dlp not found in PATH');
    return false;
  }
}

/**
 * Скачивает видео через yt-dlp с retry логикой
 */
async function downloadVideoWithYtDlp(
  videoId: string,
  videoPath: string,
  log: Logger
): Promise<boolean> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Проверяем наличие yt-dlp
  const ytdlpAvailable = await checkYtDlpAvailable(log);
  if (!ytdlpAvailable) {
    log.error({ videoId }, 'yt-dlp binary not found, cannot download video');
    return false;
  }

  const videoUrl = `https://www.facebook.com/watch/?v=${videoId}`;

  log.info({
    videoId,
    videoUrl,
    videoPath,
    maxRetries: YTDLP_RETRY_ATTEMPTS
  }, 'Starting yt-dlp download');

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= YTDLP_RETRY_ATTEMPTS; attempt++) {
    log.info({
      videoId,
      attempt,
      maxAttempts: YTDLP_RETRY_ATTEMPTS
    }, 'yt-dlp download attempt');

    try {
      // Удаляем файл если остался от прошлой попытки
      try {
        await fs.unlink(videoPath);
      } catch {
        // Файла нет - это ок
      }

      // yt-dlp скачивает видео в указанный путь
      // Убрали --quiet чтобы видеть stderr при ошибках
      const cmd = `yt-dlp -f "best[ext=mp4]/best" --no-warnings -o "${videoPath}" "${videoUrl}"`;

      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: VIDEO_DOWNLOAD_TIMEOUT,
        maxBuffer: EXEC_MAX_BUFFER
      });

      const downloadDurationMs = Date.now() - startTime;

      // Логируем stdout/stderr если есть
      if (stdout?.trim()) {
        log.debug?.({ videoId, stdout: stdout.trim().substring(0, 500) }, 'yt-dlp stdout');
      }
      if (stderr?.trim()) {
        log.warn({ videoId, stderr: stderr.trim().substring(0, 500) }, 'yt-dlp stderr');
      }

      // Проверяем что файл скачался
      let stats;
      try {
        stats = await fs.stat(videoPath);
      } catch (statError: any) {
        log.error({
          videoId,
          attempt,
          error: 'File not found after download',
          statError: statError.message
        }, 'yt-dlp download produced no file');
        lastError = 'Downloaded file not found';
        continue;
      }

      if (stats.size === 0) {
        log.error({ videoId, attempt }, 'yt-dlp downloaded empty file');
        lastError = 'Downloaded empty video file';
        continue;
      }

      log.info({
        videoId,
        attempt,
        fileSizeBytes: stats.size,
        fileSizeMB: (stats.size / 1024 / 1024).toFixed(2),
        downloadDurationMs
      }, 'Video downloaded successfully via yt-dlp');

      return true;

    } catch (error: any) {
      lastError = error.message;

      // Детальное логирование ошибки
      log.error({
        videoId,
        attempt,
        maxAttempts: YTDLP_RETRY_ATTEMPTS,
        errorMessage: error.message,
        errorCode: error.code,
        signal: error.signal,
        killed: error.killed,
        stderr: error.stderr?.substring?.(0, 1000),
        stdout: error.stdout?.substring?.(0, 500)
      }, 'yt-dlp attempt failed');

      // Если это timeout - не имеет смысла retry
      if (error.killed || error.signal === 'SIGTERM') {
        log.error({ videoId }, 'yt-dlp process was killed (timeout), skipping retries');
        break;
      }

      // Ждём перед retry
      if (attempt < YTDLP_RETRY_ATTEMPTS) {
        log.info({
          videoId,
          delayMs: YTDLP_RETRY_DELAY,
          nextAttempt: attempt + 1
        }, 'Waiting before retry');
        await delay(YTDLP_RETRY_DELAY);
      }
    }
  }

  log.error({
    videoId,
    attempts: YTDLP_RETRY_ATTEMPTS,
    lastError
  }, 'All yt-dlp download attempts failed');

  return false;
}

/**
 * Скачивает видео и транскрибирует его
 */
async function downloadAndTranscribe(
  videoId: string,
  accessToken: string,
  log: Logger,
  creativeId?: string
): Promise<{ text: string; duration?: number; videoPath: string } | null> {
  const startTime = Date.now();
  const videoPath = path.join('/var/tmp', `import_${randomUUID()}.mp4`);

  log.info({
    videoId,
    videoPath,
    stage: 'download_start'
  }, 'Starting video download and transcription process');

  log.info({ videoId, stage: 'fb_api_check' }, 'Checking if FB API provides source URL');

  // Попробуем получить source URL через API
  const videoInfoUrl = `https://graph.facebook.com/${FB_API_VERSION}/${videoId}?fields=source&access_token=${accessToken}`;

  let videoSource: string | null = null;

  try {
    const videoInfoResponse = await fetchWithTimeout(videoInfoUrl, {}, FB_API_TIMEOUT);
    const videoInfo = await videoInfoResponse.json() as { source?: string; error?: any; id?: string };

    log.info({
      videoId,
      status: videoInfoResponse.status,
      hasSource: !!videoInfo.source,
      responseKeys: Object.keys(videoInfo)
    }, 'Facebook video info response');

    if (videoInfoResponse.ok && videoInfo.source) {
      videoSource = videoInfo.source;
    }
  } catch (error: any) {
    log.warn({ videoId, error: error.message }, 'Failed to fetch video info from API');
  }

  // Fallback: через creative object_story_spec — альтернативный video_id
  if (!videoSource && creativeId) {
    try {
      log.info({ videoId, creativeId, stage: 'creative_video_fallback' }, 'Trying to get video source via creative object_story_spec');
      const creativeUrl = `https://graph.facebook.com/${FB_API_VERSION}/${creativeId}?fields=object_story_spec&access_token=${accessToken}`;
      const creativeResponse = await fetchWithTimeout(creativeUrl, {}, FB_API_TIMEOUT);
      const creativeData = await creativeResponse.json() as any;
      const storyVideoId = creativeData?.object_story_spec?.video_data?.video_id;

      if (storyVideoId && storyVideoId !== videoId) {
        log.info({ videoId, storyVideoId }, 'Found alternative video_id from creative, fetching source');
        const altVideoUrl = `https://graph.facebook.com/${FB_API_VERSION}/${storyVideoId}?fields=source&access_token=${accessToken}`;
        const altResponse = await fetchWithTimeout(altVideoUrl, {}, FB_API_TIMEOUT);
        const altData = await altResponse.json() as any;
        if (altResponse.ok && altData.source) {
          videoSource = altData.source;
          log.info({ videoId, storyVideoId, hasSource: true }, 'Got video source via creative fallback');
        }
      }
    } catch (error: any) {
      log.warn({ videoId, creativeId, error: error.message }, 'Creative video fallback failed');
    }
  }

  let downloadSuccess = false;

  // Способ 1: прямое скачивание по source URL
  if (videoSource) {
    log.info({ videoId, videoPath }, 'Starting video download via source URL');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_TIMEOUT);

      const response = await fetch(videoSource, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VideoDownloader/1.0)'
        }
      });

      clearTimeout(timeout);

      if (response.ok && response.body) {
        const nodeStream = Readable.fromWeb(response.body as any);
        await pipeline(nodeStream, createWriteStream(videoPath));

        const stats = await fs.stat(videoPath);
        if (stats.size > 0) {
          downloadSuccess = true;
          log.info({
            videoId,
            fileSizeBytes: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(2),
            method: 'source_url'
          }, 'Video downloaded via source URL');
        }
      }
    } catch (error: any) {
      log.warn({ videoId, error: error.message }, 'Source URL download failed, trying yt-dlp');
    }
  }

  // Способ 2: yt-dlp fallback
  if (!downloadSuccess) {
    log.info({ videoId }, 'Trying yt-dlp fallback');
    downloadSuccess = await downloadVideoWithYtDlp(videoId, videoPath, log);
  }

  if (!downloadSuccess) {
    log.error({
      videoId,
      videoPath,
      triedSourceUrl: !!videoSource,
      triedYtDlp: true,
      durationMs: Date.now() - startTime,
      stage: 'download_failed'
    }, 'All download methods failed - cannot proceed with transcription');
    return null;
  }

  // Проверяем размер скачанного файла
  let fileStats;
  try {
    fileStats = await fs.stat(videoPath);
  } catch (statErr: any) {
    log.error({
      videoId,
      videoPath,
      error: statErr.message,
      stage: 'file_check_failed'
    }, 'Cannot stat downloaded video file');
    return null;
  }

  const downloadDurationMs = Date.now() - startTime;
  log.info({
    videoId,
    videoPath,
    fileSizeBytes: fileStats.size,
    fileSizeMB: (fileStats.size / 1024 / 1024).toFixed(2),
    downloadDurationMs,
    stage: 'download_complete'
  }, 'Video downloaded successfully, starting transcription');

  try {
    // Транскрибируем
    const transcriptionStart = Date.now();
    const transcription = await processVideoTranscription(videoPath, 'ru');

    log.info({
      videoId,
      textLength: transcription.text.length,
      durationSec: transcription.duration,
      transcriptionDurationMs: Date.now() - transcriptionStart,
      totalDurationMs: Date.now() - startTime
    }, 'Transcription completed');

    return {
      text: transcription.text,
      duration: transcription.duration,
      videoPath,
    };
  } catch (error: any) {
    log.error({
      videoId,
      error: error.message,
      durationMs: Date.now() - startTime
    }, 'Transcription failed');

    // Очищаем файл при ошибке
    try {
      await fs.unlink(videoPath);
      log.debug?.({ videoPath }, 'Cleaned up temporary video file');
    } catch (cleanupError: any) {
      log.warn({ videoPath, error: cleanupError.message }, 'Failed to cleanup temporary file');
    }

    return null;
  }
}

/**
 * Импортирует один креатив в базу
 */
async function importSingleCreative(
  creative: TopCreativePreview,
  userId: string,
  targetAccountId: string | null,
  accessToken: string,
  log: Logger,
  directionId?: string | null
): Promise<{ success: boolean; creative_id?: string; error?: string }> {
  const startTime = Date.now();

  log.info({
    adId: creative.ad_id,
    adName: creative.ad_name,
    videoId: creative.video_id,
    cpl: creative.cpl.toFixed(2),
    leads: creative.leads
  }, 'Starting import of single creative');

  try {
    // Пропускаем не-видео креативы
    if (!creative.video_id) {
      log.info({ adId: creative.ad_id }, 'Skipping: not a video creative');
      return { success: false, error: 'Not a video creative' };
    }

    // Проверяем, не импортировали ли уже этот ad
    const { data: existingAd, error: checkError } = await supabase
      .from('user_creatives')
      .select('id')
      .eq('user_id', userId)
      .eq('fb_ad_id', creative.ad_id)
      .maybeSingle();

    if (checkError) {
      log.error({ adId: creative.ad_id, error: checkError.message }, 'Database error checking existing import');
    }

    if (existingAd) {
      log.info({ adId: creative.ad_id, existingId: existingAd.id }, 'Skipping: already imported');
      return { success: false, error: 'Already imported' };
    }

    // Скачиваем и транскрибируем
    const transcription = await downloadAndTranscribe(creative.video_id, accessToken, log, creative.creative_id);

    if (!transcription) {
      log.warn({ adId: creative.ad_id, videoId: creative.video_id }, 'Failed to transcribe video');
      return { success: false, error: 'Failed to transcribe video' };
    }

    // Извлекаем thumbnail
    let thumbnailUrl: string | null = creative.thumbnail_url;
    let thumbnailBuffer: Buffer | null = null;

    log.debug?.({ adId: creative.ad_id }, 'Extracting thumbnail from video');
    try {
      thumbnailBuffer = await extractVideoThumbnail(transcription.videoPath);
      log.debug?.({ adId: creative.ad_id, thumbnailSize: thumbnailBuffer?.length }, 'Thumbnail extracted');
    } catch (e: any) {
      log.warn({ adId: creative.ad_id, error: e.message }, 'Failed to extract thumbnail, using FB thumbnail');
    }

    // Удаляем временный видео файл
    try {
      await fs.unlink(transcription.videoPath);
      log.debug?.({ videoPath: transcription.videoPath }, 'Temporary video file deleted');
    } catch (cleanupError: any) {
      log.warn({ videoPath: transcription.videoPath, error: cleanupError.message }, 'Failed to delete temporary video');
    }

    // Сохраняем thumbnail в Supabase Storage если получилось извлечь
    if (thumbnailBuffer) {
      log.debug?.({ adId: creative.ad_id }, 'Uploading thumbnail to storage');
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
            log.debug?.({ adId: creative.ad_id, thumbnailUrl }, 'Thumbnail uploaded successfully');
          }
        } else {
          log.warn({ adId: creative.ad_id, error: uploadError.message }, 'Thumbnail upload failed');
        }
      } catch (e: any) {
        log.warn({ adId: creative.ad_id, error: e.message }, 'Thumbnail upload exception');
      }
    }

    // Создаём запись в user_creatives
    log.debug?.({ adId: creative.ad_id, directionId }, 'Inserting creative record to database');

    const { data: newCreative, error: insertError } = await supabase
      .from('user_creatives')
      .insert({
        user_id: userId,
        account_id: targetAccountId,
        direction_id: directionId || null,
        title: `Топ креатив: ${creative.ad_name.substring(0, 50)}`,
        status: 'ready',
        source: 'imported_analysis',
        fb_ad_id: creative.ad_id,
        fb_video_id: creative.video_id,
        imported_cpl_cents: creative.cpl_cents,
        imported_leads: creative.leads,
        thumbnail_url: thumbnailUrl,
        media_type: 'video',
      })
      .select()
      .single();

    if (insertError || !newCreative) {
      log.error({ adId: creative.ad_id, error: insertError?.message }, 'Failed to create creative record');
      return { success: false, error: 'Database error' };
    }

    // НОВЫЙ КОД: Создаём Facebook Creative если есть direction
    log.info({
      adId: creative.ad_id,
      directionId: directionId || 'NOT_SET',
      videoId: creative.video_id
    }, '[IMPORT_DEBUG] Checking if need to create Facebook Creative');

    if (directionId) {
      try {
        log.info({
          adId: creative.ad_id,
          directionId,
          videoId: creative.video_id
        }, '[IMPORT_DEBUG] ✅ DIRECTION IS SET - Creating Facebook Creative');

        // Получаем полные credentials (pageId, instagramId и т.д.)
        const fullCredentials = await getFullCredentials(userId, targetAccountId, log);

        log.info({
          hasCredentials: !!fullCredentials,
          pageId: fullCredentials?.pageId,
          instagramId: fullCredentials?.instagramId
        }, '[IMPORT_DEBUG] Credentials fetched');

        if (fullCredentials) {
          // Загружаем настройки направления
          const { data: direction } = await supabase
            .from('account_directions')
            .select('objective, use_instagram, conversion_channel')
            .eq('id', directionId)
            .maybeSingle();

          if (direction?.objective) {
            const objective = direction.objective as 'whatsapp' | 'conversions' | 'instagram_traffic' | 'site_leads' | 'lead_forms' | 'app_installs';
            const useInstagram = direction.use_instagram !== false;

            // Загружаем default_ad_settings
            const { data: defaultSettings } = await supabase
              .from('default_ad_settings')
              .select('*')
              .eq('direction_id', directionId)
              .maybeSingle();

            const description = defaultSettings?.description || 'Напишите нам, чтобы узнать подробности';
            const clientQuestion = defaultSettings?.client_question || 'Здравствуйте! Хочу узнать об этом подробнее.';
            const siteUrl = defaultSettings?.site_url;
            const utm = defaultSettings?.utm_tag;
            const leadFormId = defaultSettings?.lead_form_id;
            const appStoreUrl = defaultSettings?.app_store_url;

            // Создаём креатив в зависимости от objective
            let fbCreativeId = '';
            const normalizedAdAccountId = fullCredentials.adAccountId.startsWith('act_')
              ? fullCredentials.adAccountId
              : `act_${fullCredentials.adAccountId}`;

            if (objective === 'whatsapp' || (objective === 'conversions' && direction?.conversion_channel === 'whatsapp')) {
              const whatsappCreative = await createWhatsAppCreative(normalizedAdAccountId, accessToken, {
                videoId: creative.video_id!,
                pageId: fullCredentials.pageId,
                instagramId: useInstagram ? (fullCredentials.instagramId || undefined) : undefined,
                message: description,
                clientQuestion: clientQuestion,
                whatsappPhoneNumber: fullCredentials.whatsappPhoneNumber || undefined,
                imageUrl: creative.thumbnail_url || undefined // используем thumbnail_url из Facebook
              });
              fbCreativeId = whatsappCreative.id;
            } else if (objective === 'instagram_traffic' && fullCredentials.instagramId) {
              const instagramCreative = await createInstagramCreative(normalizedAdAccountId, accessToken, {
                videoId: creative.video_id!,
                pageId: fullCredentials.pageId,
                instagramId: fullCredentials.instagramId,
                instagramUsername: fullCredentials.instagramUsername || '',
                message: description,
                imageUrl: creative.thumbnail_url || undefined
              });
              fbCreativeId = instagramCreative.id;
            } else if (objective === 'site_leads' || (objective === 'conversions' && direction?.conversion_channel === 'site')) {
              if (siteUrl) {
                const websiteCreative = await createWebsiteLeadsCreative(normalizedAdAccountId, accessToken, {
                  videoId: creative.video_id!,
                  pageId: fullCredentials.pageId,
                  instagramId: fullCredentials.instagramId || undefined,
                  message: description,
                  siteUrl: siteUrl,
                  utm: utm,
                  imageUrl: creative.thumbnail_url || undefined
                });
                fbCreativeId = websiteCreative.id;
              }
            } else if (objective === 'lead_forms' || (objective === 'conversions' && direction?.conversion_channel === 'lead_form')) {
              if (leadFormId) {
                const leadFormCreative = await createLeadFormVideoCreative(normalizedAdAccountId, accessToken, {
                  videoId: creative.video_id!,
                  pageId: fullCredentials.pageId,
                  instagramId: fullCredentials.instagramId || undefined,
                  message: description,
                  leadFormId: leadFormId,
                  imageUrl: creative.thumbnail_url || undefined
                });
                fbCreativeId = leadFormCreative.id;
              }
            } else if (objective === 'app_installs') {
              const appConfig = getAppInstallsConfig();
              if (appConfig && appStoreUrl) {
                const appInstallCreative = await createAppInstallsVideoCreative(normalizedAdAccountId, accessToken, {
                  videoId: creative.video_id!,
                  pageId: fullCredentials.pageId,
                  instagramId: fullCredentials.instagramId || undefined,
                  message: description,
                  appStoreUrl: appStoreUrl,
                  imageUrl: creative.thumbnail_url || undefined
                });
                fbCreativeId = appInstallCreative.id;
              } else {
                const envHints = getAppInstallsConfigEnvHints();
                log.warn({
                  directionId,
                  objective,
                  appIdEnvKeys: envHints.appIdEnvKeys,
                  hasAppStoreUrlInSettings: Boolean(appStoreUrl)
                }, '[IMPORT_DEBUG] Skipping app_installs creative creation: missing app_id env or app_store_url in settings');
              }
            }

            // Обновляем запись креатива с fb_creative_id
            if (fbCreativeId) {
              const updateData: Record<string, string> = {
                fb_creative_id: fbCreativeId
              };

              // Сохраняем в соответствующее поле по objective
              if (objective === 'whatsapp' || (objective === 'conversions' && direction?.conversion_channel === 'whatsapp')) {
                updateData.fb_creative_id_whatsapp = fbCreativeId;
              } else if (objective === 'instagram_traffic') {
                updateData.fb_creative_id_instagram_traffic = fbCreativeId;
              } else if (objective === 'site_leads' || (objective === 'conversions' && direction?.conversion_channel === 'site')) {
                updateData.fb_creative_id_site_leads = fbCreativeId;
              } else if (objective === 'lead_forms' || (objective === 'conversions' && direction?.conversion_channel === 'lead_form')) {
                updateData.fb_creative_id_lead_forms = fbCreativeId;
              }

              await supabase
                .from('user_creatives')
                .update(updateData)
                .eq('id', newCreative.id);

              log.info({
                creativeId: newCreative.id,
                fbCreativeId,
                objective,
                conversion_channel: direction?.conversion_channel,
                field: (objective === 'whatsapp' || (objective === 'conversions' && direction?.conversion_channel === 'whatsapp')) ? 'fb_creative_id_whatsapp' :
                       objective === 'instagram_traffic' ? 'fb_creative_id_instagram_traffic' :
                       (objective === 'site_leads' || (objective === 'conversions' && direction?.conversion_channel === 'site')) ? 'fb_creative_id_site_leads' :
                       (objective === 'lead_forms' || (objective === 'conversions' && direction?.conversion_channel === 'lead_form')) ? 'fb_creative_id_lead_forms' : 'fb_creative_id'
              }, '[IMPORT_DEBUG] ✅✅✅ Facebook Creative created and SAVED to DB!');
            }
          }
        }
      } catch (creativeError: any) {
        // Не фейлим весь импорт, только логируем
        log.error({
          adId: creative.ad_id,
          error: creativeError.message,
          stack: creativeError.stack,
          name: creativeError.name
        }, '[IMPORT_DEBUG] ❌❌❌ FAILED to create Facebook Creative');
      }
    } else {
      log.warn({
        adId: creative.ad_id,
        directionIdValue: directionId
      }, '[IMPORT_DEBUG] ⚠️⚠️⚠️ SKIPPING Creative creation - direction_id is NULL/undefined');
    }

    // Сохраняем транскрипцию
    const { error: transcriptError } = await supabase
      .from('creative_transcripts')
      .insert({
        creative_id: newCreative.id,
        lang: 'ru',
        source: 'whisper',
        text: transcription.text,
        duration_sec: transcription.duration ? Math.round(transcription.duration) : null,
        status: 'ready'
      });

    if (transcriptError) {
      log.warn({ creativeId: newCreative.id, error: transcriptError.message }, 'Failed to save transcript');
    }

    log.info({
      adId: creative.ad_id,
      creativeId: newCreative.id,
      cpl: creative.cpl.toFixed(2),
      leads: creative.leads,
      transcriptLength: transcription.text.length,
      totalDurationMs: Date.now() - startTime
    }, 'Creative imported successfully');

    return { success: true, creative_id: newCreative.id };

  } catch (error: any) {
    log.error({
      adId: creative.ad_id,
      error: error.message,
      stack: error.stack,
      durationMs: Date.now() - startTime
    }, 'Unexpected error during creative import');
    return { success: false, error: error.message };
  }
}

/**
 * Legacy функция для автоматического импорта (backward compatibility)
 * Используется в approve-fb для фонового импорта
 */
export async function analyzeTopCreatives(
  userId: string,
  accountId?: string,
  force: boolean = false
): Promise<{ success: boolean; imported: number; error?: string }> {
  // Создаём простой логгер для legacy использования
  const log: Logger = {
    info: (obj, msg) => console.log(`[INFO] ${msg || ''}`, JSON.stringify(obj)),
    warn: (obj, msg) => console.warn(`[WARN] ${msg || ''}`, JSON.stringify(obj)),
    error: (obj, msg) => console.error(`[ERROR] ${msg || ''}`, JSON.stringify(obj)),
    debug: (obj, msg) => console.debug(`[DEBUG] ${msg || ''}`, JSON.stringify(obj)),
  };

  log.info({ userId, accountId, force }, 'Starting legacy analyzeTopCreatives');

  try {
    const credentials = await getCredentials(userId, accountId, log);
    if (!credentials) {
      log.error({ userId }, 'No FB credentials found');
      return { success: false, imported: 0, error: 'No FB credentials' };
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
        log.info({ userId, existingCount: existing.length }, 'Already has imported creatives, skipping');
        return { success: true, imported: 0 };
      }
    }

    // Получаем топ креативы из FB
    const topCreatives = await fetchTopCreatives(credentials.accessToken, credentials.adAccountId, log);

    if (topCreatives.length === 0) {
      log.info({ userId }, 'No qualifying creatives found');
      return { success: true, imported: 0 };
    }

    let importedCount = 0;
    const errors: string[] = [];

    // Импортируем все креативы (legacy behavior)
    for (const creative of topCreatives) {
      log.info({ adId: creative.ad_id, index: importedCount + 1, total: topCreatives.length },
        'Importing creative (legacy mode)');

      const result = await importSingleCreative(
        creative,
        userId,
        credentials.targetAccountId,
        credentials.accessToken,
        log,
        null // Legacy: нет direction_id
      );

      if (result.success) {
        importedCount++;
      } else if (result.error) {
        errors.push(`${creative.ad_name}: ${result.error}`);
      }
    }

    log.info({
      userId,
      imported: importedCount,
      total: topCreatives.length,
      errors: errors.length
    }, 'Legacy analyzeTopCreatives completed');

    return { success: true, imported: importedCount };

  } catch (error: any) {
    log.error({ userId, error: error.message, stack: error.stack }, 'analyzeTopCreatives failed');

    // Логируем в админку для отслеживания
    logErrorToAdmin({
      user_account_id: userId,
      error_type: 'api',
      raw_error: error.message || String(error),
      stack_trace: error.stack,
      action: 'analyze_top_creatives_legacy',
      severity: 'warning'
    }).catch(() => {});

    return { success: false, imported: 0, error: error.message };
  }
}

/**
 * Fastify plugin с routes
 */
export const creativeAnalysisRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /analyze-top-creatives/preview
   *
   * Получает топ-5 креативов для превью (без импорта)
   * Пользователь может выбрать какие из них импортировать
   */
  app.get('/analyze-top-creatives/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startTime = Date.now();

    try {
      const query = PreviewSchema.parse(request.query);

      request.log.info({
        requestId,
        userId: query.user_id,
        accountId: query.account_id || 'default',
        action: 'preview_start'
      }, 'Starting top creatives preview');

      const credentials = await getCredentials(query.user_id, query.account_id, request.log);
      if (!credentials) {
        request.log.warn({ requestId, userId: query.user_id }, 'No credentials found for preview');
        return reply.code(400).send({
          success: false,
          error: 'No Facebook credentials found. Please reconnect your Facebook account.'
        });
      }

      // Проверяем, какие креативы уже импортированы
      const { data: existingImports, error: existingError } = await supabase
        .from('user_creatives')
        .select('fb_ad_id')
        .eq('user_id', query.user_id)
        .eq('source', 'imported_analysis');

      if (existingError) {
        request.log.warn({ requestId, error: existingError.message }, 'Failed to check existing imports');
      }

      const importedAdIds = new Set((existingImports || []).map(c => c.fb_ad_id).filter(Boolean));

      request.log.info({ requestId, existingImportsCount: importedAdIds.size }, 'Checked existing imports');

      // Получаем топ креативы
      const topCreatives = await fetchTopCreatives(
        credentials.accessToken,
        credentials.adAccountId,
        request.log
      );

      // Помечаем уже импортированные
      const creativesWithStatus = topCreatives.map(c => ({
        ...c,
        already_imported: importedAdIds.has(c.ad_id),
        is_video: !!c.video_id,
      }));

      const response = {
        success: true,
        creatives: creativesWithStatus,
        total_found: creativesWithStatus.length,
        already_imported: creativesWithStatus.filter(c => c.already_imported).length,
      };

      request.log.info({
        requestId,
        userId: query.user_id,
        creativesFound: response.total_found,
        alreadyImported: response.already_imported,
        durationMs: Date.now() - startTime,
        action: 'preview_complete'
      }, 'Preview completed successfully');

      return reply.send(response);

    } catch (error: any) {
      request.log.error({
        requestId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
        action: 'preview_error'
      }, 'Preview failed');

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid parameters',
          details: error.errors
        });
      }

      // Специфичные ошибки FB API
      if (error.message?.includes('Facebook API')) {
        return reply.code(502).send({
          success: false,
          error: error.message
        });
      }

      return reply.code(500).send({
        success: false,
        error: 'Internal server error. Please try again later.'
      });
    }
  });

  /**
   * POST /analyze-top-creatives/import
   *
   * Импортирует выбранные креативы
   */
  app.post('/analyze-top-creatives/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const startTime = Date.now();

    try {
      const body = ImportSchema.parse(request.body);

      request.log.info({
        requestId,
        userId: body.user_id,
        accountId: body.account_id || 'default',
        selectedAdIds: body.ad_ids,
        selectedCount: body.ad_ids.length,
        action: 'import_start'
      }, 'Starting selected creatives import');

      const credentials = await getCredentials(body.user_id, body.account_id, request.log);
      if (!credentials) {
        request.log.warn({ requestId, userId: body.user_id }, 'No credentials found for import');
        return reply.code(400).send({
          success: false,
          error: 'No Facebook credentials found. Please reconnect your Facebook account.'
        });
      }

      // Получаем информацию о выбранных креативах из FB
      request.log.info({ requestId }, 'Fetching creative details from Facebook');

      const allTopCreatives = await fetchTopCreatives(
        credentials.accessToken,
        credentials.adAccountId,
        request.log
      );

      // Фильтруем только выбранные
      const selectedCreatives = allTopCreatives.filter(c => body.ad_ids.includes(c.ad_id));

      // Создаём Map для быстрого поиска direction_id по ad_id
      const directionMappingMap = new Map<string, string | null>();
      if (body.direction_mappings) {
        for (const mapping of body.direction_mappings) {
          directionMappingMap.set(mapping.ad_id, mapping.direction_id);
        }
      }

      request.log.info({
        requestId,
        requestedCount: body.ad_ids.length,
        foundCount: selectedCreatives.length,
        notFoundIds: body.ad_ids.filter(id => !selectedCreatives.find(c => c.ad_id === id)),
        hasDirectionMappings: body.direction_mappings?.length || 0
      }, 'Filtered selected creatives');

      if (selectedCreatives.length === 0) {
        request.log.warn({ requestId, requestedIds: body.ad_ids }, 'None of the selected creatives found in top list');
        return reply.code(400).send({
          success: false,
          error: 'Selected creatives not found. They may no longer meet the minimum requirements (5+ leads).'
        });
      }

      // Импортируем выбранные
      const results: Array<{
        ad_id: string;
        ad_name: string;
        success: boolean;
        creative_id?: string;
        error?: string;
      }> = [];

      for (let i = 0; i < selectedCreatives.length; i++) {
        const creative = selectedCreatives[i];
        const directionId = directionMappingMap.get(creative.ad_id);

        request.log.info({
          requestId,
          adId: creative.ad_id,
          directionId: directionId || 'none',
          progress: `${i + 1}/${selectedCreatives.length}`,
          action: 'import_single_start'
        }, 'Importing creative');

        const result = await importSingleCreative(
          creative,
          body.user_id,
          credentials.targetAccountId,
          credentials.accessToken,
          request.log,
          directionId
        );

        results.push({
          ad_id: creative.ad_id,
          ad_name: creative.ad_name,
          success: result.success,
          creative_id: result.creative_id,
          error: result.error,
        });

        request.log.info({
          requestId,
          adId: creative.ad_id,
          success: result.success,
          error: result.error,
          action: 'import_single_complete'
        }, 'Creative import attempt finished');
      }

      const importedCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      request.log.info({
        requestId,
        userId: body.user_id,
        requested: body.ad_ids.length,
        imported: importedCount,
        failed: failedCount,
        durationMs: Date.now() - startTime,
        action: 'import_complete'
      }, 'Import batch completed');

      return reply.send({
        success: true,
        imported: importedCount,
        results,
        message: importedCount > 0
          ? `Импортировано ${importedCount} из ${selectedCreatives.length} креативов`
          : 'Не удалось импортировать креативы'
      });

    } catch (error: any) {
      request.log.error({
        requestId,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
        action: 'import_error'
      }, 'Import failed');

      logErrorToAdmin({
        user_account_id: (request.body as any)?.user_id,
        error_type: 'api',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'import_selected_creatives',
        endpoint: '/analyze-top-creatives/import',
        severity: 'warning'
      }).catch(() => {});

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid parameters',
          details: error.errors
        });
      }

      if (error.message?.includes('Facebook API')) {
        return reply.code(502).send({
          success: false,
          error: error.message
        });
      }

      return reply.code(500).send({
        success: false,
        error: 'Internal server error. Please try again later.'
      });
    }
  });

  /**
   * GET /analyze-top-creatives/status
   *
   * Проверяет, есть ли уже импортированные креативы
   */
  app.get('/analyze-top-creatives/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const { user_id, account_id } = request.query as { user_id?: string; account_id?: string };

    request.log.info({ requestId, userId: user_id, accountId: account_id }, 'Checking import status');

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
      request.log.error({ requestId, error: error.message }, 'Status check failed');
      return reply.code(500).send({ success: false, error: error.message });
    }

    request.log.info({ requestId, hasImported: data && data.length > 0, count: data?.length }, 'Status check complete');

    return reply.send({
      success: true,
      hasImported: data && data.length > 0,
      count: data?.length || 0,
      creatives: data || []
    });
  });
};

export default creativeAnalysisRoutes;
