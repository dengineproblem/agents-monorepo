import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabase.js';

export interface ConsultantAuthRequest extends FastifyRequest {
  consultant?: {
    id: string;
    name: string;
    parent_user_account_id: string;
  };
  userRole?: 'admin' | 'consultant' | 'manager';
  userAccountId?: string;
}

/**
 * Middleware: проверяет авторизацию пользователя и добавляет информацию о роли
 * Для консультантов также добавляет информацию о профиле консультанта
 */
export async function consultantAuthMiddleware(
  request: ConsultantAuthRequest,
  reply: FastifyReply
) {
  // Получаем user_account_id из заголовка
  // В текущей системе используется localStorage, ID передается в заголовке
  const userAccountId = request.headers['x-user-id'] as string;

  if (!userAccountId) {
    return reply.status(401).send({ error: 'Unauthorized: missing x-user-id header' });
  }

  request.userAccountId = userAccountId;

  try {
    // Сначала проверяем user_accounts (для админов И legacy консультантов)
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, username, role, is_tech_admin')
      .eq('id', userAccountId)
      .maybeSingle();

    if (userAccount) {
      // Если это legacy консультант (role='consultant' в user_accounts)
      if (userAccount.role === 'consultant') {
        request.userRole = 'consultant';

        // Получаем данные консультанта через parent_user_account_id
        const { data: consultant, error: fetchConsultantError } = await supabase
          .from('consultants')
          .select('id, name, parent_user_account_id')
          .eq('parent_user_account_id', userAccount.id)
          .eq('is_active', true)
          .single();

        if (fetchConsultantError || !consultant) {
          return reply.status(403).send({
            error: 'Consultant profile not found or inactive',
            details: 'Профиль консультанта не найден или неактивен'
          });
        }

        request.consultant = consultant;
        return;
      }

      // Если это админ или manager
      request.userRole = userAccount.is_tech_admin
        ? 'admin'
        : (userAccount.role as 'admin' | 'manager' || 'admin');
      return;
    }

    // Если не найдено в user_accounts - проверяем consultant_accounts
    const { data: consultantAccount, error: consultantError } = await supabase
      .from('consultant_accounts')
      .select('id, consultant_id, role')
      .eq('id', userAccountId)
      .single();

    if (consultantError || !consultantAccount) {
      return reply.status(401).send({ error: 'User or consultant account not found' });
    }

    // Это консультант - получаем его данные
    request.userRole = 'consultant';

    const { data: consultant, error: fetchConsultantError } = await supabase
      .from('consultants')
      .select('id, name, parent_user_account_id')
      .eq('id', consultantAccount.consultant_id)
      .eq('is_active', true)
      .single();

    if (fetchConsultantError || !consultant) {
      return reply.status(403).send({
        error: 'Consultant profile not found or inactive',
        details: 'Профиль консультанта не найден или неактивен'
      });
    }

    request.consultant = consultant;

  } catch (error: any) {
    request.log.error({ error, userAccountId }, 'Error in consultantAuthMiddleware');
    return reply.status(500).send({ error: 'Authentication error' });
  }
}

/**
 * Middleware: проверяет что пользователь - консультант
 * Должен вызываться ПОСЛЕ consultantAuthMiddleware
 */
export async function consultantOnlyMiddleware(
  request: ConsultantAuthRequest,
  reply: FastifyReply
) {
  // Админы имеют доступ ко всему
  if (request.userRole === 'admin') {
    return;
  }

  // Проверяем что это консультант
  if (request.userRole !== 'consultant' || !request.consultant) {
    return reply.status(403).send({
      error: 'Consultant access only',
      details: 'Доступ только для консультантов'
    });
  }
}

/**
 * Middleware: проверяет что пользователь - админ
 * Должен вызываться ПОСЛЕ consultantAuthMiddleware
 */
export async function adminOnlyMiddleware(
  request: ConsultantAuthRequest,
  reply: FastifyReply
) {
  if (request.userRole !== 'admin') {
    return reply.status(403).send({
      error: 'Admin access only',
      details: 'Доступ только для администраторов'
    });
  }
}

/**
 * Вспомогательная функция: проверяет что консультант имеет доступ к лиду
 */
export function checkConsultantLeadAccess(
  request: ConsultantAuthRequest,
  assignedConsultantId: string | null
): boolean {
  // Админы имеют доступ ко всем лидам
  if (request.userRole === 'admin') {
    return true;
  }

  // Консультант имеет доступ только к своим лидам
  if (request.userRole === 'consultant' && request.consultant) {
    return assignedConsultantId === request.consultant.id;
  }

  return false;
}

/**
 * Вспомогательная функция: проверяет что консультант имеет доступ к консультации
 */
export function checkConsultantConsultationAccess(
  request: ConsultantAuthRequest,
  consultantId: string
): boolean {
  // Админы имеют доступ ко всем консультациям
  if (request.userRole === 'admin') {
    return true;
  }

  // Консультант имеет доступ только к своим консультациям
  if (request.userRole === 'consultant' && request.consultant) {
    return consultantId === request.consultant.id;
  }

  return false;
}
