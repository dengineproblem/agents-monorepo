import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import {
  buildPaymentFormScriptSrc,
  buildPaymentPageUrl,
  buildResultSignature,
  getPlanConfig,
  isRobokassaConfigured
} from '../lib/robokassa.js';
import { sendTelegramNotification, sendCommunityNotification, createChatInviteLink } from '../lib/telegramNotifier.js';

const logger = createLogger({ module: 'robokassaRoutes' });

const uuidSchema = z.string().uuid();
const planSchema = z.string().min(1);

const ALMATY_OFFSET_HOURS = 5;
const FORCE_INV_ID = (process.env.ROBO_FORCE_INV_ID || '').trim();

function generateInvId(): string {
  if (FORCE_INV_ID) {
    return FORCE_INV_ID;
  }
  return '0';
}

function getAlmatyTodayDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + ALMATY_OFFSET_HOURS * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function addMonthsToDateString(dateString: string, months: number): string {
  const [y, m, d] = dateString.split('-').map(Number);
  const result = new Date(Date.UTC(y, m - 1, d));
  const originalDay = result.getUTCDate();

  result.setUTCMonth(result.getUTCMonth() + months);

  if (result.getUTCDate() !== originalDay) {
    result.setUTCDate(0);
  }

  return result.toISOString().slice(0, 10);
}

function resolveSubscriptionStartDate(args: {
  currentTarifExpires: string | null;
  userCreatedAt: string | null;
  today: string;
}): string {
  const currentExpiry = toDateString(args.currentTarifExpires);
  if (currentExpiry && currentExpiry > args.today) {
    return currentExpiry;
  }

  const createdAt = toDateString(args.userCreatedAt);
  if (createdAt) {
    return createdAt;
  }

  return args.today;
}

function getTarifCodeByMonths(months: number): string {
  if (months === 1) return 'subscription_1m';
  if (months === 3) return 'subscription_3m';
  if (months === 12) return 'subscription_12m';
  return `subscription_${months}m`;
}

function extractParam(source: Record<string, any>, key: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  return String(value);
}

function collectCustomParams(source: Record<string, any>): Record<string, string> {
  const customParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase().startsWith('shp_')) {
      customParams[key] = String(value);
    }
  }
  return customParams;
}

function normalizeSignature(value: string | null): string {
  return (value || '').trim().toLowerCase();
}

export default async function robokassaRoutes(app: FastifyInstance) {
  app.get('/robokassa/form', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRobokassaConfigured()) {
      return reply.status(500).send({ error: 'Robokassa credentials are not configured' });
    }

    const query = request.query as Record<string, any>;
    const planRaw = extractParam(query, 'plan');
    const userIdRaw = extractParam(query, 'user_id') || extractParam(request.headers as any, 'x-user-id');

    const planParse = planSchema.safeParse(planRaw);
    const userParse = uuidSchema.safeParse(userIdRaw);

    if (!planParse.success || !userParse.success) {
      return reply.status(400).send({ error: 'Invalid plan or user_id' });
    }

    const plan = getPlanConfig(planParse.data);
    if (!plan) {
      return reply.status(400).send({ error: 'Unknown plan' });
    }

    const { data: user, error: userError } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('id', userParse.data)
      .maybeSingle<{ id: string }>();

    if (userError || !user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const paymentId = crypto.randomUUID();
    const invId = generateInvId();
    const scriptSrc = buildPaymentFormScriptSrc({
      plan,
      userId: user.id,
      paymentId,
      invId
    });

    return reply.send({
      plan: plan.slug,
      amount: plan.amount,
      description: plan.description,
      script_src: scriptSrc,
    });
  });

  app.get('/robokassa/redirect', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRobokassaConfigured()) {
      return reply.status(500).type('text/plain').send('Robokassa credentials are not configured');
    }

    const query = request.query as Record<string, any>;
    const planRaw = extractParam(query, 'plan');
    const userIdRaw = extractParam(query, 'user_id') || extractParam(request.headers as any, 'x-user-id');

    const planParse = planSchema.safeParse(planRaw);
    const userParse = uuidSchema.safeParse(userIdRaw);

    if (!planParse.success || !userParse.success) {
      return reply.status(400).type('text/plain').send('Invalid plan or user_id');
    }

    const plan = getPlanConfig(planParse.data);
    if (!plan) {
      return reply.status(400).type('text/plain').send('Unknown plan');
    }

    const { data: user, error: userError } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('id', userParse.data)
      .maybeSingle<{ id: string }>();

    if (userError || !user) {
      return reply.status(404).type('text/plain').send('User not found');
    }

    const paymentId = crypto.randomUUID();
    const invId = generateInvId();
    const scriptSrc = buildPaymentFormScriptSrc({
      plan,
      userId: user.id,
      paymentId,
      invId
    });

    const redirectUrl = buildPaymentPageUrl({
      plan,
      userId: user.id,
      paymentId,
      invId
    });
    return reply.redirect(redirectUrl);
  });

  const handleResult = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isRobokassaConfigured()) {
      return reply.status(500).type('text/plain').send('Robokassa not configured');
    }

    const payload = {
      ...(request.query as Record<string, any>),
      ...(request.body as Record<string, any>),
    };

    const outSum = extractParam(payload, 'OutSum') || '';
    const invId = extractParam(payload, 'InvId') || extractParam(payload, 'InvoiceID') || '0';
    const signature = extractParam(payload, 'SignatureValue') || extractParam(payload, 'Signature') || '';
    const customParams = collectCustomParams(payload);
    const userId = customParams.shp_user_id;
    const planSlug = customParams.shp_plan;
    const paymentId = customParams.shp_payment_id;

    if (!outSum || !signature || !userId || !planSlug || !paymentId) {
      logger.warn({ outSum, invId, hasSignature: Boolean(signature), userId, planSlug, paymentId }, 'Missing Robokassa params');
      return reply.status(400).type('text/plain').send('Invalid params');
    }

    const plan = getPlanConfig(planSlug);
    if (!plan) {
      return reply.status(400).type('text/plain').send('Unknown plan');
    }

    const expectedSignature = buildResultSignature({
      outSum,
      invId,
      customParams
    });

    if (normalizeSignature(signature) !== normalizeSignature(expectedSignature)) {
      logger.warn({ invId, userId, plan: planSlug }, 'Robokassa signature mismatch');
      return reply.status(403).type('text/plain').send('Invalid signature');
    }

    const amountNumber = Number(outSum);
    if (!Number.isFinite(amountNumber)) {
      return reply.status(400).type('text/plain').send('Invalid OutSum');
    }

    if (Math.abs(amountNumber - plan.amount) > 0.01) {
      logger.warn({ invId, userId, plan: plan.slug, outSum }, 'OutSum mismatch');
      return reply.status(400).type('text/plain').send('OutSum mismatch');
    }

    const userParse = uuidSchema.safeParse(userId);
    if (!userParse.success) {
      return reply.status(400).type('text/plain').send('Invalid user_id');
    }

    const paymentParse = uuidSchema.safeParse(paymentId);
    if (!paymentParse.success) {
      return reply.status(400).type('text/plain').send('Invalid payment_id');
    }

    const { data: user, error: userError } = await supabase
      .from('user_accounts')
      .select('id, created_at, tarif_expires')
      .eq('id', userParse.data)
      .maybeSingle<{ id: string; created_at: string | null; tarif_expires: string | null }>();

    if (userError || !user) {
      return reply.status(404).type('text/plain').send('User not found');
    }

    const todayAlmaty = getAlmatyTodayDateString();
    const startDate = resolveSubscriptionStartDate({
      currentTarifExpires: user.tarif_expires,
      userCreatedAt: user.created_at,
      today: todayAlmaty
    });
    const newTarif = getTarifCodeByMonths(plan.months);
    const newTarifExpires = addMonthsToDateString(startDate, plan.months);

    const { data: applied, error: rpcError } = await supabase.rpc('apply_robokassa_payment', {
      p_payment_id: paymentParse.data,
      p_user_account_id: user.id,
      p_plan_slug: plan.slug,
      p_months: plan.months,
      p_amount: plan.amount,
      p_out_sum: amountNumber,
      p_inv_id: String(invId),
      p_signature: signature,
      p_payload: payload,
      p_new_tarif: newTarif,
      p_new_tarif_expires: newTarifExpires
    });

    if (rpcError) {
      logger.error({ invId, userId, error: rpcError.message }, 'Failed to apply Robokassa payment');
      return reply.status(500).type('text/plain').send('Server error');
    }

    if (applied === false) {
      return reply.type('text/plain').send(`OK${invId}`);
    }

    const notificationMessage = `Оплата получена. Подписка активна до ${newTarifExpires}.`;
    const { error: notifyError } = await supabase
      .from('user_notifications')
      .insert({
        user_account_id: user.id,
        type: 'subscription_payment',
        title: 'Оплата получена',
        message: notificationMessage,
        metadata: {
          payment_id: paymentParse.data,
          plan: plan.slug,
          amount: plan.amount,
          tarif_expires: newTarifExpires
        }
      });

    if (notifyError) {
      logger.warn({ userId: user.id, error: notifyError.message }, 'Failed to create payment notification');
    }

    // Send Telegram notification about successful payment
    try {
      const { data: userTg } = await supabase
        .from('user_accounts')
        .select('telegram_id')
        .eq('id', user.id)
        .maybeSingle<{ telegram_id: string | null }>();

      if (userTg?.telegram_id) {
        const formattedDate = newTarifExpires.split('-').reverse().join('.');
        await sendTelegramNotification(userTg.telegram_id,
          `✅ Оплата получена! Подписка активна до ${formattedDate}.\n\nОтправьте любое сообщение боту для продолжения настройки.`,
          { userAccountId: user.id, source: 'bot' }
        );
        logger.info({ userId: user.id, telegramId: userTg.telegram_id }, 'Payment TG notification sent');

        // Отправить инвайт-ссылку в закрытый канал комьюнити
        const communityChannelId = process.env.COMMUNITY_CHANNEL_ID;
        if (communityChannelId) {
          const inviteLink = await createChatInviteLink(communityChannelId);
          if (inviteLink) {
            await sendCommunityNotification(userTg.telegram_id,
              `🔗 Ваша одноразовая ссылка для входа в закрытый канал комьюнити:`
            );
            await sendCommunityNotification(userTg.telegram_id, inviteLink);
            await supabase.from('user_accounts')
              .update({ community_channel_invited: true })
              .eq('id', user.id);
            logger.info({ userId: user.id }, 'Community invite link sent');
          }
        }
      }
    } catch (tgErr: any) {
      logger.warn({ userId: user.id, error: tgErr.message }, 'Failed to send TG payment notification');
    }

    return reply.type('text/plain').send(`OK${invId}`);
  };

  app.post('/robokassa/result', handleResult);
  app.get('/robokassa/result', handleResult);
}
