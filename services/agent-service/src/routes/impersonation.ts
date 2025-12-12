/**
 * Impersonation API Routes
 *
 * Allows tech admin to login as any user for testing/support purposes
 * Actions performed while impersonating are NOT recorded in analytics
 *
 * @module routes/impersonation
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { logErrorToAdmin } from '../lib/errorLogger.js';
import crypto from 'crypto';

const logger = createLogger({ module: 'impersonationRoutes' });

// =====================================================
// Schemas
// =====================================================

const QuerySchema = z.object({
  search: z.string().optional(),
  stage: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50)
});

// In-memory store for impersonation sessions
// In production, consider using Redis or database
const impersonationSessions = new Map<string, {
  techAdminId: string;
  targetUserId: string;
  createdAt: Date;
  expiresAt: Date;
}>();

// Clean expired sessions every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [token, session] of impersonationSessions.entries()) {
    if (session.expiresAt < now) {
      impersonationSessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

// =====================================================
// Helper Functions
// =====================================================

/**
 * Проверяет, является ли пользователь техадмином
 */
async function isTechAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_accounts')
    .select('is_tech_admin')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  return data.is_tech_admin === true;
}

/**
 * Генерирует токен для impersonation сессии
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// =====================================================
// Routes
// =====================================================

export default async function impersonationRoutes(app: FastifyInstance) {
  /**
   * GET /impersonate/users
   *
   * Список пользователей для выбора (только для tech_admin)
   */
  app.get('/impersonate/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const techAdminId = request.headers['x-user-id'] as string;

    if (!techAdminId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Проверяем права
    const isAdmin = await isTechAdmin(techAdminId);
    if (!isAdmin) {
      logger.warn({ userId: techAdminId }, 'Non-admin attempted to access impersonation');
      return reply.code(403).send({ error: 'Access denied. Tech admin only.' });
    }

    const query = QuerySchema.safeParse(request.query);
    const { search, stage, limit } = query.success
      ? query.data
      : { search: undefined, stage: undefined, limit: 50 };

    try {
      let queryBuilder = supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          onboarding_stage,
          onboarding_tags,
          is_active,
          telegram_id,
          created_at
        `)
        .eq('is_tech_admin', false)
        .order('updated_at', { ascending: false })
        .limit(limit);

      // Фильтр по поиску
      if (search) {
        queryBuilder = queryBuilder.ilike('username', `%${search}%`);
      }

      // Фильтр по этапу
      if (stage) {
        queryBuilder = queryBuilder.eq('onboarding_stage', stage);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        logger.error({ error: error.message }, 'Failed to fetch users for impersonation');
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ users: data || [] });
    } catch (err: any) {
      logger.error({ error: String(err) }, 'Exception in GET /impersonate/users');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'impersonate_list_users',
        endpoint: '/impersonate/users',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /impersonate/:userId
   *
   * Начать impersonation сессию (войти как пользователь)
   */
  app.post('/impersonate/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId: targetUserId } = request.params as { userId: string };
    const techAdminId = request.headers['x-user-id'] as string;

    if (!techAdminId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Проверяем права
    const isAdmin = await isTechAdmin(techAdminId);
    if (!isAdmin) {
      logger.warn({ userId: techAdminId, targetUserId }, 'Non-admin attempted impersonation');
      return reply.code(403).send({ error: 'Access denied. Tech admin only.' });
    }

    try {
      // Получаем данные целевого пользователя
      const { data: targetUser, error } = await supabase
        .from('user_accounts')
        .select(`
          id,
          username,
          onboarding_stage,
          is_active,
          access_token,
          ad_account_id,
          page_id,
          instagram_id,
          telegram_id,
          site_url,
          facebook_pixel_id,
          city_id,
          tarif,
          optimization,
          autopilot,
          creative_generations_available
        `)
        .eq('id', targetUserId)
        .single();

      if (error || !targetUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Нельзя имперсонировать другого техадмина
      const targetIsAdmin = await isTechAdmin(targetUserId);
      if (targetIsAdmin) {
        return reply.code(403).send({ error: 'Cannot impersonate another tech admin' });
      }

      // Создаём токен сессии
      const token = generateToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 часа

      impersonationSessions.set(token, {
        techAdminId,
        targetUserId,
        createdAt: now,
        expiresAt
      });

      logger.info({
        techAdminId,
        targetUserId,
        targetUsername: targetUser.username
      }, 'Impersonation session started');

      return reply.send({
        success: true,
        impersonationToken: token,
        expiresAt: expiresAt.toISOString(),
        user: targetUser
      });
    } catch (err: any) {
      logger.error({ error: String(err), targetUserId }, 'Exception in POST /impersonate/:userId');

      logErrorToAdmin({
        error_type: 'api',
        raw_error: err.message || String(err),
        stack_trace: err.stack,
        action: 'impersonate_start_session',
        endpoint: '/impersonate/:userId',
        severity: 'warning'
      }).catch(() => {});

      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /impersonate/verify
   *
   * Проверить валидность impersonation токена
   */
  app.get('/impersonate/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers['x-impersonation-token'] as string;

    if (!token) {
      return reply.send({ valid: false, reason: 'No token provided' });
    }

    const session = impersonationSessions.get(token);

    if (!session) {
      return reply.send({ valid: false, reason: 'Invalid token' });
    }

    if (session.expiresAt < new Date()) {
      impersonationSessions.delete(token);
      return reply.send({ valid: false, reason: 'Token expired' });
    }

    return reply.send({
      valid: true,
      techAdminId: session.techAdminId,
      targetUserId: session.targetUserId,
      expiresAt: session.expiresAt.toISOString()
    });
  });

  /**
   * POST /impersonate/end
   *
   * Завершить impersonation сессию
   */
  app.post('/impersonate/end', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers['x-impersonation-token'] as string;

    if (!token) {
      return reply.code(400).send({ error: 'No impersonation token provided' });
    }

    const session = impersonationSessions.get(token);

    if (session) {
      logger.info({
        techAdminId: session.techAdminId,
        targetUserId: session.targetUserId
      }, 'Impersonation session ended');

      impersonationSessions.delete(token);
    }

    return reply.send({ success: true });
  });

  /**
   * GET /impersonate/active-sessions
   *
   * Список активных impersonation сессий (для мониторинга)
   */
  app.get('/impersonate/active-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const techAdminId = request.headers['x-user-id'] as string;

    if (!techAdminId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const isAdmin = await isTechAdmin(techAdminId);
    if (!isAdmin) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const sessions = [];
    const now = new Date();

    for (const [token, session] of impersonationSessions.entries()) {
      if (session.expiresAt > now) {
        sessions.push({
          techAdminId: session.techAdminId,
          targetUserId: session.targetUserId,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString()
        });
      }
    }

    return reply.send({ sessions });
  });
}
