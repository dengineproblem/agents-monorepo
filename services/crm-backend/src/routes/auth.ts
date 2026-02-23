/**
 * POST /auth/login
 * Авторизация для CRM (консультанты + админы)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username: string; password: string };

    if (!username?.trim() || !password?.trim()) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    // 1. Сначала проверяем consultant_accounts
    const { data: consultantAccount } = await supabase
      .from('consultant_accounts')
      .select('id, consultant_id, username, password, role')
      .eq('username', username.trim())
      .maybeSingle();

    if (consultantAccount) {
      const match = await bcrypt.compare(password, consultantAccount.password);
      if (!match) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Получаем данные консультанта
      const { data: consultant, error: consultantError } = await supabase
        .from('consultants')
        .select('id, name, is_active')
        .eq('id', consultantAccount.consultant_id)
        .single();

      if (consultantError || !consultant || !consultant.is_active) {
        return reply.status(403).send({ error: 'Consultant profile not found or inactive' });
      }

      return reply.send({
        id: consultantAccount.id,
        username: consultantAccount.username,
        role: 'consultant',
        is_tech_admin: false,
        consultantId: consultant.id,
        consultantName: consultant.name,
      });
    }

    // 2. Если не найдено — проверяем user_accounts (админы/менеджеры)
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, username, password, role, is_tech_admin')
      .eq('username', username.trim())
      .maybeSingle();

    if (userError) {
      app.log.error({ error: userError }, 'auth/login: DB error');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    if (!userAccount) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, userAccount.password);
    if (!match) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Определяем роль
    const role = userAccount.is_tech_admin
      ? 'admin'
      : (userAccount.role || 'admin');

    let consultantId: string | undefined;
    let consultantName: string | undefined;

    // Если роль consultant в user_accounts — получаем consultantId (legacy)
    if (role === 'consultant') {
      const { data: consultant } = await supabase
        .from('consultants')
        .select('id, name')
        .eq('parent_user_account_id', userAccount.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!consultant) {
        return reply.status(403).send({ error: 'Consultant profile not found or inactive' });
      }

      consultantId = consultant.id;
      consultantName = consultant.name;
    }

    return reply.send({
      id: userAccount.id,
      username: userAccount.username,
      role,
      is_tech_admin: userAccount.is_tech_admin || false,
      consultantId,
      consultantName,
    });
  });
}
