import { logger } from './logger.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

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

/**
 * Send text message via Evolution API
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  try {
    const { instanceName, phone, message } = params;

    logger.info({ instanceName, phone }, 'Sending WhatsApp notification');

    // Format phone number (remove non-digits, add country code if needed)
    let formattedPhone = phone.replace(/\D/g, '');

    // If doesn't start with country code, assume it's Russian number
    if (!formattedPhone.startsWith('7') && formattedPhone.length === 10) {
      formattedPhone = '7' + formattedPhone;
    }

    // Evolution API endpoint
    const url = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: formattedPhone,
        text: message,
        delay: 1000, // 1 second delay to appear more human-like
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Evolution API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    logger.info({
      instanceName,
      phone,
      messageId: data.key?.id
    }, 'Notification sent successfully');

    return {
      success: true,
      key: data.key
    };
  } catch (error: any) {
    logger.error({
      error: error.message,
      instanceName: params.instanceName,
      phone: params.phone
    }, 'Failed to send WhatsApp notification');

    return {
      success: false,
      error: error.message
    };
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
        logger.warn({
          attempt,
          maxRetries,
          delay,
          error: lastError
        }, 'Retrying notification send');
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

  logger.error({
    instanceName: params.instanceName,
    phone: params.phone,
    attempts: maxRetries,
    lastError
  }, 'Failed to send notification after retries');

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`
  };
}
