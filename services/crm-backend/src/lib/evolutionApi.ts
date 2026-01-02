import { logger } from './logger.js';

// ==================== CONFIGURATION ====================

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

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

// ==================== MAIN FUNCTIONS ====================

/**
 * Send text message via Evolution API
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  const startTime = Date.now();
  const { instanceName, phone, message } = params;

  const formattedPhone = formatPhoneNumber(phone);

  logger.info({
    instanceName,
    phone: formattedPhone,
    messageLength: message.length
  }, '[EvolutionAPI] Sending message');

  try {
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
        delay: 1000, // 1 секунда задержки для естественности
      }),
      signal: controller.signal
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();

      logger.error({
        instanceName,
        phone: formattedPhone,
        status: response.status,
        error: errorText,
        durationMs: duration
      }, '[EvolutionAPI] HTTP error');

      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`
      };
    }

    const data = await response.json() as any;

    logger.info({
      instanceName,
      phone: formattedPhone,
      messageId: data.key?.id,
      durationMs: duration
    }, '[EvolutionAPI] Message sent successfully');

    return {
      success: true,
      key: data.key
    };

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
      phone: formattedPhone,
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

    const instances = (data || []).map((inst: any) => ({
      instanceName: inst.instance?.instanceName || inst.name,
      status: inst.instance?.status || inst.status || 'unknown',
      connected: inst.instance?.status === 'open' || inst.status === 'open'
    }));

    logger.debug({
      count: instances.length,
      connected: instances.filter(i => i.connected).length
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
