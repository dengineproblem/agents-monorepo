/**
 * TikTok Webhooks
 *
 * Обработка webhook-событий от TikTok:
 * - Lead Generation: получение лидов из Instant Forms
 *
 * Webhook URL: https://performanteaiagency.com/api/tiktok/webhook
 * Настройка в TikTok Developer Portal → Events → Lead Generation
 *
 * Безопасность:
 * - HMAC-SHA256 верификация подписи (x-tiktok-signature)
 * - Проверка дублей по external_lead_id перед обработкой
 * - Маскирование PII в логах
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { normalizePhone } from '../adapters/bitrix24.js';

const log = createLogger({ module: 'tiktokWebhooks' });

// Webhook secret из TikTok Developer Portal
const TIKTOK_WEBHOOK_SECRET = process.env.TIKTOK_WEBHOOK_SECRET;

/**
 * Верификация HMAC-SHA256 подписи от TikTok
 */
function verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
  if (!TIKTOK_WEBHOOK_SECRET) {
    // Если secret не настроен - логируем предупреждение, но пропускаем
    // (для обратной совместимости на время настройки)
    log.warn({}, '[tiktokWebhooks] TIKTOK_WEBHOOK_SECRET not configured, skipping signature verification');
    return true;
  }

  if (!signature) {
    log.warn({}, '[tiktokWebhooks] Missing x-tiktok-signature header');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', TIKTOK_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    // Используем timingSafeEqual для защиты от timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (err) {
    log.error({ err }, '[tiktokWebhooks] Error verifying signature');
    return false;
  }
}

/**
 * Безопасное маскирование телефона (последние 4 цифры)
 */
function maskPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 4) return '****';
  return '***' + phone.slice(-4);
}

/**
 * Безопасное маскирование email
 */
function maskEmail(email: string | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local?.slice(0, 2) || ''}***@${domain}`;
}

interface TikTokWebhookVerification {
  challenge: string;
}

interface TikTokLeadData {
  lead_id: string;
  page_id: string;
  ad_id?: string;
  adgroup_id?: string;
  campaign_id?: string;
  advertiser_id: string;
  create_time: string;
  field_data: Array<{
    field_name: string;
    field_value: string;
  }>;
}

interface TikTokWebhookEvent {
  event_type: string;
  timestamp: number;
  data: TikTokLeadData;
}

export default async function tiktokWebhooks(app: FastifyInstance) {

  /**
   * GET /tiktok/webhook
   *
   * Верификация webhook URL от TikTok
   * TikTok отправляет GET запрос с challenge, нужно вернуть его обратно
   */
  app.get('/tiktok/webhook', async (
    req: FastifyRequest<{ Querystring: TikTokWebhookVerification }>,
    res
  ) => {
    const { challenge } = req.query;

    log.info({
      challenge_preview: challenge ? `${challenge.substring(0, Math.min(20, challenge.length))}...` : null,
      challenge_length: challenge?.length,
      ip: req.ip,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type']
      }
    }, '[tiktokWebhooks] Webhook verification request received');

    if (!challenge) {
      log.warn({ ip: req.ip }, '[tiktokWebhooks] Missing challenge parameter');
      return res.code(400).send({ error: 'Missing challenge parameter' });
    }

    log.info({
      challenge_length: challenge.length
    }, '[tiktokWebhooks] ✅ Challenge verified, returning response');

    // Возвращаем challenge как plain text для верификации
    return res.type('text/plain').send(challenge);
  });

  /**
   * POST /tiktok/webhook
   *
   * Получение событий от TikTok (лиды, конверсии и т.д.)
   *
   * Безопасность:
   * - Верификация HMAC-SHA256 подписи
   * - Проверка дублей перед обработкой
   */
  app.post('/tiktok/webhook', {
    config: {
      rawBody: true  // Сохраняем raw body для верификации подписи
    }
  }, async (
    req: FastifyRequest,
    res
  ) => {
    const correlationId = randomUUID();
    const startTime = Date.now();
    const event = req.body as TikTokWebhookEvent;

    // Детальное логирование входящего запроса
    log.info({
      correlationId,
      event_type: event?.event_type,
      timestamp: event?.timestamp,
      has_data: !!event?.data,
      ip: req.ip,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        'x-tiktok-signature': req.headers['x-tiktok-signature'] ? 'present' : 'missing'
      },
      raw_event_keys: event ? Object.keys(event) : [],
      data_keys: event?.data ? Object.keys(event.data) : []
    }, '[tiktokWebhooks] 📥 Received webhook event');

    // Верификация подписи (используем ОРИГИНАЛЬНЫЙ raw body, а не JSON.stringify)
    // JSON.stringify(req.body) может изменить порядок ключей/пробелы → HMAC не совпадёт
    const signature = req.headers['x-tiktok-signature'] as string | undefined;
    const rawBodyBuffer = (req as any).rawBody as Buffer | undefined;
    const rawBody = rawBodyBuffer ? rawBodyBuffer.toString('utf8') : JSON.stringify(req.body);

    if (!rawBodyBuffer) {
      log.warn({ correlationId }, '[tiktokWebhooks] rawBody not available from content parser, falling back to JSON.stringify');
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      log.warn({
        correlationId,
        ip: req.ip,
        hasSignature: !!signature
      }, '[tiktokWebhooks] ⛔ Invalid webhook signature - rejecting request');

      // Возвращаем 403 для невалидных подписей
      return res.code(403).send({ error: 'Invalid signature' });
    }

    try {
      // Обрабатываем только lead events
      if (event?.event_type === 'lead' && event?.data) {
        const leadId = event.data.lead_id;

        // ЯВНАЯ проверка дублей ПЕРЕД обработкой
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id')
          .eq('leadgen_id', leadId)
          .maybeSingle();

        if (existingLead) {
          log.info({
            correlationId,
            lead_id: leadId,
            existing_db_id: existingLead.id,
            duration_ms: Date.now() - startTime
          }, '[tiktokWebhooks] ℹ️ Duplicate webhook - lead already exists, skipping');
          return res.code(200).send({ success: true, duplicate: true });
        }

        log.info({
          correlationId,
          lead_id: leadId,
          advertiser_id: event.data.advertiser_id,
          campaign_id: event.data.campaign_id,
          page_id: event.data.page_id
        }, '[tiktokWebhooks] Processing lead event...');

        await processLeadEvent(event.data, correlationId, app);

        const duration = Date.now() - startTime;
        log.info({
          correlationId,
          lead_id: leadId,
          duration_ms: duration
        }, '[tiktokWebhooks] ✅ Lead event processed successfully');
      } else {
        log.info({
          correlationId,
          event_type: event?.event_type,
          raw_body_preview: JSON.stringify(event).substring(0, 200)
        }, '[tiktokWebhooks] ⏭️ Skipping non-lead event');
      }

      // TikTok ожидает 200 OK для подтверждения получения
      return res.code(200).send({ success: true });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      log.error({
        correlationId,
        error: error.message,
        error_code: error.code,
        stack: error.stack,
        event_type: event?.event_type,
        lead_id: event?.data?.lead_id,
        duration_ms: duration
      }, '[tiktokWebhooks] ❌ Error processing webhook event');

      // Всё равно возвращаем 200, чтобы TikTok не делал повторные попытки
      // (ошибки обработки логируем, но не возвращаем TikTok)
      return res.code(200).send({ success: true, processed: false });
    }
  });
}

/**
 * Обработка события лида
 */
async function processLeadEvent(leadData: TikTokLeadData, correlationId: string, app: FastifyInstance): Promise<void> {
  const processStartTime = Date.now();

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    advertiser_id: leadData.advertiser_id,
    campaign_id: leadData.campaign_id,
    page_id: leadData.page_id,
    ad_id: leadData.ad_id,
    fields_count: leadData.field_data?.length,
  }, '[tiktokWebhooks] 🔍 Starting lead processing');

  // ─── Валидация обязательных полей ────────────────────────────────────────────
  if (!leadData.advertiser_id) {
    log.warn({
      correlationId,
      lead_id: leadData.lead_id,
    }, '[tiktokWebhooks] ⚠️ Missing advertiser_id in lead data, skipping');
    return;
  }

  // ─── ФЛОУ 1: Найти аккаунт по advertiser_id (обязательно) ───────────────────
  // Аналог FB: найти аккаунт по page_id — без аккаунта лид принять невозможно
  const { data: adAccount, error: adAccountError } = await supabase
    .from('ad_accounts')
    .select('id, user_account_id')
    .eq('tiktok_business_id', leadData.advertiser_id)
    .maybeSingle();

  if (adAccountError) {
    log.error({
      correlationId,
      lead_id: leadData.lead_id,
      advertiser_id: leadData.advertiser_id,
      error: adAccountError.message,
    }, '[tiktokWebhooks] ❌ Supabase error querying ad_account, skipping');
    return;
  }

  if (!adAccount) {
    log.warn({
      correlationId,
      lead_id: leadData.lead_id,
      advertiser_id: leadData.advertiser_id,
    }, '[tiktokWebhooks] ⚠️ No ad_account found for advertiser_id, skipping');
    return;
  }

  const userAccountId = adAccount.user_account_id;
  const accountId = adAccount.id;

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    account_id: accountId,
    user_account_id: userAccountId,
  }, '[tiktokWebhooks] 🏢 Resolved ad_account');

  // ─── ФЛОУ 2: Привязка к направлению (опционально, для аналитики) ─────────────
  // Ищем по campaign_id → page_id, не блокирует сохранение лида
  let directionId: string | null = null;
  let matchedBy: string | null = null;

  if (leadData.campaign_id) {
    const { data } = await supabase
      .from('account_directions')
      .select('id')
      .eq('tiktok_campaign_id', leadData.campaign_id)
      .maybeSingle();
    if (data) {
      directionId = data.id;
      matchedBy = 'campaign_id';
    }
  }

  if (!directionId && leadData.page_id) {
    const { data } = await supabase
      .from('account_directions')
      .select('id')
      .eq('tiktok_instant_page_id', leadData.page_id)
      .maybeSingle();
    if (data) {
      directionId = data.id;
      matchedBy = 'page_id';
    }
  }

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    account_id: accountId,
    user_account_id: userAccountId,
    direction_id: directionId,
    matched_by: matchedBy,
    search_duration_ms: Date.now() - processStartTime,
  }, '[tiktokWebhooks] 🎯 Account resolved for lead');

  // ─── Парсинг полей ────────────────────────────────────────────────────────────
  // Предупреждение если field_data отсутствует или не массив
  if (!leadData.field_data || !Array.isArray(leadData.field_data)) {
    log.warn({
      correlationId,
      lead_id: leadData.lead_id,
      field_data_type: typeof leadData.field_data,
    }, '[tiktokWebhooks] ⚠️ field_data is missing or not an array, lead fields will be empty');
  }

  const fields = parseLeadFields(leadData.field_data);

  // Нормализация телефона
  let phoneRaw: string | undefined = fields.phone;
  let phoneNormalized: string | undefined;
  if (phoneRaw) {
    phoneNormalized = normalizePhone(phoneRaw);
    log.info({
      correlationId,
      lead_id: leadData.lead_id,
      phone_raw_masked: maskPhone(phoneRaw),
      phone_normalized_masked: maskPhone(phoneNormalized),
    }, '[tiktokWebhooks] 📞 Phone normalized');
  } else {
    log.warn({
      correlationId,
      lead_id: leadData.lead_id,
    }, '[tiktokWebhooks] ⚠️ Lead has no phone — CRM push will be skipped');
  }

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    has_name: !!fields.name,
    has_phone: !!phoneNormalized,
    phone_masked: maskPhone(phoneNormalized),
    has_email: !!fields.email,
    direction_id: directionId,
  }, '[tiktokWebhooks] 📋 Parsed lead fields');

  // ─── Дедупликация перед вставкой в БД ────────────────────────────────────────
  // Явная проверка до insert, чтобы не делать лишние CRM-пуши для дублей
  const { data: existingByLeadgenId } = await supabase
    .from('leads')
    .select('id')
    .eq('leadgen_id', leadData.lead_id)
    .maybeSingle();

  if (existingByLeadgenId) {
    log.info({
      correlationId,
      lead_id: leadData.lead_id,
      existing_db_id: existingByLeadgenId.id,
    }, '[tiktokWebhooks] ℹ️ Duplicate lead skipped (pre-insert check by leadgen_id)');
    return;
  }

  // ─── ФЛОУ 3: Сохранение лида в БД + CRM параллельно ─────────────────────────
  // CRM check до параллельных операций (как в FB)
  let bitrix24Enabled = false;
  try {
    const { checkBitrix24AutoCreate } = await import('../workflows/bitrix24Sync.js');
    const s = await checkBitrix24AutoCreate(userAccountId, accountId);
    bitrix24Enabled = s.enabled;
  } catch (err: any) {
    log.warn({ correlationId, err: err.message }, '[tiktokWebhooks][Bitrix24] Auto-create check failed');
  }

  let amocrmEnabled = false;
  try {
    const { checkAmoCRMAutoCreate } = await import('../workflows/amocrmSync.js');
    const s = await checkAmoCRMAutoCreate(userAccountId, accountId);
    amocrmEnabled = s.enabled;
  } catch (err: any) {
    log.warn({ correlationId, err: err.message }, '[tiktokWebhooks][AmoCRM] Auto-create check failed');
  }

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    bitrix24_enabled: bitrix24Enabled,
    amocrm_enabled: amocrmEnabled,
  }, '[tiktokWebhooks] 🔗 CRM integration status');

  const dbSavePromise = supabase
    .from('leads')
    .insert({
      user_account_id: userAccountId,
      account_id: accountId,
      direction_id: directionId,
      conversion_source: 'tiktok_instant_form',
      source_type: 'lead_form',
      leadgen_id: leadData.lead_id,
      name: fields.name || null,
      phone: phoneNormalized || null,
      email: fields.email || null,
      utm_source: 'tiktok_instant_form',
      utm_campaign: leadData.campaign_id || null,
    })
    .select('id')
    .single();

  const bitrix24Promise = bitrix24Enabled && phoneNormalized
    ? (async () => {
        const { pushLeadToBitrix24Direct } = await import('../workflows/bitrix24Sync.js');
        return pushLeadToBitrix24Direct(
          {
            name: fields.name || null,
            phone: phoneNormalized!,
            email: fields.email || null,
            utm_source: 'tiktok_instant_form',
            utm_campaign: leadData.campaign_id || null,
            source_description: 'TikTok Instant Forms',
          },
          userAccountId,
          accountId,
          app
        );
      })()
    : Promise.resolve(null);

  const amocrmPromise = amocrmEnabled && phoneNormalized
    ? (async () => {
        const { pushLeadToAmoCRMDirect } = await import('../workflows/amocrmSync.js');
        return pushLeadToAmoCRMDirect(
          {
            name: fields.name || null,
            phone: phoneNormalized!,
            email: fields.email || null,
            utm_source: 'tiktok_instant_form',
            utm_campaign: leadData.campaign_id || null,
            fieldData: (leadData.field_data || []).map(f => ({ name: f.field_name, values: [f.field_value] })),
          },
          userAccountId,
          accountId,
          app
        );
      })()
    : Promise.resolve(null);

  const [dbSettled, bitrix24Settled, amocrmSettled] = await Promise.allSettled([
    dbSavePromise,
    bitrix24Promise,
    amocrmPromise,
  ]);

  // Проверяем БД (критично)
  if (dbSettled.status === 'rejected') {
    log.error({ correlationId, error: dbSettled.reason?.message, lead_id: leadData.lead_id }, '[tiktokWebhooks] ❌ DB save rejected');
    return;
  }
  const { data: lead, error: insertError } = dbSettled.value;
  if (insertError) {
    if (insertError.code === '23505') {
      log.info({ correlationId, lead_id: leadData.lead_id }, '[tiktokWebhooks] ℹ️ Duplicate lead (DB unique constraint), skipping');
      return;
    }
    log.error({ correlationId, error: insertError.message, lead_id: leadData.lead_id }, '[tiktokWebhooks] ❌ DB insert error');
    return;
  }

  log.info({ correlationId, lead_db_id: lead?.id, lead_id: leadData.lead_id }, '[tiktokWebhooks] 💾 Lead saved to DB');

  const bitrix24Pushed = bitrix24Settled.status === 'fulfilled' && bitrix24Settled.value !== null;
  const amocrmPushed = amocrmSettled.status === 'fulfilled' && amocrmSettled.value !== null;

  // Обновляем лид с ID из Bitrix24
  if (lead?.id && bitrix24Settled.status === 'fulfilled' && bitrix24Settled.value) {
    const r = bitrix24Settled.value;
    const upd: Record<string, any> = {};
    if (r.bitrix24LeadId) { upd.bitrix24_lead_id = r.bitrix24LeadId; upd.bitrix24_entity_type = 'lead'; }
    if (r.bitrix24DealId) { upd.bitrix24_deal_id = r.bitrix24DealId; upd.bitrix24_entity_type = 'deal'; }
    if (r.bitrix24ContactId) upd.bitrix24_contact_id = r.bitrix24ContactId;
    if (Object.keys(upd).length > 0) {
      await supabase.from('leads').update(upd).eq('id', lead.id);
      log.info({ correlationId, lead_db_id: lead.id, ...upd }, '[tiktokWebhooks][Bitrix24] ✅ Lead linked');
    }
  } else if (bitrix24Enabled && bitrix24Settled.status === 'rejected') {
    log.warn({ correlationId, error: bitrix24Settled.reason?.message, lead_id: leadData.lead_id }, '[tiktokWebhooks][Bitrix24] ❌ Push failed');
  }

  // Обновляем лид с ID из AmoCRM
  if (lead?.id && amocrmSettled.status === 'fulfilled' && amocrmSettled.value) {
    const r = amocrmSettled.value;
    const upd: Record<string, any> = {};
    if (r.amocrmLeadId) upd.amocrm_lead_id = r.amocrmLeadId;
    if (r.amocrmContactId) upd.amocrm_contact_id = r.amocrmContactId;
    if (Object.keys(upd).length > 0) {
      await supabase.from('leads').update(upd).eq('id', lead.id);
      log.info({ correlationId, lead_db_id: lead.id, ...upd }, '[tiktokWebhooks][AmoCRM] ✅ Lead linked');
    }
  } else if (amocrmEnabled && amocrmSettled.status === 'rejected') {
    log.warn({ correlationId, error: amocrmSettled.reason?.message, lead_id: leadData.lead_id }, '[tiktokWebhooks][AmoCRM] ❌ Push failed');
  }

  // ─── ФЛОУ 4: Привязка к креативу (опционально, для ROI аналитики) ────────────
  if (lead?.id && leadData.ad_id) {
    try {
      const { data: mapping } = await supabase
        .from('ad_creative_mapping')
        .select('user_creative_id')
        .eq('ad_id', leadData.ad_id)
        .maybeSingle();

      if (mapping?.user_creative_id) {
        await supabase.from('leads').update({ creative_id: mapping.user_creative_id }).eq('id', lead.id);
        log.info({ correlationId, lead_db_id: lead.id, creative_id: mapping.user_creative_id, ad_id: leadData.ad_id }, '[tiktokWebhooks] 🔗 Lead linked to creative');
      } else {
        log.warn({ correlationId, ad_id: leadData.ad_id }, '[tiktokWebhooks] ⚠️ No creative mapping for ad_id');
      }
    } catch (err: any) {
      log.warn({ correlationId, error: err.message }, '[tiktokWebhooks] ⚠️ Creative mapping error (non-critical)');
    }
  }

  log.info({
    correlationId,
    lead_db_id: lead?.id,
    lead_id: leadData.lead_id,
    direction_id: directionId,
    bitrix24_pushed: bitrix24Pushed,
    amocrm_pushed: amocrmPushed,
    total_duration_ms: Date.now() - processStartTime,
  }, '[tiktokWebhooks] ✅ Lead created successfully');
}

/**
 * Парсинг полей лида из TikTok формата
 */
function parseLeadFields(fieldData: Array<{ field_name: string; field_value: string }>): {
  name?: string;
  phone?: string;
  email?: string;
  [key: string]: string | undefined;
} {
  const result: { [key: string]: string | undefined } = {};

  if (!fieldData || !Array.isArray(fieldData)) {
    return result;
  }

  for (const field of fieldData) {
    const fieldName = field.field_name.toLowerCase();

    // Маппинг стандартных полей TikTok
    if (fieldName.includes('name') || fieldName === 'full_name') {
      result.name = field.field_value;
    } else if (fieldName.includes('phone') || fieldName === 'phone_number') {
      result.phone = field.field_value;
    } else if (fieldName.includes('email')) {
      result.email = field.field_value;
    } else {
      // Сохраняем все остальные поля as-is
      result[field.field_name] = field.field_value;
    }
  }

  return result;
}
