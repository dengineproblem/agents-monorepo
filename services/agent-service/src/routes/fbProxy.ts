/**
 * Facebook Graph API Proxy
 *
 * Проксирует запросы к Facebook Graph API через бэкенд,
 * чтобы access_token никогда не попадал на фронтенд.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { graph } from '../adapters/facebook.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'fbProxy' });

const FbProxySchema = z.object({
  path: z.string().min(1),
  params: z.record(z.string()).optional().default({}),
  method: z.enum(['GET', 'POST', 'DELETE']).optional().default('GET'),
  // Явный adAccountId (internal DB id) — для multi-account вызовов
  adAccountId: z.string().uuid().optional(),
});

/**
 * Вспомогательная функция: получить access_token пользователя из БД
 */
async function resolveAccessToken(userAccountId: string, adAccountId?: string): Promise<string | null> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, access_token')
    .eq('id', userAccountId)
    .single();

  if (!user) return null;

  // Multi-account → токен из ad_accounts
  if (user.multi_account_enabled && adAccountId) {
    const { data: acc } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', adAccountId)
      .eq('user_account_id', userAccountId)
      .single();
    return acc?.access_token || null;
  }

  // Legacy → токен из user_accounts
  return user.access_token || null;
}

async function resolveFbAdAccountId(userAccountId: string, adAccountId?: string): Promise<string | null> {
  const { data: user } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, ad_account_id')
    .eq('id', userAccountId)
    .single();

  if (!user) return null;

  if (user.multi_account_enabled && adAccountId) {
    const { data: acc } = await supabase
      .from('ad_accounts')
      .select('ad_account_id')
      .eq('id', adAccountId)
      .eq('user_account_id', userAccountId)
      .single();
    return acc?.ad_account_id || null;
  }

  return user.ad_account_id || null;
}

export async function fbProxyRoutes(app: FastifyInstance) {
  /**
   * POST /fb-proxy/lead-forms
   * Получение лидформ страницы — требует Page Access Token (серверная логика)
   */
  app.post('/fb-proxy/lead-forms', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    const userAccountId = req.headers['x-user-id'] as string;
    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    const bodySchema = z.object({
      pageId: z.string().min(1),
      adAccountId: z.string().uuid().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { pageId, adAccountId } = parsed.data;

    try {
      const accessToken = await resolveAccessToken(userAccountId, adAccountId);
      if (!accessToken) {
        return reply.status(400).send({ error: 'No Facebook access token found' });
      }

      // 1. Получаем страницы через /me/accounts для Page Access Token
      let allPages: any[] = [];
      let after: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const pagesParams: Record<string, string> = {
          fields: 'id,name,access_token',
          limit: '100',
        };
        if (after) pagesParams.after = after;

        const pagesData = await graph('GET', 'me/accounts', accessToken, pagesParams);
        if (pagesData.data) {
          allPages = allPages.concat(pagesData.data);
        }
        if (pagesData.paging?.cursors?.after && pagesData.paging?.next) {
          after = pagesData.paging.cursors.after;
        } else {
          hasMore = false;
        }
      }

      // 2. Находим Page Access Token для нужной страницы
      let tokenForForms = accessToken; // fallback на User Token
      const page = allPages.find((p: any) => p.id === pageId);
      if (page?.access_token) {
        tokenForForms = page.access_token;
        log.info({ pageId, pageName: page.name }, 'Using Page Access Token for lead forms');
      }

      // 3. Запрашиваем лидформы с Page Access Token
      const formsData = await graph('GET', `${pageId}/leadgen_forms`, tokenForForms, {
        fields: 'id,name,status',
        limit: '100',
      });

      const forms = (formsData.data || []).map((f: any) => ({
        id: String(f.id),
        name: f.name || f.id,
        status: f.status || 'ACTIVE',
      }));

      return reply.send({ data: forms });
    } catch (error: any) {
      log.error({ error: error.message, pageId }, 'FB Proxy lead-forms error');

      if (error.fb) {
        return reply.status(error.fb.status_code || 400).send({
          error: error.message,
          facebook_error: error.fb,
        });
      }

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'facebook',
        raw_error: error.message || String(error),
        action: 'fb_proxy_lead_forms',
        endpoint: '/fb-proxy/lead-forms',
        request_data: { pageId },
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({ error: error.message || 'Facebook API error' });
    }
  });

  /**
   * GET /fb-video-embed?videoId=...&userId=...
   * Возвращает URL для embed iframe Facebook видео.
   */
  app.get('/fb-video-embed', async (req: FastifyRequest, reply: FastifyReply) => {
    const { videoId, userId, adAccountId } = req.query as {
      videoId?: string;
      userId?: string;
      adAccountId?: string;
    };

    if (!videoId || !userId) {
      return reply.status(400).send({ error: 'videoId and userId are required' });
    }

    try {
      const accessToken = await resolveAccessToken(userId, adAccountId);
      if (!accessToken) {
        return reply.status(401).send({ error: 'No Facebook access token' });
      }

      const data = await graph('GET', videoId, accessToken, { fields: 'format,permalink_url' });

      // Извлекаем embed URL из format[].embed_html (берём максимальное разрешение)
      let embedUrl: string | null = null;

      if (Array.isArray(data?.format)) {
        const best = (data.format as any[])
          .filter(f => f.embed_html)
          .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

        if (best?.embed_html) {
          const match = (best.embed_html as string).match(/src="([^"]+)"/);
          if (match?.[1]) {
            embedUrl = match[1].replace(/&amp;/g, '&');
            // autoplay=1 + muted=1 — обязательно для мобильных браузеров (iOS Safari блокирует autoplay без muted)
            embedUrl += '&autoplay=1&muted=1&show_text=0&allowfullscreen=1';
          }
        }
      }

      if (!embedUrl && data?.permalink_url) {
        const encoded = encodeURIComponent(data.permalink_url);
        embedUrl = `https://www.facebook.com/plugins/video.php?href=${encoded}&show_text=0&autoplay=1&muted=1&allowfullscreen=1`;
      }

      // Ссылка для мобилки — открывает в приложении Facebook или мобильном браузере
      const watchUrl = data?.permalink_url || `https://www.facebook.com/watch/?v=${videoId}`;
      log.info({ videoId, gotEmbedUrl: !!embedUrl }, 'FB video embed result');
      return reply.send({ embedUrl, permalinkUrl: watchUrl });
    } catch (error: any) {
      log.error({ error: error.message, videoId }, 'FB video embed error');
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * POST /fb-refresh-creative-urls
   * Batch-запрос свежих image_url / thumbnail_url для объявлений Facebook.
   * Принимает список ad_id и возвращает актуальные CDN URL.
   */
  app.post('/fb-refresh-creative-urls', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    const userAccountId = req.headers['x-user-id'] as string;
    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    const bodySchema = z.object({
      // ad IDs → получаем creative{image_url,thumbnail_url}
      adIds: z.array(z.string()).max(50).optional().default([]),
      // creative IDs → получаем image_url,thumbnail_url напрямую
      creativeIds: z.array(z.string()).max(50).optional().default([]),
      adAccountId: z.string().uuid().optional(),
    }).refine(d => d.adIds.length + d.creativeIds.length > 0, {
      message: 'adIds or creativeIds must not both be empty',
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { adIds, creativeIds, adAccountId } = parsed.data;

    try {
      const accessToken = await resolveAccessToken(userAccountId, adAccountId);
      if (!accessToken) {
        return reply.status(400).send({ error: 'No Facebook access token found' });
      }

      const result: Record<string, { image_url: string | null; thumbnail_url: string | null }> = {};

      // Батч по ad IDs: GET /?ids=...&fields=creative{image_url,thumbnail_url}
      if (adIds.length > 0) {
        const data = await graph('GET', '', accessToken, {
          ids: adIds.join(','),
          fields: 'creative{image_url,thumbnail_url}',
        });
        for (const adId of adIds) {
          const ad = data?.[adId];
          result[adId] = {
            image_url: ad?.creative?.image_url ?? null,
            thumbnail_url: ad?.creative?.thumbnail_url ?? null,
          };
        }
      }

      // Батч по creative IDs: GET /?ids=...&fields=image_url,thumbnail_url
      if (creativeIds.length > 0) {
        const data = await graph('GET', '', accessToken, {
          ids: creativeIds.join(','),
          fields: 'image_url,thumbnail_url',
        });
        for (const creativeId of creativeIds) {
          const cr = data?.[creativeId];
          result[creativeId] = {
            image_url: cr?.image_url ?? null,
            thumbnail_url: cr?.thumbnail_url ?? null,
          };
        }
      }

      return reply.send(result);
    } catch (error: any) {
      log.error({ error: error.message }, 'fb-refresh-creative-urls error');
      return reply.status(500).send({ error: error.message || 'Facebook API error' });
    }
  });

  /**
   * POST /fb-proxy
   * Проксирует запрос к Facebook Graph API
   */
  app.post('/fb-proxy', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    const userAccountId = req.headers['x-user-id'] as string;

    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    const parsed = FbProxySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { path: fbPath, params, method, adAccountId } = parsed.data;

    try {
      const accessToken = await resolveAccessToken(userAccountId, adAccountId);

      if (!accessToken) {
        return reply.status(400).send({ error: 'No Facebook access token found for this account' });
      }

      // Вызываем Facebook Graph API через существующий адаптер
      const result = await graph(method, fbPath, accessToken, params);

      return reply.send(result);
    } catch (error: any) {
      log.error({ error: error.message, fbPath, method }, 'FB Proxy error');

      // Если это ошибка от Facebook (имеет .fb), прокидываем детали
      if (error.fb) {
        return reply.status(error.fb.status_code || 400).send({
          error: error.message,
          facebook_error: error.fb,
        });
      }

      logErrorToAdmin({
        user_account_id: userAccountId,
        error_type: 'facebook',
        raw_error: error.message || String(error),
        stack_trace: error.stack,
        action: 'fb_proxy',
        endpoint: '/fb-proxy',
        request_data: { fbPath, method },
        severity: 'warning'
      }).catch(() => {});

      return reply.status(500).send({ error: error.message || 'Facebook API error' });
    }
  });
}
