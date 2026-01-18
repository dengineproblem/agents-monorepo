/**
 * TikTok General Routes
 *
 * Общие endpoints для работы с TikTok API:
 * - Instant Pages (Lead Forms)
 * - И другие общие функции
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { getInstantPages, TikTokInstantPage } from '../adapters/tiktok.js';

const log = createLogger({ module: 'tiktokRoutes' });

// Валидация UUID формата
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string | undefined): boolean {
  return !!value && UUID_REGEX.test(value);
}

interface GetInstantPagesQuery {
  advertiserId?: string;
  userAccountId?: string;
  adAccountId?: string;
}

export default async function tiktokRoutes(app: FastifyInstance) {

  /**
   * GET /tiktok/instant-pages
   *
   * Получить список Instant Pages (Lead Forms) для TikTok аккаунта
   *
   * Query params:
   * - advertiserId: TikTok advertiser ID (опционально, если передан userAccountId)
   * - userAccountId: UUID пользователя для получения credentials
   * - adAccountId: UUID ad_account для multi-account режима
   */
  app.get('/tiktok/instant-pages', async (
    req: FastifyRequest<{ Querystring: GetInstantPagesQuery }>,
    res
  ) => {
    const correlationId = randomUUID();
    const startTime = Date.now();

    try {
      const { advertiserId, userAccountId, adAccountId } = req.query;

      log.info({
        correlationId,
        advertiserId,
        userAccountId,
        adAccountId,
        ip: req.ip
      }, '[tiktokRoutes] GET /tiktok/instant-pages - request received');

      // Валидация: нужен хотя бы один параметр
      if (!userAccountId && !adAccountId && !advertiserId) {
        log.warn({ correlationId }, '[tiktokRoutes] Missing required parameters');
        return res.code(400).send({
          success: false,
          error: 'userAccountId or adAccountId is required'
        });
      }

      // Валидация UUID форматов
      if (userAccountId && !isValidUUID(userAccountId)) {
        log.warn({ correlationId, userAccountId }, '[tiktokRoutes] Invalid userAccountId format');
        return res.code(400).send({
          success: false,
          error: 'Invalid userAccountId format'
        });
      }

      if (adAccountId && !isValidUUID(adAccountId)) {
        log.warn({ correlationId, adAccountId }, '[tiktokRoutes] Invalid adAccountId format');
        return res.code(400).send({
          success: false,
          error: 'Invalid adAccountId format'
        });
      }

      // Получаем credentials
      let accessToken: string | null = null;
      let effectiveAdvertiserId: string | null = advertiserId || null;

      if (adAccountId) {
        // Multi-account mode: получаем из ad_accounts
        // КРИТИЧНО: проверяем владение аккаунтом через userAccountId
        const query = supabase
          .from('ad_accounts')
          .select('tiktok_access_token, tiktok_business_id, user_account_id')
          .eq('id', adAccountId);

        // Если передан userAccountId - проверяем владение
        if (userAccountId) {
          query.eq('user_account_id', userAccountId);
        }

        const { data: adAccount, error } = await query.single();

        if (error || !adAccount) {
          log.warn({
            correlationId,
            adAccountId,
            userAccountId,
            error: error?.message,
            accessDenied: !!userAccountId
          }, '[tiktokRoutes] Ad account not found or access denied');
          return res.code(userAccountId ? 403 : 404).send({
            success: false,
            error: userAccountId ? 'Access denied to this ad account' : 'Ad account not found'
          });
        }

        // Логируем успешную проверку доступа
        log.info({
          correlationId,
          adAccountId,
          ownerUserId: adAccount.user_account_id,
          accessGranted: true
        }, '[tiktokRoutes] Access control check passed');

        accessToken = adAccount.tiktok_access_token;
        effectiveAdvertiserId = adAccount.tiktok_business_id || effectiveAdvertiserId;
      } else if (userAccountId) {
        // Получаем TikTok credentials из связанного ad_account
        // (TikTok credentials всегда хранятся в ad_accounts, не в user_accounts)
        const { data: adAccount, error } = await supabase
          .from('ad_accounts')
          .select('tiktok_access_token, tiktok_business_id')
          .eq('user_account_id', userAccountId)
          .not('tiktok_access_token', 'is', null)
          .limit(1)
          .maybeSingle();

        if (error || !adAccount) {
          log.warn({
            correlationId,
            userAccountId,
            error: error?.message
          }, '[tiktokRoutes] No TikTok ad account found for user');
          return res.code(404).send({
            success: false,
            error: 'TikTok account not connected'
          });
        }

        accessToken = adAccount.tiktok_access_token;
        effectiveAdvertiserId = adAccount.tiktok_business_id || effectiveAdvertiserId;

        log.info({
          correlationId,
          userAccountId,
          advertiserId: effectiveAdvertiserId
        }, '[tiktokRoutes] Found TikTok credentials via user_account_id');
      }

      if (!accessToken) {
        log.warn({ correlationId, userAccountId, adAccountId }, '[tiktokRoutes] TikTok not connected');
        return res.code(400).send({
          success: false,
          error: 'TikTok account not connected'
        });
      }

      if (!effectiveAdvertiserId) {
        log.warn({ correlationId, userAccountId, adAccountId }, '[tiktokRoutes] TikTok advertiser ID not found');
        return res.code(400).send({
          success: false,
          error: 'TikTok advertiser ID not found'
        });
      }

      // Запрашиваем Instant Pages
      const pages = await getInstantPages(effectiveAdvertiserId, accessToken);

      const duration = Date.now() - startTime;
      log.info({
        correlationId,
        advertiserId: effectiveAdvertiserId,
        pages_count: pages.length,
        durationMs: duration
      }, '[tiktokRoutes] Instant Pages retrieved successfully');

      return res.send({
        success: true,
        data: pages
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      log.error({
        correlationId,
        error: error.message,
        stack: error.stack,
        durationMs: duration
      }, '[tiktokRoutes] Error getting instant pages');

      // Проверяем тип ошибки для более точного HTTP кода
      if (error.message?.includes('token') || error.message?.includes('auth')) {
        return res.code(401).send({
          success: false,
          error: 'TikTok authentication error. Please reconnect your account.',
          action: 'reconnect_tiktok'
        });
      }

      return res.code(500).send({
        success: false,
        error: error.message || 'Failed to get instant pages'
      });
    }
  });
}
