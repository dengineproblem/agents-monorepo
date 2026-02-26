/**
 * POST /auth/login
 * Авторизация пользователя (bcrypt)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username?.trim() || !password?.trim()) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    // Ищем пользователя по username
    const { data: user, error } = await supabase
      .from('user_accounts')
      .select('id, username, password, ad_account_id, page_id, prompt1, is_tech_admin')
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

    // Возвращаем данные пользователя БЕЗ пароля
    return reply.send({
      id: user.id,
      username: user.username,
      ad_account_id: user.ad_account_id || '',
      page_id: user.page_id || '',
      prompt1: user.prompt1 || null,
      is_tech_admin: user.is_tech_admin || false,
    });
  });
}
