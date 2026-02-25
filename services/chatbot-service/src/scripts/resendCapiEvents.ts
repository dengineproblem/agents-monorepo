/**
 * Ресенд CAPI событий для WhatsApp диалогов
 *
 * Проблема: до фикса от 24 фев события отправлялись как LeadSubmitted,
 * что не работает для business_messaging. Facebook не матчит такие события.
 *
 * Скрипт:
 * 1. Находит dialog_analysis записи для whatsapp-конверсионных направлений
 *    где флаги capi_*_sent = true (уже отправлено, но неправильно)
 * 2. Сбрасывает флаги → false
 * 3. Напрямую отправляет Purchase события через Meta CAPI
 *
 * Запуск:
 *   npx tsx src/scripts/resendCapiEvents.ts
 *   или на сервере:
 *   docker exec agents-monorepo-chatbot-service-1 node dist/scripts/resendCapiEvents.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { supabase } from '../lib/supabase.js';

const CAPI_BASE_URL = process.env.META_CAPI_URL || 'https://graph.facebook.com/v20.0';
const WHATSAPP_LEVEL_VALUES: Record<number, number> = { 1: 1, 2: 10, 3: 100 };
const PURCHASE_CURRENCY = 'KZT';

function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function sendPurchaseEvent(params: {
  pixelId: string;
  accessToken: string;
  phone: string;
  ctwaClid: string;
  pageId: string;
  level: number;
  dialogId: string;
}): Promise<{ success: boolean; eventsReceived?: number; error?: string }> {
  const { pixelId, accessToken, phone, ctwaClid, pageId, level, dialogId } = params;
  const eventTime = Math.floor(Date.now() / 1000);
  const value = WHATSAPP_LEVEL_VALUES[level] ?? 1;
  const eventId = `resend_${dialogId}_L${level}_${eventTime}`;
  const hashedPhone = hashSha256(normalizePhone(phone));

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      event_id: eventId,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: {
        ph: [hashedPhone],
        page_id: pageId,
        ctwa_clid: ctwaClid,
      },
      custom_data: {
        currency: PURCHASE_CURRENCY,
        value,
      },
    }],
  };

  const url = `${CAPI_BASE_URL}/${pixelId}/events?access_token=${accessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as any;
  if (!res.ok || data.error) {
    return { success: false, error: data.error?.message || `HTTP ${res.status}` };
  }
  return { success: true, eventsReceived: data.events_received };
}

async function main() {
  console.log('=== CAPI Resend Script ===');
  console.log('Ищем диалоги с неправильно отправленными CAPI событиями...\n');

  // 1. Получаем все whatsapp-конверсионные направления
  const { data: directions, error: dirError } = await supabase
    .from('account_directions')
    .select('id, user_account_id, name')
    .eq('objective', 'conversions')
    .eq('conversion_channel', 'whatsapp')
    .eq('is_active', true);

  if (dirError || !directions?.length) {
    console.error('Нет WhatsApp конверсионных направлений:', dirError?.message);
    return;
  }

  console.log(`Найдено направлений: ${directions.length}`);
  directions.forEach(d => console.log(`  - ${d.name} (${d.id})`));

  for (const direction of directions) {
    console.log(`\n--- Обрабатываем направление: ${direction.name} ---`);

    // 2. Получаем CAPI settings
    const { data: capiSettings } = await supabase
      .from('capi_settings')
      .select('pixel_id, capi_access_token')
      .eq('user_account_id', direction.user_account_id)
      .eq('channel', 'whatsapp')
      .eq('is_active', true)
      .maybeSingle();

    if (!capiSettings?.pixel_id || !capiSettings?.capi_access_token) {
      console.log(`  Нет CAPI настроек, пропускаем`);
      continue;
    }

    // 3. Получаем page_id из capi_settings или user_accounts
    const { data: userAccount } = await supabase
      .from('user_accounts')
      .select('page_id')
      .eq('id', direction.user_account_id)
      .single();

    const pageId = userAccount?.page_id;
    if (!pageId) {
      console.log(`  Нет page_id, пропускаем`);
      continue;
    }

    // 4. Находим диалоги где хоть один флаг true И есть ctwa_clid
    const { data: dialogs, error: dialogsError } = await supabase
      .from('dialog_analysis')
      .select('id, contact_phone, ctwa_clid, capi_interest_sent, capi_qualified_sent, capi_scheduled_sent')
      .eq('direction_id', direction.id)
      .not('ctwa_clid', 'is', null)
      .or('capi_interest_sent.eq.true,capi_qualified_sent.eq.true,capi_scheduled_sent.eq.true');

    if (dialogsError) {
      console.error(`  Ошибка загрузки диалогов: ${dialogsError.message}`);
      continue;
    }

    console.log(`  Диалогов с отправленными событиями: ${dialogs?.length || 0}`);

    for (const dialog of dialogs || []) {
      if (!dialog.ctwa_clid) continue;

      console.log(`\n  Диалог ${dialog.id} (${dialog.contact_phone}):`);
      console.log(`    ctwa_clid: ${dialog.ctwa_clid.slice(0, 20)}...`);
      console.log(`    interest_sent=${dialog.capi_interest_sent}, qualified_sent=${dialog.capi_qualified_sent}, scheduled_sent=${dialog.capi_scheduled_sent}`);

      // Определяем максимальный уровень который был отправлен
      let maxLevel = 0;
      if (dialog.capi_interest_sent) maxLevel = 1;
      if (dialog.capi_qualified_sent) maxLevel = 2;
      if (dialog.capi_scheduled_sent) maxLevel = 3;

      // 5. Сбрасываем все флаги
      const { error: resetError } = await supabase
        .from('dialog_analysis')
        .update({
          capi_interest_sent: false,
          capi_qualified_sent: false,
          capi_scheduled_sent: false,
          capi_interest_sent_at: null,
          capi_qualified_sent_at: null,
          capi_scheduled_sent_at: null,
        })
        .eq('id', dialog.id);

      if (resetError) {
        console.error(`    Ошибка сброса флагов: ${resetError.message}`);
        continue;
      }
      console.log(`    Флаги сброшены`);

      // 6. Отправляем Purchase события за каждый уровень который был достигнут
      for (let level = 1; level <= maxLevel; level++) {
        const result = await sendPurchaseEvent({
          pixelId: capiSettings.pixel_id,
          accessToken: capiSettings.capi_access_token,
          phone: dialog.contact_phone,
          ctwaClid: dialog.ctwa_clid,
          pageId,
          level,
          dialogId: dialog.id,
        });

        if (result.success) {
          console.log(`    ✓ L${level} Purchase отправлен (value=${WHATSAPP_LEVEL_VALUES[level]}, events_received=${result.eventsReceived})`);

          // Обновляем флаги в БД
          const flagColumn = ['capi_interest_sent', 'capi_qualified_sent', 'capi_scheduled_sent'][level - 1];
          const flagAtColumn = `${flagColumn}_at`;
          await supabase
            .from('dialog_analysis')
            .update({ [flagColumn]: true, [flagAtColumn]: new Date().toISOString() })
            .eq('id', dialog.id);
        } else {
          console.error(`    ✗ L${level} Purchase ошибка: ${result.error}`);
          // Не восстанавливаем флаг — следующий cron отправит
        }

        // Небольшая задержка между запросами
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  console.log('\n=== Готово ===');
}

main().catch(e => { console.error(e); process.exit(1); });
