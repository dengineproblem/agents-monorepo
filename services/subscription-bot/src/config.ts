import dotenv from 'dotenv';
dotenv.config();

export interface SubscriptionPlan {
  slug: string;
  months: number;
  amount: number;
  title: string;
  description: string;
}

// Placeholder plans — replace with real prices later
const PLAN_CONFIGS: Record<string, SubscriptionPlan> = {
  'sub-1m': {
    slug: 'sub-1m',
    months: 1,
    amount: 49000,
    title: 'Подписка 1 месяц',
    description: 'Подписка на 1 месяц',
  },
  'sub-3m': {
    slug: 'sub-3m',
    months: 3,
    amount: 99000,
    title: 'Подписка 3 месяца',
    description: 'Подписка на 3 месяца',
  },
  'sub-test': {
    slug: 'sub-test',
    months: 1,
    amount: 500,
    title: 'Тестовая оплата',
    description: 'Тестовая оплата 500 KZT',
  },
};

export function getPlan(slug: string): SubscriptionPlan | null {
  return PLAN_CONFIGS[slug] ?? null;
}

export function getAllPlans(): SubscriptionPlan[] {
  return Object.values(PLAN_CONFIGS).filter(p => p.slug !== 'sub-test');
}

export function getAllPlansIncludingTest(): SubscriptionPlan[] {
  return Object.values(PLAN_CONFIGS);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  communityChannelId: requireEnv('COMMUNITY_CHANNEL_ID'),

  roboMerchantLogin: requireEnv('ROBO_MERCHANT_LOGIN'),
  roboPassword1: requireEnv('ROBO_PASSWORD_1'),
  roboPassword2: requireEnv('ROBO_PASSWORD_2'),
  roboPayUrl: process.env.ROBO_PAY_URL || 'https://auth.robokassa.kz/Merchant/Index.aspx',
  roboIsTest: ['1', 'true', 'yes'].includes(String(process.env.ROBO_IS_TEST || '').toLowerCase()),
  roboResultUrl: process.env.ROBO_RESULT_URL || '',

  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRole: requireEnv('SUPABASE_SERVICE_ROLE'),

  port: Number(process.env.PORT || 8087),
  logLevel: process.env.LOG_LEVEL || 'info',

  cronEnabled: process.env.CRON_ENABLED !== 'false',
  expiryCronSchedule: process.env.EXPIRY_CRON_SCHEDULE || '0 3 * * *',
};
