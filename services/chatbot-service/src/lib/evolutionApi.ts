import { createLogger } from './logger.js';
import { supabase } from './supabase.js';

const log = createLogger({ module: 'evolutionApi' });

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

interface SendMessageParams {
  instanceName: string;
  phone: string;
  message: string;
}

interface SendMessageResponse {
  success: boolean;
  key?: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  error?: string;
}

interface WabaChannelInfo {
  wabaPhoneId: string;
  accessToken: string;
}

type DeliveryChannel =
  | { type: 'evolution' }
  | { type: 'waba'; info: WabaChannelInfo };

function formatPhoneForWhatsApp(rawPhone: string): string {
  let formattedPhone = rawPhone.replace(/\D/g, '');

  // Legacy fallback: local RU number without country code
  if (!formattedPhone.startsWith('7') && formattedPhone.length === 10) {
    formattedPhone = `7${formattedPhone}`;
  }

  return formattedPhone;
}

function extractNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeErrorPayload(payload: string): string {
  if (!payload) return '';
  return payload
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"***"')
    .replace(/access_token=[^&\s]+/gi, 'access_token=***')
    .slice(0, 1200);
}

async function resolveWabaAccessToken(userAccountId: string, accountId: string | null): Promise<string | null> {
  if (accountId) {
    const { data: adAccount, error: adAccountError } = await supabase
      .from('ad_accounts')
      .select('access_token')
      .eq('id', accountId)
      .maybeSingle();

    if (adAccountError) {
      log.warn({ accountId, error: adAccountError.message }, 'Failed to fetch ad_account token for WABA');
    } else {
      const tokenFromAdAccount = extractNonEmptyString((adAccount as any)?.access_token);
      if (tokenFromAdAccount) {
        return tokenFromAdAccount;
      }
    }
  }

  const { data: userAccount, error: userError } = await supabase
    .from('user_accounts')
    .select('access_token')
    .eq('id', userAccountId)
    .maybeSingle();

  if (userError) {
    log.warn({ userAccountId, error: userError.message }, 'Failed to fetch user token for WABA');
    return null;
  }

  return extractNonEmptyString((userAccount as any)?.access_token);
}

async function findWabaPhoneRecord(instanceName: string): Promise<{
  waba_phone_id: string | null;
  user_account_id: string;
  account_id: string | null;
  connection_type: string | null;
} | null> {
  const normalizedInstanceName = instanceName.trim();

  if (!normalizedInstanceName) {
    return null;
  }

  const { data: byInstanceName, error: byInstanceNameError } = await supabase
    .from('whatsapp_phone_numbers')
    .select('waba_phone_id, user_account_id, account_id, connection_type')
    .eq('instance_name', normalizedInstanceName)
    .eq('is_active', true)
    .maybeSingle();

  if (byInstanceNameError) {
    log.warn({
      instanceName: normalizedInstanceName,
      error: byInstanceNameError.message
    }, 'Failed to resolve WhatsApp phone number by instance_name');
  }

  if (byInstanceName) {
    return byInstanceName as {
      waba_phone_id: string | null;
      user_account_id: string;
      account_id: string | null;
      connection_type: string | null;
    };
  }

  // Fallback for synthetic names like waba_<phone_number_id>
  if (normalizedInstanceName.startsWith('waba_')) {
    const fallbackWabaPhoneId = normalizedInstanceName.slice('waba_'.length);
    if (!fallbackWabaPhoneId) return null;

    const { data: byWabaPhoneId, error: byWabaPhoneIdError } = await supabase
      .from('whatsapp_phone_numbers')
      .select('waba_phone_id, user_account_id, account_id, connection_type')
      .eq('waba_phone_id', fallbackWabaPhoneId)
      .eq('is_active', true)
      .maybeSingle();

    if (byWabaPhoneIdError) {
      log.warn({
        instanceName: normalizedInstanceName,
        fallbackWabaPhoneId,
        error: byWabaPhoneIdError.message
      }, 'Failed to resolve WhatsApp phone number by fallback waba_phone_id');
    }

    if (byWabaPhoneId) {
      return byWabaPhoneId as {
        waba_phone_id: string | null;
        user_account_id: string;
        account_id: string | null;
        connection_type: string | null;
      };
    }
  }

  return null;
}

async function resolveDeliveryChannel(instanceName: string): Promise<DeliveryChannel> {
  const wabaRecord = await findWabaPhoneRecord(instanceName);

  if (!wabaRecord) {
    return { type: 'evolution' };
  }

  if (wabaRecord.connection_type !== 'waba') {
    return { type: 'evolution' };
  }

  const wabaPhoneId = extractNonEmptyString(wabaRecord.waba_phone_id);
  if (!wabaPhoneId) {
    log.warn({ instanceName }, 'WABA connection found but waba_phone_id is missing, fallback to Evolution');
    return { type: 'evolution' };
  }

  const accessToken = await resolveWabaAccessToken(wabaRecord.user_account_id, wabaRecord.account_id);
  if (!accessToken) {
    log.warn({ instanceName, wabaPhoneId }, 'WABA access token not found, fallback to Evolution');
    return { type: 'evolution' };
  }

  return {
    type: 'waba',
    info: {
      wabaPhoneId,
      accessToken
    }
  };
}

async function sendViaEvolution(params: SendMessageParams): Promise<SendMessageResponse> {
  const { instanceName, phone, message } = params;

  // Evolution API endpoint
  const url = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;
  const formattedPhone = formatPhoneForWhatsApp(phone);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_API_KEY
    },
    body: JSON.stringify({
      number: formattedPhone,
      text: message,
      delay: 1000,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evolution API error: ${response.status} - ${sanitizeErrorPayload(errorText)}`);
  }

  const data = await response.json() as any;

  return {
    success: true,
    key: data.key
  };
}

async function sendViaWaba(params: SendMessageParams, channelInfo: WabaChannelInfo): Promise<SendMessageResponse> {
  const { instanceName, phone, message } = params;
  const to = formatPhoneForWhatsApp(phone);

  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${channelInfo.wabaPhoneId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelInfo.accessToken}`
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        body: message
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WABA Cloud API error: ${response.status} - ${sanitizeErrorPayload(errorText)}`);
  }

  const data = await response.json() as {
    messages?: Array<{ id?: string }>;
  };

  const messageId = data.messages?.[0]?.id || `waba:${Date.now()}`;

  log.info({
    instanceName,
    wabaPhoneId: channelInfo.wabaPhoneId,
    phone: to,
    messageId
  }, 'Message sent via WABA Cloud API');

  return {
    success: true,
    key: {
      remoteJid: `${to}@s.whatsapp.net`,
      fromMe: true,
      id: messageId
    }
  };
}

/**
 * Send text message via Evolution API or WABA Cloud API
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  try {
    const { instanceName, phone } = params;

    const channel = await resolveDeliveryChannel(instanceName);

    log.info({
      instanceName,
      phone,
      channel: channel.type
    }, 'Sending WhatsApp message');

    const result = channel.type === 'waba'
      ? await sendViaWaba(params, channel.info)
      : await sendViaEvolution(params);

    log.info({
      instanceName,
      phone,
      channel: channel.type,
      messageId: result.key?.id
    }, 'Message sent successfully');

    return result;
  } catch (error: any) {
    log.error({
      error: error.message,
      instanceName: params.instanceName,
      phone: params.phone
    }, 'Failed to send WhatsApp message');

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send presence status (typing, recording, etc.)
 * Used to show "typing..." indicator before sending messages
 */
export async function sendPresence(
  instanceName: string,
  phone: string,
  presence: 'composing' | 'recording' | 'paused' = 'composing',
  delayMs: number = 1500
): Promise<boolean> {
  try {
    const channel = await resolveDeliveryChannel(instanceName);

    // Meta Cloud API does not provide the same typing endpoint as Evolution.
    // We keep behavior graceful and continue without hard failure.
    if (channel.type === 'waba') {
      log.debug({ instanceName, phone, presence, delayMs }, 'Skipping presence for WABA channel');
      return true;
    }

    const formattedPhone = formatPhoneForWhatsApp(phone);
    const url = `${EVOLUTION_API_URL}/chat/sendPresence/${instanceName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: formattedPhone,
        presence,
        delay: delayMs
      })
    });

    if (!response.ok) {
      log.warn({ instanceName, phone, presence }, 'Failed to send presence');
      return false;
    }

    log.debug({ instanceName, phone, presence, delayMs }, 'Presence sent');
    return true;
  } catch (error: any) {
    log.warn({ error: error.message, instanceName, phone }, 'Error sending presence');
    return false;
  }
}

/**
 * Check if instance is connected and ready
 */
export async function checkInstanceStatus(instanceName: string): Promise<boolean> {
  try {
    const channel = await resolveDeliveryChannel(instanceName);

    if (channel.type === 'waba') {
      return true;
    }

    const url = `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': EVOLUTION_API_KEY
      }
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as any;

    // Check if instance is connected
    return data.state === 'open';
  } catch (error: any) {
    log.error({ error: error.message, instanceName }, 'Failed to check instance status');
    return false;
  }
}

/**
 * Send message with retry logic
 */
export async function sendWhatsAppMessageWithRetry(
  params: SendMessageParams,
  maxRetries: number = 3
): Promise<SendMessageResponse> {
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendWhatsAppMessage(params);

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        log.warn({
          attempt,
          maxRetries,
          delay,
          error: lastError
        }, 'Retrying message send');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error: any) {
      lastError = error.message;

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  log.error({
    instanceName: params.instanceName,
    phone: params.phone,
    attempts: maxRetries,
    lastError
  }, 'Failed to send message after retries');

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`
  };
}
