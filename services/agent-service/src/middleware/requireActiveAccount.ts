import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';

// Пути, доступные для неактивных аккаунтов (вебхуки + оплата)
const EXEMPT_PREFIXES = [
  '/auth',
  '/robokassa',
  '/facebook-webhook',
  '/evolution-webhook',
  '/waba-webhook',
  '/tiktok-webhook',
  '/telegram-webhook',
  '/support-bot-webhook',
  '/bizon-webhook',
  '/green-api-webhook',
  '/amocrm-webhook',
  '/bitrix24-webhook',
];

export async function requireActiveAccount(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.headers['x-user-id'] as string | undefined;
  if (!userId) return;

  const url = request.url.split('?')[0];

  // Вебхуки и оплата работают всегда
  if (EXEMPT_PREFIXES.some(p => url.startsWith(p))) return;

  // GET /ad-accounts/:id — нужен чтобы фронтенд узнал статус аккаунта
  if (request.method === 'GET' && /^\/ad-accounts\/[^/]+$/.test(url)) return;

  const { data } = await supabase
    .from('user_accounts')
    .select('is_active')
    .eq('id', userId)
    .maybeSingle();

  if (data && data.is_active === false) {
    return reply.status(403).send({
      error: 'SUBSCRIPTION_INACTIVE',
      message: 'Подписка истекла. Продлите подписку для продолжения работы.',
    });
  }
}
