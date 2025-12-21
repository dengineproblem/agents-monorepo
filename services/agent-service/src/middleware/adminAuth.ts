import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../supabaseClient.js';

/**
 * SECURITY: Middleware для проверки прав техадмина
 * Проверяет is_tech_admin флаг в БД для всех /admin/* роутов
 */
export async function requireTechAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.headers['x-user-id'] as string;

  if (!userId) {
    request.log.warn('Admin access attempt without x-user-id header');
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'x-user-id header is required'
    });
  }

  try {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('is_tech_admin')
      .eq('id', userId)
      .single();

    if (error) {
      request.log.warn({ userId, error: error.message }, 'Failed to verify admin status');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    if (!data?.is_tech_admin) {
      request.log.warn({ userId }, 'Non-admin user attempted to access admin route');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    // Добавляем флаг в request для использования в роутах
    (request as any).isAdmin = true;
  } catch (err) {
    request.log.error({ userId, error: err }, 'Error checking admin status');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to verify admin status'
    });
  }
}
