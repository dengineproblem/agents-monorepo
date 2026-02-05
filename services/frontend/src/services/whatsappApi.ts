import { API_BASE_URL } from '@/config/api';
import { shouldFilterByAccountId } from '@/utils/multiAccountHelper';

export type ConnectionType = 'evolution' | 'waba';

export interface WhatsAppNumber {
  id: string;
  phone_number: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  instance_name: string | null;
  connection_status: 'connecting' | 'connected' | 'disconnected' | null;
  connection_type: ConnectionType;
  waba_phone_id: string | null;
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
  async getNumbers(userAccountId: string, accountId?: string): Promise<WhatsAppNumber[]> {
    let url = `${API_BASE_URL}/whatsapp-numbers?userAccountId=${userAccountId}`;
    // Передаём accountId ТОЛЬКО в multi-account режиме (см. MULTI_ACCOUNT_GUIDE.md)
    if (shouldFilterByAccountId(accountId)) {
      url += `&accountId=${accountId}`;
    }
    const response = await fetch(url);
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
    phoneNumberId: string,
    accountId?: string  // UUID из ad_accounts.id для мультиаккаунтности
  ): Promise<WhatsAppInstanceResponse> {
    const response = await fetch(`${API_BASE_URL}/whatsapp/instances/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccountId, phoneNumberId, accountId }),
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
      `${API_BASE_URL}/whatsapp/instances/${instanceName}/status`
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
      `${API_BASE_URL}/whatsapp/instances/${instanceName}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to disconnect instance');
    }
  },

  /**
   * Сбросить зависший статус подключения
   */
  async resetConnection(phoneNumberId: string, userAccountId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/whatsapp-numbers/${phoneNumberId}/reset-connection?userAccountId=${userAccountId}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      throw new Error('Failed to reset connection');
    }
  },

  /**
   * Удалить WABA номер
   */
  async deleteWabaNumber(phoneNumberId: string, userAccountId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE_URL}/whatsapp-numbers/${phoneNumberId}?userAccountId=${userAccountId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      throw new Error('Failed to delete WABA number');
    }
  },
};
