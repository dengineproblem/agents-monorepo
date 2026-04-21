import { supabase } from './supabase.js';
import type { FastifyBaseLogger } from 'fastify';

// Codes treated as "задолженность" — block creative upload/import.
// 3 = UNSETTLED, 9 = IN_GRACE_PERIOD
export const BLOCKING_ACCOUNT_STATUS_CODES = new Set<number>([3, 9]);

export type EligibilityReason =
  | 'ok'
  | 'account_unsettled'         // code 3
  | 'account_grace_period'      // code 9
  | 'account_not_found'
  | 'credentials_missing'
  | 'status_unknown';           // FB API недоступен — fail-open

export interface UploadEligibility {
  canUpload: boolean;
  reason: EligibilityReason;
  message: string | null;
  accountStatus: number | null;
  fbAdAccountId: string | null;
}

interface ResolvedCredentials {
  accessToken: string;
  fbAdAccountId: string;
}

async function resolveMetaCredentials(
  userId: string,
  accountId: string | null | undefined
): Promise<ResolvedCredentials | null> {
  const { data: userAccount } = await supabase
    .from('user_accounts')
    .select('multi_account_enabled, access_token, ad_account_id')
    .eq('id', userId)
    .single();

  if (!userAccount) return null;

  if (userAccount.multi_account_enabled) {
    if (!accountId) return null;
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('access_token, ad_account_id')
      .eq('id', accountId)
      .eq('user_account_id', userId)
      .single();
    if (!adAccount?.access_token || !adAccount.ad_account_id) return null;
    return { accessToken: adAccount.access_token, fbAdAccountId: adAccount.ad_account_id };
  }

  if (!userAccount.access_token || !userAccount.ad_account_id) return null;
  return { accessToken: userAccount.access_token, fbAdAccountId: userAccount.ad_account_id };
}

async function fetchStatus(
  fbAdAccountId: string,
  accessToken: string,
  log: FastifyBaseLogger
): Promise<number | null> {
  const normalized = fbAdAccountId.startsWith('act_') ? fbAdAccountId : `act_${fbAdAccountId}`;
  const url = new URL(`https://graph.facebook.com/v18.0/${normalized}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('fields', 'account_status');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      log.warn({ status: response.status }, '[uploadEligibility] FB status fetch failed');
      return null;
    }
    const data = await response.json();
    return typeof data.account_status === 'number' ? data.account_status : null;
  } catch (err: any) {
    log.warn({ err: err?.message }, '[uploadEligibility] FB status fetch error');
    return null;
  }
}

function reasonFromCode(code: number): { reason: EligibilityReason; message: string } {
  if (code === 3) {
    return {
      reason: 'account_unsettled',
      message: 'Рекламный кабинет имеет задолженность. Погасите долг в Ads Manager, чтобы возобновить загрузку креативов.',
    };
  }
  if (code === 9) {
    return {
      reason: 'account_grace_period',
      message: 'Рекламный кабинет в grace-периоде из-за неоплаты. Оплатите задолженность, чтобы не потерять доступ.',
    };
  }
  return { reason: 'ok', message: '' };
}

/**
 * Check whether the user may upload or import creatives to the currently selected Meta ad account.
 *
 * Fail-open policy: if the FB API is unreachable we return `canUpload: true` with reason
 * `status_unknown`. We do NOT block users on transient errors — upload will still fail
 * at the actual FB call if the account is truly unsettled.
 */
export async function checkUploadEligibility(
  userId: string,
  accountId: string | null | undefined,
  log: FastifyBaseLogger
): Promise<UploadEligibility> {
  const creds = await resolveMetaCredentials(userId, accountId);
  if (!creds) {
    return {
      canUpload: false,
      reason: 'credentials_missing',
      message: 'Facebook credentials не найдены. Подключите рекламный аккаунт.',
      accountStatus: null,
      fbAdAccountId: null,
    };
  }

  const code = await fetchStatus(creds.fbAdAccountId, creds.accessToken, log);
  if (code === null) {
    return {
      canUpload: true,
      reason: 'status_unknown',
      message: null,
      accountStatus: null,
      fbAdAccountId: creds.fbAdAccountId,
    };
  }

  if (BLOCKING_ACCOUNT_STATUS_CODES.has(code)) {
    const { reason, message } = reasonFromCode(code);
    return {
      canUpload: false,
      reason,
      message,
      accountStatus: code,
      fbAdAccountId: creds.fbAdAccountId,
    };
  }

  return {
    canUpload: true,
    reason: 'ok',
    message: null,
    accountStatus: code,
    fbAdAccountId: creds.fbAdAccountId,
  };
}
