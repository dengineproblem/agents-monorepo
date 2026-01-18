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

    // Верификация подписи
    const signature = req.headers['x-tiktok-signature'] as string | undefined;
    const rawBody = JSON.stringify(req.body);

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
          .eq('external_lead_id', leadId)
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

        await processLeadEvent(event.data, correlationId);

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
async function processLeadEvent(leadData: TikTokLeadData, correlationId: string): Promise<void> {
  const processStartTime = Date.now();

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    page_id: leadData.page_id,
    ad_id: leadData.ad_id,
    adgroup_id: leadData.adgroup_id,
    campaign_id: leadData.campaign_id,
    advertiser_id: leadData.advertiser_id,
    fields_count: leadData.field_data?.length,
    create_time: leadData.create_time
  }, '[tiktokWebhooks] 🔍 Starting lead processing');

  // Парсим поля лида
  const fields = parseLeadFields(leadData.field_data);

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    has_name: !!fields.name,
    has_phone: !!fields.phone,
    phone_masked: maskPhone(fields.phone),
    has_email: !!fields.email,
    email_masked: maskEmail(fields.email),
    extra_fields: Object.keys(fields).filter(k => !['name', 'phone', 'email'].includes(k))
  }, '[tiktokWebhooks] 📋 Parsed lead fields');

  // Ищем направление по campaign_id, page_id или advertiser_id
  let direction = null;
  let matchedBy: string | null = null;

  // 1. Сначала по campaign_id (самый точный)
  if (leadData.campaign_id) {
    log.debug({ campaign_id: leadData.campaign_id }, '[tiktokWebhooks] Searching by campaign_id...');
    const { data, error } = await supabase
      .from('account_directions')
      .select('id, user_account_id, account_id, name')
      .eq('tiktok_campaign_id', leadData.campaign_id)
      .single();

    if (data) {
      direction = data;
      matchedBy = 'campaign_id';
    } else if (error && error.code !== 'PGRST116') {
      log.warn({ error: error.message }, '[tiktokWebhooks] Error searching by campaign_id');
    }
  }

  // 2. Затем по page_id (Instant Page)
  if (!direction && leadData.page_id) {
    log.debug({ page_id: leadData.page_id }, '[tiktokWebhooks] Searching by page_id...');
    const { data, error } = await supabase
      .from('account_directions')
      .select('id, user_account_id, account_id, name')
      .eq('tiktok_instant_page_id', leadData.page_id)
      .single();

    if (data) {
      direction = data;
      matchedBy = 'page_id';
    } else if (error && error.code !== 'PGRST116') {
      log.warn({ error: error.message }, '[tiktokWebhooks] Error searching by page_id');
    }
  }

  // 3. Fallback: ищем по advertiser_id (если у юзера только одно направление TikTok)
  if (!direction && leadData.advertiser_id) {
    log.debug({ advertiser_id: leadData.advertiser_id }, '[tiktokWebhooks] Searching by advertiser_id...');

    // Находим ad_account по advertiser_id
    const { data: adAccount } = await supabase
      .from('ad_accounts')
      .select('id')
      .eq('tiktok_advertiser_id', leadData.advertiser_id)
      .single();

    if (adAccount) {
      // Проверяем, есть ли единственное TikTok направление
      const { data: directions } = await supabase
        .from('account_directions')
        .select('id, user_account_id, account_id, name')
        .eq('account_id', adAccount.id)
        .eq('platform', 'tiktok')
        .eq('tiktok_objective', 'lead_generation');

      if (directions?.length === 1) {
        direction = directions[0];
        matchedBy = 'advertiser_id (single direction)';
        log.info({
          advertiser_id: leadData.advertiser_id,
          direction_id: direction.id
        }, '[tiktokWebhooks] Found single TikTok lead_generation direction by advertiser_id');
      } else if (directions && directions.length > 1) {
        log.warn({
          advertiser_id: leadData.advertiser_id,
          directions_count: directions.length
        }, '[tiktokWebhooks] Multiple TikTok directions found, cannot auto-match');
      }
    }
  }

  if (!direction) {
    log.warn({
      correlationId,
      lead_id: leadData.lead_id,
      campaign_id: leadData.campaign_id,
      page_id: leadData.page_id,
      advertiser_id: leadData.advertiser_id,
      search_duration_ms: Date.now() - processStartTime
    }, '[tiktokWebhooks] ⚠️ Direction not found for lead, skipping');
    return;
  }

  log.info({
    correlationId,
    lead_id: leadData.lead_id,
    direction_id: direction.id,
    direction_name: direction.name,
    matched_by: matchedBy,
    search_duration_ms: Date.now() - processStartTime
  }, '[tiktokWebhooks] 🎯 Found direction for lead');

  // Создаём лид в базе данных
  const insertStartTime = Date.now();
  const { data: lead, error: insertError } = await supabase
    .from('leads')
    .insert({
      user_account_id: direction.user_account_id,
      account_id: direction.account_id,
      direction_id: direction.id,
      source: 'tiktok_instant_form',
      external_lead_id: leadData.lead_id,
      name: fields.name,
      phone: fields.phone,
      email: fields.email,
      ad_id: leadData.ad_id,
      adgroup_id: leadData.adgroup_id,
      campaign_id: leadData.campaign_id,
      platform: 'tiktok',
      raw_data: {
        tiktok_lead_id: leadData.lead_id,
        tiktok_page_id: leadData.page_id,
        tiktok_advertiser_id: leadData.advertiser_id,
        // Сохраняем только имена полей, не значения (для безопасности PII)
        field_names: leadData.field_data?.map(f => f.field_name) || [],
        fields_count: leadData.field_data?.length || 0,
        create_time: leadData.create_time,
        matched_by: matchedBy,
        correlation_id: correlationId
      }
    })
    .select()
    .single();

  if (insertError) {
    // Проверяем на дублирование (unique constraint violation)
    if (insertError.code === '23505') {
      log.info({
        correlationId,
        lead_id: leadData.lead_id,
        direction_id: direction.id,
        total_duration_ms: Date.now() - processStartTime
      }, '[tiktokWebhooks] ℹ️ Lead already exists (duplicate via DB constraint), skipping');
      return;
    }

    log.error({
      correlationId,
      error: insertError.message,
      error_code: insertError.code,
      error_details: insertError.details,
      lead_id: leadData.lead_id,
      direction_id: direction.id
    }, '[tiktokWebhooks] ❌ Error inserting lead');
    throw insertError;
  }

  const totalDuration = Date.now() - processStartTime;
  log.info({
    correlationId,
    lead_db_id: lead?.id,
    lead_id: leadData.lead_id,
    direction_id: direction.id,
    direction_name: direction.name,
    matched_by: matchedBy,
    insert_duration_ms: Date.now() - insertStartTime,
    total_duration_ms: totalDuration
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
