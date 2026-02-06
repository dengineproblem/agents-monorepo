import crypto from 'crypto';

export type RobokassaPlanSlug = '1m-49k' | '3m-99k' | '1m-35k' | 'test-500';

export interface RobokassaPlanConfig {
  slug: RobokassaPlanSlug;
  months: number;
  amount: number;
  description: string;
  title: string;
}

const ROBO_MERCHANT_LOGIN = process.env.ROBO_MERCHANT_LOGIN || '';
const ROBO_PASSWORD_1 = process.env.ROBO_PASSWORD_1 || '';
const ROBO_PASSWORD_2 = process.env.ROBO_PASSWORD_2 || '';
const ROBO_FORM_URL = process.env.ROBO_FORM_URL || 'https://auth.robokassa.kz/Merchant/PaymentForm/FormSS.js';
const ROBO_PAY_URL = process.env.ROBO_PAY_URL || 'https://auth.robokassa.kz/Merchant/Index.aspx';
const ROBO_IS_TEST = ['1', 'true', 'yes'].includes(String(process.env.ROBO_IS_TEST || '').toLowerCase());

const PLAN_CONFIGS: Record<RobokassaPlanSlug, RobokassaPlanConfig> = {
  '1m-49k': {
    slug: '1m-49k',
    months: 1,
    amount: 49000,
    title: 'Tariff 1 month',
    description: 'Тариф 1 месяц',
  },
  '3m-99k': {
    slug: '3m-99k',
    months: 3,
    amount: 99000,
    title: 'Tariff 3 months',
    description: 'Тариф на 3 месяца',
  },
  '1m-35k': {
    slug: '1m-35k',
    months: 1,
    amount: 35000,
    title: 'Tariff 1 month (special)',
    description: 'Тариф 1 месяц',
  },
  'test-500': {
    slug: 'test-500',
    months: 1,
    amount: 500,
    title: 'Tariff test 500',
    description: 'Тестовая оплата 500 KZT',
  },
};

export function isRobokassaConfigured(): boolean {
  return Boolean(ROBO_MERCHANT_LOGIN && ROBO_PASSWORD_1 && ROBO_PASSWORD_2);
}

export function getRobokassaConfig() {
  return {
    merchantLogin: ROBO_MERCHANT_LOGIN,
    password1: ROBO_PASSWORD_1,
    password2: ROBO_PASSWORD_2,
    formUrl: ROBO_FORM_URL,
    payUrl: ROBO_PAY_URL,
    isTest: ROBO_IS_TEST,
  };
}

export function getPlanConfig(plan: string | undefined | null): RobokassaPlanConfig | null {
  if (!plan) return null;
  if (plan in PLAN_CONFIGS) {
    return PLAN_CONFIGS[plan as RobokassaPlanSlug];
  }
  return null;
}

function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

function isShpParam(key: string): boolean {
  return key.toLowerCase().startsWith('shp_');
}

function formatCustomParams(customParams: Record<string, string>): string {
  const entries = Object.entries(customParams)
    .filter(([key]) => isShpParam(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  return entries.join(':');
}

export function buildFormSignature(params: {
  outSum: string;
  invId: string;
  customParams: Record<string, string>;
}): string {
  const { merchantLogin, password1 } = getRobokassaConfig();
  const custom = formatCustomParams(params.customParams);
  const base = [merchantLogin, params.outSum, params.invId, password1, custom].filter(Boolean).join(':');
  return md5(base);
}

export function buildResultSignature(params: {
  outSum: string;
  invId: string;
  customParams: Record<string, string>;
}): string {
  const { password2 } = getRobokassaConfig();
  const custom = formatCustomParams(params.customParams);
  const base = [params.outSum, params.invId, password2, custom].filter(Boolean).join(':');
  return md5(base);
}

export function buildPaymentFormScriptSrc(params: {
  plan: RobokassaPlanConfig;
  userId: string;
  paymentId: string;
  invId?: string;
}): string {
  const { merchantLogin, formUrl, isTest } = getRobokassaConfig();
  const invId = params.invId ?? '0';
  const outSum = String(params.plan.amount);
  const customParams = {
    shp_user_id: params.userId,
    shp_plan: params.plan.slug,
    shp_payment_id: params.paymentId,
    shp_interface: 'field',
  };

  const signature = buildFormSignature({ outSum, invId, customParams });
  const urlParams = new URLSearchParams({
    MerchantLogin: merchantLogin,
    OutSum: outSum,
    InvoiceID: invId,
    Description: params.plan.description,
    Culture: 'ru',
    Encoding: 'utf-8',
    SignatureValue: signature,
    ...customParams,
  });

  if (isTest) {
    urlParams.set('IsTest', '1');
  }

  return `${formUrl}?${urlParams.toString()}`;
}

export function buildPaymentPageUrl(params: {
  plan: RobokassaPlanConfig;
  userId: string;
  paymentId: string;
  invId?: string;
}): string {
  const { merchantLogin, payUrl, isTest } = getRobokassaConfig();
  const invId = params.invId ?? '0';
  const outSum = String(params.plan.amount);
  const customParams = {
    shp_user_id: params.userId,
    shp_plan: params.plan.slug,
    shp_payment_id: params.paymentId,
  };

  const signature = buildFormSignature({ outSum, invId, customParams });
  const urlParams = new URLSearchParams({
    MerchantLogin: merchantLogin,
    OutSum: outSum,
    InvId: invId,
    Description: params.plan.description,
    Culture: 'ru',
    SignatureValue: signature,
    ...customParams,
  });
  urlParams.append('InvoiceID', invId);

  if (isTest) {
    urlParams.set('IsTest', '1');
  }

  return `${payUrl}?${urlParams.toString()}`;
}
