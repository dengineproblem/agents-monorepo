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
  let accessToken: string | null = null;

  if (adAccountId) {
    const { data: acc } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', adAccountId)
      .eq('user_account_id', userAccountId)
      .single();
    accessToken = acc?.access_token || null;
  }

  if (!accessToken) {
    const { data: userAcc } = await supabase
      .from('user_accounts')
      .select('access_token')
      .eq('id', userAccountId)
      .single();

    if (userAcc?.access_token) {
      accessToken = userAcc.access_token;
    } else {
      const { data: firstAcc } = await supabase
        .from('ad_accounts')
        .select('access_token')
        .eq('user_account_id', userAccountId)
        .not('access_token', 'is', null)
        .limit(1)
        .single();
      accessToken = firstAcc?.access_token || null;
    }
  }

  return accessToken;
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
