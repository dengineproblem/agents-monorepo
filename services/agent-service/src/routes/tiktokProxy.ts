/**
 * TikTok Business API Proxy
 *
 * Проксирует запросы к TikTok Business API через бэкенд,
 * чтобы access_token никогда не попадал на фронтенд.
 * Аналог fbProxy.ts для Facebook.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { tikTokGraph } from '../adapters/tiktok.js';
import { getTikTokCredentials } from '../lib/tiktokSettings.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ module: 'tiktokProxy' });

const TikTokProxySchema = z.object({
  endpoint: z.string().min(1),
  params: z.record(z.any()).optional().default({}),
  method: z.enum(['GET', 'POST']).optional().default('GET'),
  // Явный adAccountId (internal DB id) — для multi-account вызовов
  adAccountId: z.string().uuid().optional(),
});

export async function tiktokProxyRoutes(app: FastifyInstance) {
  /**
   * POST /tiktok-proxy
   * Проксирует запрос к TikTok Business API
   */
  app.post('/tiktok-proxy', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    const userAccountId = req.headers['x-user-id'] as string;

    if (!userAccountId) {
      return reply.status(401).send({ error: 'x-user-id header is required' });
    }

    const parsed = TikTokProxySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { endpoint, params, method, adAccountId } = parsed.data;

    try {
      const creds = await getTikTokCredentials(userAccountId, adAccountId);

      if (!creds) {
        return reply.status(400).send({ error: 'No TikTok credentials found for this account' });
      }

      // Добавляем advertiser_id в params если его нет
      if (!params.advertiser_id) {
        params.advertiser_id = creds.advertiserId;
      }

      log.info({
        userAccountId,
        endpoint,
        method,
        advertiserId: creds.advertiserId,
      }, 'TikTok proxy request');

      // Вызываем TikTok API через адаптер
      const result = await tikTokGraph(method, endpoint, creds.accessToken, params);

      return reply.send(result);
    } catch (error: any) {
      log.error({ error: error.message, endpoint, method }, 'TikTok Proxy error');

      return reply.status(500).send({
        code: error.code || -1,
        message: error.message || 'TikTok API error',
      });
    }
  });
}
