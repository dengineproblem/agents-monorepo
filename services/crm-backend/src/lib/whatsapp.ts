/**
 * WhatsApp Integration via Evolution API
 */

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

export interface SendMessageParams {
  instanceName: string;
  phone: string;
  message: string;
}

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Отправляет WhatsApp сообщение через Evolution API
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<SendMessageResponse> {
  try {
    const { instanceName, phone, message } = params;

    // Format phone number (remove non-digits, add country code if needed)
    let formattedPhone = phone.replace(/\D/g, '');

    // If doesn't start with country code, assume it's Russian number
    if (!formattedPhone.startsWith('7') && formattedPhone.length === 10) {
      formattedPhone = '7' + formattedPhone;
    }

    const url = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: `${formattedPhone}@s.whatsapp.net`,
        textMessage: {
          text: message
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Evolution API error:', errorText);
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`
      };
    }

    const data = await response.json();

    return {
      success: true,
      messageId: data.key?.id || data.messageId
    };
  } catch (error: any) {
    console.error('Failed to send WhatsApp message:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Отправляет WhatsApp сообщение с повторными попытками
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

      // Подождать перед следующей попыткой
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    } catch (error: any) {
      lastError = error.message;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} retries: ${lastError}`
  };
}
