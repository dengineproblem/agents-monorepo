import { logger } from './logger.js';
import { supabase } from './supabase.js';

// ==================== CONFIGURATION ====================

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

// Таймаут для запросов (10 секунд)
const REQUEST_TIMEOUT_MS = 10000;

// ==================== INTERFACES ====================

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

// ==================== UTILITIES ====================

/**
 * Create abort controller with timeout
 */
function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

/**
 * Format phone number for WhatsApp
 * - Removes all non-digit characters
 * - Adds Russian country code if needed
 */
function formatPhoneNumber(phone: string): string {
  let formatted = phone.replace(/\D/g, '');

  // Если 10 цифр и не начинается с 7 - добавляем 7 (Россия)
  if (!formatted.startsWith('7') && formatted.length === 10) {
    formatted = '7' + formatted;
  }

  return formatted;
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
      logger.warn({ accountId, error: adAccountError.message }, '[EvolutionAPI] Failed to fetch ad_account token for WABA');
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
    logger.warn({ userAccountId, error: userError.message }, '[EvolutionAPI] Failed to fetch user token for WABA');
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
    logger.warn({
      instanceName: normalizedInstanceName,
      error: byInstanceNameError.message
    }, '[EvolutionAPI] Failed to resolve phone number by instance_name');
  }

  if (byInstanceName) {
    return byInstanceName as {
      waba_phone_id: string | null;
      user_account_id: string;
      account_id: string | null;
      connection_type: string | null;
    };
  }

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
      logger.warn({
        instanceName: normalizedInstanceName,
        fallbackWabaPhoneId,
        error: byWabaPhoneIdError.message
      }, '[EvolutionAPI] Failed to resolve phone number by fallback waba_phone_id');
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

  if (!wabaRecord || wabaRecord.connection_type !== 'waba') {
    logger.debug({
      instanceName,
      connectionType: wabaRecord?.connection_type || null
    }, '[EvolutionAPI] Delivery channel resolved to Evolution');
    return { type: 'evolution' };
  }

  const wabaPhoneId = extractNonEmptyString(wabaRecord.waba_phone_id);
  if (!wabaPhoneId) {
    logger.warn({ instanceName }, '[EvolutionAPI] WABA connection found but waba_phone_id missing, fallback to Evolution');
    return { type: 'evolution' };
  }

  const accessToken = await resolveWabaAccessToken(wabaRecord.user_account_id, wabaRecord.account_id);
  if (!accessToken) {
    logger.warn({ instanceName, wabaPhoneId }, '[EvolutionAPI] WABA access token not found, fallback to Evolution');
    return { type: 'evolution' };
  }

  logger.debug({
    instanceName,
    wabaPhoneId
  }, '[EvolutionAPI] Delivery channel resolved to WABA');

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
  const formattedPhone = formatPhoneNumber(phone);

  const url = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;
  const controller = createTimeoutController(REQUEST_TIMEOUT_MS);

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
    }),
    signal: controller.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      error: `HTTP ${response.status}: ${sanitizeErrorPayload(errorText)}`
    };
  }

  const data = await response.json() as any;
  return {
    success: true,
    key: data.key
  };
}

async function sendViaWaba(params: SendMessageParams, channelInfo: WabaChannelInfo): Promise<SendMessageResponse> {
  const { instanceName, phone, message } = params;
  const to = formatPhoneNumber(phone);
  const controller = createTimeoutController(REQUEST_TIMEOUT_MS);

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
    }),
    signal: controller.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      success: false,
      error: `HTTP ${response.status}: ${sanitizeErrorPayload(errorText)}`
    };
  }

  const data = await response.json() as { messages?: Array<{ id?: string }> };
  const messageId = data.messages?.[0]?.id || `waba:${Date.now()}`;

  logger.info({
    instanceName,
    wabaPhoneId: channelInfo.wabaPhoneId,
    phone: to,
    messageId
  }, '[EvolutionAPI] Message sent via WABA Cloud API');

  return {
    success: true,
    key: {
      remoteJid: `${to}@s.whatsapp.net`,
      fromMe: true,
      id: messageId
    }
  };
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Send text message via Evolution API
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  const startTime = Date.now();
  const { instanceName, phone } = params;

  logger.info({
    instanceName,
    phone: formatPhoneNumber(phone),
    messageLength: params.message.length
  }, '[EvolutionAPI] Sending message');

  try {
    const channel = await resolveDeliveryChannel(instanceName);
    const result = channel.type === 'waba'
      ? await sendViaWaba(params, channel.info)
      : await sendViaEvolution(params);

    const duration = Date.now() - startTime;

    if (!result.success) {
      logger.error({
        instanceName,
        channel: channel.type,
        error: result.error,
        durationMs: duration
      }, '[EvolutionAPI] Delivery channel returned error');

      return result;
    }

    logger.info({
      instanceName,
      phone: formatPhoneNumber(phone),
      channel: channel.type,
      messageId: result.key?.id,
      durationMs: duration
    }, '[EvolutionAPI] Message sent successfully');

    return result;

  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Определяем тип ошибки
    let errorMessage = error.message;
    let errorType = 'unknown';

    if (error.name === 'AbortError') {
      errorMessage = `Request timeout after ${REQUEST_TIMEOUT_MS}ms`;
      errorType = 'timeout';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - Evolution API unavailable';
      errorType = 'connection';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'DNS resolution failed';
      errorType = 'dns';
    }

    logger.error({
      instanceName,
      phone: formatPhoneNumber(phone),
      error: errorMessage,
      errorType,
      durationMs: duration
    }, '[EvolutionAPI] Failed to send message');

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Check if WhatsApp instance is connected
 */
export async function checkInstanceStatus(instanceName: string): Promise<{
  connected: boolean;
  state?: string;
  error?: string;
}> {
  logger.debug({ instanceName }, '[EvolutionAPI] Checking instance status');

  try {
    const channel = await resolveDeliveryChannel(instanceName);
    if (channel.type === 'waba') {
      return {
        connected: true,
        state: 'open'
      };
    }

    const url = `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`;
    const controller = createTimeoutController(5000); // 5 секунд для проверки статуса

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': EVOLUTION_API_KEY
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        connected: false,
        error: `HTTP ${response.status}`
      };
    }

    const data = await response.json() as any;
    const isConnected = data.state === 'open';

    logger.debug({
      instanceName,
      state: data.state,
      connected: isConnected
    }, '[EvolutionAPI] Instance status checked');

    return {
      connected: isConnected,
      state: data.state
    };

  } catch (error: any) {
    logger.warn({
      instanceName,
      error: error.message
    }, '[EvolutionAPI] Failed to check instance status');

    return {
      connected: false,
      error: error.message
    };
  }
}

/**
 * Fetch all instances from Evolution API with their connection status
 */
export async function fetchAllInstances(): Promise<{
  instances: Array<{
    instanceName: string;
    status: string;
    connected: boolean;
  }>;
  error?: string;
}> {
  logger.debug({}, '[EvolutionAPI] Fetching all instances');

  try {
    const url = `${EVOLUTION_API_URL}/instance/fetchInstances`;
    const controller = createTimeoutController(10000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': EVOLUTION_API_KEY
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        instances: [],
        error: `HTTP ${response.status}`
      };
    }

    const data = await response.json() as any[];

    // Log raw response for debugging
    logger.info({
      rawResponse: JSON.stringify(data).slice(0, 1000),
      firstInstance: data?.[0] ? JSON.stringify(data[0]).slice(0, 500) : null
    }, '[EvolutionAPI] Raw fetchInstances response');

    const instances = (data || []).map((inst: any) => ({
      instanceName: inst.instance?.instanceName || inst.name || inst.instanceName,
      status: inst.instance?.status || inst.connectionStatus || 'unknown',
      connected: (inst.instance?.status === 'open') || (inst.connectionStatus === 'open')
    }));

    logger.info({
      count: instances.length,
      connected: instances.filter(i => i.connected).length,
      instanceNames: instances.map(i => i.instanceName)
    }, '[EvolutionAPI] Fetched all instances');

    return { instances };

  } catch (error: any) {
    logger.warn({
      error: error.message
    }, '[EvolutionAPI] Failed to fetch instances');

    return {
      instances: [],
      error: error.message
    };
  }
}

/**
 * Send message with retry logic and exponential backoff
 */
export async function sendWhatsAppMessageWithRetry(
  params: SendMessageParams,
  maxRetries: number = 3
): Promise<SendMessageResponse> {
  let lastError: string = '';

  logger.debug({
    instanceName: params.instanceName,
    phone: params.phone,
    maxRetries
  }, '[EvolutionAPI] Starting send with retry');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendWhatsAppMessage(params);

      if (result.success) {
        if (attempt > 1) {
          logger.info({
            instanceName: params.instanceName,
            phone: params.phone,
            attempt
          }, '[EvolutionAPI] Message sent after retry');
        }
        return result;
      }

      lastError = result.error || 'Unknown error';

      // Не ретраим некоторые ошибки
      if (lastError.includes('instance not found') ||
          lastError.includes('not connected') ||
          lastError.includes('invalid number')) {
        logger.warn({
          instanceName: params.instanceName,
          phone: params.phone,
          error: lastError
        }, '[EvolutionAPI] Non-retryable error, aborting');
        return result;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

        logger.warn({
          instanceName: params.instanceName,
          phone: params.phone,
          attempt,
          maxRetries,
          nextRetryIn: `${delay}ms`,
          error: lastError
        }, '[EvolutionAPI] Retrying after delay');

        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error: any) {
      lastError = error.message;

      logger.error({
        instanceName: params.instanceName,
        phone: params.phone,
        attempt,
        error: lastError
      }, '[EvolutionAPI] Unexpected error during send');

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error({
    instanceName: params.instanceName,
    phone: params.phone,
    attempts: maxRetries,
    lastError
  }, '[EvolutionAPI] All retry attempts failed');

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`
  };
}
