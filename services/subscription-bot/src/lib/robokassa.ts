import crypto from 'crypto';
import { config, type SubscriptionPlan } from '../config.js';

function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

function formatCustomParams(customParams: Record<string, string>): string {
  return Object.entries(customParams)
    .filter(([key]) => key.toLowerCase().startsWith('shp_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(':');
}

export function buildFormSignature(params: {
  outSum: string;
  invId: string;
  customParams: Record<string, string>;
}): string {
  const custom = formatCustomParams(params.customParams);
  const base = [config.roboMerchantLogin, params.outSum, params.invId, config.roboPassword1, custom]
    .filter(Boolean)
    .join(':');
  return md5(base);
}

export function buildResultSignature(params: {
  outSum: string;
  invId: string;
  customParams: Record<string, string>;
}): string {
  const custom = formatCustomParams(params.customParams);
  const base = [params.outSum, params.invId, config.roboPassword2, custom]
    .filter(Boolean)
    .join(':');
  return md5(base);
}

export function buildPaymentPageUrl(params: {
  plan: SubscriptionPlan;
  telegramId: number;
  paymentId: string;
}): string {
  const invId = '0';
  const outSum = String(params.plan.amount);
  const customParams: Record<string, string> = {
    shp_payment_id: params.paymentId,
    shp_plan: params.plan.slug,
    shp_telegram_id: String(params.telegramId),
  };

  const signature = buildFormSignature({ outSum, invId, customParams });

  const urlParams = new URLSearchParams({
    MerchantLogin: config.roboMerchantLogin,
    OutSum: outSum,
    InvId: invId,
    Description: params.plan.description,
    Culture: 'ru',
    SignatureValue: signature,
    ...customParams,
  });

  if (config.roboIsTest) {
    urlParams.set('IsTest', '1');
  }

  if (config.roboResultUrl) {
    urlParams.set('ResultURL', `${config.roboResultUrl}/robokassa/result`);
  }

  return `${config.roboPayUrl}?${urlParams.toString()}`;
}
