import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPlan } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { buildResultSignature } from '../lib/robokassa.js';
import { notifyPaymentSuccess } from '../bot.js';
import type { ApplyPaymentResult } from '../types.js';

const logger = createLogger({ module: 'robokassa-route' });

const ALMATY_OFFSET_HOURS = 5;

function getAlmatyTodayDateString(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + ALMATY_OFFSET_HOURS * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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

function getTarifCodeByMonths(months: number): string {
  if (months === 1) return 'subscription_1m';
  if (months === 3) return 'subscription_3m';
  if (months === 12) return 'subscription_12m';
  return `subscription_${months}m`;
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

function extractParam(source: Record<string, any>, key: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  return String(value);
}

export default async function robokassaRoutes(app: FastifyInstance) {
  const handleResult = async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = {
      ...(request.query as Record<string, any>),
      ...(request.body as Record<string, any> || {}),
    };

    const outSum = extractParam(payload, 'OutSum') || '';
    const invId = extractParam(payload, 'InvId') || extractParam(payload, 'InvoiceID') || '0';
    const signature = extractParam(payload, 'SignatureValue') || extractParam(payload, 'Signature') || '';
    const customParams = collectCustomParams(payload);
    const telegramIdRaw = customParams.shp_telegram_id;
    const planSlug = customParams.shp_plan;
    const paymentId = customParams.shp_payment_id;

    if (!outSum || !signature || !telegramIdRaw || !planSlug || !paymentId) {
      logger.warn({ outSum, invId, hasSig: Boolean(signature), telegramIdRaw, planSlug, paymentId }, 'Missing params');
      return reply.status(400).type('text/plain').send('Invalid params');
    }

    const plan = getPlan(planSlug);
    if (!plan) {
      return reply.status(400).type('text/plain').send('Unknown plan');
    }

    // Verify signature
    const expectedSignature = buildResultSignature({ outSum, invId, customParams });
    if (signature.trim().toLowerCase() !== expectedSignature.trim().toLowerCase()) {
      logger.warn({ invId, telegramIdRaw, plan: planSlug }, 'Signature mismatch');
      return reply.status(403).type('text/plain').send('Invalid signature');
    }

    const amountNumber = Number(outSum);
    if (!Number.isFinite(amountNumber) || Math.abs(amountNumber - plan.amount) > 0.01) {
      logger.warn({ invId, telegramIdRaw, plan: plan.slug, outSum }, 'OutSum mismatch');
      return reply.status(400).type('text/plain').send('OutSum mismatch');
    }

    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      return reply.status(400).type('text/plain').send('Invalid telegram_id');
    }

    const paymentIdParse = z.string().uuid().safeParse(paymentId);
    if (!paymentIdParse.success) {
      return reply.status(400).type('text/plain').send('Invalid payment_id');
    }

    // Calculate subscription dates
    // Check existing subscription for stacking
    const { data: existingSub } = await supabase
      .from('bot_subscriptions')
      .select('user_account_id')
      .eq('telegram_id', telegramId)
      .maybeSingle<{ user_account_id: string }>();

    let startDate = getAlmatyTodayDateString();

    if (existingSub) {
      const { data: user } = await supabase
        .from('user_accounts')
        .select('tarif_expires, created_at')
        .eq('id', existingSub.user_account_id)
        .maybeSingle<{ tarif_expires: string | null; created_at: string | null }>();

      if (user) {
        const currentExpiry = toDateString(user.tarif_expires);
        if (currentExpiry && currentExpiry > startDate) {
          startDate = currentExpiry;
        }
      }
    }

    const newTarif = getTarifCodeByMonths(plan.months);
    const newTarifExpires = addMonthsToDateString(startDate, plan.months);

    // Atomic payment application
    const { data: result, error: rpcError } = await supabase.rpc('apply_bot_subscription_payment', {
      p_telegram_id: telegramId,
      p_payment_id: paymentIdParse.data,
      p_plan_slug: plan.slug,
      p_months: plan.months,
      p_amount: plan.amount,
      p_out_sum: amountNumber,
      p_inv_id: String(invId),
      p_signature: signature,
      p_payload: payload,
      p_new_tarif: newTarif,
      p_new_tarif_expires: newTarifExpires,
    });

    if (rpcError) {
      logger.error({ invId, telegramId, error: rpcError.message }, 'Failed to apply payment');
      return reply.status(500).type('text/plain').send('Server error');
    }

    const parsed = result as ApplyPaymentResult & { duplicate?: boolean };

    if (parsed?.duplicate) {
      logger.info({ invId, telegramId }, 'Duplicate payment, skipping notification');
      return reply.type('text/plain').send(`OK${invId}`);
    }

    logger.info({
      invId, telegramId, plan: plan.slug,
      isNewUser: parsed?.is_new_user,
      tarifExpires: newTarifExpires,
    }, 'Payment applied successfully');

    // Send invite link to user (non-blocking)
    notifyPaymentSuccess(telegramId, plan, newTarifExpires).catch(err => {
      logger.error({ telegramId, error: err.message }, 'Failed to notify after payment');
    });

    return reply.type('text/plain').send(`OK${invId}`);
  };

  app.post('/robokassa/result', handleResult);
  app.get('/robokassa/result', handleResult);
}
