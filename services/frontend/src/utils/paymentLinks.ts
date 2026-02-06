export type PaymentPlanSlug = '1m-49k' | '3m-99k' | '1m-35k' | 'test-500';

const PAYMENT_PATHS: Record<PaymentPlanSlug, string> = {
  '1m-49k': '/pay/1m-49k',
  '3m-99k': '/pay/3m-99k',
  '1m-35k': '/pay/1m-35k',
  'test-500': '/pay/test-500',
};

export function resolvePaymentPlanSlug(params: {
  tarif?: string | null;
  renewalCost?: number | null;
}): PaymentPlanSlug | null {
  const cost = params.renewalCost !== null && params.renewalCost !== undefined
    ? Number(params.renewalCost)
    : null;

  if (cost === 35000) return '1m-35k';
  if (cost === 49000) return '1m-49k';
  if (cost === 99000) return '3m-99k';
  if (cost === 500) return 'test-500';

  if (params.tarif === 'subscription_1m') return '1m-49k';
  if (params.tarif === 'subscription_3m') return '3m-99k';

  return null;
}

export function buildPaymentPath(params: {
  tarif?: string | null;
  renewalCost?: number | null;
}): string | null {
  const slug = resolvePaymentPlanSlug(params);
  if (!slug) return null;
  return PAYMENT_PATHS[slug];
}

export function buildPaymentRedirectUrl(params: {
  tarif?: string | null;
  renewalCost?: number | null;
  userId?: string | null;
  apiBaseUrl: string;
}): string | null {
  const slug = resolvePaymentPlanSlug(params);
  if (!slug) return null;
  if (!params.userId) return null;
  const base = params.apiBaseUrl.replace(/\/$/, '');
  const qs = new URLSearchParams({
    plan: slug,
    user_id: params.userId,
  });
  return `${base}/robokassa/redirect?${qs.toString()}`;
}
