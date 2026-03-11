/**
 * POST /auth/login
 * Авторизация пользователя (bcrypt)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';
import { signJwt, verifyJwt } from '../lib/jwt.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username?.trim() || !password?.trim()) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    // Ищем пользователя по username
    const { data: user, error } = await supabase
      .from('user_accounts')
      .select('id, username, password, ad_account_id, page_id, prompt1, is_tech_admin, instagram_id')
      .eq('username', username.trim())
      .maybeSingle();

    if (error) {
      app.log.error({ error }, 'auth/login: DB error');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Сравниваем пароль: bcrypt hash ($2a$/$2b$) или plaintext (legacy)
    const isBcrypt = user.password?.startsWith('$2a$') || user.password?.startsWith('$2b$');
    const passwordMatch = isBcrypt
      ? await bcrypt.compare(password, user.password)
      : password === user.password;
    if (!passwordMatch) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // JWT токен — подписан секретом, содержит userId
    const token = signJwt({ userId: user.id });

    // Возвращаем данные пользователя БЕЗ пароля + токен
    return reply.send({
      id: user.id,
      username: user.username,
      ad_account_id: user.ad_account_id || '',
      page_id: user.page_id || '',
      prompt1: user.prompt1 || null,
      is_tech_admin: user.is_tech_admin || false,
      instagram_id: user.instagram_id || null,
      token,
    });
  });

  /**
   * POST /auth/impersonate
   * Войти как другой юзер (только для tech_admin, требует JWT)
   */
  app.post('/auth/impersonate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username } = request.body as { username: string };

    if (!username?.trim()) {
      return reply.status(400).send({ error: 'Username required' });
    }

    // Проверяем JWT вызывающего
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'JWT required' });
    }
    const caller = verifyJwt(authHeader.slice(7));
    if (!caller) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Проверяем что вызывающий — tech_admin
    const { data: admin } = await supabase
      .from('user_accounts')
      .select('is_tech_admin')
      .eq('id', caller.userId)
      .single();

    if (!admin?.is_tech_admin) {
      return reply.status(403).send({ error: 'Tech admin only' });
    }

    // Получаем целевого юзера
    const { data: user, error } = await supabase
      .from('user_accounts')
      .select('id, username, ad_account_id, page_id, prompt1, is_tech_admin, instagram_id')
      .eq('username', username.trim())
      .maybeSingle();

    if (error) {
      app.log.error({ error }, 'auth/impersonate: DB error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const token = signJwt({ userId: user.id });

    app.log.info({ adminId: caller.userId, targetUser: user.username }, 'Impersonation login');

    return reply.send({
      id: user.id,
      username: user.username,
      ad_account_id: user.ad_account_id || '',
      page_id: user.page_id || '',
      prompt1: user.prompt1 || null,
      is_tech_admin: user.is_tech_admin || false,
      instagram_id: user.instagram_id || null,
      token,
    });
  });
}
