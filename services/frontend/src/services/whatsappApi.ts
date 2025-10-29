import { API_BASE_URL } from '@/config/api';

export interface WhatsAppNumber {
  id: string;
  phone_number: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  instance_name: string | null;
  connection_status: 'connecting' | 'connected' | 'disconnected' | null;
}

export interface WhatsAppInstanceResponse {
  instance: {
    instance_name: string;
    status: string;
  };
  qrcode: {
    base64?: string;
    code?: string;
    count: number;
  };
}

export const whatsappApi = {
  /**
   * Получить список WhatsApp номеров пользователя
   */
  async getNumbers(userAccountId: string): Promise<WhatsAppNumber[]> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp-numbers?userAccountId=${userAccountId}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch WhatsApp numbers');
    }
    const data = await response.json();
    return data.numbers || [];
  },

  /**
   * Создать WhatsApp инстанс и получить QR-код
   */
  async createInstance(
    userAccountId: string,
    phoneNumberId: string
  ): Promise<WhatsAppInstanceResponse> {
    const response = await fetch(`${API_BASE_URL}/api/whatsapp/instances/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccountId, phoneNumberId }),
    });
    if (!response.ok) {
      throw new Error('Failed to create WhatsApp instance');
    }
    return response.json();
  },

  /**
   * Получить статус подключения инстанса
   */
  async getInstanceStatus(instanceName: string): Promise<{ status: string }> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp/instances/${instanceName}/status`
    );
    if (!response.ok) {
      throw new Error('Failed to get instance status');
    }
    const data = await response.json();
    return { status: data.instance.status };
  },

  /**
   * Отключить WhatsApp инстанс
   */
  async disconnectInstance(instanceName: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp/instances/${instanceName}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to disconnect instance');
    }
  },
};
