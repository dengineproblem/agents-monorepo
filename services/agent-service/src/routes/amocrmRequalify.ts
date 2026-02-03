/**
 * AmoCRM Requalification Routes
 *
 * API endpoints для перепроверки квалификации лидов
 *
 * @module routes/amocrmRequalify
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requalifyLeads, RequalifyOptions } from '../workflows/amocrmRequalifyLeads.js';

/**
 * Zod schema для валидации query params
 */
const RequalifyQuerySchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  batchSize: z.coerce.number().int().min(1).max(500).optional(),
  dryRun: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()    // YYYY-MM-DD
});

const StatusQuerySchema = z.object({
  userAccountId: z.string().uuid(),
  accountId: z.string().uuid().optional()
});

export default async function amocrmRequalifyRoutes(app: FastifyInstance) {
  /**
   * POST /amocrm/requalify-leads
   * Запустить перепроверку квалификации лидов
   *
   * Query params:
   *   - userAccountId: UUID пользователя (required)
   *   - accountId: UUID ad_account для мультиаккаунтности (optional)
   *   - batchSize: Размер батча (optional, по умолчанию 50)
   *   - dryRun: Тестовый режим без сохранения в БД (optional, по умолчанию false)
   *   - startDate: Дата начала YYYY-MM-DD (optional)
   *   - endDate: Дата окончания YYYY-MM-DD (optional)
   *
   * Response:
   *   - success: true/false
   *   - result: RequalifyResult
   *   - message: string
   */
  app.post('/amocrm/requalify-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = RequalifyQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, accountId, batchSize, dryRun, startDate, endDate } = parsed.data;

      app.log.info({
        userAccountId,
        accountId,
        batchSize,
        dryRun,
        startDate,
        endDate
      }, 'POST /amocrm/requalify-leads called');

      // Построить опции
      const options: RequalifyOptions = {
        batchSize,
        dryRun,
        startDate,
        endDate
      };

      // Запустить перепроверку
      const result = await requalifyLeads(userAccountId, app, accountId || null, options);

      return reply.send({
        success: true,
        result,
        message: dryRun
          ? 'Dry-run completed. Database was not modified.'
          : 'Requalification completed successfully.'
      });

    } catch (error: any) {
      app.log.error({ error: error.message }, 'POST /amocrm/requalify-leads failed');

      // Специфичные ошибки
      if (error.message.includes('Qualification fields are not configured')) {
        return reply.code(404).send({
          success: false,
          error: 'qualification_not_configured',
          message: 'Qualification fields are not configured. Please configure qualification fields first.'
        });
      }

      if (error.message.includes('AmoCRM not connected') || error.message.includes('No valid token')) {
        return reply.code(401).send({
          success: false,
          error: 'amocrm_not_connected',
          message: 'AmoCRM is not connected. Please connect AmoCRM first.'
        });
      }

      // Общая ошибка
      return reply.code(500).send({
        success: false,
        error: 'internal_server_error',
        message: error.message || 'Failed to requalify leads'
      });
    }
  });

  /**
   * GET /amocrm/requalify-status
   * Получить последний результат перепроверки
   *
   * Query params:
   *   - userAccountId: UUID пользователя (required)
   *   - accountId: UUID ad_account для мультиаккаунтности (optional)
   *
   * Response:
   *   - lastSync: { created_at, sync_status, response_json } | null
   */
  app.get('/amocrm/requalify-status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = StatusQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          issues: parsed.error.flatten()
        });
      }

      const { userAccountId, accountId } = parsed.data;

      app.log.info({ userAccountId, accountId }, 'GET /amocrm/requalify-status called');

      // Загрузить последнюю запись из amocrm_sync_log
      let query = supabase
        .from('amocrm_sync_log')
        .select('created_at, sync_status, response_json')
        .eq('user_account_id', userAccountId)
        .eq('sync_type', 'lead_requalification')
        .order('created_at', { ascending: false })
        .limit(1);

      // Фильтрация по accountId если указан
      if (accountId) {
        query = query.eq('account_id', accountId);
      } else {
        query = query.is('account_id', null);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch requalify status: ${error.message}`);
      }

      return reply.send({
        lastSync: data || null
      });

    } catch (error: any) {
      app.log.error({ error: error.message }, 'GET /amocrm/requalify-status failed');

      return reply.code(500).send({
        error: 'internal_server_error',
        message: error.message || 'Failed to fetch requalify status'
      });
    }
  });
}
