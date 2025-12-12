/**
 * Admin Errors Routes
 *
 * API для раздела ошибок в админ-панели с LLM расшифровкой
 *
 * @module routes/adminErrors
 */

import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import OpenAI from 'openai';
import { logErrorToAdmin } from '../lib/errorLogger.js';

const log = createLogger({ module: 'adminErrors' });

// OpenAI для LLM расшифровки ошибок
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Генерация LLM объяснения для ошибки
 */
async function generateErrorExplanation(error: {
  error_type: string;
  error_code?: string;
  raw_error: string;
  action?: string;
  endpoint?: string;
}): Promise<{ explanation: string; solution: string }> {
  try {
    const prompt = `Ты помощник для анализа технических ошибок. Проанализируй ошибку и дай:
1. Краткое объяснение на русском языке (что произошло, простыми словами)
2. Рекомендуемое решение

Контекст ошибки:
- Тип: ${error.error_type}
- Код: ${error.error_code || 'не указан'}
- Действие: ${error.action || 'не указано'}
- Endpoint: ${error.endpoint || 'не указан'}

Текст ошибки:
${error.raw_error.substring(0, 1000)}

Ответь в формате JSON:
{
  "explanation": "краткое объяснение на русском",
  "solution": "рекомендуемое решение"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const result = JSON.parse(content);
      return {
        explanation: result.explanation || 'Не удалось проанализировать ошибку',
        solution: result.solution || 'Обратитесь к разработчику',
      };
    }
  } catch (err) {
    log.error({ error: String(err) }, 'Error generating LLM explanation');
  }

  return {
    explanation: 'Ошибка в системе',
    solution: 'Обратитесь к разработчику для анализа',
  };
}

export default async function adminErrorsRoutes(app: FastifyInstance) {

  /**
   * GET /admin/errors
   * Получить список ошибок с фильтрами
   */
  app.get('/admin/errors', async (req, res) => {
    try {
      const {
        page = '1',
        limit = '20',
        type = '',
        severity = '',
        resolved = '',
      } = req.query as Record<string, string>;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      // Build query
      let query = supabase
        .from('error_logs')
        .select(`
          id,
          user_account_id,
          error_type,
          error_code,
          raw_error,
          stack_trace,
          action,
          endpoint,
          request_data,
          llm_explanation,
          llm_solution,
          severity,
          is_resolved,
          resolved_at,
          resolved_by,
          created_at,
          user_accounts!error_logs_user_account_id_fkey(username)
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (type) {
        query = query.eq('error_type', type);
      }

      if (severity) {
        query = query.eq('severity', severity);
      }

      if (resolved === 'true') {
        query = query.eq('is_resolved', true);
      } else if (resolved === 'false') {
        query = query.eq('is_resolved', false);
      }

      // Get total count
      let countQuery = supabase
        .from('error_logs')
        .select('*', { count: 'exact', head: true });

      if (type) countQuery = countQuery.eq('error_type', type);
      if (severity) countQuery = countQuery.eq('severity', severity);
      if (resolved === 'true') countQuery = countQuery.eq('is_resolved', true);
      else if (resolved === 'false') countQuery = countQuery.eq('is_resolved', false);

      const { count: total } = await countQuery;

      // Get paginated data
      const { data: errors, error } = await query
        .range(offset, offset + limitNum - 1);

      if (error) throw error;

      // Format errors
      const formattedErrors = (errors || []).map((err: any) => ({
        ...err,
        user_username: err.user_accounts?.username,
      }));

      return res.send({
        errors: formattedErrors,
        total: total || 0,
        page: pageNum,
        totalPages: Math.ceil((total || 0) / limitNum),
      });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error fetching errors');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_list_errors',
        endpoint: '/admin/errors',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to fetch errors' });
    }
  });

  /**
   * GET /admin/errors/unresolved-count
   * Получить количество нерешённых ошибок для бейджа
   */
  app.get('/admin/errors/unresolved-count', async (req, res) => {
    try {
      const { count } = await supabase
        .from('error_logs')
        .select('*', { count: 'exact', head: true })
        .eq('is_resolved', false);

      return res.send({ count: count || 0 });
    } catch (err) {
      log.error({ error: String(err) }, 'Error fetching unresolved count');
      return res.send({ count: 0 });
    }
  });

  /**
   * POST /admin/errors/:id/resolve
   * Отметить ошибку как решённую
   */
  app.post('/admin/errors/:id/resolve', async (req, res) => {
    try {
      const { id } = req.params as { id: string };
      const adminId = req.headers['x-user-id'] as string;

      const { error } = await supabase
        .from('error_logs')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: adminId || null,
        })
        .eq('id', id);

      if (error) throw error;

      return res.send({ success: true });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error resolving error');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'admin_resolve_error',
        endpoint: '/admin/errors/:id/resolve',
        severity: 'warning'
      }).catch(() => {});

      return res.status(500).send({ error: 'Failed to resolve error' });
    }
  });

  /**
   * POST /admin/errors/log
   * Логирование новой ошибки (внутренний endpoint)
   */
  app.post('/admin/errors/log', async (req, res) => {
    try {
      const {
        user_account_id,
        error_type,
        error_code,
        raw_error,
        stack_trace,
        action,
        endpoint,
        request_data,
        severity = 'warning',
      } = req.body as any;

      if (!error_type || !raw_error) {
        return res.status(400).send({ error: 'error_type and raw_error are required' });
      }

      // Generate LLM explanation
      const { explanation, solution } = await generateErrorExplanation({
        error_type,
        error_code,
        raw_error,
        action,
        endpoint,
      });

      // Insert error
      const { data: insertedError, error } = await supabase
        .from('error_logs')
        .insert({
          user_account_id,
          error_type,
          error_code,
          raw_error,
          stack_trace,
          action,
          endpoint,
          request_data,
          llm_explanation: explanation,
          llm_solution: solution,
          severity,
        })
        .select()
        .single();

      if (error) throw error;

      // Create admin notification for critical errors
      if (severity === 'critical') {
        await supabase
          .from('admin_notifications')
          .insert({
            type: 'error',
            title: `Критическая ошибка: ${error_type}`,
            message: explanation,
            metadata: { errorId: insertedError.id },
          });
      }

      log.info({ errorId: insertedError.id, type: error_type }, 'Error logged');

      return res.send({ success: true, error: insertedError });
    } catch (err: any) {
      log.error({ error: String(err) }, 'Error logging error');
      // Не логируем ошибку логирования во избежание рекурсии
      return res.status(500).send({ error: 'Failed to log error' });
    }
  });
}
