/**
 * Синхронизация purchases → leads.sale_amount
 *
 * Единая точка пересчёта sale_amount в лидах после создания/обновления продажи.
 * Вызывается из: ручного ввода, AmoCRM webhook, CRM consultant sales.
 */

import { supabase } from './supabase.js';
import { normalizePhoneNumber } from './phoneNormalization.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'purchaseSync' });

export async function syncPurchasesToLeadSaleAmount(
  clientPhone: string,
  userAccountId: string
): Promise<{ totalAmount: number; updatedLeads: number }> {
  const digits = normalizePhoneNumber(clientPhone);

  if (!digits) {
    log.warn({ clientPhone, userAccountId }, 'Empty phone after normalization, skipping sync');
    return { totalAmount: 0, updatedLeads: 0 };
  }

  // 1. Считаем SUM(amount) всех purchases этого клиента в базе
  const { data: purchases, error: purchaseError } = await supabase
    .from('purchases')
    .select('amount')
    .eq('user_account_id', userAccountId)
    .ilike('client_phone', `%${digits.slice(-10)}%`);

  if (purchaseError) {
    log.error({ error: purchaseError, clientPhone, userAccountId }, 'Failed to fetch purchases for sync');
    throw purchaseError;
  }

  const totalAmount = (purchases || []).reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );

  // 2. Ищем все лиды по телефону (chat_id или phone)
  const chatIdCandidates = [
    digits,
    `${digits}@s.whatsapp.net`,
    `${digits}@c.us`,
  ];
  const phoneCandidates = [
    digits,
    `+${digits}`,
  ];

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id')
    .eq('user_account_id', userAccountId)
    .or(
      [
        ...chatIdCandidates.map(c => `chat_id.eq.${c}`),
        ...phoneCandidates.map(p => `phone.eq.${p}`),
      ].join(',')
    );

  if (leadsError) {
    log.error({ error: leadsError, clientPhone, userAccountId }, 'Failed to fetch leads for sync');
    throw leadsError;
  }

  if (!leads || leads.length === 0) {
    log.debug({ digits, userAccountId }, 'No matching leads found for phone, skipping sale_amount update');
    return { totalAmount, updatedLeads: 0 };
  }

  // 3. Обновляем sale_amount во всех найденных лидах
  const leadIds = leads.map(l => l.id);

  const { error: updateError } = await supabase
    .from('leads')
    .update({ sale_amount: totalAmount })
    .in('id', leadIds);

  if (updateError) {
    log.error({ error: updateError, leadIds, totalAmount }, 'Failed to update leads sale_amount');
    throw updateError;
  }

  log.info({
    clientPhone: digits,
    userAccountId,
    totalAmount,
    updatedLeads: leadIds.length
  }, 'Synced purchases to leads.sale_amount');

  return { totalAmount, updatedLeads: leadIds.length };
}
